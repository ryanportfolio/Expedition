// Drawing for the rival influence ring and the belief bar. Render-side only: draw functions write
// into the view buffer; nothing here runs in update().
//
// Ring: a dashed circle on the ground around the rival village. Points are sampled on the circle
// in tile space, lifted to the drawn ground surface, projected, and kept only where
// the terrain does not hide them: a point is visible when picking its own screen pixel finds the
// point again (pickTile returns the front-most surface hit, so a hill in front wins). The projection
// has no rotation, so visibility does not depend on the camera; the samples are built once per map
// and ring and reused every frame. Dashes are measured in screen pixels along the circle, longer
// and brighter as belief rises, so the ring reads as a faint dotted line at 0 and a bright chain
// near conversion. The drawn ground is stepped (each tile's top diamond sits at its stored height,
// water tiles flat at sea level as the terrain system draws them), so by default a point sits on the
// top of the tile under it (tileSurface); pass world.heightAt instead for a smooth surface. Colors go through the frame's LUT (ramp `creature-accent`: amber gold when the
// player is good, ember red when evil).
//
// Belief bar: a small meter above the rival temple, projected from the temple's world position and
// drawn as a screen overlay so buildings and trees never cover it. The fill splits into impress
// (pale gold, left) and scare (ember, right) in proportion to the two totals.
import { worldToScreen, pickTile } from '../world/iso.js';
import { idx } from '../art/palette.js';
import { surfaceHeights } from '../terrain/cache.js';

const RING_RAMP = 'creature-accent';
const SAMPLES_PER_PX = 2; // circle samples per screen pixel of circumference (gapless after rounding)
const PERIOD = 6; // dash period in screen px
const BAR = { w: 27, h: 5, lift: 5 }; // outer size in px; gap above the temple sprite
const COL = {
  edge: idx('shadow', 0),
  outline: idx('ink', 0),
  trough: idx('ink', 2),
  troughLit: idx('ink', 3),
  impress: idx('fire', 6),
  impressLit: idx('fire', 7),
  scare: idx('fire', 2),
  scareLit: idx('fire', 3),
};

/** Height of the drawn tile top under (x, y): the stepped surface the terrain pass draws, from the
 * terrain cache's own surfaceHeights (water tiles at sea level, so ring points over the sea sit on
 * the water, not below it on the sea bed). Snapshot of the map at call time. */
export function tileSurface(world) {
  const surf = surfaceHeights(world);
  return (x, y) => {
    const tx = Math.min(world.w - 1, Math.max(0, Math.floor(x))), ty = Math.min(world.h - 1, Math.max(0, Math.floor(y)));
    return surf[ty * world.w + tx];
  };
}

/** Builds the ring samples: { px, py (world px), arc (screen px along the ring), vis, n }. */
export function buildRing(world, ring, surface = tileSurface(world)) {
  const { x: cx, y: cy, r } = ring;
  // The circle projects to an ellipse with semi-axes 16 r sqrt2 and 8 r sqrt2 screen px (flat
  // ground); its circumference (Ramanujan) sets the sample count. Slopes only add length.
  const a = 16 * r * Math.SQRT2, b = 8 * r * Math.SQRT2;
  const circ = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  const n = Math.max(64, Math.ceil(circ * SAMPLES_PER_PX));
  const px = new Int32Array(n), py = new Int32Array(n), arc = new Float32Array(n), vis = new Uint8Array(n);
  const bounds = { w: world.w, h: world.h };
  let count = 0, len = 0, lastX = null, lastY = null, lastPx = null, lastPy = null;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = cx + r * Math.cos(t), y = cy + r * Math.sin(t);
    if (x < 0 || y < 0 || x >= world.w || y >= world.h) { lastX = null; continue; }
    const z = surface(x, y);
    const s = worldToScreen(x, y, z);
    if (lastX !== null) len += Math.hypot(s.sx - lastX, s.sy - lastY);
    lastX = s.sx; lastY = s.sy;
    const ix = Math.round(s.sx), iy = Math.round(s.sy);
    if (ix === lastPx && iy === lastPy) continue;
    lastPx = ix; lastPy = iy;
    const hit = pickTile(ix, iy, surface, bounds);
    px[count] = ix; py[count] = iy; arc[count] = len;
    vis[count] = hit && Math.hypot(hit.x - x, hit.y - y) < 0.35 ? 1 : 0;
    count++;
  }
  return { px: px.subarray(0, count), py: py.subarray(0, count), arc: arc.subarray(0, count), vis: vis.subarray(0, count), n: count };
}

/** Ring look for a belief level: dash length (px out of PERIOD) and shade on the ring ramp. */
export function ringStyle(belief, converted) {
  if (converted) return { on: PERIOD, shade: 7 }; // solid and brightest once the village is won
  const b = Math.max(0, Math.min(1, belief));
  return { on: 1 + Math.round(b * 3), shade: 3 + Math.round(b * 3) };
}

/** Paints the ring samples into the view buffer (call after terrain, before entities). */
export function drawRing(ctx, samples, belief, converted) {
  const { buf, w, h, camX, camY, lut } = ctx;
  const { on, shade } = ringStyle(belief, converted);
  const lit = lut[idx(RING_RAMP, shade)], edge = lut[COL.edge];
  const { px, py, arc, vis, n } = samples;
  // Two passes: a one-pixel dark lip under every dash pixel (keeps it readable on pale sand and
  // stone), then the dash pixels themselves, so a lip never covers a neighbouring dash.
  for (let pass = 0; pass < 2; pass++) {
    const c = pass === 0 ? edge : lit, dy = pass === 0 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      if (!vis[i] || arc[i] % PERIOD >= on) continue;
      const x = px[i] - camX, y = py[i] - camY + dy;
      if (x >= 0 && x < w && y >= 0 && y < h) buf[y * w + x] = c;
    }
  }
}

/** Paints the belief bar with its top-center at view pixel (cx, top). */
export function drawBeliefBar(ctx, cx, top, belief, mix, converted) {
  const { buf, w, h, lut } = ctx;
  const x0 = Math.round(cx - (BAR.w >> 1)), y0 = Math.round(top);
  const put = (x, y, c) => { if (x >= 0 && x < w && y >= 0 && y < h) buf[y * w + x] = lut[c]; };
  const inner = BAR.w - 2;
  const b = converted ? 1 : Math.max(0, Math.min(1, belief));
  const fill = Math.round(b * inner);
  const im = Math.max(0, mix?.impress || 0), sc = Math.max(0, mix?.scare || 0);
  const imPx = im + sc > 0 ? Math.round((fill * im) / (im + sc)) : fill;
  for (let y = 0; y < BAR.h; y++) {
    for (let x = 0; x < BAR.w; x++) {
      const edgeX = x === 0 || x === BAR.w - 1, edgeY = y === 0 || y === BAR.h - 1;
      if (edgeX && edgeY) continue; // rounded corners
      if (edgeX || edgeY) { put(x0 + x, y0 + y, COL.outline); continue; }
      const i = x - 1, topRow = y === 1;
      let c;
      if (i < imPx) c = topRow ? COL.impressLit : COL.impress;
      else if (i < fill) c = topRow ? COL.scareLit : COL.scare;
      else c = topRow ? COL.troughLit : COL.trough;
      put(x0 + x, y0 + y, c);
    }
  }
  return { x: x0, y: y0, w: BAR.w, h: BAR.h, fill, impressPx: imPx };
}

export const BAR_SIZE = BAR;

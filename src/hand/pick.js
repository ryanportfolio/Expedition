// Entity picking under a view pixel. Each candidate's box is its sprite's rectangle around the
// projected anchor (mirrored for flipX), or a kind-sized box standing on its world point when it has
// no sprite, grown by HAND.pickPad and widened to HAND.pickMin. Large sprites also need an opaque
// pixel within pickPad of the pointer, so the transparent corners of a tree or the creature do not
// steal clicks. Among hits the front-most in draw order wins (depth x + y, then z, then id), which
// accounts for terrain height because boxes come from projected positions. Pure: no DOM.
import { compareDepth } from '../world/iso.js';
import { HAND } from './tunables.js';

const PIXEL_TEST_AREA = 400; // sprites bigger than this (in px) use the opaque-pixel test

/** View-pixel box { x0, y0, x1, y1 } (inclusive) of entity e, before padding. */
export function entityBox(e, camera, T = HAND) {
  const v = camera.worldToView(e.x, e.y, e.z ?? 0);
  const s = e.sprite;
  if (s && s.w && s.h) {
    const left = e.flipX ? v.sx - (s.w - 1 - s.ax) : v.sx - s.ax;
    return { x0: left, y0: v.sy - s.ay, x1: left + s.w - 1, y1: v.sy - s.ay + s.h - 1, v };
  }
  const hb = e.hitBox ?? T.hitBox[e.kind] ?? T.hitBox.default;
  const x0 = v.sx - Math.floor(hb.w / 2);
  return { x0, y0: v.sy - hb.h + 1, x1: x0 + hb.w - 1, y1: v.sy, v };
}

/** True when view pixel (sx, sy) is on entity e. */
export function hitsEntity(e, sx, sy, camera, T = HAND) {
  const b = entityBox(e, camera, T);
  let { x0, y0, x1, y1 } = b;
  const grow = (lo, hi) => {
    const need = T.pickMin - (hi - lo + 1);
    return need > 0 ? [lo - Math.floor(need / 2), hi + Math.ceil(need / 2)] : [lo, hi];
  };
  [x0, x1] = grow(x0, x1);
  [y0, y1] = grow(y0, y1);
  const pad = T.pickPad;
  if (sx < x0 - pad || sx > x1 + pad || sy < y0 - pad || sy > y1 + pad) return false;
  const s = e.sprite;
  if (!s || !s.data || s.w * s.h <= PIXEL_TEST_AREA) return true;
  // opaque pixel within pad of the pointer
  for (let dy = -pad; dy <= pad; dy++) {
    for (let dx = -pad; dx <= pad; dx++) {
      const px = sx + dx - b.x0, py = sy + dy - b.y0;
      if (px < 0 || py < 0 || px >= s.w || py >= s.h) continue;
      const col = e.flipX ? s.w - 1 - px : px;
      if (s.data[py * s.w + col]) return true;
    }
  }
  return false;
}

/**
 * Front-most entity under view pixel (sx, sy) that passes filter(e), or null.
 * near = { x, y } ground point to search around (HAND.queryRadius); without it every entity is tested.
 */
export function pickEntity(world, camera, sx, sy, filter, near = null, T = HAND) {
  const list = near ? world.query({ x: near.x, y: near.y, r: T.queryRadius }) : world.entities.values();
  let best = null;
  for (const e of list) {
    if (!filter(e) || !hitsEntity(e, sx, sy, camera, T)) continue;
    if (!best || compareDepth(e, best) > 0) best = e;
  }
  return best;
}

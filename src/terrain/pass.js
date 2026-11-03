// Per-frame terrain draw: copy the visible window of the cached index buffer through the LUT into
// the view buffer. Water pixels get a cheap animated glint keyed to sim time (deterministic).
// The cache is either one whole buffer (buildTerrainCache, checks) or chunks painted on first use
// (createTerrainChunks, the game); both draw the same pixels, since the glint is keyed to cache
// coordinates, not to the buffer a pixel sits in.

import { WATER_LO, WATER_HI, CHUNK } from './cache.js';
import { hash32 } from './noise.js';

// 64 x 64 glint phases; most cells never glint. A cell lights for one step out of 64.
const NEVER = 255; // phase of a cell that never glints
const GLINT = new Uint8Array(64 * 64);
for (let i = 0; i < GLINT.length; i++) {
  const h = hash32(i & 63, i >> 6, 977);
  GLINT[i] = (h & 7) < 3 ? (h >>> 8) & 63 : NEVER;
}
const GLINT_RATE = 5; // steps per second of sim time

/**
 * Draws the cache into ctx.buf at camera (ctx.camX, ctx.camY). time = sim seconds. With a chunked
 * cache, every chunk the view touches is painted first if need be; returns the number painted.
 */
export function drawTerrain(ctx, cache, time) {
  const { w: VW, h: VH, camX, camY } = ctx;
  const { w: CW, h: CH, ox, oy } = cache;
  const step = Math.floor(time * GLINT_RATE) & 63;
  // View pixel (vx, vy) shows cache pixel (vx + camX - ox, vy + camY - oy).
  const dx = camX - ox, dy = camY - oy;
  const vx0 = Math.max(0, -dx), vx1 = Math.min(VW, CW - dx);
  const vy0 = Math.max(0, -dy), vy1 = Math.min(VH, CH - dy);
  if (vx0 >= vx1 || vy0 >= vy1) return 0;
  if (cache.data) { copy(ctx, cache.data, CW, 0, 0, dx, dy, vx0, vx1, vy0, vy1, step); return 0; }
  const built = cache.built;
  const ci0 = Math.floor((vx0 + dx) / CHUNK), ci1 = Math.floor((vx1 - 1 + dx) / CHUNK);
  const cj0 = Math.floor((vy0 + dy) / CHUNK), cj1 = Math.floor((vy1 - 1 + dy) / CHUNK);
  cache.keep = Math.max(cache.keep, 2 * (ci1 - ci0 + 3) * (cj1 - cj0 + 3)); // the view and its prefetch ring, twice
  for (let cj = cj0; cj <= cj1; cj++) {
    for (let ci = ci0; ci <= ci1; ci++) {
      const cx0 = ci * CHUNK, cy0 = cj * CHUNK; // the chunk's cache pixel origin
      copy(ctx, cache.chunk(ci, cj), CHUNK, cx0, cy0, dx, dy,
        Math.max(vx0, cx0 - dx), Math.min(vx1, cx0 + CHUNK - dx), Math.max(vy0, cy0 - dy), Math.min(vy1, cy0 + CHUNK - dy), step);
    }
  }
  return cache.built - built;
}

/** Copies view rows [vy0, vy1) x columns [vx0, vx1) from `src` (stride sw, holding cache pixels
 * from (sx0, sy0)) through the LUT; view pixel (vx, vy) is cache pixel (vx + dx, vy + dy). */
function copy(ctx, src, sw, sx0, sy0, dx, dy, vx0, vx1, vy0, vy1, step) {
  const { buf, w: VW, lut } = ctx;
  for (let vy = vy0; vy < vy1; vy++) {
    const cy = vy + dy, row = (cy - sy0) * sw + dx - sx0, dst = vy * VW, grow = (cy & 63) << 6;
    for (let vx = vx0; vx < vx1; vx++) {
      let v = src[row + vx];
      if (!v) continue;
      if (v >= WATER_LO && v <= WATER_HI) {
        const shade = v - WATER_LO;
        if (shade >= 1 && shade <= 4) {
          // NEVER is tested before the phase sum: (255 + 1) & 63 === 0, so without it every
          // never-glint cell (about 5/8 of the sea) lit together at step 1, once every 12.8 s
          // (round 46).
          const g = GLINT[grow | (((vx + dx) >> 1) & 63)];
          if (g !== NEVER && ((g + step) & 63) === 0) v += 2;
        }
      }
      const c = lut[v];
      if (c) buf[dst + vx] = c;
    }
  }
}

/**
 * Paints up to `max` not yet painted chunks of a chunked cache in the ring one chunk wide round the
 * view (nearest the view's middle first), so a camera pan finds them ready. Returns the number painted.
 */
export function prefetchTerrain(ctx, cache, max = 1) {
  if (cache.data || max <= 0) return 0;
  const dx = ctx.camX - cache.ox, dy = ctx.camY - cache.oy;
  const ci0 = Math.floor(dx / CHUNK) - 1, ci1 = Math.floor((dx + ctx.w - 1) / CHUNK) + 1;
  const cj0 = Math.floor(dy / CHUNK) - 1, cj1 = Math.floor((dy + ctx.h - 1) / CHUNK) + 1;
  const mx = (ci0 + ci1) / 2, my = (cj0 + cj1) / 2, todo = [];
  for (let cj = Math.max(0, cj0); cj <= Math.min(cache.rows - 1, cj1); cj++)
    for (let ci = Math.max(0, ci0); ci <= Math.min(cache.cols - 1, ci1); ci++)
      if (!cache.has(ci, cj)) todo.push({ ci, cj, d: Math.hypot(ci - mx, cj - my) });
  todo.sort((a, b) => a.d - b.d || a.cj - b.cj || a.ci - b.ci);
  for (const t of todo.slice(0, max)) cache.chunk(t.ci, t.cj);
  return Math.min(max, todo.length);
}

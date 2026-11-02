// Per-frame terrain draw: copy the visible window of the cached index buffer through the LUT into
// the view buffer. Water pixels get a cheap animated glint keyed to sim time (deterministic).

import { WATER_LO, WATER_HI } from './cache.js';
import { hash32 } from './noise.js';

// 64 x 64 glint phases; most cells never glint. A cell lights for one step out of 64.
const NEVER = 255; // phase of a cell that never glints
const GLINT = new Uint8Array(64 * 64);
for (let i = 0; i < GLINT.length; i++) {
  const h = hash32(i & 63, i >> 6, 977);
  GLINT[i] = (h & 7) < 3 ? (h >>> 8) & 63 : NEVER;
}
const GLINT_RATE = 5; // steps per second of sim time

/** Draws the cache into ctx.buf at camera (ctx.camX, ctx.camY). time = sim seconds. */
export function drawTerrain(ctx, cache, time) {
  const { buf, w: VW, h: VH, camX, camY, lut } = ctx;
  const { data, w: CW, h: CH, ox, oy } = cache;
  const step = Math.floor(time * GLINT_RATE) & 63;
  // View pixel (vx, vy) shows cache pixel (vx + camX - ox, vy + camY - oy).
  const dx = camX - ox, dy = camY - oy;
  const vx0 = Math.max(0, -dx), vx1 = Math.min(VW, CW - dx);
  const vy0 = Math.max(0, -dy), vy1 = Math.min(VH, CH - dy);
  if (vx0 >= vx1 || vy0 >= vy1) return;
  for (let vy = vy0; vy < vy1; vy++) {
    const cy = vy + dy, src = cy * CW + dx, dst = vy * VW, grow = (cy & 63) << 6;
    for (let vx = vx0; vx < vx1; vx++) {
      let v = data[src + vx];
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

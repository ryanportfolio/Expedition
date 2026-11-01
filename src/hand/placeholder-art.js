// Placeholder sprites for the hand poses and ground shadows, so the hand reads in play and in
// screenshots before its real painter exists. The hand system only ever asks getSprite() for these
// names; a painter module that registers the same names (src/art/painters/*.js) wins, because these
// are registered only for names nobody else has registered when this module loads (the registry's
// painter glob has already run by then). Removing it later takes only its import in src/systems/hand.js.
//
// Look: a glowing palm seen from above with the fingers reaching down toward the grip point. The
// anchor is the lowest fingertip row, middle column. Pale spectral blue-white from the lightning
// ramp (shades 5-7 only, so no saturated mid-blue), lit from the top-left, outlined in
// shade 2 (darker than any fill shade, so the edge reads on grass), with a few spark pixels.
import { registerPainters, listSprites } from '../art/registry.js';
import { idx } from '../art/palette.js';
import { createSprite, ellipse, rect, line, outline, sphereShade, px, trim } from '../art/sprite.js';

// Spectral blue-white (art direction: concept 12). The neutral lightning ramp keeps that look at any
// alignment; the real painter decides how the hand shifts between good and evil.
const RAMP = 'lightning';
const FILL_LO = 5, FILL_HI = 7; // pale end of the ramp: the spectral look of concept 12
const INK = 2; // outline shade

// fingers: [x, width, length] hanging from the palm's lower edge (y = 12); thumb: [x, y, w, h]
const POSES = {
  'hand-open': { fingers: [[2, 2, 6], [5, 2, 8], [8, 2, 8], [11, 2, 6]], thumb: [[0, 6, 2, 5]] },
  'hand-grab': { fingers: [[3, 2, 4], [5, 2, 5], [8, 2, 5], [10, 2, 4]], thumb: [[1, 8, 2, 4]] },
  'hand-hold': { fingers: [[3, 2, 2], [5, 2, 3], [8, 2, 3], [10, 2, 2]], thumb: [[2, 12, 8, 1]] },
  'hand-point': { fingers: [[5, 2, 10], [8, 2, 2], [10, 2, 2], [3, 2, 2]], thumb: [[1, 9, 2, 3]] },
  'hand-stroke': { fingers: [[3, 2, 7], [5, 2, 8], [7, 2, 8], [9, 2, 6]], thumb: [[1, 7, 2, 4]], joined: true },
  'hand-slap': { fingers: [[2, 2, 6], [5, 2, 8], [8, 2, 8], [11, 2, 6]], thumb: [[0, 6, 2, 5]], streaks: true },
};

function paintHand(name) {
  const p = POSES[name];
  const W = 15, H = 23;
  // anchor on the lowest fingertip, so every pose grips at the same point
  const bottom = Math.max(...p.fingers.map(([, , len]) => 12 + len - 1), ...p.thumb.map(([, y, , h]) => y + h - 1));
  const s = createSprite(W, H, 7, bottom);
  const base = idx(RAMP, 5);
  rect(s, 5, 0, 5, 4, base); // wrist
  ellipse(s, 7, 8, 5, 4.5, base);
  for (const [x, w, len] of p.fingers) rect(s, x, 12, w, len, base);
  for (const [x, y, w, h] of p.thumb) rect(s, x, y, w, h, base);
  sphereShade(s, RAMP, { lo: FILL_LO, hi: FILL_HI, cx: 6, cy: 8, rx: 7, ry: 10 });
  if (p.joined) for (const [x, , len] of p.fingers.slice(1)) line(s, x, 13, x, 11 + len, idx(RAMP, FILL_LO));
  let out = outline(s, idx(RAMP, INK));
  if (p.streaks) {
    const wide = createSprite(out.w + 5, out.h, out.ax, out.ay);
    for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) wide.data[y * wide.w + x] = out.data[y * out.w + x];
    for (const [y, len] of [[7, 4], [11, 5], [15, 3]]) line(wide, out.w, y, out.w + len - 1, y, idx(RAMP, 6));
    out = wide;
  }
  // a few loose sparks around the glow
  for (const [x, y] of [[0, 1], [out.w - 2, 3], [1, out.h - 6]]) if (!out.data[y * out.w + x]) px(out, x, y, idx(RAMP, 7));
  return trim(out);
}

function paintShadow(rx, ry) {
  const s = createSprite(2 * rx + 1, 2 * ry + 1, rx, ry);
  ellipse(s, rx, ry, rx, ry, idx('shadow', 2));
  // soften the two ends: every other pixel of the outermost columns
  for (let y = 0; y < s.h; y++) for (const x of [0, s.w - 1]) if ((x + y) & 1) px(s, x, y, 0);
  return s;
}

export const PLACEHOLDERS = {
  ...Object.fromEntries(Object.keys(POSES).map((n) => [n, () => paintHand(n)])),
  'shadow-s': () => paintShadow(4, 2),
  'shadow-m': () => paintShadow(6, 3),
  'shadow-l': () => paintShadow(9, 4),
};

const taken = new Set(listSprites());
registerPainters({ sprites: Object.fromEntries(Object.entries(PLACEHOLDERS).filter(([n]) => !taken.has(n))) });

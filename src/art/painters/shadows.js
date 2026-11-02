// Ground shadows under carried and flying objects and under the empty hand: flat iso ellipses about
// 8, 14 and 24 px wide, drawn as a sparse checker in the `shadow` ramp so the terrain shows through
// the gaps (the sprite format has no alpha; src/hand/draw.js blits only the opaque pixels). A denser
// core and a sparser rim make the edge soft; the small one is all core, since at 8 x 4 a sparse rim
// leaves too few pixels to read as an ellipse. Anchor = the ellipse centre, which draw.js places on
// the ground point under the object.
import { createSprite } from '../sprite.js';
import { idx } from '../palette.js';

// coreR: squared radius share drawn as the 50% checker (Infinity = all core); the rest is the one-in-four rim.
function paintShadow(w, h, coreR = 0.45) {
  const s = createSprite(w, h, Math.floor(w / 2), Math.floor(h / 2));
  const cx = (w - 1) / 2, cy = (h - 1) / 2, rx = w / 2, ry = h / 2;
  const core = idx('shadow', 1), rim = idx('shadow', 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    if (d > 1) continue;
    // core: every other pixel (checker); rim: every fourth pixel, offset per row
    if (d < coreR) { if ((x + y) & 1) s.data[y * w + x] = core; }
    else if ((x + 2 * y) % 4 === 0) s.data[y * w + x] = rim;
  }
  return s;
}

export const sprites = {
  'shadow-s': () => paintShadow(8, 4, Infinity),
  'shadow-m': () => paintShadow(14, 7),
  'shadow-l': () => paintShadow(24, 11),
};

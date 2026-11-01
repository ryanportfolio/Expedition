// The player's hand: six poses of a translucent, icy spectral hand with a wrist that dissolves into
// square motes. The pixels are baked from the six panels of concept 12 (the project's own hand sheet,
// which the user approved as the hand's art source) by scripts/bake-hand.mjs into ./hand-data.js;
// this module only turns those rows of characters into sprites. To change the art, change the bake
// rules or sources (art-src/hand/README.md) and rebake; never edit hand-data.js by hand.
//
// Colors: `hand-glow` (icy cyan at good, crimson-ash at evil; src/hand/draw.js draws the hand with
// handLut() so it stays icy at alignment 0) and, for the stroke's hearts and warm trail only, `heart`
// (muted rose). Anchor = the grip point, where src/hand/draw.js places the hand: held objects hang
// just below it (the pinch between thumb and index for hand-hold, the fingertip for hand-point).
import { createSprite } from '../sprite.js';
import { idx } from '../palette.js';
import { HAND_POSES } from './hand-data.js';

/** Sprite for one baked pose: '.' transparent, '0'-'7' hand-glow shades, 'a'-'h' heart shades. */
function fromRows({ w, h, ax, ay, data }) {
  const s = createSprite(w, h, ax, ay);
  const map = new Map([['.', 0]]);
  for (let k = 0; k < 8; k++) { map.set(String(k), idx('hand-glow', k)); map.set('abcdefgh'[k], idx('heart', k)); }
  data.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const v = map.get(row[x]);
      if (v === undefined) throw new Error(`hand-data: bad pixel '${row[x]}' at ${x},${y}`);
      s.data[y * w + x] = v;
    }
  });
  return s;
}

export const sprites = Object.fromEntries(Object.entries(HAND_POSES).map(([name, pose]) => [name, () => fromRows(pose)]));
export const previews = {};

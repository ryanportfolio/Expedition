// Miracle orbs: `orb { miracle }`, 9 px spheres in the miracle's own ramp (rain `water`, fire `fire`,
// heal `heal`, lightning `lightning`), lit from the top-left with a highlight there, a dark rim and a
// small inner symbol in the palest shades: falling droplets, a flame tongue, a leaf, a zig-zag bolt.
// Anchor = bottom centre (the orb's world point; src/miracles/orbs.js floats it above its pedestal).
import { createSprite, ellipse, sphereShade, px } from '../sprite.js';
import { idx } from '../palette.js';

const RAMPS = { rain: 'water', fire: 'fire', heal: 'heal', lightning: 'lightning' };

// [x, y, shade] symbol pixels inside the 9 x 9 sphere
const SYMBOLS = {
  rain: [[3, 3, 7], [3, 4, 6], [5, 4, 7], [5, 5, 6], [4, 6, 7], [4, 7, 5]],
  fire: [[5, 2, 6], [4, 3, 7], [5, 3, 6], [4, 4, 7], [5, 4, 7], [3, 5, 6], [4, 5, 7], [5, 5, 7], [4, 6, 6]],
  heal: [[5, 3, 6], [6, 3, 7], [4, 4, 6], [5, 4, 7], [6, 4, 6], [3, 5, 6], [4, 5, 7], [5, 5, 6], [3, 6, 7], [4, 6, 6], [2, 7, 5]],
  lightning: [[5, 2, 7], [4, 3, 7], [3, 4, 7], [4, 4, 6], [5, 4, 7], [4, 5, 7], [3, 6, 6]],
};

function paintOrb({ miracle = 'rain' } = {}) {
  const ramp = RAMPS[miracle];
  if (!ramp) throw new Error(`orb: unknown miracle "${miracle}"`);
  const s = createSprite(9, 9, 4, 8);
  ellipse(s, 4, 4, 4, 4, idx(ramp, 3), idx(ramp, 0));
  sphereShade(s, ramp, { only: idx(ramp, 3), lo: 1, hi: 4, cx: 4.5, cy: 4.5, rx: 4.5, ry: 4.5 });
  for (const [x, y, shade] of SYMBOLS[miracle]) px(s, x, y, idx(ramp, shade));
  px(s, 2, 2, idx(ramp, 7)); // top-left highlight
  px(s, 2, 1, idx(ramp, 6));
  px(s, 1, 2, idx(ramp, 6));
  return s;
}

export const sprites = { orb: paintOrb };
export const previews = { orb: Object.keys(RAMPS).map((miracle) => ({ miracle })) };

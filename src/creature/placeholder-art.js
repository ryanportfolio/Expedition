// Placeholder sprites for the creature and its dung, so the game draws a readable creature before
// its painter lands (src/art/painters/creature.js, another round). src/systems/creature.js imports
// this module for its side effect: it registers `creature` and `dung` only for names no painter has
// registered yet. In the browser the registry's painter glob runs before this module body (this
// module imports the registry), so a real painter wins; in node a painter registered later through
// registerPainters() replaces these. Removing the placeholder takes only that import.
//
// Look: a gaunt slate giant about 70 px tall in the creature-hide ramp, hooded, face in shadow, an
// ember seam in the chest (creature-accent), one silhouette per pose (arm and stance) and one frame
// per pose. lean 1 adds moss and pale blooms on the shoulders; lean -1 adds charred cracks and hot
// seams. Back facings (ne, nw) hide the chest seam; west facings (sw, nw) are mirrors. Sleep lies
// down; weak and poop stoop.
import { registerPainters, listSprites } from '../art/registry.js';
import { idx } from '../art/palette.js';
import { createSprite, ellipse, rect, line, outline, sphereShade, px, mirror } from '../art/sprite.js';

const HIDE = 'creature-hide';

// Arm poses: [shoulder x, shoulder y, hand x, hand y] for the near (right) and far (left) arm.
const ARMS = {
  idle: [[24, 20, 26, 46], [9, 20, 7, 46]],
  walk: [[24, 20, 28, 44], [9, 20, 5, 44]],
  weak: [[23, 24, 24, 52], [10, 24, 9, 52]],
  eat: [[24, 20, 19, 12], [9, 20, 7, 44]],
  throw: [[24, 20, 30, 4], [9, 20, 5, 36]],
  smash: [[24, 20, 26, 2], [9, 20, 7, 2]],
  haul: [[24, 20, 26, 14], [9, 20, 7, 14]],
  water: [[24, 20, 31, 30], [9, 20, 27, 32]],
  play: [[24, 20, 31, 10], [9, 20, 2, 10]],
  poop: [[24, 26, 27, 40], [9, 26, 6, 40]],
  happy: [[24, 20, 30, 6], [9, 20, 3, 6]],
  hurt: [[24, 20, 20, 10], [9, 20, 13, 10]],
};

function thickLine(s, x0, y0, x1, y1, c) {
  line(s, x0, y0, x1, y1, c);
  line(s, x0 + 1, y0, x1 + 1, y1, c);
  line(s, x0, y0 + 1, x1, y1 + 1, c);
  line(s, x0 + 1, y0 + 1, x1 + 1, y1 + 1, c);
}

function standing(pose, back, lean) {
  const ink = idx('ink', 0);
  const s = createSprite(36, 76, 17, 74);
  const base = idx(HIDE, 4);
  const stoop = pose === 'weak' ? 4 : pose === 'poop' ? 6 : 0;
  rect(s, 11, 18 + stoop, 12, 26, base); // torso of stacked blocks
  ellipse(s, 17, 11 + stoop, 5, 7, base); // hood
  const legY = 44 + stoop;
  const spread = pose === 'walk' ? 3 : pose === 'poop' ? 2 : 0;
  rect(s, 12 - spread, legY, 4, 74 - legY, base);
  rect(s, 18 + spread, legY, 4, 74 - legY, base);
  const [near, far] = ARMS[pose] ?? ARMS.idle;
  thickLine(s, far[0], far[1] + stoop, far[2], far[3] + stoop, base);
  thickLine(s, near[0], near[1] + stoop, near[2], near[3] + stoop, base);
  sphereShade(s, HIDE, { lo: 1, hi: 6, cx: 13, cy: 30, rx: 14, ry: 42 });
  for (const y of [26, 34]) line(s, 12, y + stoop, 21, y + stoop, idx(HIDE, 1)); // block seams
  line(s, 12, legY + 12, 15, legY + 12, idx(HIDE, 1));
  line(s, 18, legY + 12, 21, legY + 12, idx(HIDE, 1));
  rect(s, 14, 10 + stoop, 6, 4, ink); // hooded brow: the face stays in shadow, no mouth
  if (!back) {
    const hot = lean < 0 ? idx('fire', 6) : idx('creature-accent', 5);
    line(s, 16, 24 + stoop, 17, 31 + stoop, hot);
    px(s, 17, 27 + stoop, idx('fire', 7));
  }
  if (lean > 0) {
    for (const [x, y] of [[11, 19], [12, 18], [21, 19], [22, 18], [13, 44], [19, 45]]) px(s, x, y + stoop, idx('moss', 5));
    for (const [x, y] of [[12, 17], [22, 17]]) px(s, x, y + stoop, idx('grain', 7));
  } else if (lean < 0) {
    line(s, 13, 20 + stoop, 15, 30 + stoop, ink);
    line(s, 20, 36 + stoop, 18, 42 + stoop, ink);
    for (const [x, y] of [[12, 52], [20, 58]]) px(s, x, y + stoop, idx('fire', 5));
  }
  return outline(s, ink);
}

function lying(back, lean) {
  const ink = idx('ink', 0);
  const s = createSprite(64, 22, 32, 20);
  const base = idx(HIDE, 4);
  ellipse(s, 10, 13, 6, 5, base); // hood
  rect(s, 16, 8, 26, 10, base); // torso on its side
  rect(s, 42, 10, 18, 4, base); // legs
  rect(s, 42, 14, 18, 4, base);
  rect(s, 18, 17, 20, 3, base); // arm along the body
  sphereShade(s, HIDE, { lo: 1, hi: 5, cx: 28, cy: 10, rx: 30, ry: 12 });
  rect(s, 7, 11, 4, 4, ink);
  if (!back) px(s, 26, 12, idx('creature-accent', 4));
  if (lean > 0) for (const x of [18, 24, 31, 38]) px(s, x, 8, idx('moss', 5));
  if (lean < 0) line(s, 20, 9, 30, 16, ink);
  return outline(s, ink);
}

function paintCreature({ pose = 'idle', facing = 'se', lean = 0 } = {}) {
  const back = facing === 'ne' || facing === 'nw';
  const west = facing === 'sw' || facing === 'nw';
  const l = lean > 0 ? 1 : lean < 0 ? -1 : 0;
  const s = pose === 'sleep' ? lying(back, l) : standing(pose, back, l);
  return west ? mirror(s) : s;
}

function paintDung() {
  const s = createSprite(9, 5, 4, 4);
  ellipse(s, 4, 3, 4, 2, idx('dirt', 2));
  px(s, 4, 1, idx('dirt', 1));
  sphereShade(s, 'dirt', { lo: 0, hi: 3 });
  return s;
}

export const PLACEHOLDERS = { creature: paintCreature, dung: paintDung };

const taken = new Set(listSprites());
registerPainters({ sprites: Object.fromEntries(Object.entries(PLACEHOLDERS).filter(([n]) => !taken.has(n))) });

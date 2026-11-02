// Test-pattern painters: small sprites that exercise the art kit, kept as a worked example for
// painter authors. Each export maps a sprite name to (opts) => Sprite; `previews` lists extra
// option sets that scripts/art-preview.mjs renders next to the default.
//
// Pattern used throughout: paint flat shapes in palette indices, shade them with the light from
// the top-left, outline in ink shade 0 (or the ramp's darkest shade), and set the anchor on the
// pixel that touches the ground.

import { idx } from '../palette.js';
import { createSprite, ellipse, get, isoBox, isoDiamond, line, outline, px, rect, sphereShade, dither, stamp, mirror } from '../sprite.js';

const INK = idx('ink', 0);

/** Iso block on a 32 x 16 footprint: top, lit left face, dark right face, rim light, outline. */
function testBox({ ramp = 'stone', h = 12 } = {}) {
  const w = 32, hh = 16 + h;
  const s = createSprite(w, hh, 16, 8 + h); // anchor: ground point under the footprint center
  const top = idx(ramp, 6), left = idx(ramp, 4), right = idx(ramp, 2);
  isoBox(s, 16, 0, 8, 8, h, { top, left, right });
  // Rim light: top-face pixels whose lower neighbor is a wall get the brightest shade.
  const rim = idx(ramp, 7);
  for (let y = s.h - 2; y >= 0; y--) for (let x = 0; x < w; x++) {
    if (get(s, x, y) === top && get(s, x, y + 1) !== top && get(s, x, y + 1) !== 0) px(s, x, y, rim);
  }
  // Front vertical corner edge one shade darker than the lit wall reads as a crease.
  line(s, 15, 16, 15, 16 + h - 1, idx(ramp, 3));
  return outline(s, INK);
}

/** Shaded ball: a filled circle re-shaded as a sphere, outlined in the ramp's darkest shade. */
function testSphere({ ramp = 'water', r = 7, dither: useDither = false } = {}) {
  const d = 2 * r + 1;
  const s = createSprite(d, d, r, d - 1);
  ellipse(s, r, r, r, r, idx(ramp, 4));
  sphereShade(s, ramp, { lo: 1, hi: 7, dither: useDither });
  return outline(s, idx(ramp, 0));
}

/** About 10 px tall villager: hair, skin, cloth with left-lit shading, ink outline. */
function testFigure({ team = 'player', flip = false } = {}) {
  const cloth = team === 'rival' ? 'cloth-rival' : 'cloth-player';
  const hair = idx('dirt', 1), legs = idx(cloth, 1), feet = idx('bark', 1);
  // One row per string: h hair, 1-3 skin (bright to dark), a-e cloth (bright to dark), l legs, f feet.
  const map = [
    '.hhh.',
    '.123.',
    '.233.',
    'abccd',
    '2bcd3',
    '.bcd.',
    '.l.l.',
    '.f.f.',
  ];
  const key = {
    h: hair, f: feet, l: legs,
    1: idx('skin', 6), 2: idx('skin', 5), 3: idx('skin', 4),
    a: idx(cloth, 6), b: idx(cloth, 5), c: idx(cloth, 4), d: idx(cloth, 3),
  };
  const body = createSprite(5, map.length, 2, map.length - 1);
  map.forEach((row, y) => [...row].forEach((ch, x) => { if (key[ch]) px(body, x, y, key[ch]); }));
  const s = outline(body, INK); // 7 x 10, anchor on the outline row under the feet
  return flip ? mirror(s) : s;
}

/** 2 x 2 patch of iso tiles (grass, dirt, sand, water) built from diamonds and stamps. */
function testTiles() {
  const s = createSprite(64, 32, 32, 16);
  const kinds = [['grass', 0, 0], ['dirt', 1, 0], ['sand', 0, 1], ['water', 1, 1]];
  for (const [ramp, i, j] of kinds) {
    const tile = createSprite(32, 16);
    isoDiamond(tile, 0, 0, idx(ramp, 4));
    dither(tile, 0, 0, 32, 16, idx(ramp, 4), idx(ramp, 5), 0.25, true); // texture speckle
    dither(tile, 0, 10, 32, 6, idx(ramp, 4), idx(ramp, 3), 0.5, true); // darker near edge
    stamp(s, tile, 16 + (i - j) * 16, (i + j) * 8);
  }
  return s;
}

/** Small tree: bark trunk under a dithered, sphere-shaded foliage crown. */
function testTree({ size = 1 } = {}) {
  const r = 5 + 2 * size, trunkH = 4 + size;
  const w = 2 * r + 1, h = 2 * r + 1 + trunkH;
  const s = createSprite(w, h, r, h - 1);
  rect(s, r - 1, 2 * r - 1, 3, trunkH + 1, idx('bark', 3));
  px(s, r - 1, 2 * r - 1 + trunkH, idx('bark', 2));
  line(s, r - 1, 2 * r - 1, r - 1, h - 2, idx('bark', 4)); // lit left edge of the trunk
  const crown = idx('foliage', 4);
  ellipse(s, r, r, r, r - 1, crown);
  sphereShade(s, 'foliage', { only: crown, lo: 1, hi: 7, dither: true });
  return outline(s, idx('foliage', 0));
}

export const sprites = {
  'test-box': testBox,
  'test-sphere': testSphere,
  'test-figure': testFigure,
  'test-tiles': testTiles,
  'test-tree': testTree,
};

export const previews = {
  'test-box': [{ ramp: 'thatch', h: 8 }, { ramp: 'clay', h: 16 }],
  'test-sphere': [{ ramp: 'creature-hide', dither: true }, { ramp: 'hand-glow', r: 5 }, { ramp: 'fire', r: 3 }],
  'test-figure': [{ team: 'rival' }, { flip: true }],
  'test-tree': [{ size: 2 }],
};

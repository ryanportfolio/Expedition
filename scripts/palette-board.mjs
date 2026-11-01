// Palette review board: every ramp's 8 shades at alignment +1, 0 and -1, plus small material
// samples drawn with the sprite kit, upscaled 4x nearest-neighbor, written as one PNG.
//
//   node scripts/palette-board.mjs --out <file.png>
//
// Top block: one row per ramp (name, then 8 swatches darkest to brightest for +1 good, 0, -1 evil).
// Bottom block: one cell per material sample, drawn three times left to right (+1, 0, -1) on the
// slate-blue backdrop of the concept sheets, so each material can be judged next to its neighbors.
// Node built-ins and repo modules only; no DOM.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encodePNG } from './lib/png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => import(pathToFileURL(join(ROOT, p)).href);
const { RAMPS, SHADES, idx } = await load('src/art/palette.js');
const { makeLut } = await load('src/art/lut.js');
const S = await load('src/art/sprite.js');

const SCALE = 4;
const ALIGNMENTS = [1, 0, -1];
const BG = [0x23, 0x26, 0x2e];
const SAMPLE_BG = [0x56, 0x60, 0x70]; // close to the backdrop of concept sheets 06 and 07
const TEXT = [0xc8, 0xc8, 0xc8];
const DIM = [0x8a, 0x8f, 0x99];

function parseArgs(argv) {
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && i + 1 < argv.length) out = argv[++i];
    else throw new Error(`unknown or incomplete argument ${argv[i]}`);
  }
  if (!out) throw new Error('missing --out <path.png>');
  return { out };
}

// ---- 3x5 pixel font for labels (uppercase, digits, + and -) ----
const GLYPHS = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111',
  9: '111101111001110', '-': '000000111000000', '+': '000010111010000', ' ': '000000000000000',
};
const textWidth = (str) => str.length * 4 - 1;

class Board {
  constructor(w, h) { this.w = w; this.h = h; this.px = new Uint8ClampedArray(w * h * 4); }
  fill(x, y, w, h, [r, g, b]) {
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(this.w, x + w); xx++) {
      const i = (yy * this.w + xx) * 4;
      this.px[i] = r; this.px[i + 1] = g; this.px[i + 2] = b; this.px[i + 3] = 255;
    }
  }
  text(str, x, y, color) {
    [...str.toUpperCase()].forEach((ch, n) => {
      const g = GLYPHS[ch] ?? GLYPHS[' '];
      for (let k = 0; k < 15; k++) if (g[k] === '1') this.fill(x + n * 4 + (k % 3), y + Math.floor(k / 3), 1, 1, color);
    });
  }
  sprite(sp, lut, x, y) {
    const rgba = S.toRGBA(sp, lut);
    for (let sy = 0; sy < sp.h; sy++) for (let sx = 0; sx < sp.w; sx++) {
      const si = (sy * sp.w + sx) * 4;
      if (!rgba[si + 3]) continue;
      this.fill(x + sx, y + sy, 1, 1, [rgba[si], rgba[si + 1], rgba[si + 2]]);
    }
  }
  scaled(k) {
    const W = this.w * k, out = new Uint8ClampedArray(W * this.h * k * 4);
    for (let y = 0; y < this.h * k; y++) for (let x = 0; x < W; x++) {
      const si = (Math.floor(y / k) * this.w + Math.floor(x / k)) * 4, di = (y * W + x) * 4;
      out[di] = this.px[si]; out[di + 1] = this.px[si + 1]; out[di + 2] = this.px[si + 2]; out[di + 3] = this.px[si + 3];
    }
    return out;
  }
}

// ---- material samples (painted in palette indices, light from the top-left) ----
// Deterministic per-pixel noise in [0, 1) so the board is identical on every run.
const noise = (x, y, seed = 0) => {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Iso ground tile: textured 32x16 top over a short side skirt, outlined in the skirt's darkest shade. */
function groundTile(top, skirt = top, { seed = 1, tufts = false } = {}) {
  const d = 4; // skirt height in px
  const s = S.createSprite(32, 16 + d, 16, 8);
  S.isoBox(s, 16, 0, 8, 8, d, { top: idx(top, 4), left: idx(skirt, 3), right: idx(skirt, 2) });
  const topIdx = idx(top, 4);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    if (S.get(s, x, y) !== topIdx) continue;
    const v = noise(x, y, seed);
    // Light from the top-left: the upper-left half of the diamond one step brighter in places.
    const lit = (x - 16) + (y - 8) * 2 < 0;
    let shade = 4 + (v < 0.18 ? 1 : 0) - (v > 0.86 ? 1 : 0) + (lit && v < 0.4 ? 1 : 0) - (!lit && v > 0.7 ? 1 : 0);
    if (S.get(s, x, y - 1) === 0 && x < 16) shade = 6; // rim light on the upper-left edge
    S.px(s, x, y, idx(top, shade));
  }
  if (tufts) for (const [x, y] of [[9, 7], [14, 4], [20, 9], [24, 6], [13, 11], [18, 5]]) {
    S.px(s, x, y, idx(top, 6)); S.px(s, x, y + 1, idx(top, 2));
  }
  // Skirt texture: a few darker strata.
  for (let x = 0; x < 32; x++) for (let y = 8; y < s.h; y++) {
    const c = S.get(s, x, y);
    if ((c === idx(skirt, 3) || c === idx(skirt, 2)) && noise(x, y, seed + 7) < 0.2) S.px(s, x, y, c - 1);
  }
  return S.outline(s, idx(skirt, 0));
}

function waterTile() {
  const s = S.createSprite(32, 16, 16, 8);
  S.isoDiamond(s, 0, 0, idx('water', 3));
  for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
    if (!S.get(s, x, y)) continue;
    const v = noise(x >> 2, y, 3);
    if (y % 3 === 1 && v < 0.35) S.px(s, x, y, idx('water', 5));
    else if (y > 10) S.px(s, x, y, idx('water', 2));
    if (noise(x, y, 4) < 0.02) S.px(s, x, y, idx('water', 7));
  }
  for (let x = 0; x < 32; x++) for (let y = 0; y < 16; y++) {
    if (S.get(s, x, y) && !S.get(s, x, y - 1) && x < 16) S.px(s, x, y, idx('water', 6)); // foam on the lit shore edge
  }
  return s;
}

/** Short wall: brick courses on the lit face, mortar in a darker shade, optional moss on top. */
function wall(ramp, { moss = false } = {}) {
  const s = S.createSprite(24, 22, 12, 21);
  const top = idx(ramp, 6), face = idx(ramp, 4), side = idx(ramp, 2);
  S.isoBox(s, 4, 0, 8, 2, 10, { top, left: face, right: side });
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const c = S.get(s, x, y);
    if (c !== face && c !== side) continue;
    // Courses follow the 2:1 slope of the wall face; joints stagger every other course.
    const along = c === face ? x : -x;
    const course = Math.floor((y - Math.floor(along / 2)) / 3);
    const mortarRow = (y - Math.floor(along / 2)) % 3 === 0;
    const joint = (Math.floor(along / 2) + (course & 1) * 2) % 4 === 0;
    if (mortarRow || joint) S.px(s, x, y, c - 2);
    else if (noise(x, y, 11) < 0.15) S.px(s, x, y, c + 1);
  }
  if (moss) for (const [x, y] of [[6, 1], [7, 2], [8, 2], [14, 5], [15, 5], [15, 6]]) S.px(s, x, y, idx('moss', noise(x, y) < 0.5 ? 4 : 5));
  return S.outline(S.trim(s), idx(ramp, 0));
}

/** Cottage wall: cracked, stained plaster panels in a timber frame. */
function plasterWall() {
  const s = S.createSprite(24, 22, 12, 21);
  const top = idx('bark', 4), face = idx('plaster', 5), side = idx('plaster', 3);
  S.isoBox(s, 4, 0, 8, 2, 10, { top, left: face, right: side });
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const c = S.get(s, x, y);
    if (c !== face && c !== side) continue;
    const along = c === face ? x : -x;
    const rise = y - Math.floor(along / 2); // height along the face, following its 2:1 slope
    const timber = c === face ? idx('bark', 3) : idx('bark', 2);
    if (rise === 4 || x === 0 || x === 8 || x === 9 || x === 12 || x === 13) S.px(s, x, y, timber); // beam and posts
    else if (noise(x, y, 41) < 0.06) S.px(s, x, y, c - 2); // hairline cracks
    else if (noise(x, y, 43) < 0.12) S.px(s, x, y, c - 1); // stains
  }
  return S.outline(S.trim(s), idx('ink', 0));
}

/** About 10 px tall villager: hair, skin, cloth lit from the left, ink outline. */
function figure(cloth) {
  const map = ['.hhh.', '.123.', '.233.', 'abccd', '2bcd3', '.bcd.', '.l.l.', '.f.f.'];
  const key = { h: idx('bark', 1), f: idx('bark', 1), l: idx(cloth, 1), 1: idx('skin', 6), 2: idx('skin', 5), 3: idx('skin', 4),
    a: idx(cloth, 6), b: idx(cloth, 5), c: idx(cloth, 4), d: idx(cloth, 3) };
  const s = S.createSprite(5, map.length, 2, map.length - 1);
  map.forEach((row, y) => [...row].forEach((ch, x) => { if (key[ch]) S.px(s, x, y, key[ch]); }));
  return S.outline(s, idx('ink', 0));
}

/** Two villagers (player and rival cloth) on a ground shadow. */
function figures() {
  const s = S.createSprite(20, 13, 10, 12);
  S.ellipse(s, 5, 11, 3, 1, idx('shadow', 3));
  S.ellipse(s, 14, 11, 3, 1, idx('shadow', 3));
  S.stamp(s, figure('cloth-player'), 2, 1);
  S.stamp(s, figure('cloth-rival'), 11, 1);
  return s;
}

/** Creature material: slate block with a glowing seam, moss in the crevice and a bound root. */
function slateBlock() {
  const s = S.createSprite(28, 28, 14, 27);
  S.isoBox(s, 14, 0, 6, 6, 14, { top: idx('creature-hide', 5), left: idx('creature-hide', 3), right: idx('creature-hide', 2) });
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const c = S.get(s, x, y);
    if (c && noise(x, y, 21) < 0.12) S.px(s, x, y, c - 1); // pitted stone
  }
  // Jagged seam down the lit face: hot core, dimmer rim.
  const seam = [[7, 10], [8, 11], [8, 12], [9, 13], [9, 14], [8, 15], [9, 16], [10, 17], [10, 18], [11, 19], [11, 20], [12, 21]];
  for (const [x, y] of seam) { S.px(s, x - 1, y, idx('creature-accent', 3)); S.px(s, x, y, idx('creature-accent', 6)); }
  S.px(s, 9, 14, idx('creature-accent', 7)); S.px(s, 10, 18, idx('creature-accent', 7));
  // Moss along the top edge and in the seam's upper end.
  for (const [x, y, sh] of [[9, 6, 4], [10, 6, 5], [11, 7, 3], [6, 9, 4], [7, 9, 5], [18, 4, 4], [19, 5, 3]]) S.px(s, x, y, idx('moss', sh));
  // Root bound around the block's right face.
  S.line(s, 15, 19, 26, 13, idx('bark', 2));
  S.line(s, 15, 20, 26, 14, idx('bark', 1));
  return S.outline(s, idx('ink', 0));
}

function tree() {
  const s = S.createSprite(18, 24, 9, 23);
  S.rect(s, 8, 14, 3, 9, idx('bark', 3));
  S.line(s, 10, 14, 10, 22, idx('bark', 1));
  S.line(s, 8, 15, 8, 21, idx('bark', 4));
  S.ellipse(s, 9, 8, 7, 7, idx('foliage', 4));
  S.sphereShade(s, 'foliage', { only: idx('foliage', 4), lo: 1, hi: 6, dither: true });
  return S.outline(s, idx('foliage', 0));
}

function roof() {
  const s = S.createSprite(30, 22, 15, 21);
  S.isoBox(s, 15, 10, 6, 6, 8, { top: 0, left: idx('plaster', 5), right: idx('plaster', 3) });
  S.polygon(s, [[3, 16], [15, 4], [27, 10], [15, 22]], idx('thatch', 4)); // simple hip roof over plaster walls
  S.polygon(s, [[15, 4], [27, 10], [27, 12], [15, 6]], idx('thatch', 6));
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const c = S.get(s, x, y);
    if (c === idx('thatch', 4)) {
      if ((x + y * 2) % 5 === 0) S.px(s, x, y, idx('thatch', 2));
      else if (noise(x, y, 31) < 0.2) S.px(s, x, y, idx('thatch', 5));
      else if (x > 15 && y > 12) S.px(s, x, y, idx('thatch', 3));
    }
  }
  S.rect(s, 14, 17, 2, 3, idx('bark', 1)); // door
  return S.outline(s, idx('ink', 0));
}

function grainPatch() {
  const s = S.createSprite(32, 20, 16, 8);
  S.isoDiamond(s, 0, 4, idx('dirt', 3));
  for (let y = 0; y < 20; y++) for (let x = 0; x < 32; x++) {
    if (S.get(s, x, y) !== idx('dirt', 3) || (x + y) % 3) continue;
    S.px(s, x, y - 2, idx('grain', 6)); S.px(s, x, y - 1, idx('grain', 4)); S.px(s, x, y, idx('grain', 2));
  }
  return s;
}

function handBlob() {
  const s = S.createSprite(18, 18, 9, 17);
  S.ellipse(s, 8, 9, 6, 7, idx('hand-glow', 4));
  S.rect(s, 13, 3, 2, 8, idx('hand-glow', 4)); // a raised finger
  S.sphereShade(s, 'hand-glow', { lo: 2, hi: 7 });
  for (const [x, y] of [[1, 3], [16, 1], [2, 15], [16, 13], [4, 0]]) S.px(s, x, y, idx('hand-glow', 7));
  return s;
}

function flame() {
  const s = S.createSprite(14, 20, 7, 19);
  S.polygon(s, [[7, 0], [12, 9], [13, 15], [10, 20], [4, 20], [1, 15], [2, 9]], idx('fire', 3));
  S.polygon(s, [[7, 5], [10, 12], [10, 16], [8, 20], [6, 20], [4, 16], [4, 12]], idx('fire', 5));
  S.polygon(s, [[7, 10], [9, 15], [8, 20], [6, 20], [5, 15]], idx('fire', 7));
  S.line(s, 1, 19, 13, 19, idx('fire', 1));
  return s;
}

function bolt() {
  const s = S.createSprite(16, 26, 8, 25);
  const pts = [[9, 0], [6, 7], [10, 11], [5, 18], [8, 21], [7, 25]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    S.line(s, ax - 1, ay, bx - 1, by, idx('lightning', 3));
    S.line(s, ax + 1, ay, bx + 1, by, idx('lightning', 4));
  }
  for (let i = 0; i + 1 < pts.length; i++) S.line(s, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], idx('lightning', 7));
  return s;
}

function healSpark() {
  const s = S.createSprite(15, 15, 7, 14);
  S.ellipse(s, 7, 7, 6, 6, idx('heal', 2));
  S.ellipse(s, 7, 7, 4, 4, idx('heal', 4));
  S.rect(s, 6, 2, 3, 11, idx('heal', 6)); S.rect(s, 2, 6, 11, 3, idx('heal', 6));
  S.rect(s, 7, 3, 1, 9, idx('heal', 7)); S.rect(s, 3, 7, 9, 1, idx('heal', 7));
  return s;
}

function uiPanel() {
  const s = S.createSprite(26, 14, 0, 13);
  S.rect(s, 0, 0, 26, 14, idx('ui-parchment', 5));
  S.rect(s, 1, 1, 24, 12, idx('ui-parchment', 6));
  for (const [y, w] of [[3, 18], [6, 21], [9, 12]]) S.rect(s, 3, y, w, 1, idx('ui-ink', 1));
  S.rect(s, 1, 12, 24, 1, idx('ui-parchment', 3));
  return S.outline(s, idx('ui-ink', 0));
}

const SAMPLES = [
  ['grass', () => groundTile('grass', 'dirt', { seed: 1, tufts: true })],
  ['sand', () => groundTile('sand', 'sand', { seed: 2 })],
  ['dirt', () => groundTile('dirt', 'dirt', { seed: 3 })],
  ['rock', () => groundTile('rock', 'rock', { seed: 4 })],
  ['water', waterTile],
  ['stone wall', () => wall('stone', { moss: true })],
  ['clay wall', () => wall('clay')],
  ['plaster wall', plasterWall],
  ['villagers', figures],
  ['slate seam', slateBlock],
  ['tree', tree],
  ['thatch', roof],
  ['grain', grainPatch],
  ['hand', handBlob],
  ['fire', flame],
  ['lightning', bolt],
  ['heal', healSpark],
  ['ui', uiPanel],
];

function main() {
  const { out } = parseArgs(process.argv.slice(2));
  const luts = ALIGNMENTS.map((a) => makeLut(a));

  // Ramp block geometry.
  const SW = 6, GROUP_GAP = 6, ROW_H = 8, PAD = 6;
  const labelW = Math.max(...RAMPS.map((r) => textWidth(r.name))) + 6;
  const groupW = SHADES * SW;
  const rampsW = PAD + labelW + ALIGNMENTS.length * (groupW + GROUP_GAP) - GROUP_GAP + PAD;
  const rampsTop = PAD + 8;
  const rampsH = rampsTop + RAMPS.length * ROW_H;

  // Sample block geometry: three copies per cell, cells flow left to right.
  const sprites = SAMPLES.map(([label, paint]) => ({ label, sp: paint() }));
  const CELL_PAD = 3, COPY_GAP = 3;
  const cells = sprites.map((c) => ({ ...c, w: Math.max(c.sp.w * 3 + COPY_GAP * 2, textWidth(c.label)) + CELL_PAD * 2, h: c.sp.h + CELL_PAD * 2 + 8 }));
  const maxW = Math.max(rampsW, 260);
  let x = PAD, y = rampsH + PAD + 8, rowH = 0;
  for (const c of cells) {
    if (x > PAD && x + c.w > maxW - PAD) { x = PAD; y += rowH + 4; rowH = 0; }
    c.x = x; c.y = y; x += c.w + 4; rowH = Math.max(rowH, c.h);
  }
  const W = Math.max(maxW, ...cells.map((c) => c.x + c.w + PAD));
  const H = y + rowH + PAD;

  const b = new Board(W, H);
  b.fill(0, 0, W, H, BG);
  ALIGNMENTS.forEach((a, g) => {
    const gx = PAD + labelW + g * (groupW + GROUP_GAP);
    b.text(a > 0 ? '+1 GOOD' : a < 0 ? '-1 EVIL' : '0', gx, PAD, DIM);
  });
  RAMPS.forEach((ramp, r) => {
    const ry = rampsTop + r * ROW_H;
    b.text(ramp.name, PAD, ry + 1, ramp.shifts ? TEXT : DIM);
    luts.forEach((lut, g) => {
      const gx = PAD + labelW + g * (groupW + GROUP_GAP);
      for (let s = 0; s < SHADES; s++) {
        const v = lut[1 + r * SHADES + s];
        b.fill(gx + s * SW, ry, SW, SW, [v & 255, (v >>> 8) & 255, (v >>> 16) & 255]);
      }
    });
  });
  b.text('SAMPLES  +1  0  -1', PAD, rampsH + PAD, DIM);
  for (const c of cells) {
    b.fill(c.x, c.y, c.w, c.h, SAMPLE_BG);
    luts.forEach((lut, g) => b.sprite(c.sp, lut, c.x + CELL_PAD + g * (c.sp.w + COPY_GAP), c.y + CELL_PAD));
    b.text(c.label, c.x + CELL_PAD, c.y + c.h - 7, TEXT);
  }

  const png = encodePNG(W * SCALE, H * SCALE, b.scaled(SCALE));
  const file = resolve(out);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png);
  console.log(`${RAMPS.length} ramps, ${SAMPLES.length} samples, ${W * SCALE}x${H * SCALE} px -> ${file}`);
}

try {
  main();
} catch (err) {
  console.error(`palette-board: ${err.message}`);
  process.exitCode = 1;
}

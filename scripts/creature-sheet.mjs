// Creature sprite sheet: every pose x frame x facing at lean 0 (alignment-0 LUT), then idle at
// lean -1 (evil LUT) and lean +1 (good LUT), on a grass-toned background, upscaled
// nearest-neighbor for review by eye.
//
//   node scripts/creature-sheet.mjs --out <file.png> [--scale 3] [--poses idle,walk] [--facings se,ne]
//
// One row per pose. Each row holds the pose's frames for se, sw, ne, nw in that order, with a
// wider gap between facings. A 1 px tick under each cell marks the sprite's anchor (ground point).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encodePNG } from './lib/png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => import(pathToFileURL(join(ROOT, p)).href);
const { makeLut } = await load('src/art/lut.js');
const { toRGBA } = await load('src/art/sprite.js');
const registry = await load('src/art/registry.js');
const painter = await load('src/art/painters/creature.js');

const FACINGS = ['se', 'sw', 'ne', 'nw'];

function parseArgs(argv) {
  const args = { out: null, scale: 3, poses: null, facings: FACINGS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--scale') args.scale = Number(argv[++i]);
    else if (a === '--poses') args.poses = String(argv[++i]).split(',');
    else if (a === '--facings') args.facings = String(argv[++i]).split(',');
    else throw new Error(`unknown argument ${a}`);
  }
  if (!args.out) throw new Error('missing --out <path.png>');
  if (!Number.isInteger(args.scale) || args.scale < 1 || args.scale > 12) throw new Error('--scale must be an integer 1..12');
  for (const p of args.poses ?? []) if (!(p in painter.CREATURE_FRAMES)) throw new Error(`--poses: unknown pose "${p}"`);
  for (const f of args.facings) if (!FACINGS.includes(f)) throw new Error(`--facings: unknown facing "${f}"`);
  return args;
}

const BG = [0x2b, 0x36, 0x2c], CELL = [0x33, 0x40, 0x34], TICK = [0xd0, 0x60, 0x40];
const PAD = 2, GAP = 1, FACING_GAP = 6;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  registry.registerPainters(painter);
  const poses = args.poses ?? Object.keys(painter.CREATURE_FRAMES);

  // Rows of { opts, lut } cells; null marks a facing gap.
  const rows = poses.map((pose) => {
    const cells = [];
    args.facings.forEach((facing, k) => {
      if (k) cells.push(null);
      for (let frame = 0; frame < painter.CREATURE_FRAMES[pose]; frame++) cells.push({ opts: { pose, frame, facing, lean: 0 }, lut: makeLut(0) });
    });
    return cells;
  });
  if (!args.poses || args.poses.includes('idle')) {
    rows.push([-1, 1].flatMap((lean, k) => {
      const cells = k ? [null] : [];
      for (const facing of args.facings) for (let frame = 0; frame < painter.CREATURE_FRAMES.idle; frame++) {
        cells.push({ opts: { pose: 'idle', frame, facing, lean }, lut: makeLut(lean) });
      }
      return cells;
    }));
  }

  // Uniform cells: as wide and tall as the largest sprite, anchors aligned on one baseline.
  let left = 0, right = 0, up = 0, down = 0, painted = 0;
  for (const row of rows) for (const c of row) {
    if (!c) continue;
    c.sprite = registry.getSprite('creature', c.opts);
    if (c.sprite === registry.placeholderSprite()) throw new Error(`creature ${JSON.stringify(c.opts)} fell back to the placeholder`);
    painted++;
    left = Math.max(left, c.sprite.ax); right = Math.max(right, c.sprite.w - c.sprite.ax);
    up = Math.max(up, c.sprite.ay); down = Math.max(down, c.sprite.h - c.sprite.ay);
  }
  const cw = left + right + PAD * 2, ch = up + down + PAD * 2 + 2;
  const rowW = (row) => row.reduce((w, c) => w + (c ? cw + GAP : FACING_GAP), 0);
  const width = Math.max(...rows.map(rowW)) + PAD * 2, height = rows.length * (ch + GAP) + PAD * 2;
  const px = new Uint8ClampedArray(width * height * 4);
  const fill = (x, y, w, h, [r, g, b]) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const i = (yy * width + xx) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
  };
  fill(0, 0, width, height, BG);
  rows.forEach((row, ri) => {
    let x = PAD;
    const y = PAD + ri * (ch + GAP);
    for (const c of row) {
      if (!c) { x += FACING_GAP; continue; }
      fill(x, y, cw, ch, CELL);
      const s = c.sprite, rgba = toRGBA(s, c.lut);
      const ox = x + PAD + left - s.ax, oy = y + PAD + up - s.ay;
      for (let sy = 0; sy < s.h; sy++) for (let sx = 0; sx < s.w; sx++) {
        const si = (sy * s.w + sx) * 4;
        if (!rgba[si + 3]) continue;
        const di = ((oy + sy) * width + ox + sx) * 4;
        px[di] = rgba[si]; px[di + 1] = rgba[si + 1]; px[di + 2] = rgba[si + 2]; px[di + 3] = 255;
      }
      fill(x + PAD + left, y + PAD + up + down + 1, 1, 1, TICK);
      x += cw + GAP;
    }
  });

  const k = args.scale, W = width * k, H = height * k, big = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const si = (Math.floor(y / k) * width + Math.floor(x / k)) * 4, di = (y * W + x) * 4;
    big[di] = px[si]; big[di + 1] = px[si + 1]; big[di + 2] = px[si + 2]; big[di + 3] = 255;
  }
  const out = resolve(args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, encodePNG(W, H, big));
  console.log(`creature-sheet: ${painted} sprites in ${rows.length} rows, cell ${cw}x${ch}, ${W}x${H} px -> ${out}`);
}

main().catch((err) => {
  console.error(`creature-sheet: ${err.message}`);
  process.exitCode = 1;
});

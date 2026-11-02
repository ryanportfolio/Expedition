// Renders every registered sprite (and every `previews` variant) to one PNG for review by eye.
//
//   node scripts/art-preview.mjs --out <file.png> [--only <name>] [--scale <n>]
//
// Each sprite variant is one cell holding three copies stacked top to bottom: alignment +1
// (good), 0, -1 (evil). Without --only, a palette sheet comes first: one row per ramp, eight
// shades each, in three column groups for +1, 0 and -1. Upscaled nearest-neighbor (default 3x).
// Painter files are discovered by listing src/art/painters/, so new files need no edit here.

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encodePNG } from './lib/png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { RAMPS, SHADES } = await import(pathToFileURL(join(ROOT, 'src/art/palette.js')).href);
const { makeLut } = await import(pathToFileURL(join(ROOT, 'src/art/lut.js')).href);
const { toRGBA } = await import(pathToFileURL(join(ROOT, 'src/art/sprite.js')).href);
const registry = await import(pathToFileURL(join(ROOT, 'src/art/registry.js')).href);

function parseArgs(argv) {
  const args = { out: null, only: null, scale: 3 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--only') args.only = argv[++i];
    else if (a === '--scale') args.scale = Number(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  if (!args.out) throw new Error('missing --out <path.png>');
  if (!Number.isInteger(args.scale) || args.scale < 1 || args.scale > 16) throw new Error('--scale must be an integer 1..16');
  if (args.only === undefined) throw new Error('--only needs a sprite name');
  return args;
}

const ALIGNMENTS = [1, 0, -1];
const BG = [0x26, 0x29, 0x33];
const CELL_BG = [[0x30, 0x34, 0x40], [0x2b, 0x2f, 0x3a]];
const PAD = 3, GAP = 2, MAX_W = 520;

class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.px = new Uint8ClampedArray(w * h * 4); }
  fill(x, y, w, h, [r, g, b]) {
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(this.w, x + w); xx++) {
      const i = (yy * this.w + xx) * 4;
      this.px[i] = r; this.px[i + 1] = g; this.px[i + 2] = b; this.px[i + 3] = 255;
    }
  }
  draw(rgba, w, h, x, y) {
    for (let sy = 0; sy < h; sy++) for (let sx = 0; sx < w; sx++) {
      const si = (sy * w + sx) * 4;
      if (!rgba[si + 3]) continue;
      const dx = x + sx, dy = y + sy;
      if (dx < 0 || dy < 0 || dx >= this.w || dy >= this.h) continue;
      const di = (dy * this.w + dx) * 4;
      this.px[di] = rgba[si]; this.px[di + 1] = rgba[si + 1]; this.px[di + 2] = rgba[si + 2]; this.px[di + 3] = 255;
    }
  }
  scaled(k) {
    const out = new Uint8ClampedArray(this.w * k * this.h * k * 4);
    const W = this.w * k;
    for (let y = 0; y < this.h * k; y++) for (let x = 0; x < W; x++) {
      const si = ((Math.floor(y / k)) * this.w + Math.floor(x / k)) * 4, di = (y * W + x) * 4;
      out[di] = this.px[si]; out[di + 1] = this.px[si + 1]; out[di + 2] = this.px[si + 2]; out[di + 3] = this.px[si + 3];
    }
    return out;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const painterDir = join(ROOT, 'src/art/painters');
  const files = readdirSync(painterDir).filter((f) => f.endsWith('.js')).sort();
  for (const f of files) registry.registerPainters(await import(pathToFileURL(join(painterDir, f)).href));

  let names = registry.listSprites();
  if (args.only) {
    if (!names.includes(args.only)) throw new Error(`--only: no sprite named "${args.only}" (have: ${names.join(', ')})`);
    names = [args.only];
  }

  // One render per (name, option set): the default {} plus each declared preview, deduplicated.
  const renders = [];
  for (const name of names) {
    const seen = new Set();
    for (const opts of [{}, ...registry.previewsFor(name)]) {
      const key = registry.stableKey(opts);
      if (seen.has(key)) continue;
      seen.add(key);
      const sprite = registry.getSprite(name, opts);
      if (sprite === registry.placeholderSprite()) throw new Error(`painter "${name}" ${key} failed (see error above)`);
      renders.push({ name, opts, sprite });
    }
  }

  // Shelf layout for the cells.
  const luts = ALIGNMENTS.map((a) => makeLut(a));
  const swatch = { size: 4, rowH: 5, groupW: SHADES * 4 + 4 };
  const sheetW = args.only ? 0 : ALIGNMENTS.length * swatch.groupW;
  const sheetH = args.only ? 0 : RAMPS.length * swatch.rowH;
  let x = 0, y = sheetH ? sheetH + PAD * 2 : 0, rowH = 0, width = Math.max(sheetW + PAD * 2, 1);
  const placed = renders.map((r) => {
    const cw = r.sprite.w + PAD * 2, ch = (r.sprite.h + GAP) * ALIGNMENTS.length - GAP + PAD * 2;
    if (x > 0 && x + cw > MAX_W) { x = 0; y += rowH; rowH = 0; }
    const p = { ...r, x, y, cw, ch };
    x += cw; rowH = Math.max(rowH, ch); width = Math.max(width, x);
    return p;
  });
  const height = y + rowH;

  const canvas = new Canvas(width, Math.max(height, 1));
  canvas.fill(0, 0, canvas.w, canvas.h, BG);

  if (!args.only) {
    RAMPS.forEach((ramp, r) => {
      luts.forEach((lut, g) => {
        for (let s = 0; s < SHADES; s++) {
          const v = lut[1 + r * SHADES + s];
          canvas.fill(PAD + g * swatch.groupW + s * swatch.size, PAD + r * swatch.rowH, swatch.size, swatch.size, [v & 255, (v >>> 8) & 255, (v >>> 16) & 255]);
        }
      });
    });
  }

  placed.forEach((p, n) => {
    canvas.fill(p.x, p.y, p.cw, p.ch, CELL_BG[n % 2]);
    luts.forEach((lut, g) => {
      canvas.draw(toRGBA(p.sprite, lut), p.sprite.w, p.sprite.h, p.x + PAD, p.y + PAD + g * (p.sprite.h + GAP));
    });
  });

  const k = args.scale;
  const png = encodePNG(canvas.w * k, canvas.h * k, canvas.scaled(k));
  const out = resolve(args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);
  console.log(`${names.length} sprites, ${renders.length} renders, ${canvas.w * k}x${canvas.h * k} px -> ${out}`);
}

main().catch((err) => {
  console.error(`art-preview: ${err.message}`);
  process.exitCode = 1;
});

// Engine test art: a tiny LUT, one sprite in the spec format, a 16x16 test map and a debug terrain
// pass. Only checks and scenarios use this; the real palette, painters and island come from the art
// kit, island and terrain rounds.
import { rgba } from '../render/buffer.js';
import { worldToScreen } from '../world/iso.js';

const RAMPS = [
  ['#0d0b14', '#1b1826', '#2b2738', '#3d384c', '#545068', '#6f6a84', '#8e89a3', '#b3aec4'], // 0 ink
  ['#2a0d12', '#4d1419', '#76201f', '#a33326', '#c95232', '#e27a45', '#f2a35f', '#ffcf86'], // 1 red cloth
  ['#3a2a1e', '#5a4130', '#7a5a42', '#9c7656', '#bb956c', '#d4b186', '#e7cda4', '#f6e6c8'], // 2 skin / wood
  ['#0c1a3a', '#12305e', '#1a4a86', '#2668ad', '#3a8acb', '#5eaee0', '#8fcdee', '#c6e8f8'], // 3 blue
];

/** Index for ramp r, shade s (spec: 1 + ramp * 8 + shade). */
export const ix = (r, s) => 1 + r * 8 + s;

/**
 * Test LUT. Indices 1..32 hold the four test ramps above (the engine checks and the smoke scenario
 * assert on these). Every later index 33..255 repeats them by ramp and shade, so it is opaque too: a
 * sprite any system draws through this LUT (UI, orbs, real painters) never leaves a transparent hole.
 * Index 0 stays 0 (transparent, never drawn).
 */
export function makeTestLut() {
  const lut = new Uint32Array(256);
  RAMPS.forEach((ramp, r) => ramp.forEach((hex, s) => { lut[ix(r, s)] = rgba(hex); }));
  for (let i = ix(RAMPS.length, 0); i < 256; i++) lut[i] = lut[ix(((i - 1) >> 3) % RAMPS.length, (i - 1) % 8)];
  return lut;
}

/**
 * 9x14 marker post with a pennant on its right side (asymmetric so flipX shows), lit from the top
 * left, outlined in ink. Anchor (4, 13) is the foot of the post.
 */
export function makeTestSprite() {
  const rows = [
    '....O....',
    '...OHO...',
    '...OhOOOO',
    '...OsORRO',
    '...OsOrO.',
    '..OOSOO..',
    '.OBbbbBO.',
    '.OBbbbdO.',
    '.OBbbddO.',
    '..ObbdO..',
    '..OOsOO..',
    '...OsO...',
    '...OsO...',
    '..OOOOO..',
  ];
  const key = {
    '.': 0, O: ix(0, 0), H: ix(2, 7), h: ix(2, 5), s: ix(2, 3), S: ix(2, 4),
    R: ix(1, 6), r: ix(1, 3), B: ix(3, 6), b: ix(3, 4), d: ix(3, 2),
  };
  const w = rows[0].length, h = rows.length;
  const data = new Uint8Array(w * h);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { data[y * w + x] = key[ch]; }));
  return { w, h, ax: 4, ay: 13, data };
}

/** 16x16 test map in the island format: grass at height 2, a height-6 rock plateau, a water patch. */
export function makeTestMap() {
  const w = 16, h = 16;
  const height = new Uint8Array(w * h), ground = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let hh = 2, g = 3; // grass
      const cheb = Math.max(Math.abs(x - 10), Math.abs(y - 10));
      if (x >= 9 && x <= 11 && y >= 9 && y <= 11) { hh = 6; g = 5; } // plateau
      else if (cheb === 2 && x >= 8 && y >= 8) { hh = 4; g = 4; } // slope ring
      if (y === 5 && x <= 8) g = 4; // dirt path
      if (x <= 4 && y >= 11) { hh = 0; g = x <= 2 && y >= 13 ? 0 : 1; } // water
      else if (x <= 5 && y >= 10) { hh = 1; g = 2; } // beach
      height[i] = hh; ground[i] = g;
    }
  return {
    w, h, seaLevel: 1, height, ground,
    trees: [], rocks: [],
    sites: { temple: { x: 10, y: 10 }, village: { x: 4, y: 4, r: 3 }, rival: { x: 13, y: 3, r: 3 }, rivalTemple: { x: 13, y: 2 }, creatureStart: { x: 7, y: 7 } },
  };
}

const TOP = ['#10305c', '#2a6aa8', '#c9b27a', '#4f8a3a', '#7a5a3a', '#7d7a80'].map(rgba);
const LEFT = ['#0a2244', '#1d4c7c', '#8a6f45', '#4a3a26', '#4a3a26', '#4c4a52'].map(rgba);
const RIGHT = ['#0d2850', '#235a92', '#a8905c', '#6a5434', '#6a5434', '#625f68'].map(rgba);

/**
 * Debug terrain pass: each tile as a flat diamond at its stored height with side walls down to 0,
 * back to front. Stepped, so it shows tile heights rather than the bilinear surface heightAt samples.
 */
export function debugTerrainPass(ctx) {
  const { world, buf, w: W, h: H, camX, camY } = ctx;
  for (let s = 0; s < world.w + world.h - 1; s++)
    for (let tx = Math.max(0, s - world.h + 1); tx <= Math.min(s, world.w - 1); tx++) {
      const ty = s - tx, i = ty * world.w + tx;
      const hh = world.height[i], g = world.ground[i];
      const p = worldToScreen(tx, ty, hh);
      const left = Math.round(p.sx - camX) - 16, top = Math.round(p.sy - camY);
      for (let c = 0; c < 32; c++) {
        const x = left + c;
        if (x < 0 || x >= W) continue;
        const half = c < 16 ? c >> 1 : (31 - c) >> 1;
        const y0 = top + 7 - half, y1 = top + 8 + half, y2 = y1 + hh * 8;
        const side = c < 16 ? LEFT[g] : RIGHT[g];
        for (let y = Math.max(0, y0); y <= Math.min(H - 1, y2); y++) buf[y * W + x] = y <= y1 ? TOP[g] : side;
      }
    }
}

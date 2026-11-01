// Color lookup tables: palette index -> packed RGBA for one alignment value.
//
// A LUT is a Uint32Array(256) of ImageData-compatible little-endian RGBA (0xAABBGGRR), so a
// renderer can write `dst32[i] = lut[index]` into a Uint32Array view of ImageData.data.
// lut[0] is unused (index 0 = transparent) and stays 0, as do indices past the last ramp.
// Alignment a in [-1, 1] (-1 evil, +1 good) is quantized to 17 steps of 0.125; each step's
// LUT is built once and cached, so repeated calls return the same object. Callers must not
// mutate a returned LUT.

import { RAMPS, SHADES } from './palette.js';

const STEPS = 8; // steps per unit of alignment: 2 * 8 + 1 = 17 quantized values
const cache = new Map();

function parseHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const PARSED = RAMPS.map((r) => ({ good: r.good.map(parseHex), evil: r.evil.map(parseHex) }));

/** Quantized step for an alignment: integer in -8..8. NaN or non-numbers count as 0. */
export function alignmentStep(alignment) {
  const a = Number.isFinite(alignment) ? Math.max(-1, Math.min(1, alignment)) : 0;
  // Round half away from zero so +0.0625 and -0.0625 land symmetrically.
  return Math.sign(a) * Math.round(Math.abs(a) * STEPS);
}

/** Packs r, g, b, a bytes as 0xAABBGGRR (unsigned). */
export function packRGBA(r, g, b, a = 255) {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/**
 * LUT for an alignment in [-1, 1]. Each ramp color = evil + (good - evil) * t with
 * t = (a + 1) / 2, blended per sRGB channel and rounded. Cached per quantized step.
 */
export function makeLut(alignment) {
  const step = alignmentStep(alignment);
  let lut = cache.get(step);
  if (lut) return lut;
  const t = (step / STEPS + 1) / 2;
  lut = new Uint32Array(256);
  PARSED.forEach((ramp, r) => {
    for (let s = 0; s < SHADES; s++) {
      const g = ramp.good[s], e = ramp.evil[s];
      lut[1 + r * SHADES + s] = packRGBA(
        Math.round(e[0] + (g[0] - e[0]) * t),
        Math.round(e[1] + (g[1] - e[1]) * t),
        Math.round(e[2] + (g[2] - e[2]) * t),
      );
    }
  });
  cache.set(step, lut);
  return lut;
}

/**
 * LUT lookup with options. `{ neutral: true }` returns the alignment-0 LUT for things that
 * never shift with the player's alignment (UI, neutral overlays), whatever `alignment` is.
 */
export function lutFor(alignment, { neutral = false } = {}) {
  return makeLut(neutral ? 0 : alignment);
}

/** [r, g, b, a] bytes of one LUT entry. */
export function rgbaOf(lut, index) {
  const v = lut[index] >>> 0;
  return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
}

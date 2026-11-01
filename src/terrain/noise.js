// Deterministic hash noise for terrain detail. Integer hashing (imul) plus +, *, floor only, so node
// and every browser produce the same bytes. No shared state, no Math.random.

/** 32-bit hash of (x, y, salt) as an unsigned integer. */
export function hash32(x, y, salt) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Hash of (x, y, salt) in [0, 1). */
export function hash01(x, y, salt) {
  return hash32(x, y, salt) / 4294967296;
}

/** Smooth value noise in [0, 1) on a lattice of `cell` units. */
export function valueNoise(x, y, cell, salt) {
  const fx0 = x / cell, fy0 = y / cell;
  const gx = Math.floor(fx0), gy = Math.floor(fy0);
  const fx = fx0 - gx, fy = fy0 - gy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash01(gx, gy, salt), b = hash01(gx + 1, gy, salt);
  const c = hash01(gx, gy + 1, salt), d = hash01(gx + 1, gy + 1, salt);
  const top = a + (b - a) * sx, bot = c + (d - c) * sx;
  return top + (bot - top) * sy;
}

/** Two octaves of value noise, still in [0, 1). */
export function fbm(x, y, cell, salt) {
  return valueNoise(x, y, cell, salt) * 0.65 + valueNoise(x, y, cell / 2.3, salt + 101) * 0.35;
}

// Seeded mulberry32. The only random source sim code may use.
export function createRng(seed = 1) {
  let s = seed >>> 0;
  const rng = {
    get seed() { return seed; },
    /** Float in [0, 1). */
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    /** Float in [a, b). */
    range(a, b) { return a + (b - a) * rng.next(); },
    /** Integer in [0, n). */
    int(n) { return Math.floor(rng.next() * n); },
    pick(list) { return list[rng.int(list.length)]; },
  };
  return rng;
}

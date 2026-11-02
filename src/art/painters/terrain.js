// Terrain painters: trees (pine and broadleaf, five growth stages), stumps and boulders.
// Pure and deterministic; light from the top-left; anchors on the ground contact point (trunk
// base, stump base, boulder base center), which is the bottom outline row.

import { idx } from '../palette.js';
import { createSprite, ellipse, line, outline, polygon, px, get, rect, sphereShade, stamp, trim } from '../sprite.js';

const F = (s) => idx('foliage', s);
const B = (s) => idx('bark', s);
const R = (s) => idx('rock', s);
const M = (s) => idx('moss', s);

/** Small integer hash for deterministic per-sprite variation. */
function hash(a, b) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

const quantGrowth = (g) => {
  const n = Number.isFinite(g) ? g : 1;
  return Math.round(Math.max(0, Math.min(1, n)) * 4) / 4;
};

/** Trunk with root flare: (cx, top..base), width 1-3 px, lit on the left. */
function trunk(s, cx, top, base, w) {
  const x0 = cx - (w >> 1);
  rect(s, x0, top, w, base - top + 1, B(3));
  line(s, x0, top, x0, base, B(5));
  if (w >= 2) line(s, x0 + w - 1, top, x0 + w - 1, base, B(2));
  if (w >= 3) for (let y = top + 1; y <= base; y += 3) px(s, x0 + 1, y, B(4)); // bark grain
  if (w >= 2) { px(s, x0 - 1, base, B(4)); px(s, x0 + w, base, B(2)); } // roots
}

/** One crown lump: a filled ellipse shaded as its own ball, so the crown reads as clumps. */
function lump(s, cx, cy, rx, ry, hi = 6) {
  const t = createSprite(s.w, s.h);
  ellipse(t, cx, cy, rx, ry, F(4));
  sphereShade(t, 'foliage', { lo: 1, hi, cx: cx + 0.5 - rx * 0.15, cy: cy + 0.5 + ry * 0.1, rx: rx + 1, ry: ry + 1 });
  stamp(s, t, 0, 0);
}

/** Underside shadow: crown pixels with no crown below them get the darkest leaf shade. */
function shadeUnderside(s, isCrown) {
  for (let y = s.h - 1; y >= 0; y--) for (let x = 0; x < s.w; x++) {
    const v = get(s, x, y);
    if (isCrown(v) && !isCrown(get(s, x, y + 1))) {
      px(s, x, y, F(1));
      if (isCrown(get(s, x, y - 1)) && get(s, x, y - 1) > F(2)) px(s, x, y - 1, F(2));
    }
  }
}

const isLeaf = (v) => v >= F(0) && v <= F(7);

// Crown lumps of a full broadleaf: [dx, dy, rx, ry, hi] in units of the crown radius, back to front.
const BROAD_LUMPS = [
  [0.5, -0.55, 0.42, 0.36, 5], [-0.25, -0.7, 0.45, 0.38, 6], [-0.85, -0.2, 0.38, 0.34, 6],
  [0.95, 0.0, 0.36, 0.32, 5], [-0.45, 0.05, 0.46, 0.38, 6], [0.3, -0.1, 0.48, 0.4, 5],
  [-0.9, 0.35, 0.32, 0.26, 5], [0.75, 0.38, 0.34, 0.27, 4], [-0.05, 0.4, 0.42, 0.3, 5],
];

function broadTree(growth) {
  if (growth === 0) return sapling('broad');
  const k = 0.42 + 0.58 * growth; // full tree about 24 px tall, 22 px wide
  const W = 26, H = 28;
  const s = createSprite(W, H, 13, H - 1);
  const cx = 13, base = H - 1;
  const r = Math.max(3.2, 10 * k); // crown half-width
  const trunkH = Math.max(3, Math.round(7 * k));
  const cy = base - trunkH - Math.round(r * 0.55);
  trunk(s, cx, cy, base, growth >= 0.75 ? 3 : 2);
  // Limbs forking into the crown, seen through its gaps.
  if (growth >= 0.5) {
    line(s, cx - 1, cy + 1, cx - Math.round(r * 0.5), cy - Math.round(r * 0.35), B(4));
    line(s, cx + 1, cy + 2, cx + Math.round(r * 0.55), cy - Math.round(r * 0.2), B(2));
  }
  const lumps = growth >= 0.75 ? BROAD_LUMPS : BROAD_LUMPS.filter((_, i) => i % 3 !== 2);
  for (const [dx, dy, lx, ly, hi] of lumps) lump(s, cx + Math.round(dx * r), cy + Math.round(dy * r * 0.8), lx * r, ly * r, hi);
  shadeUnderside(s, isLeaf);
  // Holes in the crown showing a limb: weathered, not a perfect ball.
  if (growth >= 0.75) {
    const hx = cx + Math.round(r * 0.45), hy = cy + Math.round(r * 0.05);
    px(s, hx, hy, B(2)); px(s, hx + 1, hy, F(0)); px(s, hx, hy + 1, F(1));
    px(s, cx - Math.round(r * 0.55), cy - Math.round(r * 0.1), F(1));
  }
  // Leaf glints on the lit side.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (get(s, x, y) === F(6) && hash(x * 7 + y, 3) < 0.3) px(s, x, y, F(7));
    else if (get(s, x, y) === F(4) && hash(x, y * 5 + 1) < 0.12) px(s, x, y, F(3));
  }
  return outline(trim(s), F(0));
}

function pineTree(growth) {
  if (growth === 0) return sapling('pine');
  const k = 0.45 + 0.55 * growth; // full pine about 27 px tall
  const W = 16, H = 30;
  const s = createSprite(W, H, 8, H - 1);
  const cx = 8, base = H - 1;
  const height = Math.round(26 * k);
  const top = base - height;
  const trunkH = Math.max(2, Math.round(4 * k));
  trunk(s, cx, base - trunkH - 2, base, 2);
  const tiers = growth >= 0.75 ? 5 : growth >= 0.5 ? 4 : 3;
  const crownBottom = base - trunkH;
  const span = crownBottom - top;
  // Bottom tier first; each upper tier overlaps the one below.
  for (let t = tiers - 1; t >= 0; t--) {
    const yTop = top + Math.round((span * t) / (tiers + 0.6));
    const yBot = top + Math.round((span * (t + 1.6)) / (tiers + 0.6));
    const half = Math.max(1.5, ((t + 1.4) / (tiers + 0.4)) * 6.5 * k + (t === tiers - 1 ? 0.5 : 0));
    const droop = (hash(t, 11) < 0.5 ? 1 : 0);
    const pts = [[cx + 0.5, yTop], [cx + 0.5 + half + 0.5, yBot - droop], [cx + 0.5 + half * 0.45, yBot - 1], [cx + 0.5, yBot + 0.5],
      [cx + 0.5 - half * 0.5, yBot - 1], [cx + 0.5 - half - 0.5, yBot - (1 - droop)]];
    const tier = createSprite(W, H);
    polygon(tier, pts, F(3));
    // Lit left half, shaded right half, a dark hem under each tier.
    for (let y = yTop; y <= yBot + 1; y++) for (let x = 0; x < W; x++) {
      if (!get(tier, x, y)) continue;
      const rel = (x + 0.5 - cx) / (half + 0.5);
      let sh = rel < -0.35 ? 4 : rel < 0.15 ? 3 : 2;
      if (y <= yTop + 1 && rel < 0.2) sh = 5;
      if (!get(tier, x, y + 1)) sh = 1;
      px(tier, x, y, F(sh));
    }
    stamp(s, tier, 0, 0);
  }
  // Needle texture: a few bright and dark flecks.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = get(s, x, y);
    if (v === F(4) && hash(x, y * 13) < 0.18) px(s, x, y, F(5));
    else if (v === F(3) && hash(x * 3, y) < 0.15) px(s, x, y, F(2));
  }
  return outline(trim(s), F(0));
}

/** Growth 0: a thin stem with a few leaves. */
function sapling(species) {
  const s = createSprite(7, 9, 3, 8);
  line(s, 3, 3, 3, 8, B(4));
  px(s, 2, 8, B(3));
  if (species === 'pine') {
    px(s, 3, 1, F(5)); px(s, 3, 2, F(4));
    line(s, 2, 3, 4, 3, F(3)); px(s, 2, 3, F(4));
    line(s, 1, 5, 5, 5, F(3)); px(s, 1, 5, F(4)); px(s, 2, 5, F(4)); px(s, 5, 5, F(2));
    line(s, 2, 4, 4, 4, F(2));
  } else {
    px(s, 2, 2, F(5)); px(s, 1, 3, F(4)); px(s, 2, 3, F(4));
    px(s, 4, 3, F(4)); px(s, 5, 3, F(3)); px(s, 4, 4, F(2));
    px(s, 3, 1, F(5)); px(s, 2, 5, F(3));
  }
  return outline(trim(s), F(0));
}

function tree({ species = 'broad', growth = 1 } = {}) {
  const g = quantGrowth(growth);
  return species === 'pine' ? pineTree(g) : broadTree(g);
}

/** Felled tree stump: lit cut top with rings, bark sides, a root to each side. */
function stump() {
  const s = createSprite(10, 8, 5, 7);
  rect(s, 2, 2, 6, 5, B(3));
  line(s, 2, 2, 2, 6, B(5)); line(s, 3, 3, 3, 6, B(4));
  line(s, 7, 2, 7, 6, B(2)); line(s, 6, 4, 6, 6, B(2));
  ellipse(s, 4.5, 2, 2.5, 1, B(6));
  px(s, 4, 2, B(5)); px(s, 5, 2, B(4)); px(s, 3, 1, B(7));
  px(s, 1, 6, B(4)); px(s, 0, 7, B(3)); px(s, 8, 6, B(2)); px(s, 9, 7, B(2));
  px(s, 1, 7, B(3)); px(s, 8, 7, B(1));
  rect(s, 2, 7, 6, 1, B(1));
  return outline(trim(s), B(0));
}

// Ten points around the unit circle (literal, so every engine gets the same bytes).
const RING = [[1.0000, 0.0000], [0.8090, 0.5878], [0.3090, 0.9511], [-0.3090, 0.9511], [-0.8090, 0.5878], [-1.0000, 0.0000], [-0.8090, -0.5878], [-0.3090, -0.9511], [0.3090, -0.9511], [0.8090, -0.5878]];

/** Weathered boulder: lumpy silhouette with a flat base, a crack, moss on the lit top. */
function boulder(s, cx, base, rx, ry, seed, mossy) {
  const pts = [];
  for (let i = 0; i < RING.length; i++) {
    const j = 0.82 + 0.3 * hash(seed, i);
    const x = cx + RING[i][0] * rx * j, y = base - ry + RING[i][1] * ry * j;
    pts.push([x, Math.min(y, base + 0.5)]);
  }
  const t = createSprite(s.w, s.h);
  polygon(t, pts, R(4));
  sphereShade(t, 'rock', { lo: 1, hi: 6, cx: cx - rx * 0.25, cy: base - ry * 1.1, rx: rx * 1.15, ry: ry * 1.1 });
  // Facets: a hard edge between the lit top and the shaded front.
  for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
    const v = get(t, x, y);
    if (!v) continue;
    if (y > base - ry * 0.55 && v > R(3)) px(t, x, y, v - 1);
    if (!get(t, x, y + 1) && y >= base - 1) px(t, x, y, R(1)); // contact shadow
  }
  if (rx >= 4) { // crack
    const x0 = Math.round(cx + rx * 0.2), y0 = Math.round(base - ry * 1.3);
    line(t, x0, y0, x0 - 1, y0 + 2, R(1));
    line(t, x0 - 1, y0 + 2, x0, y0 + 4, R(1));
    px(t, x0 - 1, y0, R(6));
  }
  if (mossy) {
    for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
      const v = get(t, x, y);
      if (!v || get(t, x, y - 1)) continue; // top surface only
      if (x < cx + rx * 0.2 && hash(x, seed) < 0.6) { px(t, x, y, M(3)); if (get(t, x, y + 1) && hash(x, seed + 1) < 0.4) px(t, x, y + 1, M(2)); }
    }
  }
  stamp(s, t, 0, 0);
}

const ROCK_SIZES = { 1: [3, 2.5], 2: [5, 4], 3: [7, 5.5] };

function rock({ size = 2 } = {}) {
  const sz = ROCK_SIZES[size] ? size : 2;
  const [rx, ry] = ROCK_SIZES[sz];
  const W = 18, H = 16;
  const s = createSprite(W, H, 9, H - 1);
  const base = H - 1;
  if (sz === 3) boulder(s, 6.5, base, 3, 2.4, 41, false); // a smaller stone behind on the left
  boulder(s, 9, base, rx, ry, 7 + sz, sz >= 2);
  if (sz >= 2) boulder(s, 9 + rx, base, 1.6, 1.4, 19 + sz, false); // chip at the foot
  return outline(trim(s), R(0));
}

export const sprites = { tree, stump, rock };

const GROWTHS = [0, 0.25, 0.5, 0.75, 1];
export const previews = {
  tree: [...GROWTHS.map((growth) => ({ species: 'pine', growth })), ...GROWTHS.map((growth) => ({ species: 'broad', growth }))],
  stump: [{}],
  rock: [{ size: 1 }, { size: 2 }, { size: 3 }],
};

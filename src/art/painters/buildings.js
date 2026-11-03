// Building painters: `house`, `field`, `store`, `mine`, `temple`, each with
// { owner: 'player'|'rival', stage: 'blueprint'|'building'|'done'|'wrecked', growth, empty }
// (growth for fields, empty for a worked-out mine).
//
// Every building is modelled as flat faces in world space (x, y in tiles from the footprint
// center, z in pixels up) and rasterized with the shared iso projection, so walls, roofs and
// footprints line up with the terrain grid exactly: a 2 x 2 footprint is 64 px wide, 3 x 3 is
// 96 px. Each face is shaded by a material function of its own surface coordinates (u along the
// face in screen px, v up the face in px), which is how timber frames, stone courses, planks,
// thatch strands and roof tiles stay straight on slanted iso faces.
//
// Layers: ground apron (the footprint, trodden earth / paving / tilled soil), a cast shadow to
// the bottom-right (light from the top-left), the building mass with an ink outline, then thin
// details that must stay 1 px (scaffold poles). The anchor is the footprint center on the ground.
//
// Stages, shared by all kinds:
//   done      the finished building.
//   building  the same model clipped to the lower walls, with scaffold poles, ledgers, a ladder
//             and a lumber stack.
//   blueprint a faint ghost: the done model's silhouette and edges in the pale parchment ramp,
//             sparse fill, dashed footprint outline. No ink.
//   wrecked   the model clipped low with a jagged top, charred to soot and ash, with fallen beams
//             and rubble on a scorched apron.
// Player style: timber frame, cream plaster, thatch, fieldstone footings, chimneys. Rival style:
// sandstone walls, terracotta domes and vaults, arched doors, cobbles. Rival buildings use only
// ramps that never shift with alignment (parchment-tone sandstone, clay, ink), so the player's
// alignment never repaints the rival village; the player's buildings shift through the LUT.

import { idx, RAMP, SHADES } from '../palette.js';
import { createSprite, ellipse, line, outline, polygon, px, stamp, trim } from '../sprite.js';
import { KINDS } from '../../village/config.js';
import { MIRACLES, TUNING } from '../../miracles/tuning.js';

const STAGES = ['blueprint', 'building', 'done', 'wrecked'];
const INK = idx('ink', 0);

// ---- small helpers -----------------------------------------------------------------------------

function hash(a, b = 0, c = 0) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return (h ^ (h >>> 16)) >>> 0;
}
const clampShade = (s) => Math.max(0, Math.min(SHADES - 1, Math.round(s)));
const C = (ramp, shade) => idx(ramp, clampShade(shade));
const rampOfIndex = (v) => Math.floor((v - 1) / SHADES);
const shadeOfIndex = (v) => (v - 1) % SHADES;

/** Canvas for a footprint: anchor at the footprint center, `up` px of headroom above the top corner. */
function canvas(fw, fh, up = 64, down = 10) {
  const half = (fw + fh) * 4;
  const w = (fw + fh) * 16 + 12;
  return createSprite(w, up + half * 2 + down, w / 2, up + half);
}

/** World point (tiles, tiles, px up) to sprite pixel coordinates (pixel corners). */
const P = (s, x, y, z = 0) => [s.ax + (x - y) * 16, s.ay + (x + y) * 8 - z];

// ---- face rasterizer ---------------------------------------------------------------------------
//
// A drawing context g = { s, clip, jag } paints into sprite s. Faces above `clip` (px) are cut,
// with a jagged edge of up to `jag` px, for half-built and wrecked stages.

function ctx(s) { return { s, clip: Infinity, jag: 0, mask: new Uint8Array(s.w * s.h) }; }

/**
 * Fills a planar face given by origin O and edge vectors A, B (world: tiles, tiles, px). With
 * tri = true the face is the triangle O, O+A, O+B, else the parallelogram. `paint` is a palette
 * index or (u, v, f, x, y) => index (0 = skip) where u, v are the face's own coordinates in px
 * (u along A measured in screen x, or along the screen length when A is vertical; v along B in
 * screen length) and f = { lu, lv } their full lengths.
 */
function face(g, O, A, B, paint, tri = false) {
  const { s } = g;
  const corner = (k) => P(s, O[0] + k[0] * A[0] + k[1] * B[0], O[1] + k[0] * A[1] + k[1] * B[1], O[2] + k[0] * A[2] + k[1] * B[2]);
  const pts = tri ? [corner([0, 0]), corner([1, 0]), corner([0, 1])] : [corner([0, 0]), corner([1, 0]), corner([1, 1]), corner([0, 1])];
  const SA = [(A[0] - A[1]) * 16, (A[0] + A[1]) * 8 - A[2]];
  const SB = [(B[0] - B[1]) * 16, (B[0] + B[1]) * 8 - B[2]];
  const det = SA[0] * SB[1] - SA[1] * SB[0];
  if (Math.abs(det) < 1e-6) return;
  const lu = Math.abs(SA[0]) > 0.5 ? Math.abs(SA[0]) : Math.hypot(SA[0], SA[1]);
  const lv = Math.hypot(SB[0], SB[1]);
  const f = { lu, lv };
  const m = { w: s.w, h: s.h, data: g.mask };
  polygon(m, pts, 1);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  x0 = Math.max(0, Math.floor(x0) - 1); y0 = Math.max(0, Math.floor(y0) - 1);
  x1 = Math.min(s.w - 1, Math.ceil(x1) + 1); y1 = Math.min(s.h - 1, Math.ceil(y1) + 1);
  const S0 = pts[0];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * s.w + x;
    if (!g.mask[i]) continue;
    g.mask[i] = 0;
    const dx = x + 0.5 - S0[0], dy = y + 0.5 - S0[1];
    const u = (dx * SB[1] - dy * SB[0]) / det, v = (SA[0] * dy - SA[1] * dx) / det;
    const z = O[2] + u * A[2] + v * B[2];
    if (z > g.clip + (g.jag ? (hash(x, 7) % (g.jag + 1)) - g.jag / 2 : 0)) continue;
    const c = typeof paint === 'function' ? paint(u * lu, v * lv, f, x, y) : paint;
    if (c) s.data[i] = c;
  }
}

/** Axis box from (x0, y0, z0) to (x1, y1, z1); visible faces only: front (+y), side (+x), top. */
function box(g, x0, y0, x1, y1, z0, z1, { front, side, top }) {
  const h = z1 - z0;
  // Cut open (half built or wrecked): the inner faces of the back walls show above the floor.
  if (z1 > g.clip && z0 < g.clip && h > 6) {
    if (front) face(g, [x0, y0, z0], [x1 - x0, 0, 0], [0, 0, h], typeof front === 'function' ? shadeShift(front, -2) : front);
    if (side) face(g, [x0, y1, z0], [0, y0 - y1, 0], [0, 0, h], typeof side === 'function' ? shadeShift(side, 1) : side);
  }
  if (front) face(g, [x0, y1, z0], [x1 - x0, 0, 0], [0, 0, h], front);
  if (side) face(g, [x1, y1, z0], [0, y0 - y1, 0], [0, 0, h], side);
  // Floors and ledges of an unfinished or ruined building sit in shadow.
  const t = g.clip < Infinity && typeof top === 'function' ? shadeShift(top, -2) : g.clip < Infinity && top ? 1 + rampOfIndex(top) * SHADES + clampShade(shadeOfIndex(top) - 2) : top;
  if (t && z1 <= g.clip) face(g, [x0, y0, z1], [x1 - x0, 0, 0], [0, y1 - y0, 0], t);
}

/** Wraps a paint function so its result is n shades lighter (or darker for n < 0). */
function shadeShift(paint, n) {
  return (...a) => {
    const v = paint(...a);
    return v ? 1 + rampOfIndex(v) * SHADES + clampShade(shadeOfIndex(v) + n) : v;
  };
}

// ---- materials ---------------------------------------------------------------------------------
// Each returns paint(u, v, f, x, y). `b` is the base shade of the face (front faces lit, side
// faces two shades darker, tops brightest).

const mat = {
  /** Rough fieldstone courses, staggered joints, a little moss at the foot. */
  fieldstone: (b, ramp = 'stone', moss = true) => (u, v, f, x) => {
    const row = Math.floor(v / 3), off = row % 2 ? 2 : 0;
    const col = Math.floor((u + off) / 5);
    if (v % 3 < 1 || (u + off) % 5 < 1) return C(ramp, b - 2);
    const n = hash(col, row, 3);
    if (moss && v < 3 && n % 4 === 0) return C('moss', b - 1);
    return C(ramp, b + ((n % 3) - 1) * 0.6);
  },
  /** Cut stone blocks in even courses (temple, rival walls). */
  blocks: (b, ramp, h = 4, w = 7) => (u, v) => {
    const row = Math.floor(v / h), off = row % 2 ? Math.floor(w / 2) : 0;
    if (v % h < 1) return C(ramp, b - 2);
    if ((u + off) % w < 1) return C(ramp, b - 1.5);
    const n = hash(Math.floor((u + off) / w), row, 5);
    return C(ramp, b + (n % 5 === 0 ? -1 : n % 7 === 0 ? 1 : 0));
  },
  /** Lime plaster in a timber frame: corner and middle posts, sill, top plate, a mid rail and a brace. */
  timberFrame: (b) => (u, v, f, x, y) => {
    const wood = C('bark', b - 2);
    if (u < 1.2 || u > f.lu - 1.2 || Math.abs(u - f.lu / 2) < 0.6) return wood;
    if (v < 1 || v > f.lv - 1.4 || Math.abs(v - f.lv * 0.55) < 0.5) return wood;
    if (u < f.lu / 2 && v < f.lv * 0.55 && Math.abs(u - 1 - v * ((f.lu / 2 - 2) / (f.lv * 0.55))) < 0.7) return wood;
    const n = hash(x, y, 11);
    if (n % 29 === 0) return C('plaster', b - 2);
    if (v < 2.5 && n % 3 === 0) return C('plaster', b - 1);
    return C('plaster', b + (n % 9 === 0 ? -1 : 0));
  },
  /** Vertical boards with dark seams and grain streaks. */
  planks: (b, w = 3) => (u, v, f, x, y) => {
    const col = Math.floor(u / w);
    if (u % w < 1) return C('bark', b - 2);
    const n = hash(col, 0, 9);
    if (hash(x, y, 13) % 17 === 0) return C('bark', b - 1);
    return C('bark', b + ((n % 3) - 1) * 0.5);
  },
  /** Straw thatch: strands down the slope, layer steps, a darker eave fringe, a lit ridge. */
  thatch: (b) => (u, v, f, x, y) => {
    if (v < 1) return C('thatch', b + 1);
    if (v > f.lv - 1.5) return C('thatch', b - 2);
    const strand = hash(Math.floor(u), 0, 17) % 5;
    const layer = v % 4 < 1;
    return C('thatch', b + (layer ? -1 : 0) + (strand === 0 ? -1 : strand === 4 ? 1 : 0) * 0.6 + (hash(x, y, 2) % 11 === 0 ? -1 : 0));
  },
  /** Split wooden shingles in staggered rows. */
  shingles: (b) => (u, v) => {
    const row = Math.floor(v / 3);
    if (v % 3 < 1) return C('bark', b - 2);
    if ((u + (row % 2) * 2) % 4 < 1) return C('bark', b - 1);
    return C('bark', b + (hash(Math.floor(u / 4), row, 23) % 4 === 0 ? 1 : 0));
  },
  /** Terracotta roof tile courses (barrel vaults). */
  clayTiles: (b) => (u, v) => {
    if (u % 3 < 1) return C('clay', b - 1);
    return C('clay', b + (hash(Math.floor(u / 3), Math.floor(v / 2), 31) % 5 === 0 ? -1 : 0));
  },
  /** Flat paving / roof slab with worn joints. */
  slab: (b, ramp, cell = 6) => (u, v, f, x, y) => {
    if (u % cell < 1 || v % (cell / 2) < 1) return C(ramp, b - 1);
    return C(ramp, b + (hash(x, y, 41) % 13 === 0 ? -1 : 0));
  },
};

const STONE_R = 'ui-parchment'; // rival sandstone (never shifts with alignment)

// ---- ground aprons -----------------------------------------------------------------------------

/** World (x, y) on the ground plane under sprite pixel (px, py). */
function groundAt(s, x, y) {
  const a = (x + 0.5 - s.ax) / 16, b = (y + 0.5 - s.ay) / 8;
  return [(a + b) / 2, (b - a) / 2];
}

/** Fills the footprint diamond (inset by `inset` tiles) with paint(wx, wy, x, y). */
function apron(s, fw, fh, paint, inset = 0) {
  const hx = fw / 2 - inset, hy = fh / 2 - inset;
  const pts = [P(s, -hx, -hy), P(s, hx, -hy), P(s, hx, hy), P(s, -hx, hy)];
  const m = createSprite(s.w, s.h);
  polygon(m, pts, 1);
  for (let i = 0; i < m.data.length; i++) {
    if (!m.data[i]) continue;
    const x = i % s.w, y = (i - x) / s.w;
    const [wx, wy] = groundAt(s, x, y);
    const c = paint(wx, wy, x, y, Math.min(hx - Math.abs(wx), hy - Math.abs(wy)));
    if (c) s.data[i] = c;
  }
  return s;
}

const aprons = {
  /** Trodden earth with grass creeping in at the edges and a few loose stones. */
  yard: (s, fw, fh) => apron(s, fw, fh, (wx, wy, x, y, edge) => {
    const n = hash(x, y, 51);
    if (edge < 0.07 && n % 3 !== 0) return C('grass', 3 + (n % 2));
    if (edge < 0.2 && n % 3 === 0) return C('grass', 4);
    if (n % 37 === 0) return C('stone', 4);
    return C('dirt', 4 - (n % 5 === 0 ? 1 : 0) + (n % 11 === 0 ? 1 : 0));
  }),
  /** Rival cobbles: rounded sandstone setts in a dark bed. */
  cobbles: (s, fw, fh) => apron(s, fw, fh, (wx, wy, x, y, edge) => {
    const n = hash(x, y, 53);
    if (edge < 0.12 && n % 2) return C('grass', 3);
    const cu = (wx * 4.5) % 1, cv = (wy * 4.5) % 1;
    const gap = cu < 0.18 || cv < 0.18 || cu < 0 || cv < 0;
    if (gap) return C(STONE_R, 1);
    const k = hash(Math.floor(wx * 4.5 + 20), Math.floor(wy * 4.5 + 20), 3);
    return C(STONE_R, 3 + (k % 3 === 0 ? 1 : 0) - (n % 13 === 0 ? 1 : 0));
  }),
  /** Temple court: big stone flags with moss in the joints. */
  flags: (s, fw, fh) => apron(s, fw, fh, (wx, wy, x, y, edge) => {
    const n = hash(x, y, 57);
    if (edge < 0.1 && n % 2) return C('grass', 3);
    const cu = ((wx + 5) * 2.5) % 1, cv = ((wy + 5) * 2.5) % 1;
    if (cu < 0.07 || cv < 0.07) return n % 3 === 0 ? C('moss', 3) : C('stone', 2);
    return C('stone', 4 + (hash(Math.floor((wx + 5) * 2.5), Math.floor((wy + 5) * 2.5), 7) % 3 === 0 ? 1 : 0) - (n % 17 === 0 ? 1 : 0));
  }),
};

/** Darkens apron pixels that lie down-right of the building mass (cast shadow, light top-left). */
function castShadow(ground, mass) {
  const { w, h } = ground;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const v = ground.data[i];
    if (!v || mass.data[i]) continue;
    const near = (dx, dy) => { const xx = x - dx, yy = y - dy; return xx >= 0 && yy >= 0 && xx < w && yy < h && mass.data[yy * w + xx]; };
    if (near(2, 1) || near(4, 2) || near(5, 1)) ground.data[i] = 1 + rampOfIndex(v) * SHADES + Math.max(0, shadeOfIndex(v) - 2);
  }
}

// ---- reusable parts ----------------------------------------------------------------------------

/** Gable roof with the ridge along world y (ridge at x = xm). */
function gableY(g, x0, x1, y0, y1, ze, zr, mf, mb, edge) {
  const xm = (x0 + x1) / 2, L = y1 - y0;
  face(g, [x0, y0, ze], [0, L, 0], [xm - x0, 0, zr - ze], mb);
  face(g, [x0, y1, ze], [xm - x0, 0, zr - ze], [0, 0, -2], edge);
  face(g, [xm, y1, zr], [x1 - xm, 0, ze - zr], [0, 0, -2], edge);
  face(g, [xm, y0, zr], [0, L, 0], [x1 - xm, 0, ze - zr], mf);
  face(g, [x1, y0, ze], [0, L, 0], [0, 0, -2], edge);
}

/** Dome on a circle of radius r (tiles) at world (cx, cy, z), height h px, terracotta courses. */
function dome(g, cx, cy, z, r, h, ramp = 'clay') {
  const { s } = g;
  if (z + 1 > g.clip) return;
  const [ox, oy] = P(s, cx, cy, z);
  const rx = r * 16 * Math.SQRT2, ry = rx / 2;
  const x0 = Math.floor(ox - rx - 1), x1 = Math.ceil(ox + rx + 1);
  const y0 = Math.floor(oy - h - 1), y1 = Math.ceil(oy + ry + 1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
    const nx = (x + 0.5 - ox) / rx;
    const yc = y + 0.5 - oy;
    const ny = yc < 0 ? yc / h : yc / ry;
    const d = nx * nx + ny * ny;
    if (d > 1) continue;
    if (oy - (y + 0.5) > g.clip - z + (g.jag ? hash(x, 9) % (g.jag + 1) : 0)) continue;
    // Lambert on a sphere normal, light from the top-left.
    const nz = Math.sqrt(Math.max(0, 1 - d));
    const lam = Math.max(0, -0.55 * nx - 0.5 * (yc < 0 ? ny : 0.3) + 0.67 * nz);
    let shade = 1.4 + 5.2 * lam;
    // Tile courses: rings every quarter of the height, and seams down the sides.
    const ring = yc < 0 ? (-yc / h) * 5 : 0;
    if (yc < 0 && ring % 1 < 0.22) shade -= 1.2;
    if (Math.abs((Math.asin(Math.max(-1, Math.min(1, nx))) * 7) % 1) < 0.12 && yc < 0) shade -= 0.8;
    if (d > 0.82) shade = Math.min(shade, 2);
    s.data[y * s.w + x] = C(ramp, shade);
  }
  // Finial knob.
  if (z + h + 3 <= g.clip) {
    px(s, ox - 0.5, oy - h - 1, C(ramp, 5));
    px(s, ox - 0.5, oy - h - 2, C(ramp, 6));
    px(s, ox - 1.5, oy - h - 1, C(ramp, 3));
  }
}

/** Upright cylinder (barrel, jar body, stump): radius r px, from z0 to z1 at world (x, y). */
function barrel(g, x, y, z0, z1, ramp, shades = [2, 3, 5]) {
  const { s } = g;
  const [cx, cy] = P(s, x, y, z0);
  const r = 2;
  for (let yy = Math.round(cy - (z1 - z0)); yy <= Math.round(cy); yy++)
    for (let xx = Math.round(cx - r); xx < Math.round(cx + r); xx++) {
      const k = xx - Math.round(cx - r);
      px(s, xx, yy, C(ramp, k === 0 ? shades[2] : k === 2 * r - 1 ? shades[0] : shades[1]));
    }
  for (let xx = Math.round(cx - r) + 1; xx < Math.round(cx + r) - 1; xx++) px(s, xx, Math.round(cy - (z1 - z0)) - 1, C(ramp, shades[2] + 1));
  // Hoops.
  if (ramp === 'bark') for (let xx = Math.round(cx - r); xx < Math.round(cx + r); xx++) {
    px(s, xx, Math.round(cy - 1), C('ink', 2));
    px(s, xx, Math.round(cy - (z1 - z0) + 1), C('ink', 2));
  }
}

/** Clay amphora: rounded body, neck, lip. */
function jar(g, x, y, z = 0) {
  const { s } = g;
  const [cx, cy] = P(s, x, y, z);
  const X = Math.round(cx), Y = Math.round(cy);
  const map = ['.33.', '.44.', '5544', '5443', '5443', '.43.'];
  map.forEach((row, r) => [...row].forEach((ch, c) => { if (ch !== '.') px(s, X - 2 + c, Y - map.length + r, C('clay', Number(ch))); }));
}

/** Burlap sack sitting on the ground. */
function sack(g, x, y) {
  const { s } = g;
  const [cx, cy] = P(s, x, y, 0);
  const X = Math.round(cx), Y = Math.round(cy);
  const map = ['.3.', '544', '5443', '5433'];
  map.forEach((row, r) => [...row].forEach((ch, c) => { if (ch !== '.') px(s, X - 2 + c, Y - map.length + r, C('sand', Number(ch))); }));
}

/** One log lying along world y from y0 to y1 (cut end at y1 facing front-left), radius 1.5 px. */
function log(g, x, y0, y1, z, char = false) {
  const { s } = g;
  const steps = Math.max(2, Math.round((y1 - y0) * 24));
  const body = char ? C('ink', 2) : C('bark', 3);
  for (let k = 0; k <= steps; k++) {
    const [cx, cy] = P(s, x, y0 + ((y1 - y0) * k) / steps, z);
    ellipse(s, cx - 0.5, cy - 0.5, 2, 1.6, body);
    px(s, cx - 1, cy - 2.5, char ? C('ink', 3) : C('bark', 5));
    px(s, cx, cy - 2.5, char ? C('ink', 3) : C('bark', 4));
  }
  const [ex, ey] = P(s, x, y1, z);
  ellipse(s, ex - 0.5, ey - 0.5, 2, 1.6, char ? C('ink', 1) : C('sand', 5), char ? C('ink', 2) : C('bark', 2));
  if (!char) { px(s, ex - 1, ey - 1, C('sand', 7)); px(s, ex, ey, C('sand', 4)); }
}

/** Pyramid stack of logs (3, 2, 1) along world y, centered at (x, y). */
function logStack(g, x, y, len = 0.62, char = false) {
  const rows = [[-0.3, 0, 0.3], [-0.15, 0.15], [0]];
  rows.forEach((xs, r) => {
    for (const dx of xs) log(g, x + dx, y - len / 2, y + len / 2, 2 + r * 3.6, char);
  });
}

// ---- building models ---------------------------------------------------------------------------
// Each model: { fw, fh, apron, body: [x0, y0, x1, y1, top] (scaffold frame), draw(g, o) } where
// o = { owner, char } and draw paints the mass. Back-to-front order inside draw.

function playerHouse() {
  const x0 = -0.62, x1 = 0.62, y0 = -0.48, y1 = 0.48, zw = 17;
  return {
    apron: aprons.yard, body: [x0, y0, x1, y1, zw],
    draw(g) {
      // Fieldstone plinth, timber-framed walls.
      box(g, x0 - 0.05, y0 - 0.05, x1 + 0.05, y1 + 0.05, -3, 3, { front: mat.fieldstone(4), side: mat.fieldstone(2), top: C('stone', 5) });
      box(g, x0, y0, x1, y1, 3, zw, { front: mat.timberFrame(5), side: mat.timberFrame(3) });
      // Gable end under the roof on the +x side.
      face(g, [x1, y1, zw], [0, y0 - y1, 0], [0, (y0 + y1) / 2 - y1, 12], mat.timberFrame(3), true);
      // Door (front), windows (front and gable side).
      face(g, [-0.3, y1 + 0.001, 3], [0.26, 0, 0], [0, 0, 10], (u, v, f) => (u < 1 || u > f.lu - 1 || v > f.lv - 1 ? C('bark', 1) : C('bark', u % 2 < 1 ? 2 : 3)));
      face(g, [0.16, y1 + 0.001, 9], [0.24, 0, 0], [0, 0, 4], (u, v, f) => (u < 1 || u > f.lu - 1 || v < 1 || v > f.lv - 1 ? C('bark', 2) : C('ink', 1)));
      face(g, [x1 + 0.001, 0.14, 9], [0, -0.28, 0], [0, 0, 4], (u, v, f) => (u < 1 || u > f.lu - 1 || v < 1 || v > f.lv - 1 ? C('bark', 1) : C('ink', 1)));
      // Roof: back slope, chimney through it, front slope.
      const rx0 = x0 - 0.12, rx1 = x1 + 0.12, ry0 = y0 - 0.16, ry1 = y1 + 0.16, ze = 15, zr = 30;
      const L = rx1 - rx0, ym = 0;
      face(g, [rx0, ry0, ze], [L, 0, 0], [0, ym - ry0, zr - ze], mat.thatch(4));
      face(g, [rx1, ry0, ze], [0, ym - ry0, zr - ze], [0, 0, -2], C('thatch', 2));
      box(g, -0.48, -0.34, -0.27, -0.12, 16, 36, { front: mat.fieldstone(4, 'stone', false), side: mat.fieldstone(2, 'stone', false), top: C('ink', 1) });
      face(g, [rx1, ym, zr], [0, ry1 - ym, ze - zr], [0, 0, -2], C('thatch', 2));
      face(g, [rx0, ym, zr], [L, 0, 0], [0, ry1 - ym, ze - zr], mat.thatch(5));
      face(g, [rx0, ry1, ze], [L, 0, 0], [0, 0, -2], C('thatch', 2));
      // Water butt by the door.
      barrel(g, 0.28, y1 + 0.22, 0, 6, 'bark');
    },
  };
}

function rivalHouse() {
  const x0 = -0.6, x1 = 0.6, y0 = -0.6, y1 = 0.6, zw = 15;
  return {
    apron: aprons.cobbles, body: [x0, y0, x1, y1, zw],
    draw(g) {
      box(g, x0, y0, x1, y1, 0, zw, {
        front: (u, v, f, x, y) => (v > f.lv - 2 ? C('clay', 4) : mat.blocks(5, STONE_R)(u, v, f, x, y)),
        side: (u, v, f, x, y) => (v > f.lv - 2 ? C('clay', 2) : mat.blocks(3, STONE_R)(u, v, f, x, y)),
        top: mat.slab(6, STONE_R),
      });
      // Small arched door and a slit window.
      arch(g, 'y', y1, -0.05, 0.25, 0, 9);
      arch(g, 'x', x1, 0.05, 0.12, 7, 5);
      dome(g, 0, 0, zw, 0.42, 10);
      jar(g, 0.4, y1 + 0.25);
    },
  };
}

/** Arched opening on a wall plane: axis 'y' = front wall at y = at, 'x' = side wall at x = at. */
function arch(g, axis, at, c, w, z0, h) {
  const paint = (u, v, f) => {
    const r = f.lu / 2, dx = u - r, top = f.lv - r * 0.9;
    if (v > top && dx * dx + ((v - top) / 0.9) ** 2 > r * r) return 0;
    const edge = Math.abs(dx) > r - 1 || (v > top && dx * dx + ((v - top) / 0.9) ** 2 > (r - 1) ** 2);
    return edge ? C('clay', 3) : C('ink', 1);
  };
  if (axis === 'y') face(g, [c - w / 2, at + 0.001, z0], [w, 0, 0], [0, 0, h], paint);
  else face(g, [at + 0.001, c + w / 2, z0], [0, -w, 0], [0, 0, h], paint);
}

/** Heap of ore lumps on the ground round world (x, y): grey stone streaked rust-red, back to front. */
function oreHeap(g, x, y, stone = 'rock') {
  const { s } = g;
  const lumps = [[-0.12, -0.12, 4], [0.1, -0.1, 4], [-0.18, 0.08, 2], [0.02, 0.02, 7], [0.16, 0.1, 2], [-0.05, 0.18, 1], [0.12, 0.22, 0]];
  lumps.forEach(([dx, dy, z], k) => {
    const [cx, cy] = P(s, x + dx, y + dy, z);
    const ore = k % 2 === 0;
    ellipse(s, cx - 0.5, cy - 1.5, 2.2, 1.7, ore ? C('clay', 3) : C(stone, 3));
    px(s, cx - 1, cy - 3, ore ? C('clay', 6) : C(stone, 5));
    px(s, cx, cy - 3, ore ? C('clay', 5) : C(stone, 4));
    px(s, cx + 1, cy - 1, ore ? C('clay', 2) : C(stone, 2));
  });
}

// The store (step 3 of docs/gameplay-spec.md) holds grain, wood and ore, and shows all three so the
// hand can tell them apart (src/systems/hand.js storeKindAt draws by the third of the sprite under
// the pointer): the ore heap on the left (low x, high y), the barn with its grain sacks in the
// middle, the log stack on the right (high x, low y).
function playerStore() {
  const x0 = -0.78, x1 = 0.22, y0 = -0.82, y1 = 0.2, zw = 12;
  return {
    apron: aprons.yard, body: [x0, y0, x1, y1, zw],
    draw(g, o) {
      const { s } = g;
      box(g, x0 - 0.05, y0 - 0.05, x1 + 0.05, y1 + 0.05, -3, 3, { front: mat.fieldstone(4), side: mat.fieldstone(2), top: C('stone', 5) });
      box(g, x0, y0, x1, y1, 3, zw, { front: mat.planks(4), side: mat.planks(2) });
      // Plank gable on the front (+y) end.
      face(g, [x0, y1, zw], [x1 - x0, 0, 0], [(x1 - x0) / 2, 0, 10], mat.planks(4), true);
      // Wide double door standing open, sacks inside.
      face(g, [x0 + 0.22, y1 + 0.001, 3], [0.56, 0, 0], [0, 0, 9], (u, v, f) => {
        if (u < 1 || u > f.lu - 1 || v > f.lv - 1) return C('bark', 1);
        if (v < 4 && u > 3 && u < 7) return C('sand', v > 2.5 ? 4 : 3);
        return C('ink', 1);
      });
      const rx0 = x0 - 0.18, rx1 = x1 + 0.18, ry0 = y0 - 0.1, ry1 = y1 + 0.12;
      gableY(g, rx0, rx1, ry0, ry1, 9, 24, mat.shingles(3), mat.shingles(5), C('bark', 1));
      // Wood on the right: the log stack between its posts.
      for (const [x, y] of [[0.36, -0.86], [0.86, -0.86]]) line(s, ...P(s, x, y, 0), ...P(s, x, y, 11), C('bark', 2));
      logStack(g, 0.62, -0.5, 0.62, o.char);
      for (const [x, y] of [[0.36, -0.12], [0.86, -0.12]]) {
        const [a, b] = P(s, x, y, 0), [c, d] = P(s, x, y, 11);
        line(s, a, b, c, d, C('bark', 3));
        px(s, c, d, C('bark', 5));
      }
      // Ore on the left: a heap in a plank bin, a pick leaning on it.
      box(g, -0.92, 0.3, -0.84, 0.9, 0, 4, { front: C('bark', 3), side: C('bark', 2), top: C('bark', 5) });
      oreHeap(g, -0.55, 0.6);
      const [hx, hy] = P(s, -0.22, 0.86, 0);
      line(s, hx, hy, hx - 2, hy - 7, C('bark', 4));
      line(s, hx - 4, hy - 7, hx, hy - 8, C('ink', 5));
      // Grain in the middle, by the door.
      sack(g, 0.0, 0.5);
      sack(g, 0.2, 0.58);
      barrel(g, 0.4, 0.3, 0, 6, 'bark');
    },
  };
}

function rivalStore() {
  const x0 = -0.8, x1 = 0.25, y0 = -0.8, y1 = 0.15, zw = 11;
  return {
    apron: aprons.cobbles, body: [x0, y0, x1, y1, zw],
    draw(g, o) {
      box(g, x0, y0, x1, y1, 0, zw, { front: mat.blocks(5, STONE_R), side: mat.blocks(3, STONE_R) });
      // Barrel vault along x: half cylinder of clay tiles, back segments first.
      const N = 10, rv = (y1 - y0) / 2 + 0.04, hv = 8, yc = (y0 + y1) / 2;
      const segs = [];
      for (let k = 0; k < N; k++) {
        const a0 = Math.PI * (k / N), a1 = Math.PI * ((k + 1) / N);
        segs.push({ a0, a1, ny: Math.cos((a0 + a1) / 2) });
      }
      segs.sort((p, q) => p.ny - q.ny);
      for (const sg of segs) {
        const ya = yc - Math.cos(sg.a0) * rv, za = Math.sin(sg.a0) * hv, yb = yc - Math.cos(sg.a1) * rv, zb = Math.sin(sg.a1) * hv;
        const lit = 2.5 + 3.5 * Math.max(0, 0.75 * Math.sin((sg.a0 + sg.a1) / 2) + 0.45 * sg.ny);
        face(g, [x0 - 0.04, ya, zw + za], [x1 - x0 + 0.08, 0, 0], [0, yb - ya, zb - za], mat.clayTiles(lit));
      }
      const { s } = g;
      const pts = [];
      for (let k = 0; k <= N; k++) { const a = Math.PI * (k / N); pts.push([x1, yc - Math.cos(a) * (rv - 0.04), zw + Math.sin(a) * (hv - 1)]); }
      if (zw + 2 <= g.clip) polygon(s, pts.map(([x, y, z]) => P(s, x, y, z)), C(STONE_R, 3));
      arch(g, 'y', y1, -0.3, 0.32, 0, 9);
      // Wood on the right in a low sandstone bay.
      box(g, 0.34, -0.9, 0.9, -0.8, 0, 8, { front: mat.blocks(4, STONE_R, 3, 5), side: mat.blocks(3, STONE_R, 3, 5), top: C(STONE_R, 6) });
      logStack(g, 0.62, -0.5, 0.6, o.char);
      // Ore on the left in a sandstone bin.
      box(g, -0.92, 0.28, -0.82, 0.9, 0, 5, { front: mat.blocks(4, STONE_R, 3, 5), side: mat.blocks(3, STONE_R, 3, 5), top: C(STONE_R, 6) });
      oreHeap(g, -0.55, 0.6, 'ink');
      // Grain in the middle: jars and a sack by the door.
      jar(g, 0.05, 0.45);
      jar(g, 0.25, 0.55);
      sack(g, 0.45, 0.32);
    },
  };
}

// The mine (step 3): a prebuilt adit into a rocky knoll, timbered, with rails running out to an ore
// heap. `empty` (worked out) boards the entrance and leaves the heap bare. Player: grey rock and
// timber; rival: sandstone, clay and ink only, as every rival building (the alignment never repaints it).
function mine(owner) {
  return () => {
    const rival = owner === 'rival';
    const stone = rival ? STONE_R : 'rock', timber = rival ? 'clay' : 'bark';
    const rough = (b) => mat.fieldstone(b, stone, !rival);
    return {
      apron: rival ? aprons.cobbles : (s, fw, fh) => apron(s, fw, fh, (wx, wy, x, y, edge) => {
        const n = hash(x, y, 63);
        if (edge < 0.08 && n % 2) return C('grass', 3);
        if (n % 9 === 0) return C(stone, 3); // spoil chips
        return C('dirt', 3 + (n % 5 === 0 ? 1 : 0));
      }),
      body: [-0.9, -0.9, 0.7, 0.1, 22],
      draw(g, o) {
        const { s } = g;
        // The knoll: uneven masses of rough stone, highest at the back left, a shoulder on the right.
        box(g, -0.92, -0.92, 0.72, 0.1, 0, 9, { front: rough(4), side: rough(2), top: C(stone, 5) });
        box(g, -0.9, -0.9, -0.05, -0.15, 9, 20, { front: rough(4), side: rough(2), top: C(stone, 5) });
        box(g, 0.05, -0.9, 0.62, -0.35, 9, 15, { front: rough(4), side: rough(2), top: C(stone, 6) });
        box(g, -0.75, -0.9, -0.35, -0.5, 20, 25, { front: rough(5), side: rough(3), top: C(stone, 6) });
        if (!rival) for (const [x, y, z] of [[-0.6, -0.3, 20], [0.3, -0.5, 15], [0.5, -0.1, 9], [-0.55, -0.6, 25]]) { // grass on the ledges
          const [a, b] = P(s, x, y, z);
          px(s, a, b - 1, C('grass', 4)); px(s, a + 1, b - 1, C('grass', 3)); px(s, a - 1, b, C('grass', 3));
        }
        // The adit in the front face: a dark mouth (boarded once worked out) in a timber frame whose
        // posts and lintel stand proud of the rock.
        const ax0 = -0.5, ax1 = 0.0, ay = 0.1, ah = 12;
        face(g, [ax0, ay + 0.001, 0], [ax1 - ax0, 0, 0], [0, 0, ah], (u, v, f) => {
          if (o.empty) return Math.floor(v / 2.5) % 2 ? C(timber, 3) : C(timber, 2);
          return C('ink', v > f.lv - 3 ? 1 : 0);
        });
        for (const x of [ax0, ax1]) box(g, x - 0.05, ay, x + 0.05, ay + 0.1, 0, ah + 1, { front: C(timber, 4), side: C(timber, 2), top: C(timber, 5) });
        box(g, ax0 - 0.1, ay, ax1 + 0.1, ay + 0.12, ah, ah + 3, { front: C(timber, 4), side: C(timber, 2), top: C(timber, 6) });
        // Rails out of the adit to the front edge, on sleepers.
        for (let k = 0; k < 5; k++) { const yy = 0.28 + k * 0.15; line(s, ...P(s, -0.38, yy, 0), ...P(s, -0.1, yy, 0), C(timber, 2)); }
        for (const dx of [-0.34, -0.14]) line(s, ...P(s, dx, 0.22, 0), ...P(s, dx, 0.96, 0), C('ink', 4));
        if (!o.empty) {
          // A loaded cart on the rails and the ore heap beside them.
          box(g, -0.4, 0.5, -0.08, 0.76, 1, 6, { front: C(timber, 3), side: C(timber, 2), top: C('clay', 4) });
          oreHeap(g, 0.38, 0.5, rival ? 'ink' : 'rock');
          oreHeap(g, 0.56, 0.7, rival ? 'ink' : 'rock');
        }
      },
    };
  };
}

// Pedestal offsets (tiles from the temple center) where the miracles system floats its orbs,
// read from the miracles tuning so the stones always sit under the orbs. Sorted back to front.
const PEDESTALS = MIRACLES.map((m) => TUNING.orbs.pedestals[m]).sort((a, b) => a[0] + a[1] - (b[0] + b[1]));

function playerTemple() {
  const T1 = 1.05, T2 = 0.72, T3 = 0.42;
  const mossTop = (b) => (u, v, f, x, y) => {
    const n = hash(x, y, 71);
    if (n % 5 === 0 || (n % 3 === 0 && (x + y) % 2)) return C('moss', b - 1);
    return mat.slab(b, 'stone', 8)(u, v, f, x, y);
  };
  const pedestal = (g, x, y) => {
    box(g, x - 0.1, y - 0.1, x + 0.1, y + 0.1, 0, 5, { front: mat.blocks(4, 'stone', 2, 4), side: mat.blocks(2, 'stone', 2, 4), top: C('stone', 5) });
    box(g, x - 0.14, y - 0.14, x + 0.14, y + 0.14, 5, 7, { front: C('stone', 5), side: C('stone', 3), top: C('stone', 6) });
  };
  return {
    apron: aprons.flags, body: [-T1, -T1, T1, T1, 26],
    draw(g) {
      // Pedestals behind the shrine first.
      for (const [x, y] of PEDESTALS) if (x + y < 0) pedestal(g, x, y);
      box(g, -T1, -T1, T1, T1, 0, 7, { front: mat.fieldstone(4), side: mat.fieldstone(2), top: mossTop(5) });
      box(g, -T2, -T2, T2, T2, 7, 14, { front: mat.blocks(5, 'stone', 3, 6), side: mat.blocks(3, 'stone', 3, 6), top: mossTop(6) });
      // Shrine house with a dark arched doorway and a stepped stone cap.
      box(g, -T3, -T3, T3, T3, 14, 26, { front: mat.blocks(5, 'stone', 4, 5), side: mat.blocks(3, 'stone', 4, 5) });
      if (g.clip >= 15) {
        const door = (u, v, f) => {
          const r = f.lu / 2, dx = u - r, top = f.lv - r;
          if (v > top && dx * dx + (v - top) ** 2 > r * r) return 0;
          return Math.abs(dx) > r - 1 ? C('stone', 2) : C('ink', 0);
        };
        face(g, [-0.13, T3 + 0.001, 14], [0.26, 0, 0], [0, 0, 9], door);
        face(g, [T3 + 0.001, 0.09, 18], [0, -0.18, 0], [0, 0, 4], (u, v, f) => (u < 1 || u > f.lu - 1 ? C('stone', 2) : C('ink', 1)));
      }
      box(g, -T3 - 0.06, -T3 - 0.06, T3 + 0.06, T3 + 0.06, 26, 28, { front: C('stone', 6), side: C('stone', 4), top: C('stone', 6) });
      box(g, -0.26, -0.26, 0.26, 0.26, 28, 31, { front: mat.blocks(5, 'stone', 3, 4), side: mat.blocks(3, 'stone', 3, 4), top: C('stone', 6) });
      box(g, -0.12, -0.12, 0.12, 0.12, 31, 35, { front: C('stone', 5), side: C('stone', 3), top: C('stone', 7) });
      // Stair up the front face, beside the front-left pedestal.
      for (let k = 4; k >= 0; k--) {
        const fy = 1.42 - k * 0.14;
        box(g, 0.14, k === 4 ? T2 : fy - 0.14, 0.52, fy, 0, 3 * (k + 1) - 1, { front: C('stone', 2), side: C('stone', 1), top: C('stone', 5) });
      }
      for (const [x, y] of PEDESTALS) if (x + y >= 0) pedestal(g, x, y);
    },
  };
}

function rivalTemple() {
  const H = 18;
  return {
    apron: aprons.cobbles, body: [-0.95, -0.95, 1.0, 1.0, H],
    draw(g) {
      // Bell tower at the back corner, then the hall, the great dome and the door.
      const tx0 = -1.42, tx1 = -0.86;
      box(g, tx0, tx0, tx1, tx1, 0, 42, {
        front: (u, v, f, x, y) => (v > 31 && v < 37 && Math.abs(u - f.lu / 2) < 1.5 ? C('ink', 1) : v > f.lv - 2 ? C('clay', 4) : mat.blocks(5, STONE_R)(u, v, f, x, y)),
        side: (u, v, f, x, y) => (v > 31 && v < 37 && Math.abs(u - f.lu / 2) < 1 ? C('ink', 1) : v > f.lv - 2 ? C('clay', 2) : mat.blocks(3, STONE_R)(u, v, f, x, y)),
        top: C(STONE_R, 6),
      });
      dome(g, (tx0 + tx1) / 2, (tx0 + tx1) / 2, 42, 0.27, 6);
      box(g, -0.95, -0.95, 1.0, 1.0, 0, H, {
        front: (u, v, f, x, y) => (v > f.lv - 2 ? C('clay', 4) : mat.blocks(5, STONE_R)(u, v, f, x, y)),
        side: (u, v, f, x, y) => (v > f.lv - 2 ? C('clay', 2) : mat.blocks(3, STONE_R)(u, v, f, x, y)),
        top: mat.slab(6, STONE_R, 8),
      });
      arch(g, 'y', 1.0, 0.02, 0.36, 0, 12);
      arch(g, 'x', 1.0, 0.45, 0.14, 7, 6);
      arch(g, 'x', 1.0, -0.4, 0.14, 7, 6);
      dome(g, 0.02, 0.02, H, 0.7, 16);
      jar(g, 0.55, 1.22);
      jar(g, -0.5, 1.22);
    },
  };
}

const MODELS = {
  house: { player: playerHouse, rival: rivalHouse },
  store: { player: playerStore, rival: rivalStore },
  mine: { player: mine('player'), rival: mine('rival') },
  temple: { player: playerTemple, rival: rivalTemple },
};

// ---- stages ------------------------------------------------------------------------------------

/** Recolors a painted mass as charred: wood and thatch to soot, stone and plaster blackened. */
function charMass(mass) {
  const soot = new Set(['bark', 'thatch', 'plaster', 'grain', 'sand'].map((n) => RAMP[n]));
  for (let i = 0; i < mass.data.length; i++) {
    const v = mass.data[i];
    if (!v) continue;
    const r = rampOfIndex(v), sh = shadeOfIndex(v);
    const x = i % mass.w, y = (i - x) / mass.w;
    if (soot.has(r)) mass.data[i] = C('ink', Math.max(1, sh - 3) + (hash(x, y, 81) % 4 === 0 ? 1 : 0));
    else mass.data[i] = 1 + r * SHADES + Math.max(1, sh - 3);
  }
}

/** Scaffold: corner poles, ledger planks at the cut height, a ladder, a lumber stack. */
function scaffold(g, body, cut) {
  const { s } = g;
  const [x0, y0, x1, y1, top] = body;
  const e = 0.1, zt = top + 5;
  const pole = (x, y, c) => line(s, ...P(s, x, y, 0), ...P(s, x, y, zt), c);
  const plank = (a, b, z) => {
    line(s, ...P(s, a[0], a[1], z), ...P(s, b[0], b[1], z), C('bark', 5));
    line(s, ...P(s, a[0], a[1], z - 1), ...P(s, b[0], b[1], z - 1), C('bark', 3));
  };
  const fl = [x0 - e, y1 + e], fr = [x1 + e, y1 + e], br = [x1 + e, y0 - e];
  pole(...fl, C('bark', 3));
  pole(...fr, C('bark', 3));
  pole(...br, C('bark', 2));
  plank(fl, fr, cut + 2);
  plank(fr, br, cut + 2);
  plank(fl, fr, zt - 1);
  // Ladder against the front face.
  const lx = x0 + (x1 - x0) * 0.7;
  const [a0, b0] = P(s, lx, y1 + e + 0.12, 0), [a1, b1] = P(s, lx - 0.05, y1 + e, cut + 3);
  line(s, a0, b0, a1, b1, C('bark', 4));
  line(s, a0 + 3, b0 + 1, a1 + 3, b1 + 1, C('bark', 3));
  for (let k = 2; k < cut + 2; k += 3) {
    const t = k / (cut + 3);
    const x = Math.round(a0 + (a1 - a0) * t), y = Math.round(b0 + (b1 - b0) * t);
    line(s, x, y, x + 3, y + 1, C('bark', 5));
  }
}

function lumber(g, x, y) {
  box(g, x - 0.18, y - 0.1, x + 0.18, y + 0.1, 0, 2, { front: C('bark', 4), side: C('bark', 2), top: C('bark', 6) });
  box(g, x - 0.14, y - 0.08, x + 0.16, y + 0.08, 2, 4, { front: C('bark', 3), side: C('bark', 2), top: C('bark', 5) });
}

/** Fallen charred beams and scattered rubble over a wreck. */
function wreckage(g, body, seed) {
  const { s } = g;
  const [x0, y0, x1, y1] = body;
  const beams = [[[x0, y1 * 0.2, 9], [x1 * 0.6, y1 + 0.15, 1]], [[x0 * 0.4, y0, 8], [x1 + 0.1, y1 * 0.4, 2]], [[x1 * 0.2, y0 * 0.7, 6], [x0 * 0.2, y1 + 0.2, 0]]];
  for (const [a, b] of beams) {
    line(s, ...P(s, ...a), ...P(s, ...b), C('ink', 1));
    const [p, q] = P(s, ...a), [r, t] = P(s, ...b);
    line(s, p, q - 1, r, t - 1, C('bark', 1));
  }
  for (let k = 0; k < 22; k++) {
    const n = hash(k, seed, 91);
    const wx = x0 - 0.1 + ((n % 100) / 100) * (x1 - x0 + 0.2), wy = y0 + (((n >>> 8) % 100) / 100) * (y1 - y0 + 0.3);
    const [x, y] = P(s, wx, wy, 0);
    px(s, x, y - 1, C(k % 3 ? 'ink' : 'stone', k % 3 ? 2 : 2));
    if (k % 2) px(s, x + 1, y - 1, C('ink', 1));
  }
  // One dull ember left in the ash.
  const [ex, ey] = P(s, (x0 + x1) / 2, y1 * 0.5, 1);
  px(s, ex, ey, C('fire', 1));
}

/** Pale ghost of a finished sprite: silhouette and inner edges, sparse fill, dashed footprint. */
function ghost(done, mass, fw, fh) {
  const s = createSprite(done.w, done.h, done.ax, done.ay);
  const at = (x, y) => (x >= 0 && y >= 0 && x < mass.w && y < mass.h ? mass.data[y * mass.w + x] : 0);
  const hi = C('ui-parchment', 7), mid = C('ui-parchment', 6), lo = C('ui-parchment', 5);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const v = at(x, y);
    if (!v) continue;
    const sil = !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1);
    const nb = [at(x + 1, y), at(x, y + 1)];
    const inner = nb.some((w) => w && (rampOfIndex(w) !== rampOfIndex(v) || Math.abs(shadeOfIndex(w) - shadeOfIndex(v)) >= 2));
    if (sil) s.data[y * s.w + x] = hi;
    else if (inner && (x + y) % 3) s.data[y * s.w + x] = mid;
    else if ((x % 4 === 0 && y % 2 === 0) || ((x + 2) % 4 === 0 && y % 2 === 1 && (x + y) % 8 === 3)) s.data[y * s.w + x] = lo;
  }
  // Dashed footprint outline and corner stakes.
  const hx = fw / 2, hy = fh / 2;
  const corners = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]];
  for (let k = 0; k < 4; k++) {
    const [a, b] = P(s, ...corners[k]), [c, d] = P(s, ...corners[(k + 1) % 4]);
    const n = Math.max(Math.abs(c - a), Math.abs(d - b));
    for (let i = 0; i <= n; i++) {
      if ((i >> 2) % 2) continue;
      const x = Math.floor(a + ((c - a) * i) / n), y = Math.floor(b + ((d - b) * i) / n);
      px(s, Math.min(s.w - 1, x), Math.min(s.h - 1, y), hi);
    }
  }
  for (const [cx, cy] of corners) {
    const [x, y] = P(s, cx * 0.92, cy * 0.92);
    px(s, x, y, mid); px(s, x, y - 1, hi); px(s, x, y - 2, hi);
  }
  return s;
}

/** Renders a model at a stage. Returns the trimmed sprite. */
function render(kind, model, opts) {
  const { fw, fh } = KINDS[kind];
  const stage = opts.stage;
  const s0 = canvas(fw, fh);
  const ground = createSprite(s0.w, s0.h, s0.ax, s0.ay);
  const mass = createSprite(s0.w, s0.h, s0.ax, s0.ay);
  const g = ctx(mass);
  model.apron(ground, fw, fh);
  if (stage === 'building') { g.clip = Math.round(model.body[4] * 0.45); g.jag = 2; }
  if (stage === 'wrecked') { g.clip = 7; g.jag = 5; }
  model.draw(g, { owner: opts.owner, char: stage === 'wrecked', empty: !!opts.empty });

  if (stage === 'blueprint') {
    const out = createSprite(s0.w, s0.h, s0.ax, s0.ay);
    stamp(out, ghost(ground, mass, fw, fh), 0, 0);
    return trim(out);
  }
  if (stage === 'wrecked') {
    charMass(mass);
    apronAsh(ground);
  }
  castShadow(ground, mass);
  const out = createSprite(s0.w, s0.h, s0.ax, s0.ay);
  stamp(out, ground, 0, 0);
  stamp(out, outline(mass, INK, { grow: false }), 0, 0);
  const top = ctx(out);
  if (stage === 'building') {
    scaffold(top, model.body, g.clip);
    lumber(top, model.body[0] + 0.15, model.body[3] + 0.32);
  }
  if (stage === 'wrecked') wreckage(top, model.body, KINDS[kind].fw * 7 + (opts.owner === 'rival' ? 1 : 0));
  return trim(out);
}

/** Scorches an apron: darker soil and ash flecks. */
function apronAsh(ground) {
  for (let i = 0; i < ground.data.length; i++) {
    const v = ground.data[i];
    if (!v) continue;
    const x = i % ground.w, y = (i - x) / ground.w;
    const n = hash(x, y, 97);
    if (n % 3 === 0) ground.data[i] = C('ink', 2 + (n % 2));
    else ground.data[i] = 1 + rampOfIndex(v) * SHADES + Math.max(0, shadeOfIndex(v) - 2);
  }
}

// ---- fields ------------------------------------------------------------------------------------

/** Crop rows for a growth step 0, 0.25, 0.5, 0.75 or 1 (bare soil to ripe grain). */
function field(opts) {
  const { fw, fh } = KINDS.field;
  const owner = opts.owner;
  const stage = opts.stage;
  const growth = Math.max(0, Math.min(1, Math.round((Number(opts.growth) || 0) * 4) / 4));
  const s = canvas(fw, fh, 20);
  const H = fw / 2 - 0.06;
  const ROWS = 11, rowW = (2 * H) / ROWS;
  const tilledTo = stage === 'building' ? 0.15 : H; // building: only the back part dug so far
  // Soil: furrows along world x (ridges lit on their upper edge).
  apron(s, fw, fh, (wx, wy, x, y, edge) => {
    const n = hash(x, y, 101);
    if (wy > tilledTo) return n % 3 ? C('grass', 3 + (n % 2)) : C('dirt', 4);
    const t = ((wy + H) / rowW) % 1;
    if (edge < 0.05) return C('dirt', 2);
    const base = t < 0.35 ? 5 : t < 0.7 ? 4 : 2;
    return C('dirt', base - (n % 9 === 0 ? 1 : 0));
  }, 0.0);
  const g = ctx(s);

  const plants = [];
  if (stage === 'done' && growth > 0) {
    for (let r = 0; r < ROWS; r++) {
      const wy = -H + (r + 0.3) * rowW;
      for (let k = 0; k < 15; k++) {
        const j = hash(r, k, 103);
        const wx = -H + 0.1 + (k + (j % 100) / 250) * ((2 * H - 0.2) / 15);
        plants.push([wx, wy, j]);
      }
    }
    plants.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  }
  // Border: back edges first, crops, then front edges.
  const post = (x, y, h) => {
    const [a, b] = P(s, x, y, 0);
    if (owner === 'rival') {
      px(s, a, b - 1, C(STONE_R, 4)); px(s, a + 1, b - 1, C(STONE_R, 3)); px(s, a, b - 2, C(STONE_R, 5));
      return;
    }
    line(s, a, b, a, b - h, C('bark', 3));
    px(s, a, b - h, C('bark', 5));
  };
  const rail = (p, q, z) => {
    if (owner === 'rival') return;
    line(s, ...P(s, p[0], p[1], z), ...P(s, q[0], q[1], z), C('bark', 4));
  };
  const B = fw / 2 - 0.04;
  const edgePosts = (a, b, n) => { for (let k = 0; k <= n; k++) post(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, 5); };
  const fence = stage === 'done' || stage === 'wrecked';
  const stoneRun = (a, b) => { if (owner !== 'rival') return; for (let k = 0; k <= 24; k++) post(a[0] + ((b[0] - a[0]) * k) / 24, a[1] + ((b[1] - a[1]) * k) / 24, 2); };
  if (fence) {
    if (owner === 'rival') { stoneRun([-B, -B], [B, -B]); stoneRun([-B, -B], [-B, B]); }
    else { rail([-B, -B], [B, -B], 3); rail([-B, -B], [-B, B], 3); edgePosts([-B, -B], [B, -B], 6); edgePosts([-B, -B], [-B, B], 6); }
  }
  for (const [wx, wy, j] of plants) cropPlant(s, ...P(s, wx, wy, 0), growth, j);
  if (fence) {
    if (owner === 'rival') { stoneRun([B, -B], [B, B]); stoneRun([-B, B], [B, B]); }
    else { rail([B, -B], [B, B], 3); rail([-B, B], [B, B], 3); edgePosts([B, -B], [B, B], 6); edgePosts([-B, B], [B, B], 6); }
  }
  if (stage === 'building') {
    // Stakes and a string line marking out the rest, a spade stuck in the soil.
    const cs = [[-B, -B], [B, -B], [B, B], [-B, B]];
    for (let k = 0; k < 4; k++) line(s, ...P(s, ...cs[k], 3), ...P(s, ...cs[(k + 1) % 4], 3), C('ui-parchment', 6));
    for (const c of cs) { const [a, b] = P(s, ...c, 0); line(s, a, b, a, b - 4, C('bark', 4)); }
    const [a, b] = P(s, 0.4, 0.2, 0);
    line(s, a, b, a + 1, b - 6, C('bark', 4));
    px(s, a, b, C('ink', 4)); px(s, a - 1, b, C('ink', 5));
  }
  if (stage === 'wrecked') {
    for (let i = 0; i < s.data.length; i++) {
      const v = s.data[i];
      if (!v) continue;
      const x = i % s.w, y = (i - x) / s.w, n = hash(x, y, 107);
      const r = rampOfIndex(v);
      if (r === RAMP.dirt || r === RAMP.grass) s.data[i] = n % 4 === 0 ? C('ink', 3) : C('ink', 1 + (n % 2));
      else s.data[i] = C('ink', 1);
    }
    // Burnt stubble.
    for (let k = 0; k < 70; k++) {
      const n = hash(k, 3, 109);
      const [x, y] = P(s, ((n % 1000) / 1000) * 2.6 - 1.3, (((n >>> 10) % 1000) / 1000) * 2.6 - 1.3, 0);
      px(s, x, y - 1, C('ink', 3)); if (k % 3 === 0) px(s, x, y - 2, C('ink', 2));
    }
    const [ex, ey] = P(s, 0.2, 0.3, 0);
    px(s, ex, ey, C('fire', 1));
  }
  if (stage === 'blueprint') {
    const plot = createSprite(s.w, s.h, s.ax, s.ay);
    apron(plot, fw, fh, () => C('dirt', 4));
    return trim(ghost(s, plot, fw, fh));
  }
  return trim(s);
}

/** One crop plant at its base pixel. */
function cropPlant(s, x, y, growth, j) {
  x = Math.floor(x); y = Math.floor(y) - 1;
  const lean = j % 3 === 0 ? 1 : 0;
  if (growth <= 0.25) {
    // Sprouts: a pale shoot with a leaf on every other plant.
    if (j % 2) return;
    px(s, x, y, C('grass', 4));
    px(s, x, y - 1, C('grass', 6));
    if (j % 4 === 0) px(s, x + 1, y - 1, C('grass', 5));
    return;
  }
  if (growth <= 0.5) {
    px(s, x, y, C('grass', 3)); px(s, x, y - 1, C('grass', 4)); px(s, x, y - 2, C('grass', 6)); px(s, x + 1, y - 1, C('grass', 5));
    if (j % 2) px(s, x - 1, y - 2, C('grass', 5));
    return;
  }
  if (growth <= 0.75) {
    for (let k = 0; k < 4; k++) px(s, x + (k === 3 ? lean : 0), y - k, C('grass', 3 + k * 0.7));
    px(s, x - 1, y - 2, C('grass', 5));
    px(s, x + lean, y - 4, C('grain', 4));
    return;
  }
  for (let k = 0; k < 5; k++) px(s, x + (k >= 4 ? lean : 0), y - k, C('grain', 2 + k * 0.6));
  px(s, x + lean, y - 5, C('grain', 6));
  px(s, x + lean + 1, y - 5, C('grain', 5));
  px(s, x + lean, y - 6, C('grain', 7));
  if (j % 2) px(s, x - 1, y - 3, C('grain', 4));
}

// ---- exports -----------------------------------------------------------------------------------

function normalize(opts = {}) {
  return {
    owner: opts.owner === 'rival' ? 'rival' : 'player',
    stage: STAGES.includes(opts.stage) ? opts.stage : 'done',
    growth: opts.growth,
    empty: opts.empty ? true : undefined,
  };
}

const building = (kind) => (opts) => {
  const o = normalize(opts);
  return render(kind, MODELS[kind][o.owner](), o);
};

/** Temple pedestal offsets in tiles from the footprint center (for scenarios and checks). */
export const TEMPLE_PEDESTALS = PEDESTALS;

export const sprites = {
  house: building('house'),
  store: building('store'),
  mine: building('mine'),
  temple: building('temple'),
  field: (opts) => field(normalize(opts)),
};

const allStages = [];
for (const owner of ['player', 'rival']) for (const stage of STAGES) allStages.push({ owner, stage });
const fieldPv = [];
for (const owner of ['player', 'rival']) {
  for (const growth of [0, 0.25, 0.5, 0.75, 1]) fieldPv.push({ owner, stage: 'done', growth });
  for (const stage of ['blueprint', 'building', 'wrecked']) fieldPv.push({ owner, stage, growth: 0 });
}
export const previews = {
  house: allStages, store: allStages, temple: allStages, field: fieldPv,
  mine: ['player', 'rival'].flatMap((owner) => [{ owner, stage: 'done' }, { owner, stage: 'done', empty: true }]),
};

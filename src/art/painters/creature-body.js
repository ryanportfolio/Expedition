// Drawing kit for painters/creature.js: a body canvas that remembers which body part owns each
// pixel, two-bone IK, and the slate-giant materials (irregular chipped boulder slabs, roots wrapped
// diagonally across joints, moss tufts, ember seams). Not a painter module: it exports no `sprites`, so
// the registry, art-preview and check-art skip it.
//
// Coordinates are sprite-local pixels: x right (the creature's forward for the `se` / `ne`
// facings), y down, origin on the ground at the creature's anchor. Pixel (X, Y) of the canvas
// covers local [X - OX, X - OX + 1) x [Y - OY, Y - OY + 1); a shape covers a pixel when the
// pixel's center is inside it. Light comes from the top-left.

import { idx } from '../palette.js';

export const W = 112, H = 112, OX = 56, OY = 104;

const clamp7 = (s) => Math.max(0, Math.min(7, Math.round(s)));
export const HIDE = (s) => idx('creature-hide', clamp7(s));
export const ACC = (s) => idx('creature-accent', clamp7(s));
export const BARK = (s) => idx('bark', clamp7(s));
export const MOSS = (s) => idx('moss', clamp7(s));
export const INK = (s) => idx('ink', clamp7(s));
const HIDE0 = HIDE(0), HIDE7 = HIDE(7);
export const isHide = (v) => v >= HIDE0 && v <= HIDE7;

// ---- 2D vectors
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const mul = (a, k) => [a[0] * k, a[1] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const len = (a) => Math.hypot(a[0], a[1]);
export const unit = (a) => mul(a, 1 / (len(a) || 1e-6));
export const perp = (a) => [-a[1], a[0]];
export const LIGHT = unit([-0.6, -0.8]); // direction towards the light
/** Unit normal of the bone a->b that points at the lit (top-left) side. */
export const litSide = (a, b) => { const n = perp(unit(sub(b, a))); return dot(n, LIGHT) < 0 ? mul(n, -1) : n; };

/** Small integer hash in [0, 1): deterministic variation (chips, crack slants) with no Math.random. */
export function hash(...k) {
  let h = 2166136261;
  for (const v of k) { h ^= (v | 0) + 0x9e3779b9; h = Math.imul(h ^ (h >>> 15), 2246822519); h ^= h >>> 13; }
  h = Math.imul(h ^ (h >>> 16), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Two-bone IK: joint and end for a chain from `a` towards target `t`, bending towards `pole`. */
export function ik(a, t, L1, L2, pole) {
  let to = sub(t, a), d = len(to);
  const reach = L1 + L2 - 0.01, least = Math.abs(L1 - L2) + 0.01;
  if (d > reach) { to = mul(to, reach / d); d = reach; }
  if (d < least) { to = mul(unit(to), least); d = least; }
  const u = unit(to), along = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - along * along));
  let n = perp(u);
  if (dot(n, pole) < 0) n = mul(n, -1);
  return { joint: add(a, add(mul(u, along), mul(n, h))), end: add(a, to) };
}

// ---- body canvas
/**
 * Canvas with a per-pixel owner (body part id). `masks` (debug only) keeps each part's full
 * shape before later parts cover it, so a check can measure a limb's own width.
 */
export function newCanvas(debug = false) {
  const box = new Int16Array(MAX_ID * 4);
  for (let k = 0; k < MAX_ID; k++) box.set([W, H, -1, -1], k * 4);
  return { data: new Uint8Array(W * H), own: new Uint8Array(W * H), box, masks: debug ? new Map() : null, slabLog: debug ? [] : null };
}
/**
 * `cv.box`: per part id, the bounding box (x0, y0, x1, y1 at id * 4) of every pixel that id ever
 * owned. It is a superset of the id's current pixels, so scans for one part (rimOver, chipEdges)
 * stay inside it and still see every pixel the part owns.
 */
const MAX_ID = 32;
export function grow(cv, i, id) {
  const X = i % W, Y = (i - X) / W, b = cv.box, k = id * 4;
  if (X < b[k]) b[k] = X;
  if (Y < b[k + 1]) b[k + 1] = Y;
  if (X > b[k + 2]) b[k + 2] = X;
  if (Y > b[k + 3]) b[k + 3] = Y;
}
/** Pixel index at local coordinates, or -1 outside the canvas. */
export function pidx(x, y) {
  const X = Math.floor(x + OX), Y = Math.floor(y + OY);
  return X < 0 || Y < 0 || X >= W || Y >= H ? -1 : Y * W + X;
}
/** Paints a part pixel (owner id) at local coordinates. */
export function put(cv, x, y, c, id) {
  const i = pidx(x, y);
  if (i < 0) return;
  cv.data[i] = c;
  cv.own[i] = id;
  grow(cv, i, id);
  if (cv.masks) {
    let m = cv.masks.get(id);
    if (!m) cv.masks.set(id, (m = new Uint8Array(W * H)));
    m[i] = 1;
  }
}
/** Owner id at local coordinates (0 = empty). */
export const ownerAt = (cv, x, y) => { const i = pidx(x, y); return i < 0 ? 0 : cv.own[i]; };
/** Recolors a pixel only if one of `ids` owns it (decorations stay on their limb). */
export function deco(cv, x, y, c, ids) {
  const i = pidx(x, y);
  if (i >= 0 && cv.data[i] && ids.includes(cv.own[i])) cv.data[i] = c;
}
/** Paints into empty space only (moss poking out of a crevice, root ends). */
export function free(cv, x, y, c, id) {
  const i = pidx(x, y);
  if (i >= 0 && !cv.data[i]) put(cv, x, y, c, id);
}

/**
 * Slab cut positions along a bone of length L (caps included): `count` chipped boulders of
 * irregular length, no two neighbours the same whole-pixel length. Returns the cut list
 * [-capA, c1, ..., L + capB].
 */
export function slabCuts(L, capA, capB, seed, count) {
  const total = L + capA + capB;
  const k = count ?? (total > 15 ? 3 : total > 8 ? 2 : 1);
  const wts = Array.from({ length: k }, (_, i) => 0.65 + 0.7 * hash(seed, i, 1));
  const sum = wts.reduce((s, v) => s + v, 0);
  const lens = wts.map((v) => Math.max(2, Math.round((v / sum) * total)));
  for (let i = 1; i < k; i++) if (lens[i] === lens[i - 1]) { lens[i] += 1; if (i + 1 < k) lens[i + 1] -= 1; else lens[i - 1] -= 1; }
  const cuts = [-capA];
  for (let i = 0; i < k - 1; i++) cuts.push(cuts[cuts.length - 1] + lens[i]);
  cuts.push(L + capB);
  return cuts;
}

/**
 * One limb segment as a stack of irregular chipped boulders along the bone a -> b (full widths
 * wa at a, wb at b). Each boulder has its own length (slabCuts), width, sideways shift and tone;
 * the outline pinches into a notch where two boulders meet and steps where their widths differ,
 * with extra chip bites along the edges. Opts:
 *   seed     varies everything per segment (deterministic; left and right limbs use different seeds).
 *   count    number of boulders (default by length).
 *   tone     shade offset (far limbs -1).
 *   crackW   widens the cracks between boulders (evil lean).
 *   capA, capB extend the stone past its ends; chip = chance per px of a bite out of an edge.
 *   gapA     the first row at `a` is a dark slanted gap: the joint where this segment meets the last.
 *   hairline diagonal cracks across the longer boulders.
 *   uneven   limbs: seams on a clear slant, boulders offset sideways so neighbours never line up,
 *            one-sided seam pinch (see below); off for the waist and feet.
 * Shading across the bone: lit edge 5-6, face 4, darker inner face 3-2, dark rim 1 on the side
 * away from the light.
 */
/** Seam tuning for `uneven` limbs (see slabs): one-sided pinch depth factor, boulder offset [min, extra] px. */
export const UNEVEN = Object.freeze({ pinch: 0.6, shift: [0.3, 0.1] });
export function slabs(cv, id, a, b, wa, wb, o = {}) {
  const { seed = 1, count, tone = 0, crackW = 0, capA = 0, capB = 0, chip = 0, notch = 0, hairline = true, gapA = false, uneven = false } = o;
  const d = sub(b, a), L = len(d) || 1e-6, u = mul(d, 1 / L), n = litSide(a, b);
  const cuts = slabCuts(L, capA, capB, seed, count);
  // Chipped edges: down each side, every 2.2-3.5 px, either a 1-2 px bite out of the stone or a
  // knob standing 1 px proud, placed by the seed, so the two edges (and the two sides of the body)
  // never match. The cuts between boulders already pinch the outline, so no bite lands within
  // 1.5 px of one.
  const inner0 = cuts.slice(1, -1);
  // The two edges take turns (never a bite or knob on both at once, so the width stays within
  // 1 px of its taper).
  const bites = [[], []];
  for (let p = -capA + 0.3 + hash(seed, 99) * 1.2, k = 0; p < L + capB; k++) {
    const side = (k + (seed & 1)) % 2;
    const q = [p, p + (hash(seed, k, 98) < 0.45 ? 2 : 1.4), hash(seed, k, 97) < 0.55 ? -1 : 1];
    if (q[2] > 0 || !inner0.some((c) => c > q[0] - 1.5 && c < q[1] + 1.5)) bites[side].push(q);
    p = q[1] + 0.1 + 0.5 * hash(seed, k, 96);
  }
  const inner = cuts.slice(1, -1);
  const slants = inner.map((_, k) => (uneven ? (hash(seed, k, 7) < 0.5 ? -1 : 1) * (0.22 + 0.22 * hash(seed, k, 8)) : (hash(seed, k, 7) - 0.5) * 0.8));
  // With `uneven` (limbs), so stacked boulders never read as a column of plates:
  //  - every seam crosses on a clear slant (never level);
  //  - each boulder sits UNEVEN.shift px to one side of the last, the side its seam slants to, so
  //    neighbours never line up edge to edge: in the rows the slanted seam crosses, each edge
  //    belongs to the boulder whose edge is the inner one there, so the outline narrows by the
  //    offset on one side (a notch) and steps out below it on the other, never bulging;
  //  - the seam's pinch bites into one edge only (its side by seed), so no seam is a symmetric neck.
  // Without it (waist, feet), each boulder keeps a small random shift and the outline pinches
  // evenly at every cut.
  const shift = [0], pinchSide = inner.map((_, k) => (hash(seed, k, 24) < 0.5 ? -1 : 1));
  for (let k = 0; k < inner.length; k++) shift.push(shift[k] + (uneven ? Math.sign(slants[k]) * (UNEVEN.shift[0] + UNEVEN.shift[1] * hash(seed, k, 23)) : 0));
  { const mean = shift.reduce((q, v) => q + v, 0) / shift.length; for (let k = 0; k < shift.length; k++) shift[k] -= mean; }
  // Uneven seams: each cut between two boulders jogs 1-1.5 px along the bone at a seeded point
  // across the limb, so the crack is a broken step rather than one straight line (stacked stones,
  // not plates).
  const jogAt = inner.map((_, k) => (hash(seed, k, 31) - 0.5) * 0.8 * Math.min(wa, wb) / 2);
  const jogD = inner.map((_, k) => (hash(seed, k, 32) < 0.5 ? -1 : 1) * (0.9 + 0.5 * hash(seed, k, 33)));
  const seamAt = (k, ac) => inner[k] + ac * slants[k] + (ac > jogAt[k] ? jogD[k] : 0);
  // The joint gap runs on a clear slant (the two stones meet at an angle), its direction by seed.
  const gapSlant = (hash(seed, 9, 7) < 0.5 ? -1 : 1) * (0.45 + 0.35 * hash(seed, 9, 8));
  const r = Math.max(wa, wb) / 2 + Math.max(capA, capB) + 2;
  const X0 = Math.floor(Math.min(a[0], b[0]) - r), X1 = Math.ceil(Math.max(a[0], b[0]) + r);
  const Y0 = Math.floor(Math.min(a[1], b[1]) - r), Y1 = Math.ceil(Math.max(a[1], b[1]) + r);
  // Per-boulder variation, hashed once per boulder rather than per pixel.
  const per = (k) => Array.from({ length: inner.length + 1 }, (_, sl) => hash(seed, sl, k));
  const hShift = per(21), hWide = per(22), hTone = per(5), hMid = per(12), hDir = per(13), hReach = per(14);
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
    const rx = x + 0.5 - a[0], ry = y + 0.5 - a[1];
    const along = rx * u[0] + ry * u[1], ac0 = rx * n[0] + ry * n[1];
    if (along < -capA || along > L + capB) continue;
    // Which boulder: the cuts slant across the limb.
    let slab = 0;
    for (let k = 0; k < inner.length; k++) if (along >= seamAt(k, ac0)) slab = k + 1;
    const c0 = cuts[slab], c1 = cuts[slab + 1];
    const across = ac0 - (uneven ? shift[slab] : (hShift[slab] - 0.5) * 0.8);
    const t = Math.max(0, Math.min(1, along / L));
    let hw = ((wa + (wb - wa) * t) / 2) * (0.95 + 0.08 * hWide[slab]);
    // Pinch where two boulders meet: a notch in the outline at every cut (both edges, or with
    // `uneven` the seam's own side only).
    let dc = 9, dk = -1;
    for (let k = 0; k < inner.length; k++) { const v = Math.abs(along - inner[k]); if (v < dc) { dc = v; dk = k; } }
    if (dc < 1.2 && (!uneven || Math.sign(across) === pinchSide[dk])) hw -= (uneven ? UNEVEN.pinch : 0.6) * (1.2 - dc);
    let bite = null;
    if (notch) for (const q of bites[across > 0 ? 1 : 0]) if (along >= q[0] && along < q[1]) { bite = q; break; }
    if (bite) hw += bite[2] * notch;
    if (Math.abs(across) >= hw) continue;
    const edge = Math.abs(across) > hw - 1;
    const sideKey = across > 0 ? 1 : 0;
    // hash() is never negative, so with chip 0 no edge pixel is dropped and the hash is skipped.
    if (chip > 0 && edge && hash(seed, Math.floor(along * 1.3), sideKey, 4) < chip) continue;
    const s = across / hw; // +1 lit edge, -1 shadow edge
    let sh = s > 0.5 ? 5 : s > -0.15 ? 4 : s > -0.6 ? 3 : 2;
    if (edge && s < 0) sh = 1;
    let crack = false;
    for (let k = 0; k < inner.length; k++) {
      const kk = along - seamAt(k, ac0);
      if (kk >= -0.5 && kk < 0.5 + crackW) { crack = true; break; }
      // the riser of the step joins the two halves of the seam
      if (Math.abs(ac0 - jogAt[k]) < 0.5) { const s0 = inner[k] + ac0 * slants[k]; if (along >= Math.min(s0, s0 + jogD[k]) - 0.5 && along < Math.max(s0, s0 + jogD[k]) + 0.5) { crack = true; break; } }
      if (kk >= 0.5 + crackW && kk < 1.5 + crackW && s > -0.3) sh = Math.max(sh, 6);
    }
    // The joint gap: a dark slanted line where this segment starts.
    const ga = along + capA - ac0 * gapSlant;
    const gap = gapA && ga < 1 && ga >= -0.5;
    if (!crack && !gap && along < -capA + 1.2 && s > -0.3) sh = Math.max(sh, 6);
    if (hairline && !crack && c1 - c0 > 4) {
      const mid = (c0 + c1) / 2 + (hMid[slab] - 0.5) * 2;
      const dir = hDir[slab] < 0.5 ? 0.8 : -0.8;
      const reach = hReach[slab] < 0.5 ? 1 : -1; // the crack runs in from one edge
      if (Math.abs(along - (mid + across * dir)) < 0.5 && across * reach > -hw * 0.3) sh = 1;
    }
    const slabTone = hTone[slab] < 0.4 ? -1 : 0;
    if (gap) put(cv, x, y, HIDE(0), id);
    else if (crack) put(cv, x, y, HIDE(crackW > 0 ? 0 : 1), id);
    else put(cv, x, y, HIDE(sh === 1 ? 1 : sh + tone + (sh < 6 ? slabTone : 0)), id);
  }
  return cuts;
}

/**
 * Roots wrapped diagonally round a limb near point J (bone direction dir, limb width w): `passes`
 * strands that each cross the limb on a slant (over `span` px along the bone, at least 1.6 limb
 * widths), `thick` px thick
 * (1-3), the next pass starting where the last ended, so they read as a root spiralling round the
 * stone rather than a band. Paints only over pixels owned by `ids`. `side` (+1/-1) picks which
 * edge a strand starts from; `tail` px of root trail on along the edge afterwards. lean -1 chars
 * the end (ink tip, one ember fleck); lean +1 tips it with moss.
 */
export function rootWrap(cv, ids, J, dir, w, { lean = 0, from = -2, span = 6, passes = 1, thick = 2, side = 1, tail = 0, seed = 1 } = {}) {
  const u = unit(dir), n = perp(u), hw = w / 2 + 0.5;
  const P = (al, ac) => add(J, add(mul(u, al), mul(n, ac)));
  // A steep diagonal: each pass runs at least 1.6 limb widths down the bone while crossing it, so
  // one row of the limb never holds more than about half its width in root.
  span = Math.max(span, 1.6 * w);
  const sd = unit([span, 2 * hw * side]), sp = [-sd[1], sd[0]];
  let last = null, i = 0;
  for (let p = 0; p < passes; p++) {
    const al0 = from + p * span * 1.05;
    const steps = Math.ceil(span * 2.5);
    for (let k = 0; k <= steps; k++) {
      const f = k / steps;
      const wig = (hash(seed, p, k >> 2) - 0.5) * 0.8;
      const al = al0 + f * span + wig, ac = side * (-hw + 2 * hw * f);
      const th = thick - (hash(seed, p, k >> 1, 3) < 0.3 ? 1 : 0);
      for (let j = 0; j < Math.max(1, th); j++) {
        const q = P(al + j * 0.9 * sp[0], ac + j * 0.9 * sp[1]);
        const lit = ac * (dot(n, LIGHT) < 0 ? -1 : 1) > hw * 0.3;
        deco(cv, q[0], q[1], BARK(j === 0 ? (lit ? 4 : 3) : (i++ % 3 === 1 ? 2 : 1)), ids);
      }
      last = [al, ac];
    }
  }
  if (!last) return;
  let [al, ac] = last;
  for (let k = 1; k <= tail; k++) {
    const q = P(al + k, ac - side * ((k + seed) % 3 === 2 ? 1 : 0) * 0.8);
    deco(cv, q[0], q[1], BARK(k % 2 ? 2 : 3), ids);
  }
  al += tail;
  // The root end lies on the stone, a little in from the edge it reached.
  ac -= side * 1.2;
  const tip = P(al + 1, ac);
  if (lean < 0) {
    for (const [da, dc] of [[0, 0], [1, 0], [0.5, -side * 0.9], [-0.5, -side * 0.9]]) {
      const t2 = P(al + da, ac + dc);
      deco(cv, t2[0], t2[1], INK(0), ids);
    }
    const e = P(al - 1, ac - side * 1.2);
    deco(cv, e[0], e[1], ACC(3), ids);
  } else if (lean > 0) {
    deco(cv, tip[0], tip[1], MOSS(4), ids);
  }
}

/**
 * Moss tuft in a crevice at (x, y): a run of `size` moss pixels over pixels owned by `ids`, with
 * lit sprigs poking up into the empty space above. lean -1 withers it to one or two dull pixels;
 * lean +1 fills it out (size + 1, an extra sprig).
 */
export function tuft(cv, ids, x, y, size, lean = 0, id = 0) {
  x = Math.round(x); y = Math.round(y);
  if (lean < 0) {
    deco(cv, x, y, MOSS(1), ids);
    if (size > 2) deco(cv, x + 1, y, MOSS(2), ids);
    return;
  }
  const n = lean > 0 ? size + 1 : size;
  // A clump: a lit top row, a darker row under it, sprigs on top (over stone or into the air).
  for (let i = 0; i < n; i++) deco(cv, x + i, y, MOSS(i % 2 ? 4 : 5), ids);
  for (let i = 0; i < n - 1; i++) deco(cv, x + i + (i % 2), y + 1, MOSS(3), ids);
  for (let i = 0; i < n; i += 2) {
    const own = ownerAt(cv, x + i, y);
    if (!own || !ids.includes(own)) continue;
    if (ownerAt(cv, x + i, y - 1)) deco(cv, x + i, y - 1, MOSS(6), ids);
    else free(cv, x + i, y - 1, MOSS(6), id || own);
  }
  if (lean > 0 && n > 2) {
    const own = ownerAt(cv, x + 1, y);
    if (own && ids.includes(own)) free(cv, x + 1, y - 2, MOSS(5), id || own);
  }
}

/** Pale bloom pixel (good lean): on the body or just above it. */
export function bloom(cv, x, y, id) {
  const i = pidx(x, y);
  if (i < 0) return;
  cv.data[i] = idx('plaster', 7);
  if (!cv.own[i]) { cv.own[i] = id; grow(cv, i, id); }
}

/** 1 px polyline at local coordinates (Bresenham per segment), painted with `paint(x, y, i)`. */
export function polyline(pts, paint) {
  let i = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    let [x0, y0] = pts[k].map(Math.floor), [x1, y1] = pts[k + 1].map(Math.floor);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (!(k > 0 && x0 === Math.floor(pts[k][0]) && y0 === Math.floor(pts[k][1]))) paint(x0 + 0.5, y0 + 0.5, i++);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
}

/** Ember seam along a polyline, on pixels owned by `ids`: core shade at the start, fading. */
export function seam(cv, ids, pts, core, fade = 0.25) {
  polyline(pts, (x, y, i) => deco(cv, x, y, ACC(core - Math.floor(i * fade)), ids));
}

/**
 * Point-in-polygon (even-odd) for local plate coordinates. The polygon's edges are bucketed once
 * per 1-unit band of y (cached per polygon array), so a test visits only the few edges that span
 * its row; the crossing test is the plain even-odd one, so the result is unchanged.
 */
const POLYS = new WeakMap();
function prepPoly(pts) {
  let y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { y0 = Math.min(y0, Math.floor(p[1])); y1 = Math.max(y1, Math.floor(p[1])); }
  const lists = Array.from({ length: y1 - y0 + 1 }, () => []);
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi === yj) continue; // a flat edge never crosses a row
    for (let k = Math.floor(Math.min(yi, yj)); k <= Math.floor(Math.max(yi, yj)); k++) lists[k - y0].push(xi, yi, xj, yj);
  }
  const prep = { y0, rows: lists.map((l) => Float64Array.from(l)) };
  POLYS.set(pts, prep);
  return prep;
}
export function inPoly(pts, x, y) {
  const p = POLYS.get(pts) ?? prepPoly(pts);
  const e = p.rows[Math.floor(y) - p.y0];
  if (!e) return false;
  let inside = false;
  for (let k = 0; k < e.length; k += 4) {
    const xi = e[k], yi = e[k + 1], xj = e[k + 2], yj = e[k + 3];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Plate in a local frame (origin o, unit axes r right and dn down): every pixel whose center
 * maps inside `box` = [x0, y0, x1, y1] and passes `inside(lx, ly)` gets `shade(lx, ly)` (0 skips).
 */
export function plate(cv, id, o, r, dn, box, inside, shade) {
  const [lx0, ly0, lx1, ly1] = box;
  const cs = [[lx0, ly0], [lx1, ly0], [lx0, ly1], [lx1, ly1]].map(([lx, ly]) => add(o, add(mul(r, lx), mul(dn, ly))));
  const X0 = Math.floor(Math.min(...cs.map((c) => c[0]))) - 1, X1 = Math.ceil(Math.max(...cs.map((c) => c[0]))) + 1;
  const Y0 = Math.floor(Math.min(...cs.map((c) => c[1]))) - 1, Y1 = Math.ceil(Math.max(...cs.map((c) => c[1]))) + 1;
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
    const px = x + 0.5 - o[0], py = y + 0.5 - o[1];
    const lx = px * r[0] + py * r[1], ly = px * dn[0] + py * dn[1];
    if (!inside(lx, ly)) continue;
    const c = shade(lx, ly);
    if (c) put(cv, x, y, c, id);
  }
}

/**
 * Separation rim: where a pixel of the group just drawn (`ids`, e.g. the three segments of an arm)
 * borders a pixel of another part, darken it so overlapping limbs stay readable.
 */
export function rimOver(cv, ids) {
  const { data, own, box } = cv;
  const hits = [];
  let bx0 = W, by0 = H, bx1 = -1, by1 = -1;
  for (const id of ids) { const k = id * 4; bx0 = Math.min(bx0, box[k]); by0 = Math.min(by0, box[k + 1]); bx1 = Math.max(bx1, box[k + 2]); by1 = Math.max(by1, box[k + 3]); }
  for (let Y = by0; Y <= by1; Y++) for (let X = bx0; X <= bx1; X++) {
    const i = Y * W + X;
    if (!ids.includes(own[i]) || !isHide(data[i])) continue;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const XX = X + dx, YY = Y + dy;
      if (XX < 0 || YY < 0 || XX >= W || YY >= H) continue;
      const j = YY * W + XX;
      if (own[j] && !ids.includes(own[j])) { hits.push(i); break; }
    }
  }
  for (const i of hits) if (data[i] - HIDE0 > 1) data[i] = HIDE(1);
}

/** Copy of the canvas pixels and owners, for chipEdges to restore what a bite uncovers. */
export const snapshot = (cv) => ({ data: cv.data.slice(), own: cv.own.slice() });

/**
 * Chips the screen-space outline of the part just drawn (`id`, drawn over `before`): down its
 * left and right edges, every 3-4 rows (each side on its own seeded rhythm), one edge pixel is
 * either bitten out (the pixel goes back to what lay under it) or a knob of stone stands one pixel
 * proud (never making a row wider than `maxW`: a number, or [top, bottom] tapering down the part). Each chip is chosen so it breaks the edge's run: a bite where the edge already sits at
 * least as far in as the rows either side, a knob where it sits at least as far out. A straight
 * or evenly slanted edge therefore never runs more than 4 rows without a chip. `rim` / `lit` are
 * the colors for knobs on the shadow / light side.
 */
export function chipEdges(cv, id, before, seed, { rim = HIDE(1), lit = HIDE(5), litLeft = true, skip = 1, maxW = 99, keepNotch = false } = {}) {
  const rows = new Map(), bk = id * 4;
  for (let Y = cv.box[bk + 1]; Y <= cv.box[bk + 3]; Y++) for (let X = cv.box[bk]; X <= cv.box[bk + 2]; X++) {
    if (cv.own[Y * W + X] !== id) continue;
    const r = rows.get(Y);
    if (r) { r[0] = Math.min(r[0], X); r[1] = Math.max(r[1], X); } else rows.set(Y, [X, X]);
  }
  const ys = [...rows.keys()].sort((a, b) => a - b);
  if (ys.length < 5) return;
  const mask = cv.masks?.get(id);
  const bite = (X, Y) => {
    const i = Y * W + X;
    cv.data[i] = before.data[i]; cv.own[i] = before.own[i];
    if (mask) mask[i] = 0;
  };
  const knob = (X, Y, c) => {
    const i = Y * W + X;
    if (X < 0 || X >= W) return;
    cv.data[i] = c; cv.own[i] = id; grow(cv, i, id);
    if (mask) mask[i] = 1;
  };
  for (const side of [0, 1]) {
    const dir = side ? 1 : -1; // outward
    let k = ys[0] + skip + 1 + Math.floor(hash(seed, side, 1) * 3);
    let n = 0;
    while (k <= ys[ys.length - 1] - skip - 1) {
      const a = rows.get(k - 1), b = rows.get(k), c = rows.get(k + 1);
      if (a && b && c) {
        const e = (r) => r[side] * dir; // larger = further out
        const ea = e(a), eb = e(b), ec = e(c);
        const wide = b[1] - b[0] + 1;
        const mw = Array.isArray(maxW) ? maxW[0] + (maxW[1] - maxW[0]) * (k - ys[0]) / (ys[ys.length - 1] - ys[0]) : maxW;
        // keepNotch: never bite a row that is already narrower than a neighbour (a seam notch on
        // an uneven limb), so a bite never deepens a notch into a neck.
        const deep = keepNotch && wide < Math.min(a[1] - a[0], c[1] - c[0]) + 1;
        const canKnob = eb >= Math.max(ea, ec) && wide + 1 <= mw, canBite = eb <= Math.min(ea, ec) && wide > 3 && !deep;
        const doKnob = canKnob && (!canBite || hash(seed, side, n, 3) < 0.5);
        if (doKnob) {
          knob(b[side] + dir, k, (side === 0) === litLeft ? lit : rim);
          b[side] += dir;
        } else if (canBite) {
          bite(b[side], k);
          b[side] -= dir;
        } else { k += 1; continue; } // mid-stair: try the next row
      }
      k += 3 + (hash(seed, side, n++, 2) < 0.5 ? 0 : 1);
    }
  }
}

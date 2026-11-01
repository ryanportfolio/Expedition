// Creature painter: the slate giant (spec "Creature design (v3)", user direction v4). An original
// gaunt humanoid giant of heavy stone: tall and stooped with the hood forward of the hips, long
// arms whose fingertips hang below mid-thigh, and real stone mass. The torso is the heaviest part:
// a stone collar of three slabs (a boulder over each shoulder joint and a yoke between them that
// the hood sits low in) stacked on a broad chest of chipped boulder slabs, narrowing to a stone
// waist. Every limb is a stack of
// irregular chipped boulders (each its own length, width, shift and tone; chip notches along the
// outline; hairline cracks; a darker inner face), tapering from the shoulder or hip to a narrow
// wrist or ankle, and the left and right limbs are cut differently. Joints are two stones meeting
// at an angle with a dark gap; roots wrap diagonally across joints and slabs (never a band), moss
// sits in the crevices. Heavy blunt stone hands with two or three thick finger lumps (no claws).
// The hood hollow is pure shadow (no eyes, no mouth). Ember light (`creature-accent`: soft amber
// when good, hot red when evil, through the LUT only) shows only in the chest and joint seams.
//
//   creature { pose, frame, facing: 'se'|'sw'|'ne'|'nw', lean: -1|0|1 }
//   dung     {}  (item: the creature's droppings, fertilises fields)
//
// Anchors and the `contact` field: every creature sprite carries `contact: 'feet' | 'seat'` next
// to { w, h, ax, ay, data }. 'feet' (standing, walking, crouching poses): the anchor sits on the
// sole row, midway between the two feet. 'seat' (`sleep`, sitting slumped on the ground): the
// anchor sits where the pelvis touches the ground, and the feet stick out forward of it. The
// creature system can read `sprite.contact` (or CREATURE_CONTACT[pose]) to place a seated body by
// its seat rather than its feet. In both cases the anchor row is the lowest body row.
//
// Every pose frame is a set of rig targets (pelvis offset, stoop, head nod, hand and ankle
// positions); two-bone IK places elbows and knees with fixed bone lengths, so the body keeps its
// proportions in every pose. `se` is drawn front three-quarter, `ne` back three-quarter; `sw` and
// `nw` are their mirrors. `lean` changes shape details only: +1 fuller moss and a few pale blooms;
// -1 withered moss, wider cracks, charred root ends.

import { idx } from '../palette.js';
import { createSprite, mirror } from '../sprite.js';
import {
  W, H, OX, OY, HIDE, ACC, BARK, MOSS, INK, add, sub, mul, len, unit, perp, dot, litSide, hash, ik,
  newCanvas, put, deco, plate, inPoly, slabs, rootWrap, tuft, bloom, seam, polyline, rimOver, snapshot, chipEdges,
} from './creature-body.js';

export const CREATURE_FRAMES = Object.freeze({
  idle: 4, walk: 8, eat: 5, throw: 5, smash: 5, haul: 6, water: 4, play: 6, sleep: 3, poop: 3, weak: 6, happy: 4, hurt: 3,
});
/** Ground contact per pose (see the header): where the anchor sits. */
export const CREATURE_CONTACT = Object.freeze(Object.fromEntries(Object.keys(CREATURE_FRAMES).map((p) => [p, p === 'sleep' ? 'seat' : 'feet'])));
const FACINGS = ['se', 'sw', 'ne', 'nw'];

// ---- body measurements (px): about 77 px tall standing, legs nearly half of it.
const PELVIS_Y = -39, SPINE = 20, UPPER = 16, FORE = 15, THIGH = 17, SHIN = 18, ANKLE_Y = -4;
// Limb widths in px (full width at the start and end of each bone). Side B (the creature's left)
// is cut a little differently from side A so the two sides never mirror each other.
// Side B's forearm starts wider (8.32): at 7.4 its seam pinch and chip bites left the stretch
// next to the elbow at a median 5 px on final pixels; now it reads 6-7 px there, like side A.
// Its wrist end (4.68) and side A's ankle end (4.6) are trimmed so, with the offset limb boulders
// (slabs `uneven`), no screen row at the wrist / ankle reads over 5 px.
const LIMB_W = {
  A: { upper: [7.4, 6.8], fore: [7, 4.8], thigh: [8.4, 7.6], shin: [7.4, 4.6] },
  B: { upper: [7.2, 7], fore: [8.32, 4.68], thigh: [8.2, 7.8], shin: [7.2, 4.6] },
};
// Heavy blunt hands: finger lumps [width, length] from the hand's dark edge to its lit edge.
const FINGERS = { A: [[2, 2], [2, 3], [3, 3]], B: [[3, 3], [3, 2]] };
const PALM = 4;
// Part ids (pixel owners). A = the creature's right side (screen-left in se), B = its left.
export const PART = Object.freeze({
  upperA: 1, foreA: 2, handA: 3, upperB: 4, foreB: 5, handB: 6,
  thighA: 7, shinA: 8, footA: 9, thighB: 10, shinB: 11, footB: 12,
  pelvis: 13, spine: 14, chest: 15, hood: 16, prop: 17, collar: 18,
});
const P_ = PART;
const ARM = { A: [P_.upperA, P_.foreA, P_.handA], B: [P_.upperB, P_.foreB, P_.handB] };
const LEG = { A: [P_.thighA, P_.shinA, P_.footA], B: [P_.thighB, P_.shinB, P_.footB] };

// ---- poses: (f, n) -> rig targets in `se` terms (+x = forward, y up negative)
const BASE = {
  root: [0, 0], lean: 0.3, nod: 0.5, hA: 'rest', hB: 'rest', fA: [-5, ANKLE_Y], fB: [6, ANKLE_Y],
  poleA: [-1, 0.2], poleB: [-1, 0.2], kpA: [0.6, 0], kpB: [0.6, 0], glow: 5, prop: null, farOver: false, bloom: false,
};
const TAU = Math.PI * 2;

/**
 * Walking legs and arm swing shared by walk, haul and weak: a slow, heavy stride. The body sinks
 * `sink` px on the contact frames (both feet down, legs spread: frame 0 and n/2) and rises at
 * the passing frames; the swing foot lifts low and plants early.
 */
function stride(f, n, { reach = 6, lift = 3, sink = 2, armSwing = 4 } = {}) {
  const ph = (f / n) * TAU, c = Math.cos(ph);
  const leg = (phase, base) => [base + reach * Math.cos(phase), ANKLE_Y - Math.max(0, -Math.sin(phase) - 0.25) * lift * 1.33];
  return {
    root: [0, sink * c * c - 0.4],
    fA: leg(ph, -2), fB: leg(ph + Math.PI, 3),
    hA: [-12 - armSwing * c, -27], hB: [15 + armSwing * c, -27],
  };
}

const POSES = {
  idle(f) {
    const dy = [0, -1, -1, 0][f]; // slow breathing sway
    return { root: [0, dy * 0.6], lean: 0.3 - 0.03 * dy, nod: f === 2 ? 1.1 : 0.5 };
  },
  walk(f, n) {
    return { ...stride(f, n), lean: 0.3, nod: 1 };
  },
  eat(f) {
    const K = [
      { root: [1, 5], lean: 0.4, nod: 1, hB: [17, -10], prop: 'food' },
      { root: [1, 2], lean: 0.22, nod: 0, hB: [17, -34], prop: 'food' },
      { lean: 0.12, nod: 0, hB: [13, -52], prop: 'food', farOver: true },
      { lean: 0.16, nod: 1.5, hB: [9, -60], farOver: true, glow: 6 },
      { lean: 0.12, nod: 0.5, hB: [15, -42], farOver: true },
    ];
    return K[f];
  },
  throw(f) {
    const K = [
      { root: [-1, 1], lean: -0.05, hA: [-16, -46], hB: [17, -30], poleA: [0, 1] },
      { root: [-2, 0], lean: -0.2, hA: [-13, -70], hB: [19, -34], poleA: [-1, -0.2] },
      { root: [0, 0], lean: 0.02, hA: [0, -82], hB: [17, -30], poleA: [-1, 0] },
      { root: [2, 1], lean: 0.28, hA: [18, -62], hB: [7, -32], poleA: [0, -1], prop: 'flying' },
      { root: [3, 2], lean: 0.38, hA: [20, -36], hB: [2, -26], poleA: [-0.3, -1] },
    ];
    return { fA: [-8, ANKLE_Y], fB: [8, ANKLE_Y], prop: f < 3 ? 'rock' : null, ...K[f] };
  },
  smash(f) {
    const K = [
      { root: [0, 0], lean: -0.12, hA: [-3, -80], hB: [3, -80], pole: [-1, 0] },
      { root: [-1, -1], lean: -0.25, hA: [-6, -84], hB: [0, -84], pole: [-1, 0.2] },
      { root: [1, 3], lean: 0.25, hA: [13, -60], hB: [17, -60], pole: [-1, -0.4] },
      { root: [2, 10], lean: 0.62, hA: [19, -6], hB: [23, -6], pole: [-0.2, -1], prop: 'impact' },
      { root: [2, 8], lean: 0.52, hA: [18, -10], hB: [22, -10], pole: [-0.2, -1] },
    ];
    const k = K[f];
    return { fA: [-8, ANKLE_Y], fB: [8, ANKLE_Y], poleA: k.pole, poleB: k.pole, ...k };
  },
  haul(f, n) {
    const s = stride(f, n, { reach: 5, lift: 2.5, sink: 2, armSwing: 3 });
    return { ...s, lean: 0.26, nod: 1, hB: [6, -64], poleB: [0.2, 1], prop: 'logs' };
  },
  water(f) {
    const tilt = [0, 1, 2, 1][f];
    return {
      lean: 0.22, nod: 1, hA: [6 + tilt, -40 + tilt], hB: [12 + tilt, -40 + tilt], poleA: [-1, 0.6], poleB: [-1, 0.6],
      prop: 'water', farOver: true, drip: f,
    };
  },
  play(f) {
    const hand = [[17, -32], [17, -45], [16, -38], [16, -36], [16, -38], [17, -42]][f];
    const pebble = [null, [18, -53], [18, -63], [18, -69], [18, -61], [17, -51]][f];
    return { lean: 0.08, nod: f >= 2 && f <= 3 ? -1.5 : -0.5, hB: hand, pebble, prop: 'pebble' };
  },
  sleep(f) {
    const dy = [0, -1, 0][f];
    return {
      // Breathing moves the back; the seat stays on the ground.
      root: [-4, 33], lean: 0.5 - dy * 0.05, nod: 3, fA: [16, ANKLE_Y], fB: [21, ANKLE_Y], kpA: [0.2, -1], kpB: [0.2, -1],
      hA: [5, -12 + dy], hB: [14, -13 + dy], poleA: [-1, 0], poleB: [-1, 0], glow: 2, seat: true,
    };
  },
  poop(f) {
    const dy = [0, 1, 0][f];
    return {
      root: [-1, 13 + dy], lean: 0.34, nod: 1 + dy, fA: [-7, ANKLE_Y], fB: [7, ANKLE_Y], kpA: [1, -0.2], kpB: [1, -0.2],
      hA: [3, -22 + dy], hB: [13, -21 + dy], poleA: [-1, 0], poleB: [-1, 0],
    };
  },
  weak(f, n) {
    const s = stride(f, n, { reach: 3.5, lift: 1, sink: 1, armSwing: 2 });
    return { ...s, root: [s.root[0], s.root[1] + 3], lean: 0.45, nod: 3, hA: [s.hA[0] + 4, -16], hB: [s.hB[0] + 2, -16], glow: 3 };
  },
  happy(f) {
    const dy = [0, -2, -1, 0][f];
    return {
      root: [0, dy], lean: -0.04, nod: -1, hA: [-22, -62 + dy * 2], hB: [23, -66 + dy * 2], poleA: [0, 1], poleB: [0, 1],
      glow: 7, bloom: true,
    };
  },
  hurt(f) {
    const K = [
      { root: [-3, 1], lean: -0.32, nod: -1, hA: [4, -66], hB: [19, -50], poleA: [0, 1], glow: 7 },
      { root: [-2, 1], lean: -0.22, nod: 1, hA: [1, -60], hB: [17, -40], poleA: [0, 1], glow: 6 },
      { root: [-1, 0], lean: 0, nod: 1, glow: 5 },
    ];
    return { fA: [-8, ANKLE_Y], fB: [6, ANKLE_Y], ...K[f] };
  },
};

// ---- rig
const rot = (a) => [Math.cos(a), Math.sin(a)];
const downOf = (r) => [-r[1], r[0]];
function solve(q) {
  const P = [q.root[0], PELVIS_Y + q.root[1]];
  const up = [Math.sin(q.lean), -Math.cos(q.lean)];
  // Three-quarter view: the stoop moves the chest forward, the shoulder line tilts only a little.
  const r = rot(q.lean * 0.25), dn = downOf(r);
  const C = add(P, mul(up, SPINE));
  const at2 = (o, a, b, lx, ly) => add(o, add(mul(a, lx), mul(b, ly)));
  // Shoulders sit under the collar's shoulder boulders: the arms hang from its edges.
  // The hood sits low between them, its lower half flanked by the shoulder boulders.
  const SA = at2(C, r, dn, -10, 1.5), SB = at2(C, r, dn, 9.5, 2);
  const Hd = at2(C, r, dn, 5.5 + q.nod * 0.8, 0.8 * q.nod - 7.5);
  const rp = rot(q.lean * 0.2), dp = downOf(rp);
  const HA = at2(P, rp, dp, -4.2, 1.5), HB = at2(P, rp, dp, 4.4, 1.5);
  // 'rest': the arm hangs nearly straight beside the body, wherever the stoop puts the shoulder.
  const hA = q.hA === 'rest' ? add(SA, [-5, 31]) : q.hA, hB = q.hB === 'rest' ? add(SB, [4, 30]) : q.hB;
  const armA = ik(SA, hA, UPPER, FORE, q.poleA), armB = ik(SB, hB, UPPER, FORE, q.poleB);
  const legA = ik(HA, q.fA, THIGH, SHIN, q.kpA), legB = ik(HB, q.fB, THIGH, SHIN, q.kpB);
  return { P, C, up, r, dn, rp, dp, SA, SB, Hd, HA, HB, armA, armB, legA, legB };
}

// ---- parts
/**
 * Heavy blunt stone hand from the wrist w0 along u: a palm boulder PALM px long, then the finger
 * lumps side by side with a dark crease between them (closed over the knuckles, open between the lumps). Hands
 * within about 43 degrees of an axis snap to the nearest of up, down, left or right so the lumps stay crisp at native size.
 */
function drawHand(cv, id, S, w0, u0, tone) {
  let u = u0;
  { const a = Math.atan2(u0[1], u0[0]), q = Math.round(a / (Math.PI / 2)) * (Math.PI / 2); if (Math.abs(a - q) < 0.75) u = [Math.round(Math.cos(q)), Math.round(Math.sin(q))]; }
  const n = litSide([0, 0], u);
  const lumps = FINGERS[S];
  const Wd = lumps.reduce((s, [w]) => s + w, 0) + lumps.length - 1;
  // Pixel centers fall on whole lump columns: an odd-width hand sits half a pixel across.
  const o = add([Math.round(w0[0]), Math.round(w0[1])], mul(n, Wd % 2 ? 0.5 : 0));
  // Lump spans across the hand (s from the dark edge -Wd/2 to the lit edge +Wd/2).
  const spans = [];
  let s0 = -Wd / 2;
  for (const [w, L] of lumps) { spans.push([s0, s0 + w, L]); s0 += w + 1; }
  const long = PALM + Math.max(...lumps.map(([, L]) => L));
  if (cv.slabLog) (cv.hands ??= {})[S] = { o, u, n, width: Wd, palm: PALM };
  const R = long + Wd;
  for (let y = Math.floor(o[1] - R); y <= o[1] + R; y++) for (let x = Math.floor(o[0] - R); x <= o[0] + R; x++) {
    const rel = [x + 0.5 - o[0], y + 0.5 - o[1]], t = dot(rel, u), s = dot(rel, n);
    if (t < 0 || t >= long || Math.abs(s) >= Wd / 2) continue;
    const lump = spans.findIndex(([a, b]) => s > a && s < b);
    const sh = (s + Wd / 2) / Wd; // 0 dark edge .. 1 lit edge
    let c;
    if (t < PALM) {
      // Palm: rounded back corners, a lit top, a crease starting into the knuckles.
      if (t < 1 && (s < -Wd / 2 + 1 || s > Wd / 2 - 1)) continue;
      if (lump < 0 && t >= PALM - 1.5) c = HIDE(0);
      else if (t < 1) c = HIDE(sh > 0.4 ? 6 : 4);
      else c = HIDE(sh < 0.18 ? 1 : sh < 0.45 ? 3 : sh < 0.8 ? 4 : 5);
      if (t >= 1.5 && t < 2.5 && Math.abs(s - (hash(id, S === 'A' ? 1 : 2) - 0.5) * 2) < 0.5) c = HIDE(2);
    } else {
      const tt = t - PALM;
      if (lump < 0) { if (tt < 1) put(cv, x, y, HIDE(0), id); continue; } // the crease closes over the knuckles
      const [a, b, L] = spans[lump];
      if (tt >= L) continue;
      // A blunt lump: the last row loses its outer corner on wider lumps only.
      if (tt >= L - 1 && b - a > 2 && s > b - 1) continue;
      const ls = (s - a) / (b - a);
      c = tt < 1 && ls > 0.3 ? HIDE(6) : HIDE(sh < 0.18 || ls < 0.3 ? 2 : tt >= L - 1 ? 3 : 4);
    }
    put(cv, x, y, c + (tone && c > HIDE(1) ? tone : 0), id);
  }
}

/** Draws one stone part with `paint`, then chips its outline (see chipEdges). Returns paint's result. */
function stone(cv, id, seed, tone, maxW, paint) {
  const before = snapshot(cv);
  const out = paint();
  chipEdges(cv, id, before, seed * 7 + 3, { rim: HIDE(1), lit: HIDE(5 + tone), maxW, keepNotch: true });
  return out;
}

function drawArm(cv, S, R, q, o) {
  const [UP, FO, HA] = ARM[S];
  const sh = S === 'A' ? R.SA : R.SB, arm = S === 'A' ? R.armA : R.armB;
  const seed = S === 'A' ? 11 : 23, tone = o.tone, cw = o.lean < 0 ? 1 : 0, Wd = LIMB_W[S];
  const cutsU = stone(cv, UP, seed, tone, 8, () => slabs(cv, UP, sh, arm.joint, Wd.upper[0], Wd.upper[1], { count: S === 'A' ? 3 : 2, seed, tone, crackW: cw, capA: 2, capB: 0.5, uneven: true }));
  const cutsF = stone(cv, FO, seed + 1, tone, [7, 5], () => slabs(cv, FO, arm.joint, arm.end, Wd.fore[0], Wd.fore[1], { count: 2, seed: seed + 1, tone, crackW: cw, capA: S === 'A' ? 0.8 : 1.6, gapA: true, uneven: true }));
  const u = unit(sub(arm.end, arm.joint));
  drawHand(cv, HA, S, add(arm.end, mul(u, 0.5)), u, tone);
  rimOver(cv, ARM[S]);
  if (cv.slabLog) cv.slabLog.push({ part: UP, cuts: cutsU }, { part: FO, cuts: cutsF });
  return { sh, arm, u };
}

/** Ember in a joint seam: a pixel or two in the dark gap where the lower segment starts, at the
 * offsets `at` across the limb (each joint glows in its own place, never as a band). */
function jointEmber(cv, ids, J, dir, glow, at) {
  const u = unit(dir), n = perp(u);
  at.forEach((k, i) => {
    const p = add(J, add(mul(u, -0.3), mul(n, k)));
    deco(cv, p[0], p[1], ACC(glow - 1 - i), ids);
  });
}

function decorateArm(cv, S, R, q, o, g) {
  const [UP, FO, HA] = ARM[S];
  const { sh, arm, u } = g, lean = o.lean, seed = S === 'A' ? 3 : 5, Wd = LIMB_W[S];
  const udir = sub(arm.joint, sh), fdir = sub(arm.end, arm.joint);
  // Roots: A has a root climbing over the shoulder and one spiralling down past the elbow and
  // wrist; B has one long wrap from the upper arm across the elbow. Never the same on both sides.
  if (S === 'A') {
    rootWrap(cv, [UP, P_.collar], sh, udir, Wd.upper[0], { lean, from: 0.5, span: 6, thick: 2, side: 1, tail: 2, seed });
    rootWrap(cv, [UP, FO], arm.joint, fdir, Wd.fore[0], { lean, from: -4, span: 7, passes: 2, thick: 2, side: -1, tail: 1, seed: seed + 1 });
  } else {
    rootWrap(cv, [UP, FO], arm.joint, udir, Wd.upper[1], { lean, from: -7, span: 5, passes: 2, thick: 2, side: -1, tail: 0, seed: seed + 2 });
    rootWrap(cv, [FO], arm.end, fdir, Wd.fore[1], { lean, from: -9, span: 4, thick: 1, side: 1, tail: 0, seed: seed + 3 });
  }
  jointEmber(cv, [FO], arm.joint, fdir, q.glow - (o.near ? 0 : 1), S === 'A' ? [-0.8, 0.4] : [1.2]);
  // Moss in the shoulder crevice (where the arm meets the collar) and in a forearm crack.
  const top = add(sh, [-1.5, -1.5]);
  if (lean >= 0 || o.near) tuft(cv, [UP, P_.collar], top[0], top[1] + 1, o.near ? 3 : 2, lean);
  if (lean > 0 && o.near) tuft(cv, [FO], arm.joint[0] - 1, arm.joint[1] + 5, 2, lean);
}

function drawLeg(cv, S, R, q, o) {
  const [TH, SH, FT] = LEG[S];
  const hip = S === 'A' ? R.HA : R.HB, leg = S === 'A' ? R.legA : R.legB;
  const seed = S === 'A' ? 31 : 41, tone = o.tone, cw = o.lean < 0 ? 1 : 0, Wd = LIMB_W[S];
  const cutsT = stone(cv, TH, seed, tone, 9, () => slabs(cv, TH, hip, leg.joint, Wd.thigh[0], Wd.thigh[1], { count: S === 'A' ? 2 : 3, seed, tone, crackW: cw, capA: 1.5, capB: 0.5, uneven: true }));
  const cutsS = stone(cv, SH, seed + 1, tone, [7, 5], () => slabs(cv, SH, leg.joint, leg.end, Wd.shin[0], Wd.shin[1], { count: S === 'A' ? 3 : 2, seed: seed + 1, tone, crackW: cw, capA: 1, gapA: true, uneven: true }));
  // Foot: one heavy flat boulder towards the facing, 4 rows, a chipped toe.
  const a = leg.end, fl = S === 'A' ? 7 : 6.5;
  slabs(cv, FT, [a[0] - 2, a[1] + 2], [a[0] + fl - 2, a[1] + 2], 4.4, 3.6, { count: 2, seed: seed + 2, tone, notch: 0, hairline: false, gapA: false });
  rimOver(cv, LEG[S]);
  if (cv.slabLog) cv.slabLog.push({ part: TH, cuts: cutsT }, { part: SH, cuts: cutsS });
  return { hip, leg };
}

function decorateLeg(cv, S, R, q, o, g) {
  const [TH, SH, FT] = LEG[S];
  const { hip, leg } = g, lean = o.lean, seed = S === 'A' ? 7 : 9, Wd = LIMB_W[S];
  const tdir = sub(leg.joint, hip), sdir = sub(leg.end, leg.joint);
  if (S === 'A') {
    rootWrap(cv, [TH, SH], leg.joint, sdir, Wd.shin[0], { lean, from: -5, span: 6, thick: 2, side: 1, tail: 2, seed });
    rootWrap(cv, [SH], leg.end, sdir, Wd.shin[1], { lean, from: -14, span: 4, thick: 1, side: -1, seed: seed + 1 });
  } else {
    rootWrap(cv, [TH, P_.pelvis], hip, tdir, Wd.thigh[0], { lean, from: 0, span: 7, thick: 2, side: -1, tail: 2, seed: seed + 2 });
    rootWrap(cv, [TH, SH], leg.joint, sdir, Wd.shin[0], { lean, from: -3, span: 5, thick: 2, side: 1, tail: 1, seed: seed + 3 });
  }
  jointEmber(cv, [SH], leg.joint, sdir, q.glow - (o.near ? 0 : 1), S === 'A' ? [1.4] : [-1, 0.2]);
  if (lean > 0 && o.near) tuft(cv, [SH], leg.end[0] - 1, leg.end[1] - 4, 2, lean);
  if (lean >= 0) tuft(cv, [TH], leg.joint[0] - 2, leg.joint[1] - 1, 2, lean);
}

// Pelvis in its frame (origin P): two hip boulders split by a dark cleft, chipped corners. The far
// hip boulder hangs low over the far thigh, so the hips stay 14-18 px wide straight across the
// stooped torso axis as well as along the screen rows.
const PELVIS = [[-7.5, -2.5], [-3, -3.5], [3, -3.5], [8.5, -3], [9.5, -0.5], [8.5, 2], [9, 4.5], [7.8, 6], [3, 5.8], [-1, 4.9], [-2, 4.5], [-6, 4], [-8, 1.5], [-7, 0]];
function drawPelvis(cv, R) {
  plate(cv, P_.pelvis, add(R.P, mul(R.rp, 2)), R.rp, R.dp, [-9, -4, 11, 6], (x, y) => inPoly(PELVIS, x, y), (x, y) => {
    if (!inPoly(PELVIS, x + 1, y) || !inPoly(PELVIS, x, y + 1)) return HIDE(1);
    if (Math.abs(x - 0.5 - y * 0.2) < 0.5 && y > -1.5) return HIDE(0); // cleft between the two hip boulders
    if (y < -1.5 && x < 2) return HIDE(6);
    if (Math.abs(y - 1.5 + x * 0.3) < 0.5 && x > 3) return HIDE(1); // a crack across the far hip
    return HIDE(x < -3.5 ? 5 : x < 0.5 ? 4 : x < 4 ? 3 : 2);
  });
}

function drawSpine(cv, R, o) {
  // Waist: two stacked boulders between the chest and the pelvis, narrower than both.
  // It sits 1.5 px forward of the spine line and runs down into the pelvis, so the narrowest
  // visible waist row stays 10-14 px wide beside the hanging near arm.
  const fw = mul(R.r, 1.5), a = add(add(R.C, mul(R.up, -10)), fw), b = add(add(R.P, mul(R.up, 0.5)), fw);
  return stone(cv, P_.spine, 71, 0, 14, () => slabs(cv, P_.spine, a, b, 13.2, 12.6, { count: 2, seed: 71, crackW: o.lean < 0 ? 1 : 0, hairline: false, capA: 1, capB: 1 }));
}

// Chest in its frame (origin C, r right, dn down): the broad mass of the body, wide at the collar
// and shoulders, narrowing to the waist; an outline full of chipped steps. Built from four
// boulders split by irregular cracks (not ribs): two over the shoulders, a breast stone, a belly
// stone.
const CHEST = [
  [-7, -3.5], [-3.5, -4], [-2.5, -3], [1.5, -3.5], [6, -4], [8.5, -2.5], [9.5, -1], [10.5, 2], [10, 3.5], [10.5, 5.5],
  [9, 7], [8, 9.5], [6.5, 10.5], [6, 12.5], [-5, 12.5], [-5.5, 11.5], [-7.5, 11], [-8, 9.5], [-9.5, 9], [-10, 7.5], [-12, 5], [-11.5, 3.5],
  [-12, 1.5], [-10.5, -0.5], [-10, -2],
];
// Crack segments [x0, y0, x1, y1] in the chest frame.
// The first `deep` segments are the deep seam (shade 0) that holds the ember; it zigzags.
const CHEST_CRACKS = {
  front: [[-1.5, -3.5, 0.5, 1.5], [0.5, 1.5, -0.5, 5.5], [-0.5, 5.5, 1.5, 12], [-9.5, 1.5, -2, 4], [-7, 8.5, 7.5, 7], [0.5, 1.5, 9, 0]],
  back: [[0.5, -3.5, -0.5, 4], [-0.5, 4, 0.5, 12], [-9, 5.5, 9, 6.5], [-6, -2, -3, 4]],
};
const DEEP = { front: 3, back: 2 };
const segDist = (x, y, [x0, y0, x1, y1]) => {
  const dx = x1 - x0, dy = y1 - y0, t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - x0 - t * dx, y - y0 - t * dy);
};
/** Which side of a crack line a point lies on (the four boulders get their own tone). */
const sideOf = (x, y, [x0, y0, x1, y1]) => ((x1 - x0) * (y - y0) - (y1 - y0) * (x - x0)) > 0 ? 1 : 0;
function drawChest(cv, R, q, o) {
  const back = o.back, lean = o.lean;
  const cw = lean < 0 ? 0.35 : 0;
  const cracks = CHEST_CRACKS[back ? 'back' : 'front'];
  const before = snapshot(cv);
  plate(cv, P_.chest, R.C, R.r, R.dn, [-13, -5, 12, 13], (x, y) => inPoly(CHEST, x, y), (x, y) => {
    const rim = !inPoly(CHEST, x + 1, y) || !inPoly(CHEST, x, y + 1);
    if (rim) return HIDE(1);
    for (const [k, c] of cracks.entries()) if (segDist(x, y, c) < 0.55 + cw) return HIDE(k < DEEP[back ? 'back' : 'front'] ? 0 : 1);
    // The boulder below a crack catches the light on its top edge.
    for (const c of cracks.slice(DEEP[back ? 'back' : 'front'])) if (segDist(x, y - 1, c) < 0.55 && x < 4) return HIDE(6);
    if (y < -2.5 && x < 5) return HIDE(6);
    const region = cracks.reduce((m, c, k) => m * 2 + sideOf(x, y, c), 0);
    const tone = hash(region, back ? 3 : 1) < 0.4 ? -1 : 0;
    // A darker inner face down the far side, and a hairline in the breast stone.
    if (!back && Math.abs(x - 5 - (y - 6) * 0.6) < 0.45 && y > 3 && y < 9) return HIDE(1);
    return HIDE((x < -5 ? 5 : x < 3 ? 4 : x < 6.5 ? 3 : 2) + tone);
  });
  chipEdges(cv, P_.chest, before, back ? 61 : 67, { rim: HIDE(1), lit: HIDE(5), skip: 2, maxW: 24 });
}

// Collar in the chest frame: three stacked slabs over the top of the chest. A boulder over each
// shoulder joint (their lobes cap the arms' tops and carry the shoulder line out past the arms)
// and a lower yoke between them, so the hood sits down between the shoulders instead of
// perching on top. The boulders are flat-faced chipped slabs, not rounded pauldrons: a top plane
// that slopes down and out from the hood in two broken steps (so the near boulder tops out well
// below the hood and never reads as a second head beside it), a square outer face with a chip step part way down, each face one
// shade (top lit, outer face a step darker), so they read as broken stone blocks. The far one is a
// shade darker. Drawn after a hanging arm (its top slab tucks under) and before the hood and any
// raised arm.
const COLLAR = [
  [-15.5, 3], [-15.5, 0.5], [-16.5, 0], [-15.5, -0.7], [-14.5, -1.2], [-12.4, -1.6], [-12, -2.5], [-9.8, -3], [-9.4, -3.8], [-6.5, -4.1], [-4.5, -4.2], [-1, -4.5],
  [3, -4], [4.5, -4.5], [7, -4], [10, -4], [11, -5], [14, -4.5], [14.5, -3.5], [15.5, -3.5], [15.5, 0], [14.5, 0.5], [15, 2.5], [12, 3.5],
  [9.5, 2.5], [6.5, 1.5], [3, 0.5], [-1, 1], [-5.5, 1.5], [-8.5, 2.5], [-11, 4], [-14, 4],
];
// Cracks between the three slabs, and a hairline across the near boulder.
const COLLAR_CRACKS = [[-5.5, -6, -4, 1.5], [4.8, -4.2, 4.5, 1], [-12.5, -2.5, -10, 0.5]];
function drawCollar(cv, R, o) {
  const cw = o.lean < 0 ? 0.35 : 0;
  const before = snapshot(cv);
  plate(cv, P_.collar, R.C, R.r, R.dn, [-18, -8, 17, 5], (x, y) => inPoly(COLLAR, x, y), (x, y) => {
    if (!inPoly(COLLAR, x + 1, y) || !inPoly(COLLAR, x, y + 1)) return HIDE(1);
    for (const [k, c] of COLLAR_CRACKS.entries()) if (segDist(x, y, c) < (k < 2 ? 0.6 : 0.45) + cw) return HIDE(k < 2 ? 0 : 1);
    const far = sideOf(x, y, COLLAR_CRACKS[1]) === 0 && x > 4;
    const near = x < -5 && sideOf(x, y, COLLAR_CRACKS[0]) === 1;
    // Flat facets: a lit top plane along the top outline, an outer side face along the outer edge.
    if (!inPoly(COLLAR, x, y - 1.6)) return HIDE(far ? 5 : 6);
    if (near && !inPoly(COLLAR, x - 1.6, y)) return HIDE(4);
    if (far && !inPoly(COLLAR, x + 1.6, y)) return HIDE(2);
    if (segDist(x - 1, y, COLLAR_CRACKS[0]) < 0.6 || segDist(x - 1, y, COLLAR_CRACKS[1]) < 0.6) return HIDE(5); // edge past a crack
    // Front faces: the near boulder one flat lit plane, the yoke a step darker, the far boulder
    // darker again; underside in shadow.
    return HIDE((near ? 5 : 3) - (far ? 1 : 0) - (y > 0.5 && !near ? 1 : 0));
  });
  chipEdges(cv, P_.collar, before, o.back ? 71 : 73, { rim: HIDE(1), lit: HIDE(5), skip: 1, maxW: 31 });
}

function decorateTorso(cv, R, q, o) {
  const lean = o.lean, L = (lx, ly) => add(R.C, add(mul(R.r, lx), mul(R.dn, ly)));
  const ch = [P_.chest], co = [P_.collar];
  if (!o.back) {
    // Ember seams: down the sternum crack and a little way into the cracks that meet it.
    const g = q.glow;
    // Ember deep in the zigzag seam, brightest at the heart, fading; a short way into one side crack.
    seam(cv, ch, [L(0, 1.8), L(-0.8, 0), L(-1.2, -2)], g, 0.5);
    seam(cv, ch, [L(0.3, 2.2), L(-0.4, 5.5), L(0.6, 9)], g, 0.3);
    seam(cv, ch, [L(-0.2, 5.6), L(-2.6, 7.2)], g - 1, 0.8);
    if (lean < 0) { seam(cv, ch, [L(-0.5, 7.6), L(4, 7.2)], g - 2, 0.5); seam(cv, ch, [L(-2, 3.6), L(-5, 2.8)], g - 2, 0.6); }
  } else {
    seam(cv, ch, [L(0, 0), L(0, 10.5)], q.glow - 3, 0.15);
  }
  // A root climbing diagonally across the lit flank from the waist over the collar's near boulder.
  polyline([L(-4, 12), L(-7, 8), L(-5, 5), L(-8, 1), L(-7, -2), L(-9, -5)], (x, y, i) => deco(cv, x, y, BARK(lean < 0 ? (i % 3 ? 0 : 1) : i % 3 === 1 ? 3 : 1), [...ch, ...co]));
  if (lean < 0) { const t = L(-9, -5.5); deco(cv, t[0], t[1], INK(0), co); }
  // Moss in the collar crevices (where the yoke meets each shoulder boulder), the chest cracks
  // and on the hips.
  const m = L(-8, -2.6);
  tuft(cv, co, m[0], m[1], lean > 0 ? 3 : 2, lean);
  if (lean >= 0) { const m2 = L(4, -4.2); tuft(cv, co, m2[0], m2[1], 2, lean); }
  if (lean >= 0) { const m3 = L(-5, 8); tuft(cv, ch, m3[0], m3[1], lean > 0 ? 3 : 2, lean); }
  const hp = add(R.P, add(mul(R.rp, -5.5), mul(R.dp, -2)));
  tuft(cv, [P_.pelvis], hp[0], hp[1], lean > 0 ? 3 : 2, lean);
  if (lean >= 0) { const hq = add(R.P, add(mul(R.rp, 3), mul(R.dp, -2))); tuft(cv, [P_.pelvis], hq[0], hq[1], 1, lean); }
}

// Hood in its own frame (origin Hd, x towards the facing, y down): an elongated cowl about 14 px
// tall, the brow overhanging a hollow of pure shadow. No eyes, no mouth.
// The cowl falls back to a peak behind the crown and drapes over the collar at the bottom.
// The brow juts forward over the face, so the hollow opens onto the front silhouette.
const HOOD = [[-3, -8.5], [-5.5, -6.5], [-6.5, -3], [-6, 1], [-7.5, 6], [-2, 6.8], [5.5, 6], [6, 3.5], [5.2, 1.5], [5.6, -0.5], [7, -1.5], [8, -3], [7, -5], [4.5, -7.5], [1, -8.8]];
// The hollow under the brow: its top slopes up from the cheek to the jutting brow, its front
// opens onto the silhouette, its bottom is rounded.
export const HOLLOW = [[0.8, -2], [3.5, -3], [6.8, -1.8], [5.4, 0], [5.6, 2.2], [4.2, 4], [2, 4.2], [0.8, 2]];
function hoodFrame(R, q) {
  const tilt = q.lean * 0.4 + q.nod * 0.07;
  return { o: R.Hd, r: rot(tilt), dn: downOf(rot(tilt)) };
}
function drawHood(cv, R, q, o) {
  const back = o.back, { o: c, r, dn } = hoodFrame(R, q);
  plate(cv, P_.hood, c, r, dn, [-7, -9, 7, 7], (x, y) => inPoly(HOOD, x, y), (x, y) => {
    if (!back && inPoly(HOLLOW, x, y)) return y > -2 && x < 4.4 ? INK(0) : HIDE(0);
    const rim = !inPoly(HOOD, x + 1, y) || !inPoly(HOOD, x, y + 1);
    if (rim) return HIDE(1);
    if (!back && x > -0.5 && (inPoly(HOLLOW, x, y + 1.2) || inPoly(HOLLOW, x - 0.8, y + 1.8))) return HIDE(6); // brow lip catching the light
    if (back && Math.abs(x - 0.5) < 0.5 && y > -5 && y < 6) return HIDE(1); // crease down the back
    if (y < -4.5) return HIDE(x < 2 ? 6 : 4);
    if (Math.abs(y - 1.5 - x * 0.15) < 0.5 && x < -1.5) return HIDE(1); // a crack across the cowl
    return HIDE(x < -3 ? 5 : x < 3 ? 4 : 3);
  });
}

function decorateHood(cv, R, q, o) {
  const lean = o.lean, { o: c, r, dn } = hoodFrame(R, q), L = (lx, ly) => add(c, add(mul(r, lx), mul(dn, ly)));
  const ids = [P_.hood];
  // A root strand across the cowl's side and the crown.
  polyline([L(-5, 5), L(-4, 1), L(-4.5, -2), L(-2, -5.5)], (x, y, i) => deco(cv, x, y, BARK(lean < 0 ? (i % 2 ? 0 : 1) : i % 3 === 1 ? 3 : 1), ids));
  const crown = L(-1.5, -6.2);
  tuft(cv, ids, crown[0], crown[1], lean > 0 ? 3 : 2, lean);
  if (lean >= 0) { const s = L(-5, 2); tuft(cv, ids, s[0], s[1], 1, lean); }
  if (lean < 0) {
    // Evil lean: the crown splits; a charred crack, no light.
    polyline([L(2, -6.5), L(2.5, -5), L(1.5, -3.5)], (x, y) => deco(cv, x, y, HIDE(0), ids));
  }
  return { crown, L };
}

// ---- props
function drawProp(cv, R, q) {
  const id = P_.prop;
  const hand = (S) => { const arm = S === 'A' ? R.armA : R.armB; return add(arm.end, mul(unit(sub(arm.end, arm.joint)), 4)); };
  const ball = (c, rad, ramp) => {
    for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
      if (x * x + y * y > rad * rad + 0.5) continue;
      const edge = (x + 1) * (x + 1) + y * y > rad * rad + 0.5 || x * x + (y + 1) * (y + 1) > rad * rad + 0.5;
      put(cv, c[0] + x, c[1] + y, idx(ramp, edge ? 1 : x + y < -1 ? 6 : x + y > 1 ? 3 : 4), id);
    }
  };
  if (q.prop === 'rock') ball(add(hand('A'), [0, -2]), 3, 'rock');
  else if (q.prop === 'flying') ball([30, -74], 3, 'rock');
  else if (q.prop === 'food') {
    const c = add(hand('B'), [1, -2]);
    for (const [x, y, s] of [[0, 0, 5], [1, 0, 4], [-1, 0, 6], [0, -1, 6], [1, -1, 5], [0, 1, 3], [1, 1, 2], [-1, 1, 4], [2, 0, 3], [0, -2, 6], [-1, -1, 5]]) put(cv, c[0] + x, c[1] + y, idx('grain', s), id);
    put(cv, c[0] + 2, c[1] + 2, BARK(2), id);
  } else if (q.prop === 'pebble' && q.pebble) {
    const c = q.pebble;
    put(cv, c[0], c[1], idx('rock', 6), id); put(cv, c[0] + 1, c[1], idx('rock', 4), id);
    put(cv, c[0], c[1] + 1, idx('rock', 4), id); put(cv, c[0] + 1, c[1] + 1, idx('rock', 2), id);
  } else if (q.prop === 'water') {
    const c = add(hand('B'), [1, 0]);
    put(cv, c[0], c[1] - 1, idx('water', 6), id); put(cv, c[0] - 1, c[1] - 1, idx('water', 5), id); put(cv, c[0] + 1, c[1] - 1, idx('water', 4), id);
    const phase = q.drip ?? 0;
    for (let k = 0; k < 3; k++) {
      const y = c[1] + 2 + phase * 2 + k * 6;
      if (y < -3) { put(cv, c[0] + 1, y, idx('water', 6), id); put(cv, c[0] + 1, y + 1, idx('water', 4), id); }
    }
    for (const [dx, s] of [[-1, 4], [1, 5], [3, 4]]) put(cv, c[0] + dx, -0.5, idx('water', s), id);
  } else if (q.prop === 'impact') {
    for (const [x, y, s] of [[12, -2, 3], [14, -5, 4], [28, -3, 3], [30, -6, 2], [26, -9, 4], [10, -8, 2], [21, -12, 3]]) put(cv, x, y, idx('dirt', s), id);
  } else if (q.prop === 'logs') {
    const s = R.SB;
    for (const [dx, dy] of [[0, 0], [-1, -4], [3, -3]]) {
      const a = add(s, [-16 + dx, -9 + dy]), b = add(s, [8 + dx, -1 + dy]);
      const d = sub(b, a), L = len(d), u = mul(d, 1 / L), n = perp(u);
      for (let t = 0; t <= L; t += 0.5) for (let k = -1.5; k <= 1.5; k += 0.5) {
        const p = add(a, add(mul(u, t), mul(n, k)));
        put(cv, p[0], p[1], BARK(k < -0.7 ? 1 : k > 0.7 ? 4 : (Math.floor(t) % 5 === 0 ? 2 : 3)), id);
      }
      put(cv, b[0], b[1] - 1, idx('thatch', 6), id); put(cv, b[0], b[1], idx('thatch', 5), id); put(cv, b[0] + 1, b[1] - 1, idx('thatch', 4), id);
    }
  }
}

// ---- assemble one frame
function build(opts, debug) {
  let { pose = 'idle', frame = 0, facing = 'se', lean = 0 } = opts ?? {};
  if (!POSES[pose]) pose = 'idle';
  const n = CREATURE_FRAMES[pose];
  const f = ((Math.floor(Number(frame) || 0) % n) + n) % n;
  const ln = lean < 0 ? -1 : lean > 0 ? 1 : 0;
  if (!FACINGS.includes(facing)) facing = 'se';
  const back = facing[0] === 'n', flip = facing[1] === 'w';
  const q = { ...BASE, ...POSES[pose](f, n) };
  if (ln < 0) q.glow = Math.max(2, q.glow); // the evil LUT turns the same seams hot red
  const R = solve(q);
  const cv = newCanvas(debug);
  // se: the screen-left side (A) is nearer the viewer; ne: the screen-right side (B) is.
  const nearS = back ? 'B' : 'A', farS = back ? 'A' : 'B';
  const opt = (near) => ({ tone: near ? 0 : -1, near, lean: ln, back });
  const g = {};
  if (!(q.farOver && !back)) g[farS + 'arm'] = drawArm(cv, farS, R, q, opt(false));
  g[farS + 'leg'] = drawLeg(cv, farS, R, q, opt(false));
  g[nearS + 'leg'] = drawLeg(cv, nearS, R, q, opt(true));
  drawPelvis(cv, R); rimOver(cv, [P_.pelvis]);
  const cutsW = drawSpine(cv, R, opt(true)); rimOver(cv, [P_.spine]);
  if (cv.slabLog) cv.slabLog.push({ part: P_.spine, cuts: cutsW });
  drawChest(cv, R, q, opt(true)); rimOver(cv, [P_.chest]);
  // A hanging near arm tucks its top slab under the collar; a raised one (hand above the
  // shoulder) goes over the collar and the hood.
  const nearEarly = q.farOver && back;
  const nearArm = nearS === 'A' ? R.armA : R.armB, nearSh = nearS === 'A' ? R.SA : R.SB;
  const tucked = !nearEarly && nearArm.end[1] >= nearSh[1] - 4;
  if (tucked) g[nearS + 'arm'] = drawArm(cv, nearS, R, q, opt(true));
  drawCollar(cv, R, opt(true)); rimOver(cv, [P_.collar]);
  if (!g[farS + 'arm']) g[farS + 'arm'] = drawArm(cv, farS, R, q, opt(false));
  if (nearEarly) g[nearS + 'arm'] = drawArm(cv, nearS, R, q, opt(true));
  drawHood(cv, R, q, opt(true)); rimOver(cv, [P_.hood]);
  if (!g[nearS + 'arm']) g[nearS + 'arm'] = drawArm(cv, nearS, R, q, opt(true));
  if (q.prop) drawProp(cv, R, q);
  // Decorations go over the finished body, each only on the pixels its limb still shows.
  decorateTorso(cv, R, q, opt(true));
  for (const S of ['A', 'B']) {
    decorateLeg(cv, S, R, q, opt(S === nearS), g[S + 'leg']);
    decorateArm(cv, S, R, q, opt(S === nearS), g[S + 'arm']);
  }
  const hood = decorateHood(cv, R, q, opt(true));
  if (ln > 0 || q.bloom) {
    // Good lean: a few pale blooms in the moss (shoulders, crown, hip); 3-5 pixels.
    const pts = [add(R.SA, [-1, -1.5]), add(hood.crown, [1, -1]), add(R.SB, [0, -1]), add(R.P, add(mul(R.rp, -4), mul(R.dp, -2.5)))];
    for (const p of ln > 0 ? pts : pts.slice(0, 3)) bloom(cv, p[0], p[1], P_.hood);
  }

  // Anchor: on the ground row (local y in [-1, 0)), midway between the feet, or at the seat.
  const seat = !!q.seat;
  const ax0 = seat ? R.P[0] : (R.legA.end[0] + R.legB.end[0]) / 2 + 1.7; // +1.7: foot slabs run forward of the ankle
  const AX = Math.floor(ax0 + OX), AY = OY - 1;
  // Crop to the painted pixels.
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) if (cv.data[Y * W + X]) {
    if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
  }
  const sw = x1 - x0 + 1, shh = y1 - y0 + 1;
  const s = createSprite(sw, shh, AX - x0, AY - y0);
  for (let y = 0; y < shh; y++) s.data.set(cv.data.subarray((y + y0) * W + x0, (y + y0) * W + x1 + 1), y * sw);
  const contact = seat ? 'seat' : 'feet';
  const out = flip ? mirror(s) : s;
  out.contact = contact;
  if (!debug) return { sprite: out };

  // Debug view for checks (se / ne only): part masks, rig joints and the hood hollow in sprite pixels.
  const crop = (m) => { const a = new Uint8Array(sw * shh); for (let y = 0; y < shh; y++) a.set(m.subarray((y + y0) * W + x0, (y + y0) * W + x1 + 1), y * sw); return a; };
  const toS = (p) => [p[0] + OX - x0, p[1] + OY - y0];
  const masks = {}, owners = crop(cv.own);
  for (const [name, id] of Object.entries(P_)) if (cv.masks.has(id)) masks[name] = crop(cv.masks.get(id));
  const joints = {
    shoulderA: R.SA, elbowA: R.armA.joint, wristA: R.armA.end, shoulderB: R.SB, elbowB: R.armB.joint, wristB: R.armB.end,
    hipA: R.HA, kneeA: R.legA.joint, ankleA: R.legA.end, hipB: R.HB, kneeB: R.legB.joint, ankleB: R.legB.end,
  };
  const hollow = new Uint8Array(sw * shh);
  if (!back) {
    const { o: c, r, dn } = hoodFrame(R, q);
    for (let y = 0; y < shh; y++) for (let x = 0; x < sw; x++) {
      const rel = [x + x0 - OX + 0.5 - c[0], y + y0 - OY + 0.5 - c[1]];
      if (inPoly(HOLLOW, rel[0] * r[0] + rel[1] * r[1], rel[0] * dn[0] + rel[1] * dn[1])) hollow[y * sw + x] = 1;
    }
  }
  return {
    sprite: out, masks, owners, hollow,
    joints: Object.fromEntries(Object.entries(joints).map(([k, v]) => [k, toS(v)])),
    seat: toS(R.P), torso: { pelvis: toS(R.P), chest: toS(R.C) }, slabs: cv.slabLog,
    hands: Object.fromEntries(Object.entries(cv.hands ?? {}).map(([k, h]) => [k, { ...h, o: toS(h.o) }])),
  };
}

function paintCreature(opts = {}) {
  return build(opts, false).sprite;
}

/**
 * Debug view of one frame for scripts/check-creature-art.mjs: the sprite plus each part's own
 * mask (before nearer parts covered it), the final pixel owners, the rig joints and the hood
 * hollow region, all in sprite pixels. Only meaningful for the drawn facings `se` and `ne`.
 */
export function creatureDebug(opts) {
  return build(opts, true);
}

/** Creature droppings: a small dark mound with a few root fibres, about 5 px. */
function paintDung() {
  const rows = [
    '..ab...',
    '.abcd..',
    'abccde.',
    'bccdde.',
  ];
  const key = { a: idx('dirt', 4), b: idx('dirt', 3), c: idx('bark', 2), d: idx('bark', 1), e: idx('dirt', 1) };
  const s = createSprite(9, rows.length + 2, 4, rows.length + 1);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (key[ch]) s.data[(y + 1) * s.w + x + 1] = key[ch]; }));
  // Dark rim on the shadow side, root fibres poking out.
  for (const [x, y] of [[8, 4], [7, 5], [6, 5], [5, 5], [2, 5], [3, 5], [4, 5], [1, 5]]) s.data[y * s.w + x] = idx('ink', 1);
  for (const [x, y, c] of [[7, 2, BARK(2)], [8, 1, BARK(1)], [0, 4, BARK(2)], [4, 0, MOSS(3)]]) s.data[y * s.w + x] = c;
  return s;
}

export const sprites = {
  creature: paintCreature,
  dung: paintDung,
};

const firstFrames = Object.keys(CREATURE_FRAMES).map((pose) => ({ pose, frame: 0, facing: 'se', lean: 0 }));
const walkFrames = Array.from({ length: CREATURE_FRAMES.walk }, (_, frame) => ({ pose: 'walk', frame, facing: 'se', lean: 0 }));
export const previews = {
  creature: [
    ...firstFrames,
    ...walkFrames,
    { pose: 'idle', frame: 0, facing: 'se', lean: -1 },
    { pose: 'idle', frame: 0, facing: 'se', lean: 1 },
    { pose: 'idle', frame: 0, facing: 'ne', lean: 0 },
  ],
};


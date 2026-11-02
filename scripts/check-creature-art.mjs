// Node check for the creature painter's proportion, material and contract targets (round 31
// brief: gaunt stoop and long arms, real stone mass, chipped boulder slabs, tapered uneven limbs,
// no ring joints, no claw hands).
//   node scripts/check-creature-art.mjs [--verbose]   exit 0 on pass; non-zero with the failures printed.
//
// Measures the idle `se` lean 0 sprite through creatureDebug() (each body part's own pixel mask,
// the final pixel owners, the rig joints, the hand frames, the slab cuts, the hood hollow) and
// asserts (every width target on final composited pixels, outline included):
//   - height 74-80 px; shoulder span 26-32 (the full final silhouette in the rows around the
//     shoulder joints); torso with the arms excluded, by two methods that must both pass (screen
//     rows x cos of the torso slant, and slices across the pelvis-chest axis; see torsoWidths),
//     idle se and ne, every frame and lean: chest 16-22 wide, narrowest waist 10-14, hips 14-18;
//     the chest is the largest part; the collar slabs span the shoulders (6+ px wider than the
//     chest) and rise beside the hood's lower 4+ rows, but top out 3+ rows below the hood's top
//     and no higher than round 31's design, with no second head-like lump beside the hood
//   - limb widths in 1 px bands across the bone, counting only bands whose own-mask pixels are
//     70%+ visible, and again on screen rows x cos(slant) with the same rule, both must pass, 2+
//     counted bands per stretch (method at limbBands; median in range, no counted
//     band over the top), idle se lean 0 and idle se frames 0-3 at leans -1/0/+1: upper arm 6-8;
//     forearm 6-7 near the elbow narrowing to 4-5 at the wrist; thigh 7-9; shin 6-7 near the knee
//     narrowing to 4-5 at the ankle
//   - left and right limbs not mirror-identical (width profiles and slab cuts differ)
//   - every limb segment, the waist and the chest built from 2+ slabs (chest: 2+ cracks), no two
//     adjacent slabs the same length; an outline notch or step at least every 5 px of each limb
//     edge and of the chest edge; dark cracks inside every limb segment
//   - no ring joints: inside every joint, no screen row and no slice across the bone where root
//     (bark) pixels cover more than 70% of the limb width
//   - hands 6-9 px wide on final pixels (same 70% visibility rule per slice) with 2-3 finger lumps, every lump 2+ px wide and at most 5 px long;
//     no 1 px spike (a hand pixel with at most one hand neighbour); fingertips at or below mid-thigh
//   - forward stoop (hood centre >= 3 px ahead of the pelvis); hood hollow pure shadow, nothing
//     eye-like in it, no ember anywhere in the hood; ember only in the chest and joint seams
//   - lean: +1 fuller moss and 3-6 pale blooms, -1 withered moss, wider cracks, charred root ends
//   - heavy walk: the body sinks 1-2 px on the contact frames
//   - contract: 13 poses, frame counts, every pose x frame x facing x lean paints a valid sprite,
//     contact anchors, sw / nw mirror se / ne, deterministic, warm paint time over every variant:
//     median under 3.5 ms, p95 under 5 ms.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => import(pathToFileURL(join(ROOT, p)).href);
const { RAMP, rampOf } = await load('src/art/palette.js');
const painter = await load('src/art/painters/creature.js');
const { CREATURE_FRAMES, CREATURE_CONTACT, creatureDebug, sprites } = painter;
const verbose = process.argv.includes('--verbose');

let failed = 0, passed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; if (verbose) console.log(`ok   ${name}${detail ? `: ${detail}` : ''}`); return; }
  failed++;
  console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
}

const IDLE = { pose: 'idle', frame: 0, facing: 'se', lean: 0 };
const D = creatureDebug(IDLE);
const S = D.sprite, w = S.w, h = S.h;
const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? S.data[y * w + x] : 0);
const ramp = (v) => (v ? rampOf(v).ramp : -1);
const shade = (v) => (v ? rampOf(v).shade : -1);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const unit = (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const HIDE = RAMP['creature-hide'], BARK = RAMP.bark, ACC = RAMP['creature-accent'];
const J = D.joints, M = D.masks, P = painter.PART, own = D.owners;
const ownAt = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? own[y * w + x] : 0);

// ---- height, shoulders, torso
const rowsWith = [];
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (at(x, y)) { rowsWith.push(y); break; }
const top = rowsWith[0], bottom = rowsWith[rowsWith.length - 1];
const height = bottom - top + 1;
check('idle se height 74-80 px', height >= 74 && height <= 80, `${height} px`);
check('anchor row is the sole row', S.ay === bottom, `ay ${S.ay}, lowest row ${bottom}`);
const span = (y) => { let a = -1, b = -1; for (let x = 0; x < w; x++) if (at(x, y)) { if (a < 0) a = x; b = x; } return a < 0 ? 0 : b - a + 1; };
const maskRows = (m) => {
  const rows = new Map();
  m.forEach((v, i) => { if (!v) return; const y = Math.floor(i / w), x = i % w; const r = rows.get(y) ?? [x, x]; r[0] = Math.min(r[0], x); r[1] = Math.max(r[1], x); rows.set(y, r); });
  return rows;
};
// Shoulder window: 3 rows either side of the shoulder joints, widened to take in every row where
// the collar's own mask is at its widest (the collar caps the shoulders and its widest row sits
// above the joints' row - 3 in some frames, e.g. row 14 with the joints at row 18).
const shY = Math.round((J.shoulderA[1] + J.shoulderB[1]) / 2);
const collarWide = M.collar ? (() => { const r = [...maskRows(M.collar)], mx = Math.max(...r.map(([, [a, b]]) => b - a + 1)); return r.filter(([, [a, b]]) => b - a + 1 === mx).map(([y]) => y); })() : [];
const shY0 = Math.min(shY - 3, ...collarWide), shY1 = Math.max(shY + 3, ...collarWide);
let shoulder = 0;
for (let y = shY0; y <= shY1; y++) shoulder = Math.max(shoulder, span(y));
check('shoulder width 26-32 px', shoulder >= 26 && shoulder <= 32, `${shoulder} px (rows ${shY0}..${shY1}, collar widest at ${collarWide.join(',')})`);
const maxRowWidth = (m) => Math.max(...[...maskRows(m).values()].map(([a, b]) => b - a + 1));
// Torso widths on the final composited pixels, by two methods that must both pass. Only final
// pixels owned by a torso part (chest, waist, pelvis) count; pixels whose final owner is an arm
// (or a leg, the collar, the hood, a prop) do not, so an arm hanging in front of the torso's edge
// narrows it. Every row / slice counts (no visibility threshold: that would only skip narrow ones).
//   (a) rows: in every screen row, the run from the leftmost to the rightmost torso pixel, times
//       the cosine of the torso's slant (the rig's pelvis -> chest axis), rounded.
//   (b) across: 1 px slices along the pelvis -> chest axis (pixel centres projected onto it);
//       width = the extent of the slice's torso pixels perpendicular to the axis, + 1, rounded.
// In both, entries where the chest owns most of the torso pixels are chest entries and entries
// where the pelvis does are hip entries; chest = widest chest entry, hips = widest hip entry,
// waist = narrowest entry strictly between the widest chest entry nearest the waist and the
// widest hip entry nearest the waist (so the entry where the waist meets the pelvis counts).
// Measured in idle `se` and `ne`, every frame, leans -1, 0 and +1.
function torsoWidths(d) {
  const s = d.sprite, T = new Set([P.chest, P.spine, P.pelvis]);
  const pv = d.torso.pelvis, axis = sub(d.torso.chest, pv), u = unit(axis), nn = [-u[1], u[0]];
  const cos = Math.abs(axis[1]) / Math.hypot(axis[0], axis[1]);
  const rowMap = new Map(), binMap = new Map();
  const entry = (map, key) => { let e = map.get(key); if (!e) map.set(key, (e = { key, lo: Infinity, hi: -Infinity, n: new Map() })); return e; };
  for (let i = 0; i < s.data.length; i++) {
    const o = d.owners[i];
    if (!s.data[i] || !T.has(o)) continue;
    const x = i % s.w, y = (i - x) / s.w, r = [x + 0.5 - pv[0], y + 0.5 - pv[1]];
    const er = entry(rowMap, y), eb = entry(binMap, Math.floor(dot(r, u))), ac = dot(r, nn);
    er.lo = Math.min(er.lo, x); er.hi = Math.max(er.hi, x); er.n.set(o, (er.n.get(o) ?? 0) + 1);
    eb.lo = Math.min(eb.lo, ac); eb.hi = Math.max(eb.hi, ac); eb.n.set(o, (eb.n.get(o) ?? 0) + 1);
  }
  const major = (e) => [...e.n].sort((a, b) => b[1] - a[1])[0][0];
  // `pos` runs from the hips towards the chest in both methods (screen rows go down, so negate).
  const rows = [...rowMap.values()].map((e) => ({ y: e.key, pos: -e.key, raw: e.hi - e.lo + 1, width: Math.round((e.hi - e.lo + 1) * cos), major: major(e) }));
  const bins = [...binMap.values()].map((e) => ({ y: e.key, pos: e.key, raw: e.hi - e.lo + 1, width: Math.round(e.hi - e.lo + 1), major: major(e) }));
  const summarize = (list) => {
    const widest = (rs) => rs.reduce((m, r) => (r.width > m.width ? r : m), { width: -1 });
    const chestE = list.filter((r) => r.major === P.chest), hipE = list.filter((r) => r.major === P.pelvis);
    const chest = widest(chestE), hips = widest(hipE);
    const chestPos = Math.min(...chestE.filter((r) => r.width === chest.width).map((r) => r.pos));
    const hipPos = Math.max(...hipE.filter((r) => r.width === hips.width).map((r) => r.pos));
    const band = list.filter((r) => r.pos < chestPos && r.pos > hipPos);
    const waist = band.reduce((m, r) => (r.width < m.width ? r : m), { width: Infinity, raw: Infinity, y: NaN });
    return { chest, hips, waist };
  };
  return { rows: summarize(rows), across: summarize(bins), cos };
}
const torso = [];
for (const facing of ['se', 'ne']) for (const lean of [-1, 0, 1]) for (let frame = 0; frame < CREATURE_FRAMES.idle; frame++) {
  torso.push({ tag: `idle/${frame}/${facing}/${lean}`, ...torsoWidths(creatureDebug({ pose: 'idle', frame, facing, lean })) });
}
const torsoCheck = (name, key, lo, hi) => {
  for (const [method, label, unitName] of [['rows', '(a) screen rows x cos(slant)', 'row'], ['across', '(b) across the pelvis-chest axis', 'slice']]) {
    const bad = torso.filter((t) => !(t[method][key].width >= lo && t[method][key].width <= hi));
    const ws = torso.map((t) => t[method][key].width);
    check(`${name} ${lo}-${hi} px wide on final pixels, ${label} (idle se/ne, all frames and leans)`, bad.length === 0,
      bad.length ? bad.slice(0, 4).map((t) => `${t.tag}: ${t[method][key].width} (${unitName} ${t[method][key].y}, ${t[method][key].raw.toFixed?.(1) ?? t[method][key].raw} px raw)`).join('; ') : `${Math.min(...ws)}-${Math.max(...ws)} px`);
  }
};
torsoCheck('chest', 'chest', 16, 22);
torsoCheck('waist (narrowest)', 'waist', 10, 14);
torsoCheck('hips', 'hips', 14, 18);
const T0 = torsoWidths(D).rows, chestW = T0.chest.width, hipW = T0.hips.width, waistW = T0.waist.width;
const T0x = torsoWidths(D).across;
const area = (m) => m.reduce((k, v) => k + (v ? 1 : 0), 0);
const parts = Object.entries(M).filter(([k]) => k !== 'prop').map(([k, m]) => [k, area(m)]).sort((a, b) => b[1] - a[1]);
check('torso is the most massive part (chest has the most pixels)', parts[0][0] === 'chest', parts.slice(0, 3).map(([k, n]) => `${k} ${n}`).join(', '));
{
  // Collar: stone slabs over both shoulder joints, broader than the chest, rising beside the
  // hood's lower half so the hood sits between the shoulders rather than on top of them.
  const cRows = [...maskRows(M.collar ?? new Uint8Array(w * h)).keys()], hRows = [...maskRows(M.hood).keys()];
  const collarW = M.collar ? maxRowWidth(M.collar) : 0;
  check('collar slabs span the shoulders, 6+ px wider than the chest', collarW >= chestW + 6, `collar ${collarW} px, chest ${chestW} px`);
  const flank = cRows.length ? Math.max(...hRows) - Math.min(...cRows) : -1;
  check('hood sits low: collar rises beside its lower 4+ rows', flank >= 4, `${flank} rows`);
}
{
  // Shoulder slabs stay below the head, idle se and ne, every frame and lean, on final pixels:
  // (1) the highest collar-owned row is at least 3 rows below the hood's top row, and no higher
  //     than in round 31's approved design (measured there, idle frames 0-3, both facings, every
//     lean: the collar top sat 8, 7, 6 and 8 rows below the hood top);
  // (2) no second head: walking the silhouette's top edge outward from the hood's top column on
  //     each side (over the columns whose top lies above the shoulder joints), once the edge has
  //     dropped it never climbs back up by 2+ px, so no lump beside the hood stands up from a dip
  //     between it and the head.
  const R31_GAP = [8, 7, 6, 8], low = [], peaks = [];
  let gaps = [];
  for (const facing of ['se', 'ne']) for (const lean of [-1, 0, 1]) for (let frame = 0; frame < CREATURE_FRAMES.idle; frame++) {
    const d = creatureDebug({ pose: 'idle', frame, facing, lean }), s = d.sprite, tag = `idle/${frame}/${facing}/${lean}`;
    let hoodTop = Infinity, hoodX = -1, collarTop = Infinity;
    for (let i = 0; i < s.data.length; i++) {
      if (!s.data[i]) continue;
      const y = Math.floor(i / s.w);
      if (d.owners[i] === P.hood && y < hoodTop) { hoodTop = y; hoodX = i % s.w; }
      if (d.owners[i] === P.collar && y < collarTop) collarTop = y;
    }
    const gap = collarTop - hoodTop;
    gaps.push(gap);
    if (!(gap >= Math.max(3, R31_GAP[frame]))) low.push(`${tag}: collar top row ${collarTop}, hood top row ${hoodTop} (round 31: ${R31_GAP[frame]} rows below)`);
    const tops = Array.from({ length: s.w }, (_, x) => { for (let y = 0; y < s.h; y++) if (s.data[y * s.w + x]) return y; return Infinity; });
    const shY = (d.joints.shoulderA[1] + d.joints.shoulderB[1]) / 2;
    for (const dir of [-1, 1]) {
      let deepest = tops[hoodX];
      for (let x = hoodX + dir; x >= 0 && x < s.w && tops[x] < shY; x += dir) {
        deepest = Math.max(deepest, tops[x]);
        if (deepest - tops[x] >= 2) { peaks.push(`${tag}: column ${x} rises to row ${tops[x]} after a dip to row ${deepest}`); break; }
      }
    }
  }
  check('shoulder slabs top out 3+ rows below the hood top, no higher than round 31 (idle se/ne, all frames and leans)', low.length === 0, low.slice(0, 4).join('; ') || `collar top ${Math.min(...gaps)}-${Math.max(...gaps)} rows below the hood top`);
  check('no second head: the silhouette top never climbs 2+ px again beside the hood', peaks.length === 0, peaks.slice(0, 4).join('; '));
}

// ---- limb widths on the final composited pixels (outline included). Method: 1 px bands across
// the bone a -> b (pixel centres projected onto the bone; band k holds along-bone positions
// [k, k + 1), at fraction f = (k + 0.5) / bone length). A limb's visible pixels are the final
// pixels it owns (the final owner map), so a body part, another limb or a hand in front of it
// removes them. A band counts only where at least 70% of the limb's own-mask pixels in that band
// (its whole shape before nearer parts covered it) are visible; its width is the extent of its
// visible pixels perpendicular to the bone, + 1, rounded. Over each stretch of the bone the median
// counted band must sit in the target range and no counted band may exceed its top; a stretch
// with fewer than 2 counted bands fails. Second method, same visibility rule and limits: the
// bands are screen rows (row y at fraction f = (y + 0.5 - a.y) / (b.y - a.y) of the bone), a
// row's width the run from its leftmost to its rightmost visible pixel times cos(slant), rounded.
// Both methods must pass (slices alone let a stretch pass that reads too thin or too thick row by
// row on screen, and the reverse). Idle `se` lean 0 is the measured sprite (the targets' pose);
// frames 1-3 and leans -1 / +1 of idle `se` are held to the same ranges.
function limbBands(d, name, a, b, method = 'slices') {
  const s = d.sprite, m = d.masks[name], id = P[name];
  const ab = sub(b, a), L = Math.hypot(ab[0], ab[1]), u = unit(ab), nn = [-u[1], u[0]], cos = Math.abs(ab[1]) / L;
  const map = new Map();
  for (let i = 0; i < s.data.length; i++) {
    const inMask = !!(m && m[i]), vis = !!s.data[i] && d.owners[i] === id;
    if (!inMask && !vis) continue;
    const x = i % s.w, y = (i - x) / s.w, r = [x + 0.5 - a[0], y + 0.5 - a[1]];
    const k = method === 'rows' ? y : Math.floor(dot(r, u));
    let e = map.get(k);
    if (!e) map.set(k, (e = { k, f: method === 'rows' ? (y + 0.5 - a[1]) / ab[1] : (k + 0.5) / L, own: 0, seen: 0, lo: Infinity, hi: -Infinity }));
    if (inMask) e.own++;
    if (vis) { if (inMask) e.seen++; const c = method === 'rows' ? x : dot(r, nn); e.lo = Math.min(e.lo, c); e.hi = Math.max(e.hi, c); }
  }
  const scale = method === 'rows' ? cos : 1;
  return [...map.values()].sort((p, q) => p.k - q.k)
    .map((e) => ({ ...e, counted: e.own > 0 && e.seen >= 0.7 * e.own, width: e.hi >= e.lo ? Math.round((e.hi - e.lo + 1) * scale) : 0 }));
}
function finalWidth1(d, name, a, b, f0, f1, method) {
  const all = limbBands(d, name, a, b, method).filter((e) => e.f >= f0 && e.f <= f1), ws = all.filter((e) => e.counted).map((e) => e.width);
  const sorted = [...ws].sort((p, q) => p - q);
  return {
    n: ws.length, med: ws.length ? sorted[Math.floor((ws.length - 1) / 2)] : 0, max: ws.length ? sorted[ws.length - 1] : 0,
    toString() { return `median ${this.med}, widest ${this.max}, ${method} [${all.map((e) => (e.counted ? e.width : `(${e.width} ${Math.round((100 * e.seen) / e.own)}%)`)).join(',')}]`; },
  };
}
const finalWidth = (d, name, a, b, f0, f1) => {
  const slices = finalWidth1(d, name, a, b, f0, f1, 'slices'), rows = finalWidth1(d, name, a, b, f0, f1, 'rows');
  return { slices, rows, toString: () => `${slices}; ${rows}` };
};
const inFinal1 = (m, lo, hi) => m.n >= 2 && m.med >= lo && m.med <= hi && m.max <= hi;
const inFinal = (m, lo, hi) => inFinal1(m.slices, lo, hi) && inFinal1(m.rows, lo, hi);
const LIMB_TARGETS = [
  // [label, part, joint a, joint b, f0, f1, lo, hi]
  ['upper arm', 'upper', 'shoulder', 'elbow', 0.15, 0.85, 6, 8],
  ['forearm near the elbow', 'fore', 'elbow', 'wrist', 0.05, 0.35, 6, 7],
  ['forearm at the wrist', 'fore', 'elbow', 'wrist', 0.8, 1, 4, 5],
  ['thigh', 'thigh', 'hip', 'knee', 0.15, 0.85, 7, 9],
  ['shin near the knee', 'shin', 'knee', 'ankle', 0.05, 0.35, 6, 7],
  ['shin at the ankle', 'shin', 'knee', 'ankle', 0.8, 1, 4, 5],
];
{
  const others = [];
  for (const lean of [-1, 0, 1]) for (let frame = 0; frame < CREATURE_FRAMES.idle; frame++) {
    if (!lean && !frame) continue;
    others.push([`idle/${frame}/se/${lean}`, creatureDebug({ pose: 'idle', frame, facing: 'se', lean })]);
  }
  for (const S2 of ['A', 'B']) for (const [label, part, ja, jb, f0, f1, lo, hi] of LIMB_TARGETS) {
    const name = `${part}${S2}`, wd = (d) => finalWidth(d, name, d.joints[`${ja}${S2}`], d.joints[`${jb}${S2}`], f0, f1);
    const m0 = wd(D);
    check(`${label} ${S2} ${lo}-${hi} px on final pixels (idle se lean 0)`, inFinal(m0, lo, hi), `${m0}`);
    const bad = others.map(([tag, d]) => [tag, wd(d)]).filter(([, m]) => !inFinal(m, lo, hi));
    check(`${label} ${S2} ${lo}-${hi} px on final pixels (idle se, frames 0-3, leans -1/0/+1)`, bad.length === 0, bad.slice(0, 3).map(([tag, m]) => `${tag}: ${m}`).join('; '));
  }
}

// ---- limb outlines on screen rows (own masks; for the left/right, notch and crack checks below).
// In the idle pose every limb hangs within ~25 degrees of vertical, so a row's span times
// cos(slant) is the width across the bone. Row y belongs to fraction f = (y + 0.5 - a.y) /
// (b.y - a.y) of the bone a -> b.
function rowsAlong(mask, a, b) {
  const slope = (b[0] - a[0]) / (b[1] - a[1]), cos = Math.cos(Math.atan(slope));
  const out = [];
  for (let y = 0; y < h; y++) {
    let x0 = Infinity, x1 = -1;
    for (let x = 0; x < w; x++) if (mask[y * w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    if (x1 < 0) continue;
    out.push({ y, f: (y + 0.5 - a[1]) / (b[1] - a[1]), x0, x1, width: Math.round((x1 - x0 + 1) * cos) });
  }
  return out;
}
const profiles = {};
for (const S2 of ['A', 'B']) {
  const sh = J[`shoulder${S2}`], el = J[`elbow${S2}`], wr = J[`wrist${S2}`], hp = J[`hip${S2}`], kn = J[`knee${S2}`], an = J[`ankle${S2}`];
  for (const [name, m, a, b] of [['upper', M[`upper${S2}`], sh, el], ['fore', M[`fore${S2}`], el, wr], ['thigh', M[`thigh${S2}`], hp, kn], ['shin', M[`shin${S2}`], kn, an]]) {
    profiles[`${name}${S2}`] = { m, a, b, rows: rowsAlong(m, a, b) };
  }
}

// ---- left and right limbs differ (row widths down the limb and slab cuts)
const slabsOf = (id) => D.slabs.filter((s) => s.part === id).map((s) => s.cuts);
const lengths = (cuts) => cuts.slice(1).map((c, i) => Math.round(c - cuts[i]));
for (const name of ['upper', 'fore', 'thigh', 'shin']) {
  const wA = profiles[`${name}A`].rows.map((r) => r.width), wB = profiles[`${name}B`].rows.map((r) => r.width);
  const cA = lengths(slabsOf(P[`${name}A`])[0]), cB = lengths(slabsOf(P[`${name}B`])[0]);
  check(`${name} A and B not mirror-identical`, wA.join() !== wB.join() && cA.join() !== cB.join(), `widths ${wA.join('')} / ${wB.join('')}, slabs ${cA.join('-')} / ${cB.join('-')}`);
}

// ---- boulder slabs: 2+ per segment, neighbours of different length
for (const { part, cuts } of D.slabs) {
  const L = lengths(cuts), name = Object.keys(P).find((k) => P[k] === part);
  const same = L.some((v, i) => i && v === L[i - 1]);
  check(`${name} built from 2+ slabs, neighbours differ in length`, L.length >= 2 && !same, L.join('-'));
}
check('chest built from 2+ boulders (dark cracks inside the chest)', (() => {
  let k = 0;
  M.chest.forEach((v, i) => { if (v && own[i] === P.chest && ramp(S.data[i]) === HIDE && shade(S.data[i]) <= 1) k++; });
  return k >= 30;
})());

// Chip notches: down each edge (left and right, per screen row), consecutive rows with the same
// edge x merge into runs; a run that sits in or out of both neighbouring runs is a notch or bump,
// and a jump of 2+ px between rows is a step. A straight or evenly slanted edge has neither. The
// rows between two such features (and from either end of the edge to the first and last) may
// number at most 5.
function longestPlain(xs) {
  const runs = [];
  xs.forEach((x, i) => { if (runs.length && runs[runs.length - 1].x === x) runs[runs.length - 1].n++; else runs.push({ x, at: i, n: 1 }); });
  const feats = [];
  runs.forEach((r, k) => {
    const p = runs[k - 1], q = runs[k + 1];
    if (p && q && Math.sign(r.x - p.x) === Math.sign(r.x - q.x)) feats.push(r.at);
    if (p && Math.abs(r.x - p.x) >= 2) feats.push(r.at);
  });
  const marks = [-1, ...[...new Set(feats)].sort((a, b) => a - b), xs.length];
  return Math.max(...marks.slice(1).map((m, i) => m - marks[i] - 1));
}
for (const [name, { rows }] of Object.entries(profiles)) {
  const run = Math.max(longestPlain(rows.map((r) => r.x0)), longestPlain(rows.map((r) => r.x1)));
  check(`${name} outline has a notch or step every 5 px`, run <= 5, `longest plain stretch ${run} rows`);
}
{
  const rows = [...maskRows(M.chest)].sort((a, b) => a[0] - b[0]);
  const run = Math.max(longestPlain(rows.map(([, [a]]) => a)), longestPlain(rows.map(([, [, b]]) => b)));
  check('chest outline has a notch or step every 5 px', run <= 5, `longest plain stretch ${run} rows`);
}
// Cracks across the slabs: dark (shade <= 1) creature-hide pixels inside each limb segment,
// away from its outline.
for (const [name, { m }] of Object.entries(profiles)) {
  let k = 0;
  m.forEach((v, i) => {
    if (!v || own[i] !== P[name]) return;
    const x = i % w, y = Math.floor(i / w);
    if (![[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => m[(y + dy) * w + x + dx])) return;
    if (ramp(S.data[i]) === HIDE && shade(S.data[i]) <= 1) k++;
  });
  check(`${name} has cracks inside its slabs`, k >= 2, `${k} px`);
}

// ---- no ring joints: around each joint (4 px either side along the lower bone), in every screen
// row and every slice across the bone, root (bark) pixels on the joint's limbs cover at most 70%
// of the limb's width there.
const JOINT_PARTS = {
  shoulder: (S2) => [P[`upper${S2}`]], elbow: (S2) => [P[`upper${S2}`], P[`fore${S2}`]], wrist: (S2) => [P[`fore${S2}`], P[`hand${S2}`]],
  hip: (S2) => [P[`thigh${S2}`]], knee: (S2) => [P[`thigh${S2}`], P[`shin${S2}`]], ankle: (S2) => [P[`shin${S2}`], P[`foot${S2}`]],
};
const NEXT = { shoulder: 'elbow', elbow: 'wrist', wrist: 'elbow', hip: 'knee', knee: 'ankle', ankle: 'knee' };
const ringBad = [];
let ringWorst = 0;
for (const S2 of ['A', 'B']) for (const [j, idsOf] of Object.entries(JOINT_PARTS)) {
  const ids = idsOf(S2), Jp = J[`${j}${S2}`];
  const u = unit(sub(J[`${NEXT[j]}${S2}`], Jp)), n = [-u[1], u[0]];
  const rows = new Map(), slices = new Map();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = own[y * w + x];
    if (!ids.includes(o)) continue;
    const r = [x + 0.5 - Jp[0], y + 0.5 - Jp[1]], al = dot(r, u);
    if (Math.abs(al) > 4 || Math.abs(dot(r, n)) > 6) continue;
    const isRoot = ramp(S.data[y * w + x]) === BARK ? 1 : 0;
    for (const [map, key] of [[rows, y], [slices, Math.floor(al)]]) {
      const c = map.get(key) ?? [0, 0];
      c[0] += isRoot; c[1]++;
      map.set(key, c);
    }
  }
  for (const [kind, map] of [['row', rows], ['slice', slices]]) for (const [key, [root, all]] of map) {
    if (all < 3) continue;
    ringWorst = Math.max(ringWorst, root / all);
    if (root / all > 0.7) ringBad.push(`${j} ${S2} ${kind} ${key}: ${root}/${all}`);
  }
}
check('no ring joints: roots cover <= 70% of the limb width in every joint row and slice', ringBad.length === 0, ringBad.slice(0, 6).join('; ') || `worst ${(ringWorst * 100).toFixed(0)}%`);
// Roots are there at all: some bark on the limbs.
{
  let k = 0;
  S.data.forEach((v, i) => { if (ramp(v) === BARK && own[i] >= P.upperA && own[i] <= P.footB) k++; });
  check('roots wrap the limbs', k >= 25, `${k} bark px on the limbs`);
}

// ---- hands: blunt, 2-3 thick finger lumps, no claws
for (const S2 of ['A', 'B']) {
  const hd = D.hands[S2], hm = M[`hand${S2}`];
  check(`hand ${S2} frame exported`, !!hd);
  if (!hd) continue;
  const slices = new Map(), seen = new Map();
  hm.forEach((v, i) => {
    if (!v) return;
    const x = i % w, y = Math.floor(i / w), r = [x + 0.5 - hd.o[0], y + 0.5 - hd.o[1]];
    const t = Math.floor(dot(r, hd.u)), s = Math.round(dot(r, hd.n) - 0.5);
    const visible = !!S.data[i] && own[i] === P[`hand${S2}`];
    const finger = !(ramp(S.data[i]) === HIDE && shade(S.data[i]) === 0) && visible;
    const m = slices.get(t) ?? new Map();
    m.set(s, finger);
    slices.set(t, m);
    const e = seen.get(t) ?? { own: 0, vis: [] };
    e.own++; if (visible) e.vis.push(s);
    seen.set(t, e);
  });
  // Width on final pixels, as for the limbs: slices across the hand axis whose own-mask pixels are
  // at least 70% visible count (2+ needed); width = the widest counted slice's visible extent.
  const counted = [...seen.values()].filter((e) => e.vis.length && e.vis.length >= 0.7 * e.own);
  const width = counted.length ? Math.max(...counted.map((e) => Math.max(...e.vis) - Math.min(...e.vis) + 1)) : 0;
  check(`hand ${S2} 6-9 px wide on final pixels`, counted.length >= 2 && width >= 6 && width <= 9, `${width} px over ${counted.length} counted slices of ${seen.size}`);
  // Finger lumps: runs of finger pixels across each slice past the palm.
  const runs = (m) => {
    const ss = [...m.keys()].sort((a, b) => a - b), out = [];
    let cur = null;
    for (let s = ss[0]; s <= ss[ss.length - 1]; s++) {
      if (m.get(s)) { if (cur) cur[1] = s; else out.push((cur = [s, s])); } else cur = null;
    }
    return out;
  };
  const ts = [...slices.keys()].filter((t) => t >= hd.palm).sort((a, b) => a - b);
  const firstRuns = ts.length ? runs(slices.get(ts[0])) : [];
  check(`hand ${S2} has 2-3 finger lumps`, firstRuns.length >= 2 && firstRuns.length <= 3, `${firstRuns.length} lumps`);
  let thin = 0, longest = 0;
  for (const t of ts) for (const [a, b] of runs(slices.get(t))) if (b - a + 1 < 2) thin++;
  // Lump length: how many slices past the palm each lump's middle column stays a finger pixel.
  for (const [a, b] of firstRuns) {
    const mid = Math.floor((a + b) / 2);
    let L = 0;
    for (const t of ts) if (slices.get(t).get(mid)) L++;
    longest = Math.max(longest, L);
  }
  check(`hand ${S2}: no finger segment narrower than 2 px`, thin === 0, `${thin} thin slices`);
  check(`hand ${S2}: no finger segment longer than 5 px`, longest <= 5, `longest ${longest} px`);
  // No claw spikes: every pixel of the hand's own shape has 2+ hand neighbours (4-connected).
  let spikes = 0;
  hm.forEach((v, i) => {
    if (!v) return;
    const x = i % w, y = Math.floor(i / w);
    const k = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => x + dx >= 0 && x + dx < w && y + dy >= 0 && y + dy < h && hm[(y + dy) * w + x + dx]).length;
    if (k <= 1) spikes++;
  });
  check(`hand ${S2}: no 1 px spikes (claws) on the outline`, spikes === 0, `${spikes} spike px`);
  let tip = -1;
  hm.forEach((v, i) => { if (v) tip = Math.max(tip, Math.floor(i / w)); });
  const midThigh = (J[`hip${S2}`][1] + J[`knee${S2}`][1]) / 2;
  check(`fingertips ${S2} at or below mid-thigh`, tip >= midThigh, `tip row ${tip}, mid-thigh row ${midThigh.toFixed(1)}`);
}

// ---- gaunt: gap between the legs at mid-shin
{
  const y = Math.round((J.kneeA[1] + J.ankleA[1] + J.kneeB[1] + J.ankleB[1]) / 4);
  const xsA = [], xsB = [];
  for (let x = 0; x < w; x++) { const o = ownAt(x, y); if (o === P.shinA) xsA.push(x); if (o === P.shinB) xsB.push(x); }
  const gap = xsA.length && xsB.length ? Math.min(...xsB) - Math.max(...xsA) - 1 : -1;
  check('gap between the legs at mid-shin', gap >= 1, `${gap} px at row ${y}`);
}

// ---- hood: forward stoop, hollow of pure shadow, no eyes
{
  const banned = new Set([ACC, RAMP.fire, RAMP.lightning]);
  let n = 0, dark = 0;
  const bad = [];
  for (let i = 0; i < D.hollow.length; i++) {
    if (!D.hollow[i]) continue;
    const v = S.data[i];
    if (!v) continue;
    n++;
    if (shade(v) <= 1) dark++;
    if (banned.has(ramp(v)) || shade(v) >= 5) bad.push(`${i % w},${Math.floor(i / w)}`);
  }
  check('hood hollow present', n >= 15, `${n} px`);
  check('no eye-like light in the hood hollow', bad.length === 0, bad.join(' ') || 'none');
  check('hood hollow is pure shadow (shade <= 1)', n > 0 && dark === n, `${dark}/${n}`);
  let accHood = 0;
  S.data.forEach((v, i) => { if (own[i] === P.hood && banned.has(ramp(v))) accHood++; });
  check('no ember or light anywhere in the hood', accHood === 0, `${accHood} px`);
  let hx = 0, hk = 0;
  M.hood.forEach((v, i) => { if (v) { hx += i % w; hk++; } });
  check('forward stoop: hood centre >= 3 px ahead of the pelvis', hk > 0 && hx / hk - D.seat[0] >= 3, `hood centre x ${(hx / hk).toFixed(1)}, pelvis x ${D.seat[0].toFixed(1)}`);
}

// ---- ember only in the chest and the joint seams (lean 0 and +1; lean -1's charred root tips may
// smoulder along the limb)
{
  const LIMBS = new Set([P.upperA, P.foreA, P.upperB, P.foreB, P.thighA, P.shinA, P.thighB, P.shinB]);
  const bad = [];
  for (const lean of [0, 1]) {
    const d = creatureDebug({ ...IDLE, lean }), s = d.sprite, joints = Object.values(d.joints);
    s.data.forEach((v, i) => {
      if (ramp(v) !== ACC) return;
      const o = d.owners[i], x = (i % s.w) + 0.5, y = Math.floor(i / s.w) + 0.5;
      if (o === P.chest) return;
      const near = Math.min(...joints.map((j) => Math.hypot(x - j[0], y - j[1])));
      if (!LIMBS.has(o) || near > 3) bad.push(`lean ${lean} ${x - 0.5},${y - 0.5} part ${o} ${near.toFixed(1)} px from a joint`);
    });
  }
  check('ember glow only in chest and joint seams', bad.length === 0, bad.slice(0, 4).join('; ') || 'all in chest / joint seams');
}

// ---- moss and lean
const countRamp = (s, r) => s.data.reduce((k, v) => k + (ramp(v) === r ? 1 : 0), 0);
const good = sprites.creature({ ...IDLE, lean: 1 }), evil = sprites.creature({ ...IDLE, lean: -1 });
const moss0 = countRamp(S, RAMP.moss), moss1 = countRamp(good, RAMP.moss), mossM = countRamp(evil, RAMP.moss);
check('moss in the crevices at lean 0', moss0 >= 12, `${moss0} px`);
check('lean +1 fuller moss', moss1 > moss0, `${moss1} vs ${moss0}`);
check('lean -1 moss withers to a few pixels', mossM < moss0 / 2, `${mossM} vs ${moss0}`);
const blooms = countRamp(good, RAMP.plaster);
check('lean +1 has 3-6 pale bloom pixels', blooms >= 3 && blooms <= 6, `${blooms}`);
check('lean 0 and -1 have no blooms', countRamp(S, RAMP.plaster) === 0 && countRamp(evil, RAMP.plaster) === 0);
const darkOf = (s) => s.data.reduce((k, v) => k + (ramp(v) === HIDE && shade(v) === 0 ? 1 : 0), 0);
check('lean -1 widens cracks', darkOf(evil) > darkOf(S) + 10, `${darkOf(evil)} vs ${darkOf(S)} crack px`);
const inkTips = countRamp(evil, RAMP.ink) - countRamp(S, RAMP.ink);
check('lean -1 chars root ends', inkTips >= 4, `${inkTips} more ink px`);
const accent = countRamp(S, ACC);
check('ember seams present', accent >= 8, `${accent} px`);

// ---- heavy walk: the body sinks on the contact frames (feet spread, frame 0 and n/2) compared
// with the passing frames (n/4, 3n/4)
{
  const n = CREATURE_FRAMES.walk;
  const tall = (f) => { const s = sprites.creature({ pose: 'walk', frame: f, facing: 'se', lean: 0 }); for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.data[y * s.w + x]) return s.ay - y; return 0; };
  const contact = [0, n / 2].map(tall), passing = [n / 4, (3 * n) / 4].map(tall);
  const sinks = contact.map((c, i) => passing[i] - c);
  check('walk: body sinks 1-2 px on the contact frames', sinks.every((s) => s >= 1 && s <= 2), `contact ${contact.join('/')}, passing ${passing.join('/')}`);
}

// ---- contract: every variant paints; anchors, contact metadata, mirrors, determinism
const lowest = (s) => { for (let y = s.h - 1; y >= 0; y--) for (let x = 0; x < s.w; x++) if (s.data[y * s.w + x]) return y; return -1; };
const anchorBad = [], contactBad = [], mirrorBad = [], detBad = [], sizeBad = [], paintBad = [];
for (const [pose, n] of Object.entries(CREATURE_FRAMES)) for (let frame = 0; frame < n; frame++) {
  for (const facing of ['se', 'sw', 'ne', 'nw']) for (const lean of [-1, 0, 1]) {
    const s = sprites.creature({ pose, frame, facing, lean });
    if (!s || !(s.data instanceof Uint8Array) || s.data.length !== s.w * s.h || s.h < 30 || !s.data.some(Boolean)) paintBad.push(`${pose}/${frame}/${facing}/${lean}`);
  }
  for (const facing of ['se', 'ne']) {
    const d = creatureDebug({ pose, frame, facing, lean: 0 }), s = d.sprite;
    const tag = `${pose}/${frame}/${facing}`;
    if (s.contact !== CREATURE_CONTACT[pose]) contactBad.push(`${tag}: ${s.contact}`);
    if (Math.abs(lowest(s) - s.ay) > 1) anchorBad.push(`${tag}: anchor row ${s.ay}, lowest ${lowest(s)}`);
    if (s.contact === 'feet') {
      const mid = (m) => { let sx = 0, k = 0; m.forEach((v, i) => { if (v) { sx += i % s.w; k++; } }); return k ? sx / k : NaN; };
      const c = (mid(d.masks.footA) + mid(d.masks.footB)) / 2;
      if (!(Math.abs(s.ax - c) <= 3)) anchorBad.push(`${tag}: ax ${s.ax}, feet midpoint ${c.toFixed(1)}`);
    } else {
      let pl = -1; d.masks.pelvis.forEach((v, i) => { if (v) pl = Math.max(pl, Math.floor(i / s.w)); });
      if (Math.abs(s.ax - d.seat[0]) > 3) anchorBad.push(`${tag}: seat ax ${s.ax}, pelvis x ${d.seat[0].toFixed(1)}`);
      if (s.ay - pl > 2) anchorBad.push(`${tag}: pelvis bottom row ${pl} is ${s.ay - pl} px above the anchor row`);
    }
    if (pose !== 'sleep' && (s.ay < 52 || s.ay > 92)) sizeBad.push(`${tag}: ${s.ay + 1} px`);
    const again = sprites.creature({ pose, frame, facing, lean: 0 });
    if (again.w !== s.w || again.h !== s.h || again.ax !== s.ax || again.data.some((v, i) => v !== s.data[i])) detBad.push(tag);
    const m = sprites.creature({ pose, frame, facing: facing === 'se' ? 'sw' : 'nw', lean: 0 });
    let same = m.w === s.w && m.h === s.h && m.ax === s.w - 1 - s.ax && m.ay === s.ay && m.contact === s.contact;
    for (let y = 0; same && y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.data[y * s.w + x] !== m.data[y * s.w + s.w - 1 - x]) { same = false; break; }
    if (!same) mirrorBad.push(tag);
  }
}
check('every pose x frame x facing x lean paints a valid sprite', paintBad.length === 0, paintBad.slice(0, 6).join(', '));
check('contact metadata matches CREATURE_CONTACT', contactBad.length === 0, contactBad.join('; '));
check('anchors: feet midpoint +-3 (standing) or pelvis ground contact (seated)', anchorBad.length === 0, anchorBad.join('; '));
check('sw / nw mirror se / ne', mirrorBad.length === 0, mirrorBad.join(', '));
check('deterministic', detBad.length === 0, detBad.join(', '));
check('pose sizes sane', sizeBad.length === 0, sizeBad.join(', '));
const SPEC_POSES = ['idle', 'walk', 'eat', 'throw', 'smash', 'haul', 'water', 'play', 'sleep', 'poop', 'weak', 'happy', 'hurt'];
check('13 spec poses, walk >= 6, idle >= 2, others 3-6',
  Object.keys(CREATURE_FRAMES).length === 13 && SPEC_POSES.every((p) => CREATURE_FRAMES[p] >= 1)
  && CREATURE_FRAMES.walk >= 6 && CREATURE_FRAMES.idle >= 2
  && SPEC_POSES.filter((p) => p !== 'walk' && p !== 'idle').every((p) => CREATURE_FRAMES[p] >= 3 && CREATURE_FRAMES[p] <= 6),
  JSON.stringify(CREATURE_FRAMES));
check('dung item paints', (() => { const s = sprites.dung({}); return s && s.data.some(Boolean) && s.w <= 12; })());

// ---- paint time: warm (after the contract pass above and one more untimed pass, so the JIT has
// compiled the painter), every variant (pose x frame x 4 facings x 3 leans) timed one by one
// through the painter itself (no registry memo; the painter keeps no per-variant result cache).
// Median under 3.5 ms and 95th percentile under 5 ms.
{
  const variants = [];
  for (const [pose, n] of Object.entries(CREATURE_FRAMES)) for (let frame = 0; frame < n; frame++) {
    for (const facing of ['se', 'sw', 'ne', 'nw']) for (const lean of [-1, 0, 1]) variants.push({ pose, frame, facing, lean });
  }
  for (const v of variants) sprites.creature(v);
  const ts = variants.map((v) => { const t0 = performance.now(); sprites.creature(v); return performance.now() - t0; }).sort((a, b) => a - b);
  const q = (f) => ts[Math.min(ts.length - 1, Math.floor(f * ts.length))];
  const med = q(0.5), p95 = q(0.95);
  const detail = `${ts.length} variants: median ${med.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, max ${ts[ts.length - 1].toFixed(2)} ms`;
  check('warm paint time: median under 3.5 ms', med < 3.5, detail);
  check('warm paint time: p95 under 5 ms', p95 < 5, detail);
}

console.log(`measured idle se lean 0: height ${height}, shoulders ${shoulder}, chest ${chestW} (cross ${T0x.chest.width}), waist ${waistW} (cross ${T0x.waist.width}), hips ${hipW} (cross ${T0x.hips.width}), moss ${moss0}, blooms(+1) ${blooms}, accent ${accent}, worst joint root cover ${(ringWorst * 100).toFixed(0)}%`);
console.log(`check-creature-art: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;

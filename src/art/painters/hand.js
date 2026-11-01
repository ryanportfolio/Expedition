// The player's hand: six poses of a translucent spectral hand seen from a high three-quarter view,
// wrist up toward the sky and fingers reaching down to the grip point. Original design.
//
// Each pose is built from labelled parts (forearm + back of the hand, thumb, four fingers drawn as
// 3 px capsules along short polylines), then shaded on the `hand-glow` ramp (spectral blue-white at
// good, crimson-ash at evil through the LUT): a light core lit from the top-left, a darker rim, a
// 1 px dithered halo so the edge looks translucent without real alpha, a dissolving wrist and a few
// spark pixels; the slap adds an impact burst ahead of its fingertips. Anchor = the grip point
// (bottom of the fingertips), where src/hand/draw.js places the hand: held objects hang just below it.
import { createSprite, ellipse, polygon, line, px, trim } from '../sprite.js';
import { idx } from '../palette.js';

const RAMP = 'hand-glow';
const W = 36, H = 38, OX = 3, OY = 2; // canvas and offset of the pose coordinates below
const PALM = 1, THUMB = 2; // labels; fingers are 3..6

// Back of the hand and forearm, shared by every pose (pose coordinates).
const FOREARM = [[19, 3], [18, 7]];
const BACK = [[13, 6], [22, 6], [24, 12], [23, 18], [11, 19], [10, 12]];

// fingers: index, middle, ring, little (left to right); thumb on the left. Points are capsule centers.
const POSES = {
  'hand-open': {
    fingers: [[[12, 18], [10, 24], [9, 28]], [[15, 18], [14, 25], [14, 30]], [[18, 18], [19, 25], [19, 29]], [[21, 17], [23, 22], [24, 26]]],
    thumb: [[11, 11], [7, 16], [5, 21]],
    sparks: [[1, 9], [28, 4], [29, 17], [3, 27], [26, 31]],
  },
  'hand-grab': {
    fingers: [[[12, 18], [10, 23], [10, 26]], [[15, 18], [14, 24], [14, 27]], [[18, 18], [19, 24], [19, 26]], [[21, 17], [23, 21], [23, 24]]],
    thumb: [[11, 11], [7, 17], [8, 22]],
    curled: [0, 1, 2, 3],
    sparks: [[2, 10], [28, 6], [27, 22], [4, 28]],
  },
  'hand-hold': {
    fingers: [[[12, 18], [12, 23]], [[15, 18], [15, 24]], [[18, 18], [18, 24]], [[21, 17], [21, 22]]],
    thumb: [[11, 11], [8, 17], [10, 22]],
    curled: [0, 1, 2, 3],
    sparks: [[2, 12], [28, 5], [27, 20], [5, 26], [24, 28]],
  },
  'hand-point': {
    fingers: [[[12, 18], [10, 24], [9, 29]], [[15, 18], [15, 22]], [[18, 18], [18, 22]], [[21, 17], [21, 21]]],
    thumb: [[11, 11], [9, 16], [13, 20]],
    curled: [1, 2, 3],
    anchorFinger: 0,
    sparks: [[3, 10], [28, 7], [26, 23], [6, 30]],
  },
  'hand-stroke': {
    fingers: [[[12, 18], [9, 24], [7, 28]], [[15, 18], [12, 25], [10, 29]], [[18, 18], [15, 25], [13, 29]], [[21, 17], [19, 23], [17, 27]]],
    thumb: [[11, 11], [7, 15], [5, 18]],
    motion: [[[1, 26], [3, 26]], [[0, 29], [3, 29]], [[20, 28], [22, 28]], [[19, 31], [21, 31]]],
    sparks: [[2, 8], [28, 6], [26, 20]],
  },
  'hand-slap': {
    fingers: [[[12, 18], [13, 24], [15, 28]], [[15, 18], [16, 24], [19, 28]], [[18, 18], [20, 23], [23, 26]], [[21, 17], [24, 21], [27, 23]]],
    thumb: [[11, 11], [8, 16], [9, 21]],
    motion: [[[3, 22], [7, 26]], [[2, 26], [6, 30]], [[5, 29], [8, 31]]],
    burst: [25, 29], // impact ahead of the fingertips, on the side the hand swings toward
    sparks: [[2, 9], [29, 5], [12, 31]],
  },
};

const at = (lab, x, y) => (x >= 0 && y >= 0 && x < W && y < H ? lab[y * W + x] : 0);

/** Stamps a round brush of radius r along a polyline into the label buffer. */
function capsule(buf, pts, r, label) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let k = 0; k <= n; k++) ellipse(buf, OX + x0 + ((x1 - x0) * k) / n, OY + y0 + ((y1 - y0) * k) / n, r, r, label);
  }
}

function paintHand(name) {
  const p = POSES[name];
  const buf = createSprite(W, H);
  capsule(buf, FOREARM, 2.6, PALM);
  polygon(buf, BACK.map(([x, y]) => [x + OX, y + OY]), PALM);
  capsule(buf, p.thumb, 1.2, THUMB);
  p.fingers.forEach((f, i) => capsule(buf, f, 1, 3 + i));
  const lab = buf.data;

  // grip point: bottom of the fingertips (or of one finger), middle column
  const tips = p.anchorFinger != null ? [p.fingers[p.anchorFinger]] : p.fingers;
  const ax = OX + Math.round(tips.reduce((a, f) => a + f[f.length - 1][0], 0) / tips.length);
  const ay = OY + Math.max(...tips.map((f) => f[f.length - 1][1])) + 1;
  const s = createSprite(W, H, ax, ay);

  // core light: a lit volume centred on the back of the hand, light from the top-left
  const cx = OX + 15, cy = OY + 15, r = 15;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const l = lab[y * W + x];
    if (!l) continue;
    const nx = (x - cx) / r, ny = (y - cy) / r;
    const lit = 1 - Math.min(1, Math.hypot(nx + 0.35, ny + 0.45) * 0.85);
    const level = 4 + 3 * lit, f = level - Math.floor(level);
    // hard bands; a checker only along each band edge blends neighbouring shades
    const shade = Math.floor(level) + (Math.abs(f - 0.5) < 0.12 ? (x + y) & 1 : f > 0.5 ? 1 : 0);
    s.data[y * W + x] = idx(RAMP, Math.max(4, Math.min(7, shade)));
  }

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const l = lab[y * W + x];
    if (!l) continue;
    const L = at(lab, x - 1, y), R = at(lab, x + 1, y), U = at(lab, x, y - 1), D = at(lab, x, y + 1);
    const i = y * W + x;
    if (!L || !U || !R || !D) {
      // rim: the lit side stays mid-bright, the shadow side drops dark
      s.data[i] = idx(RAMP, !R || !D ? 2 : 4);
      continue;
    }
    // creases between thumb or finger parts (finger roots on the palm stay smooth)
    const crease = [R, D].some((o) => o !== l && !((o === PALM && l >= 3) || (l === PALM && o >= 3)));
    if (crease) s.data[i] = idx(RAMP, 3);
  }

  // curled fingers fold under: their last two rows drop into shadow
  for (const k of p.curled ?? []) {
    const f = p.fingers[k], tipY = OY + f[f.length - 1][1];
    for (let y = tipY; y <= tipY + 1; y++) for (let x = 0; x < W; x++) if (lab[y * W + x] === 3 + k && s.data[y * W + x] > idx(RAMP, 3)) s.data[y * W + x] = idx(RAMP, 3);
  }

  // dissolving wrist: thin the top rows to a dither that fades into sparks
  for (let y = 0; y < OY + 5; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!s.data[i]) continue;
    const keep = y < OY + 2 ? (x + 2 * y) % 4 === 0 : (x + y) & 1;
    s.data[i] = keep ? idx(RAMP, 6) : 0;
  }

  // halo: a 1 px dithered ring (solid where it closes a gap) reads as translucent glow on any ground
  const solid = s.data.slice();
  const has = (x, y) => x >= 0 && y >= 0 && x < W && y < H && solid[y * W + x] !== 0;
  for (let y = OY + 2; y < H; y++) for (let x = 0; x < W; x++) {
    if (solid[y * W + x]) continue;
    const L = has(x - 1, y), R = has(x + 1, y), U = has(x, y - 1), D = has(x, y + 1);
    if (!(L || R || U || D)) continue;
    if ((L && R) || (U && D) || ((x + y) & 1) === 0) s.data[y * W + x] = idx(RAMP, 1);
  }

  for (const [[x0, y0], [x1, y1]] of p.motion ?? []) line(s, OX + x0, OY + y0, OX + x1, OY + y1, idx(RAMP, 5));
  if (p.burst) {
    // impact burst: six short rays, bright near the hit and dimmer at their ends; never over the hand
    const [bx, by] = p.burst;
    const put = (x, y, k) => { if (x >= 0 && y >= 0 && x < W && y < H && !s.data[y * W + x]) px(s, x, y, idx(RAMP, k)); };
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.3, ux = Math.cos(a), uy = Math.sin(a);
      put(Math.round(OX + bx + ux * 1.6), Math.round(OY + by + uy * 1.6), 7);
      put(Math.round(OX + bx + ux * 2.9), Math.round(OY + by + uy * 2.9), k % 2 ? 5 : 6);
    }
  }
  p.sparks.forEach(([x, y], k) => {
    if (!s.data[(OY + y) * W + OX + x]) px(s, OX + x, OY + y, idx(RAMP, k % 3 === 2 ? 5 : 7));
  });
  return trim(s);
}

export const sprites = Object.fromEntries(Object.keys(POSES).map((n) => [n, () => paintHand(n)]));

// The game's one island, authored as data and built deterministically.
//
// Shape comes from the named control data below (outline blobs, a cove, a rock
// ridge, outcrops, hills, plateaus, forests, wide beaches, boulder fields, a road).
// Hash-based value noise only roughens edges and adds surface detail; the authored shapes dominate.
//
// Determinism: no Math.random, no shared RNG state, and only +, -, *, /, sqrt,
// floor and imul (no sin/cos/exp/pow, whose last bits may differ between
// engines), so node checks and every browser build the same bytes.
//
// Coordinates: tile (x, y), index y * W + x. On screen x runs down-right and y
// runs down-left, so low x + y is the back (top) of the view.
//
// Scale (step 2 of docs/gameplay-spec.md): the island's shapes were authored on a 64 x 64 grid and
// are drawn here SCALE times larger, so the island has room for towns of hundreds of villagers and
// later for several rival towns. Two kinds of layout data:
// - island-scale shapes (outline, headlands, cove, ridge, outcrops, hills, road, wild forests,
//   beaches, boulder fields) keep their 64-grid numbers and are multiplied by SCALE (L());
// - town-scale features (temples, the creature's start, village plateaus, the forests the
//   villagers cut, the temple knoll) are tile offsets from their village centre, because the
//   village sim measures its reach in tiles (workRadius, influenceR) and does not scale with the map.
// Slopes and falloffs that were per tile on the 64 grid are divided by SCALE; noise that only
// roughens edges and surfaces stays in tiles.

export const SCALE = 3;
const W = 64 * SCALE;
const H = 64 * SCALE;
const N = W * H;
const SEA = 2;
const MAX_H = 12;
const BORDER = 4; // tiles with min(x, y, W - 1 - x, H - 1 - y) <= BORDER stay water
const DEEP_H = 1;
const SHALLOW_H = SEA;

const G_DEEP = 0;
const G_SHALLOW = 1;
const G_SAND = 2;
const G_GRASS = 3;
const G_DIRT = 4;
const G_ROCK = 5;

// ---------------------------------------------------------------------------
// Authored layout
// ---------------------------------------------------------------------------

/** Island-scale shape from 64-grid numbers: x, y and r (and any `keys`) times SCALE. */
const L = (o, keys = []) => {
  const out = { ...o, x: o.x * SCALE, y: o.y * SCALE };
  if (o.r !== undefined) out.r = o.r * SCALE;
  for (const k of keys) out[k] = o[k] * SCALE;
  return out;
};
/** Polyline points [x, y, width?, ...rest]: x, y and the first `n` extras times SCALE. */
const LP = (pts, n = 0) => pts.map((p) => p.map((v, k) => (k < 2 + n ? v * SCALE : v)));

// Player village on a broad plateau on the west side; temple on a knoll behind it.
const VILLAGE = { x: 20 * SCALE, y: 40 * SCALE, r: 7, floor: 5 };
const TEMPLE = { x: VILLAGE.x - 6, y: VILLAGE.y - 5, top: 7 };
const CREATURE_START = { x: VILLAGE.x + 6, y: VILLAGE.y + 6 };

// Neutral rival village across the island on a higher eastern plateau.
const RIVAL = { x: 45 * SCALE, y: 20 * SCALE, r: 7, floor: 6 };
const RIVAL_TEMPLE = { x: RIVAL.x + 2, y: RIVAL.y - 2 };

/** Town-scale feature `dx, dy` tiles from village `v`. */
const near = (v, dx, dy, rest) => ({ x: v.x + dx, y: v.y + dy, ...rest });

// Island outline: a round-cornered core, reshaped by named headlands and bays.
const OUTLINE = { cx: 32 * SCALE, cy: 32 * SCALE, ax: 22.5 * SCALE, ay: 22.5 * SCALE };
const SHORE_BLOBS = [
  { name: 'Gull Head', x: 10, y: 10, r: 8, amp: 0.7 }, // north-west headland under the ridge
  { name: 'Rookery Point', x: 40, y: 6, r: 7, amp: 0.5 }, // north shore
  { name: 'Brackenside', x: 52, y: 13, r: 8, amp: 0.5 }, // behind the rival village
  { name: 'Lantern Point', x: 58, y: 38, r: 7, amp: 0.8 }, // east cape
  { name: 'Southrise Foreland', x: 30, y: 58, r: 8, amp: 0.6 }, // south shore, front of the view
  { name: 'Hearth Bluff', x: 7, y: 42, r: 8, amp: 0.7 }, // west shore beside the player village
  { name: 'Wester Bight', x: 3, y: 24, r: 8, amp: -0.9 }, // bay between the ridge and the village
  { name: 'Reedmouth Bay', x: 6, y: 60, r: 12, amp: -1.2 }, // south-west corner bay
  { name: 'North Reach', x: 62, y: 2, r: 10, amp: -1.0 }, // north-east corner cut
  { name: 'Back Shoal', x: 26, y: 2, r: 6, amp: -0.6 }, // dent in the north shore
  { name: 'Eastern Sound', x: 61, y: 25, r: 6, amp: -0.6 }, // between the rival lobe and the cape
].map((b) => L(b));

// A narrow cove cut in from the south-east corner. [x, y, radius].
const COVE = { name: 'Quiet Cove', pts: LP([[63, 63, 6.0], [55, 55, 4.0], [49, 50, 3.0], [44, 46, 2.2], [41, 45, 1.2]], 1) };

// Rock ridge across the back of the island. [x, y, half-width, crest height].
const RIDGES = [
  { name: 'Greyspine', pts: LP([[12, 24, 2.0, 8], [17, 17, 3.4, 12], [24, 12, 3.0, 11], [31, 10, 2.0, 8]], 1) },
];

// Small rocky knolls: cliffs in the middle of the island and a near rock source.
const OUTCROPS = [
  { name: 'Watch Crag', x: 36, y: 41, r: 2.4, crest: 8 },
  { name: 'Saltstone', x: 51, y: 31, r: 1.9, crest: 8 },
].map((o) => L(o));

// Rolling hills added to the walkable surface (amp in height units).
const HILLS = [
  ...[
    { name: 'Midsummer Downs', x: 32, y: 27, r: 9, amp: 3.0 },
    { name: 'Southrise', x: 33, y: 49, r: 7, amp: 2.0 },
    { name: 'Eastfold', x: 53, y: 30, r: 6, amp: 2.0 },
    { name: 'Gull Rise', x: 10, y: 15, r: 5, amp: 1.5 },
    { name: 'Mill Hollow', x: 29, y: 39, r: 6, amp: -2.0 }, // low meadow between the village and the downs
    { name: 'Fernbottom', x: 42, y: 33, r: 5, amp: -1.5 },
  ].map((h) => L(h)),
  { name: 'Hearth Knoll', x: TEMPLE.x, y: TEMPLE.y, r: 4.5, amp: 3.0 }, // the temple hill
];

// Dirt road from the player village over the downs to the rival village.
const ROAD = LP([[20, 40], [26, 37], [31, 32], [37, 27], [41, 23], [45, 20]]);

// Forests: density is the tree chance at the centre, falling to 0 at r.
// pine = share of pines (more pines high up).
// The villages' woods are town-scale (tile offsets from their village, within the woodcutters'
// workRadius); the wild forests between them are island-scale.
const FORESTS = [
  near(VILLAGE, -2, -11, { name: 'Hearthwood', r: 6, density: 0.85, pine: 0.2 }), // behind the player village
  near(VILLAGE, -10, -9, { name: 'Templewood', r: 4, density: 0.8, pine: 0.3 }), // behind the temple knoll
  near(VILLAGE, -11, 0, { name: 'Bluffwood', r: 4, density: 0.8, pine: 0.15 }), // west of the village
  near(VILLAGE, 3, 11, { name: 'Meadow End', r: 4.5, density: 0.8, pine: 0.1 }), // below the village, front of the view
  near(VILLAGE, 10, 6, { name: 'Kindling Copse', r: 4, density: 0.75, pine: 0.1 }),
  near(RIVAL, -6, -10, { name: 'Rookery Wood', r: 4.5, density: 0.8, pine: 0.5 }), // north of the rival village
  near(RIVAL, -11, -3, { name: 'Westerholt', r: 5, density: 0.8, pine: 0.3 }), // west of the rival village
  near(RIVAL, 6, 7, { name: 'Brackenwood', r: 5.5, density: 0.85, pine: 0.35 }), // south-east of the rival village
  ...[
    { name: 'Ridgefoot Pines', x: 26, y: 21, r: 5.5, density: 0.75, pine: 0.85 },
    { name: 'Lantern Grove', x: 50, y: 40, r: 4, density: 0.75, pine: 0.3 },
    { name: 'Covewood', x: 36, y: 52, r: 5, density: 0.7, pine: 0.15 },
  ].map((f) => L(f)),
];
const SCATTER_TREES = 0.03;

// Where the sand runs two tiles deep instead of one. Land within 2 tiles of
// water inside these circles is also kept low, at SEA + 1 where the pins allow.
const WIDE_BEACHES = [
  { name: 'Southrise Strand', x: 30, y: 56, r: 7 }, // south shore, front of the view
  { name: 'Cove Strand', x: 44, y: 46, r: 5 }, // head of Quiet Cove
  { name: 'Hearth Strand', x: 7, y: 45, r: 5 }, // west shore below the player village
].map((b) => L(b));

// Loose rock objects: density is the chance at the centre, falling to 0 at r.
// Tiles next to ridge or outcrop rock also get scree (ROCK_NEAR_CLIFF).
const BOULDER_FIELDS = [
  { name: 'Greyspine Scree', x: 19, y: 22, r: 3.5, density: 0.35 }, // front foot of the ridge
  { name: 'Gull Head Stones', x: 12, y: 11, r: 3, density: 0.25 }, // north-west headland
  { name: 'Crag Rubble', x: 39, y: 43, r: 3, density: 0.4 }, // between Watch Crag and the cove
  { name: 'Saltstone Field', x: 53, y: 34, r: 3, density: 0.35 }, // below the east outcrop
].map((b) => L(b));
const ROCK_NEAR_CLIFF = 0.3;
const SCATTER_ROCKS = 0.004; // lone stones anywhere else

// Trees and rocks sit up to this far off their tile centre so the iso view
// does not show them on a grid. Below 0.5, so each stays on its own tile.
const JITTER = 0.2;

const MIN_TREES = 150 * SCALE * SCALE;
const MIN_TREES_NEAR = 18; // per village, within NEAR_R (check needs 15)
const NEAR_R = 12;
const MIN_ROCKS = 24 * SCALE * SCALE; // check needs 20 per 64 x 64 of map

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

const SALT_COAST = 11;
const SALT_HEIGHT = 23;
const SALT_RIDGE = 37;
const SALT_SCREE = 53;
const SALT_JIT_X = 59;
const SALT_JIT_Y = 61;
const SALT_TREE = 67;
const SALT_KIND = 71;
const SALT_ROCK = 83;
const SALT_SIZE = 97;

// Integer hash of (x, y, salt) -> [0, 1).
function hash2(x, y, salt) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Smooth value noise in [-1, 1] on a lattice of `cell` tiles.
function valueNoise(x, y, cell, salt) {
  const fx0 = x / cell;
  const fy0 = y / cell;
  const gx = Math.floor(fx0);
  const gy = Math.floor(fy0);
  const fx = fx0 - gx;
  const fy = fy0 - gy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(gx, gy, salt);
  const b = hash2(gx + 1, gy, salt);
  const c = hash2(gx, gy + 1, salt);
  const d = hash2(gx + 1, gy + 1, salt);
  const top = a + (b - a) * sx;
  const bot = c + (d - c) * sx;
  return (top + (bot - top) * sy) * 2 - 1;
}

// Smooth bump: 1 at the centre, 0 at radius r and beyond.
function bump(x, y, cx, cy, r) {
  const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
  if (d2 >= r * r) return 0;
  const t = 1 - d2 / (r * r);
  return t * t;
}

// Nearest point on a polyline of [x, y, ...extra] points. Returns the distance
// and the extras linearly interpolated along the nearest segment.
function nearestOnPolyline(x, y, pts) {
  let best = Infinity;
  let bi = 0;
  let bt = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0];
    const ay = pts[i][1];
    const dx = pts[i + 1][0] - ax;
    const dy = pts[i + 1][1] - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const px = ax + dx * t - x;
    const py = ay + dy * t - y;
    const d2 = px * px + py * py;
    if (d2 < best) {
      best = d2;
      bi = i;
      bt = t;
    }
  }
  const p = pts[bi];
  const q = pts[bi + 1];
  const extra = [];
  for (let k = 2; k < p.length; k++) extra.push(p[k] + (q[k] - p[k]) * bt);
  return { d: Math.sqrt(best), extra };
}

function dist2(x, y, s) {
  return (x - s.x) * (x - s.x) + (y - s.y) * (y - s.y);
}

function inCircle(x, y, s, extra = 0) {
  const r = s.r + extra;
  return dist2(x, y, s) <= r * r;
}

function cheb(x, y, s) {
  return Math.max(Math.abs(x - s.x), Math.abs(y - s.y));
}

function onWideBeach(x, y) {
  for (const b of WIDE_BEACHES) if (dist2(x, y, b) <= b.r * b.r) return true;
  return false;
}

// Placed position of an object on tile (x, y): tile centre plus a hashed offset
// in [-JITTER, JITTER) on each axis.
function objectPos(x, y, salt) {
  return {
    px: x + 0.5 + (hash2(x, y, SALT_JIT_X + salt) * 2 - 1) * JITTER,
    py: y + 0.5 + (hash2(x, y, SALT_JIT_Y + salt) * 2 - 1) * JITTER,
  };
}

function roadDist(x, y) {
  return nearestOnPolyline(x, y, ROAD).d;
}

const DX4 = [1, -1, 0, 0];
const DY4 = [0, 0, 1, -1];

function isBorder(x, y) {
  return Math.min(x, y, W - 1 - x, H - 1 - y) <= BORDER;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function buildIsland() {
  const idx = (x, y) => y * W + x;
  const inMap = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

  // Tiles that must stay land: both village plateaus and the road corridor.
  const forced = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (isBorder(x, y)) continue;
      if (inCircle(x, y, VILLAGE, 3) || inCircle(x, y, RIVAL, 3) || roadDist(x, y) <= 1.5) forced[idx(x, y)] = 1;
    }
  }

  // 1. Land mask from the outline, shore blobs, cove and a little noise.
  const land = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (isBorder(x, y)) continue;
      if (forced[i]) {
        land[i] = 1;
        continue;
      }
      const dx = (x - OUTLINE.cx) / OUTLINE.ax;
      const dy = (y - OUTLINE.cy) / OUTLINE.ay;
      const r2 = dx * dx + dy * dy;
      const r4 = dx * dx * dx * dx + dy * dy * dy * dy;
      let f = 1 - (0.45 * r2 + 0.55 * r4); // between a circle and a rounded square
      for (const b of SHORE_BLOBS) f += b.amp * bump(x, y, b.x, b.y, b.r);
      f += 0.16 * valueNoise(x, y, 7 * SCALE, SALT_COAST) + 0.07 * valueNoise(x, y, 3, SALT_COAST + 1);
      const cove = nearestOnPolyline(x, y, COVE.pts);
      if (cove.d < cove.extra[0]) f = -1;
      if (f > 0) land[i] = 1;
    }
  }
  cleanLandMask(land, forced);

  // 2. Chebyshev distance to water for every tile (0 on water).
  const dW = chebyshevDistanceToWater(land);

  // 3. Rock: the ridge and outcrops, kept 3+ tiles from water so every coast
  //    tile can be sand, and kept off plateaus, the road and the start sites.
  const rock = new Uint8Array(N);
  const rockTarget = new Float64Array(N);
  const ridgeInfo = new Float64Array(N * 3); // per tile: distance, half-width, crest of nearest ridge
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      let bd = Infinity;
      for (const r of RIDGES) {
        const n = nearestOnPolyline(x, y, r.pts);
        if (n.d < bd) {
          bd = n.d;
          ridgeInfo[i * 3] = n.d;
          ridgeInfo[i * 3 + 1] = n.extra[0];
          ridgeInfo[i * 3 + 2] = n.extra[1];
        }
      }
      if (!land[i] || dW[i] < 3) continue;
      if (inCircle(x, y, VILLAGE, 2.5) || inCircle(x, y, RIVAL, 2.5)) continue;
      if (cheb(x, y, TEMPLE) <= 2 || cheb(x, y, CREATURE_START) <= 2 || roadDist(x, y) <= 2) continue;
      const jag = valueNoise(x, y, 3, SALT_RIDGE);
      const d = ridgeInfo[i * 3];
      const w = ridgeInfo[i * 3 + 1] + 0.6 * jag;
      if (d < w) {
        rock[i] = 1;
        rockTarget[i] = ridgeInfo[i * 3 + 2] - (d * 1.1) / SCALE + 0.4 * jag;
        continue;
      }
      for (const o of OUTCROPS) {
        const od = Math.sqrt(dist2(x, y, o));
        if (od < o.r + 0.4 * jag) {
          rock[i] = 1;
          rockTarget[i] = o.crest - (od * 1.2) / SCALE;
          break;
        }
      }
    }
  }

  // 4. Walkable heights. Target = gentle rise inland + hills + ridge foothills
  //    + plateaus. Then pins (village floors, temple top) and the coast bound the
  //    result, and a lowering pass makes every non-rock step at most 1.
  const target = new Float64Array(N);
  const pin = new Int16Array(N).fill(-1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (!land[i] || rock[i]) continue;
      let t = 3 + (Math.min(dW[i] - 1, 6 * SCALE) * 0.4) / SCALE;
      for (const h of HILLS) t += h.amp * bump(x, y, h.x, h.y, h.r);
      const rd = ridgeInfo[i * 3];
      const rw = ridgeInfo[i * 3 + 1];
      const crest = ridgeInfo[i * 3 + 2];
      const foot = crest * 0.55 - (Math.max(0, rd - rw) * 0.7) / SCALE;
      if (foot > t) t = foot;
      for (const o of OUTCROPS) {
        const of = o.crest * 0.6 - (Math.max(0, Math.sqrt(dist2(x, y, o)) - o.r) * 0.8) / SCALE;
        if (of > t) t = of;
      }
      t += 1.1 * valueNoise(x, y, 8, SALT_HEIGHT) + 0.3 * valueNoise(x, y, 4, SALT_HEIGHT + 1);
      if (dW[i] <= 2 && onWideBeach(x, y) && t > SEA + 1) t = SEA + 1; // flat strand
      if (inCircle(x, y, VILLAGE, 1)) t = VILLAGE.floor;
      if (inCircle(x, y, RIVAL, 1)) t = RIVAL.floor;
      target[i] = t;
      if (inCircle(x, y, VILLAGE)) pin[i] = VILLAGE.floor;
      if (inCircle(x, y, RIVAL)) pin[i] = RIVAL.floor;
    }
  }
  pin[idx(TEMPLE.x, TEMPLE.y)] = TEMPLE.top;
  for (const s of [VILLAGE, RIVAL, TEMPLE]) {
    const i = idx(s.x, s.y);
    if (!land[i] || rock[i]) throw new Error(`island: authored site (${s.x},${s.y}) is not walkable land`);
  }

  const height = new Uint8Array(N);
  solveWalkableHeights(land, rock, pin, target, height);

  // Rock heights: authored ridge profile, always above every walkable neighbour.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (!rock[i]) continue;
      let mx = SEA + 1;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX4[k];
        const ny = y + DY4[k];
        const j = idx(nx, ny);
        if (land[j] && !rock[j] && height[j] > mx) mx = height[j];
      }
      let h = Math.floor(rockTarget[i] + 0.5);
      if (h < mx + 1) h = mx + 1;
      if (h < 4) h = 4;
      if (h > MAX_H) h = MAX_H;
      height[i] = h;
    }
  }

  // 5. Ground.
  const ground = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (!land[i]) {
        const shallow = hasNeighbor8(land, x, y, 1);
        ground[i] = shallow ? G_SHALLOW : G_DEEP;
        height[i] = shallow ? SHALLOW_H : DEEP_H;
        continue;
      }
      if (rock[i]) {
        ground[i] = G_ROCK;
        continue;
      }
      if (dW[i] === 1 || (dW[i] === 2 && onWideBeach(x, y))) {
        ground[i] = G_SAND;
        continue;
      }
      const square = dist2(x, y, VILLAGE) <= 3.3 * 3.3 || dist2(x, y, RIVAL) <= 3.3 * 3.3;
      const onRoad = roadDist(x, y) <= 0.75;
      const scree = hasRock4(rock, x, y) && hash2(x, y, SALT_SCREE) < 0.55;
      const templeYard = x === TEMPLE.x && y === TEMPLE.y;
      ground[i] = square || onRoad || scree || templeYard ? G_DIRT : G_GRASS;
    }
  }

  // 6. Trees and rock objects.
  const blocked = new Uint8Array(N); // tiles no object may use
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (
        inCircle(x, y, VILLAGE, 1) ||
        inCircle(x, y, RIVAL, 1) ||
        cheb(x, y, TEMPLE) <= 1 ||
        cheb(x, y, RIVAL_TEMPLE) <= 1 ||
        cheb(x, y, CREATURE_START) <= 1 ||
        roadDist(x, y) <= 0.75
      ) {
        blocked[i] = 1;
      }
    }
  }

  const occupied = new Uint8Array(N);
  const rocks = placeRocks(ground, rock, blocked, occupied, height);
  const trees = placeTrees(ground, blocked, occupied, height);

  return {
    w: W,
    h: H,
    seaLevel: SEA,
    height,
    ground,
    trees,
    rocks,
    sites: {
      temple: { x: TEMPLE.x, y: TEMPLE.y },
      village: { x: VILLAGE.x, y: VILLAGE.y, r: VILLAGE.r },
      rival: { x: RIVAL.x, y: RIVAL.y, r: RIVAL.r },
      rivalTemple: { x: RIVAL_TEMPLE.x, y: RIVAL_TEMPLE.y },
      creatureStart: { x: CREATURE_START.x, y: CREATURE_START.y },
    },
  };

  // --- local helpers (closures over idx) ---

  function hasNeighbor8(mask, x, y, value) {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = x + ox;
        const ny = y + oy;
        if (inMap(nx, ny) && mask[idx(nx, ny)] === value) return true;
      }
    }
    return false;
  }

  function hasRock4(mask, x, y) {
    for (let k = 0; k < 4; k++) {
      const nx = x + DX4[k];
      const ny = y + DY4[k];
      if (inMap(nx, ny) && mask[idx(nx, ny)]) return true;
    }
    return false;
  }

  function cleanLandMask(mask, keep) {
    // Smooth: drop land spits (<= 1 land 4-neighbour), fill 1-tile notches.
    for (let pass = 0; pass < 24; pass++) {
      let changed = false;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (isBorder(x, y)) continue;
          const i = idx(x, y);
          let n = 0;
          for (let k = 0; k < 4; k++) n += mask[idx(x + DX4[k], y + DY4[k])];
          if (mask[i] && !keep[i] && n <= 1) {
            mask[i] = 0;
            changed = true;
          } else if (!mask[i] && n >= 3) {
            mask[i] = 1;
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
    // Fill lakes: water not 4-connected to the map edge becomes land.
    const seen = new Uint8Array(N);
    const queue = [];
    for (let i = 0; i < N; i++) {
      const x = i % W;
      const y = (i / W) | 0;
      if ((x === 0 || y === 0 || x === W - 1 || y === H - 1) && !mask[i]) {
        seen[i] = 1;
        queue.push(i);
      }
    }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      const x = i % W;
      const y = (i / W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX4[k];
        const ny = y + DY4[k];
        if (!inMap(nx, ny)) continue;
        const j = idx(nx, ny);
        if (!seen[j] && !mask[j]) {
          seen[j] = 1;
          queue.push(j);
        }
      }
    }
    for (let i = 0; i < N; i++) if (!mask[i] && !seen[i]) mask[i] = 1;
    // Keep only the largest 4-connected landmass.
    const comp = new Int32Array(N).fill(-1);
    const sizes = [];
    for (let s = 0; s < N; s++) {
      if (!mask[s] || comp[s] >= 0) continue;
      const id = sizes.length;
      const stack = [s];
      comp[s] = id;
      let size = 0;
      while (stack.length) {
        const i = stack.pop();
        size++;
        const x = i % W;
        const y = (i / W) | 0;
        for (let k = 0; k < 4; k++) {
          const nx = x + DX4[k];
          const ny = y + DY4[k];
          if (!inMap(nx, ny)) continue;
          const j = idx(nx, ny);
          if (mask[j] && comp[j] < 0) {
            comp[j] = id;
            stack.push(j);
          }
        }
      }
      sizes.push(size);
    }
    let main = 0;
    for (let c = 1; c < sizes.length; c++) if (sizes[c] > sizes[main]) main = c;
    for (let i = 0; i < N; i++) {
      if (mask[i] && comp[i] !== main) {
        if (keep[i]) throw new Error('island: a forced land tile is cut off from the main island');
        mask[i] = 0;
      }
    }
  }

  function chebyshevDistanceToWater(mask) {
    const d = new Int16Array(N).fill(-1);
    const queue = [];
    for (let i = 0; i < N; i++) {
      if (!mask[i]) {
        d[i] = 0;
        queue.push(i);
      }
    }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      const x = i % W;
      const y = (i / W) | 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = x + ox;
          const ny = y + oy;
          if (!inMap(nx, ny)) continue;
          const j = idx(nx, ny);
          if (d[j] < 0) {
            d[j] = d[i] + 1;
            queue.push(j);
          }
        }
      }
    }
    return d;
  }

  // Heights for non-rock land. Graph = non-rock land tiles, 4-neighbours; water
  // tiles border it at height SEA. U = coast and pin upper bound, L = pin lower
  // bound; both change by at most 1 per step, so if L <= U everywhere the
  // lowering pass ends with pins exact, coast tiles at SEA + 1 and every step <= 1.
  function solveWalkableHeights(isLand, isRock, pins, tgt, out) {
    const walk = (i) => isLand[i] && !isRock[i];
    const U = new Int16Array(N);
    const L = new Int16Array(N);
    for (let i = 0; i < N; i++) {
      U[i] = !isLand[i] ? SEA : pins[i] >= 0 ? pins[i] : 99;
      L[i] = pins[i] >= 0 ? pins[i] : SEA + 1;
    }
    relax((i, j) => {
      // upper bound flows from water and pins
      if (!walk(i) || !(walk(j) || !isLand[j])) return false;
      if (U[j] + 1 < U[i]) {
        U[i] = U[j] + 1;
        return true;
      }
      return false;
    });
    relax((i, j) => {
      if (!walk(i) || !walk(j)) return false;
      if (L[j] - 1 > L[i]) {
        L[i] = L[j] - 1;
        return true;
      }
      return false;
    });
    for (let i = 0; i < N; i++) {
      if (!walk(i)) continue;
      if (L[i] > U[i]) {
        throw new Error(
          `island: height pins unsatisfiable at (${i % W},${(i / W) | 0}): needs >= ${L[i]}, coast allows <= ${U[i]}`,
        );
      }
      let h = Math.floor(tgt[i] + 0.5);
      const hi = Math.min(U[i], MAX_H);
      if (h > hi) h = hi;
      if (h < L[i]) h = L[i];
      out[i] = h;
    }
    for (let i = 0; i < N; i++) if (!isLand[i]) out[i] = SEA;
    relax((i, j) => {
      if (!walk(i) || !(walk(j) || !isLand[j])) return false;
      if (out[j] + 1 < out[i]) {
        out[i] = out[j] + 1;
        return true;
      }
      return false;
    });
    for (let i = 0; i < N; i++) {
      if (walk(i) && (out[i] < L[i] || out[i] > U[i])) throw new Error('island: height solve left its bounds');
    }
  }

  // Repeat forward and backward sweeps of fn(i, neighbour) until nothing changes.
  function relax(fn) {
    for (let pass = 0; pass < 512; pass++) {
      let changed = false;
      for (let s = 0; s < N * 2; s++) {
        const i = s < N ? s : 2 * N - 1 - s;
        const x = i % W;
        const y = (i / W) | 0;
        for (let k = 0; k < 4; k++) {
          const nx = x + DX4[k];
          const ny = y + DY4[k];
          if (inMap(nx, ny) && fn(i, idx(nx, ny))) changed = true;
        }
      }
      if (!changed) return;
    }
    throw new Error('island: height relaxation did not converge');
  }

  function placeRocks(gr, isRock, block, occ, ht) {
    const out = [];
    const spare = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = idx(x, y);
        const g = gr[i];
        if (block[i] || g < G_SAND || g === G_ROCK) continue;
        const { px, py } = objectPos(x, y, 100);
        if (inCircle(px, py, VILLAGE) || inCircle(px, py, RIVAL)) continue;
        const nearRock = hasRock4(isRock, x, y);
        let field = 0;
        for (const b of BOULDER_FIELDS) {
          const d = b.density * (1 - dist2(x, y, b) / (b.r * b.r));
          if (d > field) field = d;
        }
        const chance = nearRock ? ROCK_NEAR_CLIFF : Math.max(field, SCATTER_ROCKS);
        const roll = hash2(x, y, SALT_ROCK);
        const s = hash2(x, y, SALT_SIZE);
        const size = nearRock ? (s < 0.45 ? 3 : 2) : field > 0 ? (s < 0.15 ? 3 : s < 0.6 ? 2 : 1) : ht[i] >= 6 ? (s < 0.5 ? 2 : 1) : 1;
        const cand = { x, y, px, py, size, score: (nearRock ? 1 : 0) + field + (1 - roll) };
        if (roll < chance) {
          out.push(cand);
          occ[i] = 1;
        } else {
          spare.push(cand);
        }
      }
    }
    // Top up deterministically if the authored chances fall short.
    spare.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
    for (const c of spare) {
      if (out.length >= MIN_ROCKS) break;
      out.push(c);
      occ[idx(c.x, c.y)] = 1;
    }
    if (out.length < MIN_ROCKS) throw new Error(`island: only ${out.length} rock spots available`);
    out.sort((a, b) => a.y - b.y || a.x - b.x);
    return out.map((c) => ({ x: c.px, y: c.py, size: c.size }));
  }

  function placeTrees(gr, block, occ, ht) {
    const picked = [];
    const spare = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = idx(x, y);
        const g = gr[i];
        if (block[i] || occ[i] || (g !== G_GRASS && g !== G_DIRT)) continue;
        const { px, py } = objectPos(x, y, 0);
        if (inCircle(px, py, VILLAGE) || inCircle(px, py, RIVAL)) continue;
        let density = SCATTER_TREES;
        let pine = ht[i] >= 7 ? 0.7 : 0.25;
        for (const f of FORESTS) {
          const d = f.density * (1 - dist2(x, y, f) / (f.r * f.r));
          if (d > density) {
            density = d;
            pine = Math.min(1, f.pine + (ht[i] >= 7 ? 0.3 : 0));
          }
        }
        if (g === G_DIRT) density *= 0.5; // keep road edges, squares and scree sparse
        const kind = hash2(x, y, SALT_KIND) < pine ? 'pine' : 'broad';
        const roll = hash2(x, y, SALT_TREE);
        const cand = { x, y, px, py, kind, score: density - roll };
        if (roll < density) picked.push(cand);
        else spare.push(cand);
      }
    }
    spare.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
    const take = (want) => {
      for (const c of spare) {
        if (want(picked)) return;
        if (c.taken) continue;
        if (!c.ok || c.ok(c)) {
          c.taken = true;
          picked.push(c);
        }
      }
    };
    // Guarantee wood near both villages, then the island-wide total.
    for (const v of [VILLAGE, RIVAL]) {
      // Measured from the tree's placed (jittered) position, as the check does.
      const near = (c) => dist2(c.px, c.py, v) <= NEAR_R * NEAR_R;
      for (const c of spare) c.ok = near;
      take((p) => p.filter(near).length >= MIN_TREES_NEAR);
      if (picked.filter(near).length < MIN_TREES_NEAR) throw new Error('island: not enough tree spots near a village');
    }
    for (const c of spare) c.ok = null;
    take((p) => p.length >= MIN_TREES);
    if (picked.length < MIN_TREES) throw new Error(`island: only ${picked.length} tree spots available`);
    for (const c of picked) occ[idx(c.x, c.y)] = 1;
    picked.sort((a, b) => a.y - b.y || a.x - b.x);
    return picked.map((c) => ({ x: c.px, y: c.py, kind: c.kind }));
  }
}

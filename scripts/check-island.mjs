// Checks the island data from src/world/island.js against every layout rule,
// prints an ASCII map and a height dump, and exits non-zero on any failure.
//
//   node scripts/check-island.mjs            full report
//   node scripts/check-island.mjs --quiet    pass/fail lines only
//
// The check also runs itself against deliberately broken copies of the island
// and fails if any rule misses the break it is meant to catch.

import { buildIsland, SCALE } from '../src/world/island.js';

const W = 64 * SCALE;
const N = W * W;
const MIN_TREES = 150 * SCALE * SCALE;
const MIN_ROCKS = 20 * SCALE * SCALE;

const quiet = process.argv.includes('--quiet');

const GROUND_NAMES = ['deep', 'shallow', 'sand', 'grass', 'dirt', 'rock'];
const isWater = (g) => g === 0 || g === 1;
const isLandG = (g) => g >= 2 && g <= 5;
const isWalkG = (g) => g === 2 || g === 3 || g === 4;

const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// ---------------------------------------------------------------------------
// Rules. Each returns a list of problem strings; empty = pass.
// ---------------------------------------------------------------------------

function shapeProblems(m) {
  const p = [];
  if (!m || typeof m !== 'object') return ['buildIsland() did not return an object'];
  if (m.w !== W || m.h !== W) p.push(`size is ${m.w}x${m.h}, want ${W}x${W}`);
  if (m.seaLevel !== 2) p.push(`seaLevel is ${m.seaLevel}, want 2`);
  if (!(m.height instanceof Uint8Array) || m.height.length !== N) p.push(`height is not a Uint8Array(${N})`);
  if (!(m.ground instanceof Uint8Array) || m.ground.length !== N) p.push(`ground is not a Uint8Array(${N})`);
  if (!Array.isArray(m.trees)) p.push('trees is not an array');
  if (!Array.isArray(m.rocks)) p.push('rocks is not an array');
  const s = m.sites || {};
  for (const k of ['temple', 'village', 'rival', 'rivalTemple', 'creatureStart']) {
    const v = s[k];
    if (!v || !Number.isInteger(v.x) || !Number.isInteger(v.y) || v.x < 0 || v.y < 0 || v.x > W - 1 || v.y > W - 1) {
      p.push(`sites.${k} missing or not an integer tile inside the map`);
    }
  }
  for (const k of ['village', 'rival']) if (s[k] && typeof s[k].r !== 'number') p.push(`sites.${k}.r missing`);
  if (p.length) return p;
  for (let i = 0; i < N; i++) {
    if (m.height[i] > 15) p.push(`height ${m.height[i]} at ${xy(i)} is over 15`);
    if (m.ground[i] > 5) p.push(`ground ${m.ground[i]} at ${xy(i)} is not 0..5`);
    if (p.length > 5) break;
  }
  const objOk = (o) => typeof o.x === 'number' && typeof o.y === 'number' && o.x >= 0 && o.y >= 0 && o.x < W && o.y < W;
  m.trees.forEach((t, n) => {
    if (!objOk(t)) p.push(`tree ${n} position (${t.x},${t.y}) is outside the map`);
    else if (t.kind !== 'pine' && t.kind !== 'broad') p.push(`tree ${n} has kind ${t.kind}`);
  });
  m.rocks.forEach((r, n) => {
    if (!objOk(r)) p.push(`rock ${n} position (${r.x},${r.y}) is outside the map`);
    else if (!Number.isInteger(r.size) || r.size < 1 || r.size > 3) p.push(`rock ${n} has size ${r.size}`);
  });
  const seen = new Map();
  for (const [list, name] of [[m.trees, 'tree'], [m.rocks, 'rock']]) {
    for (const o of list) {
      if (!objOk(o)) continue;
      const k = tileOf(o);
      if (seen.has(k)) p.push(`${name} at ${xy(k)} shares its tile with a ${seen.get(k)}`);
      else seen.set(k, name);
    }
  }
  return p.slice(0, 8);
}

const RULES = [
  {
    id: 1,
    name: 'water border (every tile 0-4 tiles from the edge is water at or below sea level)',
    run(m) {
      const p = [];
      each((x, y, i) => {
        if (Math.min(x, y, W - 1 - x, W - 1 - y) > 4) return;
        if (!isWater(m.ground[i]) || m.height[i] > m.seaLevel) p.push(`(${x},${y}) is ${gname(m, i)} h${m.height[i]}`);
      });
      return p;
    },
  },
  {
    id: 2,
    name: 'water at or below sea level, land above it; shallow exactly where water touches land',
    run(m) {
      const p = [];
      each((x, y, i) => {
        const g = m.ground[i];
        if (isWater(g) && m.height[i] > m.seaLevel) p.push(`water ${xy(i)} h${m.height[i]} is above sea level`);
        if (isLandG(g) && m.height[i] <= m.seaLevel) p.push(`land ${xy(i)} h${m.height[i]} is not above sea level`);
        if (!isWater(g)) return;
        const touches = nb(x, y, D8).some((j) => isLandG(m.ground[j]));
        if (g === 1 && !touches) p.push(`shallow ${xy(i)} does not border land`);
        if (g === 0 && touches) p.push(`deep ${xy(i)} borders land`);
      });
      return p;
    },
  },
  {
    id: 3,
    name: 'sand on every land tile next to water (8-neighbour), sand only within 2 tiles of water',
    run(m) {
      const p = [];
      const dW = waterDistance(m);
      each((x, y, i) => {
        const g = m.ground[i];
        if (isLandG(g) && dW[i] === 1 && g !== 2) p.push(`${gname(m, i)} ${xy(i)} touches water but is not sand`);
        if (g === 2 && dW[i] > 2) p.push(`sand ${xy(i)} is ${dW[i]} tiles from water`);
      });
      return p;
    },
  },
  {
    id: 4,
    name: 'walkable land steps at most 1 between 4-neighbours (rock may form cliffs)',
    run(m) {
      const p = [];
      each((x, y, i) => {
        if (!isWalkG(m.ground[i])) return;
        for (const j of nb(x, y, [[1, 0], [0, 1]])) {
          if (!isWalkG(m.ground[j])) continue;
          const d = Math.abs(m.height[i] - m.height[j]);
          if (d > 1) p.push(`${xy(i)} h${m.height[i]} -> ${xy(j)} h${m.height[j]}`);
        }
      });
      return p;
    },
  },
  {
    id: 5,
    name: 'at least 4 distinct land heights, max height at most 12',
    run(m) {
      const p = [];
      const levels = new Set();
      let max = 0;
      each((x, y, i) => {
        if (m.height[i] > max) max = m.height[i];
        if (isLandG(m.ground[i])) levels.add(m.height[i]);
      });
      if (levels.size < 4) p.push(`only ${levels.size} land levels`);
      if (max > 12) p.push(`max height ${max}`);
      this.info = `${levels.size} land levels (${[...levels].sort((a, b) => a - b).join(',')}), max ${max}`;
      return p;
    },
  },
  {
    id: 6,
    name: 'land fraction between 35% and 65%',
    run(m) {
      let n = 0;
      each((x, y, i) => (n += isLandG(m.ground[i]) ? 1 : 0));
      const f = n / N;
      this.info = `${n} land tiles = ${(f * 100).toFixed(1)}%`;
      return f >= 0.35 && f <= 0.65 ? [] : [`land fraction ${(f * 100).toFixed(1)}%`];
    },
  },
  {
    id: 7,
    name: 'village and rival circles: r 6-8, walkable, flat to 1, clear of objects; temples placed',
    run(m) {
      const p = [];
      const s = m.sites;
      const objs = [...m.trees.map((t) => ['tree', t]), ...m.rocks.map((r) => ['rock', r])];
      const floors = {};
      for (const key of ['village', 'rival']) {
        const c = s[key];
        if (!(c.r >= 6 && c.r <= 8)) p.push(`${key} radius ${c.r}`);
        let lo = 99;
        let hi = -1;
        each((x, y, i) => {
          if (!inCircle(x, y, c)) return;
          if (!isWalkG(m.ground[i])) p.push(`${key} tile ${xy(i)} is ${gname(m, i)}`);
          lo = Math.min(lo, m.height[i]);
          hi = Math.max(hi, m.height[i]);
        });
        if (hi - lo > 1) p.push(`${key} heights range ${lo}..${hi}`);
        floors[key] = hi;
        for (const [kind, o] of objs) {
          const t = tileOf(o);
          const tx = t % W;
          const ty = (t / W) | 0;
          if (inCircle(tx, ty, c) || inCircle(o.x, o.y, c)) p.push(`${kind} at (${o.x},${o.y}) is inside the ${key} circle`);
        }
      }
      const v = s.village;
      const t = s.temple;
      const ti = t.y * W + t.x;
      const td = Math.hypot(t.x - v.x, t.y - v.y);
      if (td > 8) p.push(`temple is ${td.toFixed(2)} tiles from the village centre`);
      if (inCircle(t.x, t.y, v)) p.push('temple is inside the village circle');
      if (!isWalkG(m.ground[ti])) p.push(`temple tile is ${gname(m, ti)}`);
      if (m.height[ti] < floors.village + 1) p.push(`temple h${m.height[ti]} is not above the village floor h${floors.village}`);
      if (!inCircle(s.rivalTemple.x, s.rivalTemple.y, s.rival)) p.push('rival temple is outside the rival circle');
      this.info = `village floor h${floors.village}, rival floor h${floors.rival}, temple h${m.height[ti]} at ${td.toFixed(2)} tiles`;
      return p;
    },
  },
  {
    id: 8,
    name: `villages at least ${28 * SCALE} tiles apart and joined by a walkable 4-neighbour path`,
    run(m) {
      const p = [];
      const v = m.sites.village;
      const r = m.sites.rival;
      const d = Math.hypot(v.x - r.x, v.y - r.y);
      if (d < 28 * SCALE) p.push(`centres ${d.toFixed(2)} tiles apart`);
      const start = v.y * W + v.x;
      const goal = r.y * W + r.x;
      const dist = new Int32Array(N).fill(-1);
      if (isWalkG(m.ground[start])) {
        dist[start] = 0;
        const q = [start];
        for (let k = 0; k < q.length; k++) {
          const i = q[k];
          for (const j of nb(i % W, (i / W) | 0, D4)) {
            if (dist[j] >= 0 || !isWalkG(m.ground[j])) continue;
            if (Math.abs(m.height[i] - m.height[j]) > 1) continue;
            dist[j] = dist[i] + 1;
            q.push(j);
          }
        }
      }
      if (dist[goal] < 0) p.push('no walkable path from village to rival');
      this.info = `centres ${d.toFixed(2)} apart, shortest walk ${dist[goal]} steps`;
      return p;
    },
  },
  {
    id: 9,
    name: `trees >= ${MIN_TREES} on grass/dirt, none in circles, >= 15 near each village; rocks >= ${MIN_ROCKS} on land`,
    run(m) {
      const p = [];
      const s = m.sites;
      if (m.trees.length < MIN_TREES) p.push(`${m.trees.length} trees`);
      for (const t of m.trees) {
        const i = tileOf(t);
        if (m.ground[i] !== 3 && m.ground[i] !== 4) p.push(`tree at (${t.x},${t.y}) on ${gname(m, i)}`);
        for (const key of ['village', 'rival']) {
          if (inCircle(i % W, (i / W) | 0, s[key]) || inCircle(t.x, t.y, s[key])) p.push(`tree at (${t.x},${t.y}) in the ${key} circle`);
        }
      }
      const near = {};
      for (const key of ['village', 'rival']) {
        const c = s[key];
        near[key] = m.trees.filter((t) => Math.hypot(t.x - c.x, t.y - c.y) <= 12).length;
        if (near[key] < 15) p.push(`${near[key]} trees within 12 tiles of the ${key}`);
      }
      if (m.rocks.length < MIN_ROCKS) p.push(`${m.rocks.length} rocks`);
      for (const r of m.rocks) {
        const i = tileOf(r);
        if (!isLandG(m.ground[i])) p.push(`rock at (${r.x},${r.y}) on ${gname(m, i)}`);
      }
      const pines = m.trees.filter((t) => t.kind === 'pine').length;
      this.info = `${m.trees.length} trees (${pines} pine), ${near.village} near village, ${near.rival} near rival; ${m.rocks.length} rocks`;
      return p;
    },
  },
  {
    id: 10,
    name: 'creature start on walkable land, outside the village circle, within 10 tiles',
    run(m) {
      const p = [];
      const c = m.sites.creatureStart;
      const v = m.sites.village;
      const i = c.y * W + c.x;
      const d = Math.hypot(c.x - v.x, c.y - v.y);
      if (!isWalkG(m.ground[i])) p.push(`creature start is ${gname(m, i)}`);
      if (d > 10) p.push(`creature start is ${d.toFixed(2)} tiles away`);
      if (inCircle(c.x, c.y, v)) p.push('creature start is inside the village circle');
      this.info = `${d.toFixed(2)} tiles from the village centre`;
      return p;
    },
  },
];

const DETERMINISM = {
  id: 11,
  name: 'deterministic: two builds are identical',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function each(fn) {
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) fn(x, y, y * W + x);
}

function nb(x, y, dirs) {
  const out = [];
  for (const [dx, dy] of dirs) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < W && ny < W) out.push(ny * W + nx);
  }
  return out;
}

function xy(i) {
  return `(${i % W},${(i / W) | 0})`;
}

function gname(m, i) {
  return GROUND_NAMES[m.ground[i]] ?? `ground ${m.ground[i]}`;
}

function tileOf(o) {
  return Math.floor(o.y) * W + Math.floor(o.x);
}

function inCircle(x, y, c) {
  return (x - c.x) * (x - c.x) + (y - c.y) * (y - c.y) <= c.r * c.r;
}

// Chebyshev (8-neighbour) distance from each tile to the nearest water tile.
// Off-map counts as water, which matches a map whose border is all water.
function waterDistance(m) {
  const d = new Int32Array(N).fill(-1);
  const q = [];
  each((x, y, i) => {
    if (isWater(m.ground[i])) {
      d[i] = 0;
      q.push(i);
    } else if (x === 0 || y === 0 || x === W - 1 || y === W - 1) {
      d[i] = 1;
      q.push(i);
    }
  });
  for (let k = 0; k < q.length; k++) {
    const i = q[k];
    for (const j of nb(i % W, (i / W) | 0, D8)) {
      if (d[j] < 0) {
        d[j] = d[i] + 1;
        q.push(j);
      }
    }
  }
  return d;
}

function fnv(h, byte) {
  return Math.imul(h ^ byte, 0x01000193) >>> 0;
}

function hashIsland(m) {
  let h = 0x811c9dc5;
  for (const b of m.height) h = fnv(h, b);
  for (const b of m.ground) h = fnv(h, b);
  const rest = JSON.stringify({ w: m.w, h: m.h, seaLevel: m.seaLevel, trees: m.trees, rocks: m.rocks, sites: m.sites });
  for (let i = 0; i < rest.length; i++) h = fnv(h, rest.charCodeAt(i) & 0xff);
  return h.toString(16).padStart(8, '0');
}

function sameIsland(a, b) {
  if (a.height.length !== b.height.length || a.ground.length !== b.ground.length) return false;
  for (let i = 0; i < a.height.length; i++) if (a.height[i] !== b.height[i] || a.ground[i] !== b.ground[i]) return false;
  const rest = (m) => JSON.stringify({ w: m.w, h: m.h, seaLevel: m.seaLevel, trees: m.trees, rocks: m.rocks, sites: m.sites });
  return rest(a) === rest(b);
}

function runRules(m) {
  const shape = shapeProblems(m);
  if (shape.length) return { shape, results: [] };
  return {
    shape,
    results: RULES.map((r) => {
      const ctx = { info: '' };
      const problems = r.run.call(ctx, m);
      return { id: r.id, name: r.name, problems, info: ctx.info };
    }),
  };
}

function clone(m) {
  return {
    ...m,
    height: new Uint8Array(m.height),
    ground: new Uint8Array(m.ground),
    trees: m.trees.map((t) => ({ ...t })),
    rocks: m.rocks.map((r) => ({ ...r })),
    sites: JSON.parse(JSON.stringify(m.sites)),
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function asciiMap(m) {
  const chars = [];
  each((x, y, i) => {
    let c = '~-.,:^'[m.ground[i]] ?? '?';
    if (inCircle(x, y, m.sites.village)) c = 'V';
    else if (inCircle(x, y, m.sites.rival)) c = 'R';
    chars[i] = c;
  });
  for (const r of m.rocks) chars[tileOf(r)] = 'o';
  for (const t of m.trees) chars[tileOf(t)] = 'T';
  for (const s of [m.sites.temple, m.sites.rivalTemple]) chars[s.y * W + s.x] = '*';
  const c = m.sites.creatureStart;
  chars[c.y * W + c.x] = 'C';
  const lines = ['     ' + colRuler(), ];
  for (let y = 0; y < W; y++) lines.push(String(y).padStart(3, ' ') + '  ' + chars.slice(y * W, y * W + W).join(''));
  return lines.join('\n');
}

function heightDump(m) {
  const lines = ['     ' + colRuler()];
  for (let y = 0; y < W; y++) {
    let row = '';
    for (let x = 0; x < W; x++) row += m.height[y * W + x].toString(16);
    lines.push(String(y).padStart(3, ' ') + '  ' + row);
  }
  return lines.join('\n');
}

function colRuler() {
  let s = '';
  for (let x = 0; x < W; x++) s += x % 10 === 0 ? String(((x / 10) | 0) % 10) : ' ';
  return s;
}

// Each mutation breaks one rule on a copy of the island; the rule must catch it.
function selfTest(base) {
  const v = base.sites.village;
  const r = base.sites.rival;
  const firstWalkInCircle = (m, c) => {
    for (let i = 0; i < N; i++) if (inCircle(i % W, (i / W) | 0, c) && isWalkG(m.ground[i])) return i;
    return -1;
  };
  const firstLandPairStep = (m) => {
    for (let i = 0; i < N; i++) {
      if (m.ground[i] !== 3) continue;
      const x = i % W;
      if (x < W - 1 && m.ground[i + 1] === 3) return i;
    }
    return -1;
  };
  const cases = [
    { rule: 1, what: 'land on the border', mut: (m) => { m.ground[2 * W + 30] = 3; m.height[2 * W + 30] = 3; } },
    { rule: 2, what: 'deep water next to land', mut: (m) => { const i = m.ground.indexOf(1); m.ground[i] = 0; } },
    { rule: 2, what: 'land at sea level', mut: (m) => { const i = m.ground.indexOf(3); m.height[i] = m.seaLevel; } },
    { rule: 3, what: 'grass on the shore', mut: (m) => { const i = m.ground.indexOf(2); m.ground[i] = 3; } },
    { rule: 3, what: 'sand far inland', mut: (m) => { m.ground[v.y * W + v.x] = 2; } },
    { rule: 4, what: 'a 2-high step on grass', mut: (m) => { const i = firstLandPairStep(m); m.height[i + 1] = m.height[i] + 2; } },
    { rule: 5, what: 'a peak of 13', mut: (m) => { const i = m.ground.indexOf(5); m.height[i] = 13; } },
    { rule: 5, what: 'flat land', mut: (m) => { for (let i = 0; i < N; i++) if (isLandG(m.ground[i])) m.height[i] = 3 + (i % 2); } },
    { rule: 6, what: 'too much land', mut: (m) => { each((x, y, i) => { if (Math.min(x, y, W - 1 - x, W - 1 - y) > 4) m.ground[i] = 3; }); } },
    { rule: 7, what: 'a tree in the village', mut: (m) => { m.trees[0].x = v.x + 0.5; m.trees[0].y = v.y + 0.5; } },
    { rule: 7, what: 'uneven village floor', mut: (m) => { m.height[firstWalkInCircle(m, v)] += 2; } },
    { rule: 7, what: 'temple level with the village', mut: (m) => { const t = m.sites.temple; m.height[t.y * W + t.x] = m.height[v.y * W + v.x]; } },
    { rule: 7, what: 'rival temple outside its circle', mut: (m) => { m.sites.rivalTemple = { x: r.x + 9, y: r.y }; } },
    { rule: 8, what: 'villages too close', mut: (m) => { m.sites.rival = { ...r, x: v.x + 20 * SCALE, y: v.y }; } },
    { rule: 8, what: 'rival walled off by rock', mut: (m) => { each((x, y, i) => { const d = Math.hypot(x - r.x, y - r.y); if (d > r.r + 0.5 && d < r.r + 1.6) m.ground[i] = 5; }); } },
    { rule: 9, what: 'too few trees', mut: (m) => { m.trees.length = MIN_TREES - 1; } },
    { rule: 9, what: 'a tree on sand', mut: (m) => { const i = m.ground.indexOf(2); m.trees[0].x = (i % W) + 0.5; m.trees[0].y = ((i / W) | 0) + 0.5; } },
    { rule: 9, what: 'no trees near the rival', mut: (m) => { m.trees = m.trees.filter((t) => Math.hypot(t.x - r.x, t.y - r.y) > 12); } },
    { rule: 9, what: 'too few rocks', mut: (m) => { m.rocks.length = MIN_ROCKS - 1; } },
    { rule: 10, what: 'creature start in the sea', mut: (m) => { m.sites.creatureStart = { x: 1, y: 1 }; } },
  ];
  const missed = [];
  for (const c of cases) {
    const m = clone(base);
    c.mut(m);
    const { shape, results } = runRules(m);
    const hit = shape.length > 0 || results.find((x) => x.id === c.rule)?.problems.length > 0;
    if (!hit) missed.push(`rule ${c.rule} missed: ${c.what}`);
  }
  const broken = shapeProblems({ ...clone(base), height: new Uint8Array(10) });
  if (!broken.length) missed.push('shape check missed a short height array');
  return { total: cases.length + 1, missed };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let failed = 0;
const line = (ok, id, name, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(id).padStart(2)}  ${name}${detail ? `\n          ${detail}` : ''}`);
};

let a;
let b;
try {
  a = buildIsland();
  b = buildIsland();
} catch (e) {
  console.log(`FAIL      buildIsland() threw: ${e.stack || e}`);
  process.exitCode = 1;
}

if (a) {
  const { shape, results } = runRules(a);
  line(shape.length === 0, '0', 'output shape (sizes, types, value ranges, one object per tile)', shape.join('; '));
  for (const r of results) {
    const ok = r.problems.length === 0;
    const detail = ok ? r.info : `${r.problems.length} problem(s): ${r.problems.slice(0, 6).join('; ')}`;
    line(ok, r.id, r.name, detail);
  }
  const same = sameIsland(a, b);
  const hashA = hashIsland(a);
  const hashB = hashIsland(b);
  line(same && hashA === hashB, DETERMINISM.id, DETERMINISM.name, `hash ${hashA}${same ? '' : ` vs ${hashB}`}`);

  if (shape.length === 0) {
    const st = selfTest(a);
    line(st.missed.length === 0, 'st', `check self-test: ${st.total - st.missed.length}/${st.total} planted breaks caught`, st.missed.join('; '));
    if (!quiet) {
      console.log('\nMap  ~ deep  - shallow  . sand  , grass  : dirt  ^ rock  T tree  o rock  V village  R rival  * temple  C creature\n');
      console.log(asciiMap(a));
      console.log('\nHeights (hex, one digit per tile)\n');
      console.log(heightDump(a));
    }
  }
  console.log(`\n${failed ? `${failed} check(s) FAILED` : 'all checks passed'}  island hash ${hashA}`);
  if (failed) process.exitCode = 1;
}

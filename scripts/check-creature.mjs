// Creature system check: node only, no browser. On the island with the village set up, runs the
// shared creature trial (src/creature/trial.js): spawn, two sim minutes of free choice, forced
// actions and their world effects (eat grain, water + stroke, poop, smash, haul, throw rock), a slap
// right after eating a villager followed by three starving minutes (never eats a villager again,
// goes weak, slower, no throws) and recovery on grain, then a tether. Every tick it checks the
// creature never stands in water or crosses more than 2 height in a step and never dies. Then:
// act events carry actor creature and the brain's moral weights, the same seed gives the same run.
// Extra cases: a cliff map (a 3-high cliff and a 2-then-1 ramp: it takes the ramp, never steps more
// than 2, never into water), the movement sampler catching a planted cliff jump and water tile, a
// tether next to the sea stops on the shore, a tether for another creature id is ignored, hp 0 is
// restored and a removed creature comes back. Haul delivery on a flat map (round 39): a blueprint
// removed or a woodpile wrecked while the load goes in (no crash, the load is set down), a blueprint
// one log short of a two-log load (one goes in, one is set down). Rocks: a rock the hand moved is
// offered only where it lies, and throwing it leaves one rock entity and the map's rock list; a rock
// it threw, caught by the hand and let go between ticks, lands once (round 46). Untrained defaults on seeds 13, 21, 4 (harm limits,
// grain over villagers, temples stand) and training on the same seeds (slapped twice: no harmful act
// again at hunger 1, and the key was offered to the brain; stroked: eat:villager often). Round 43: a
// slap mid eat or throw of a villager stops the act and sets the villager down alive, and a stroke at
// a haul delivery credits haul:wood as a fresh act. Runtime traps: Math.random and the browser globals
// (document, window, requestAnimationFrame, localStorage, HTMLCanvasElement, Image) are counted from
// before the game modules load through the seed 1 trial; both counts must stay 0, and a planted
// access shows the traps count. The creature sources are also scanned for Math.random and DOM names.
// Exits 1 and prints each failing check.
//
//   node scripts/check-creature.mjs
import { readFileSync, readdirSync } from 'node:fs';

// ---- runtime traps, installed before any game module loads
const TRAPPED = ['document', 'window', 'requestAnimationFrame', 'localStorage', 'HTMLCanvasElement', 'Image'];
const touched = [];
let randomCalls = 0;
const savedGlobals = new Map(TRAPPED.map((n) => [n, Object.getOwnPropertyDescriptor(globalThis, n)]));
const realRandom = Math.random;
function setTraps(on) {
  if (on) {
    for (const n of TRAPPED) Object.defineProperty(globalThis, n, { configurable: true, get() { touched.push(n); return undefined; } });
    Math.random = () => { randomCalls++; return realRandom(); };
  } else {
    for (const n of TRAPPED) { const d = savedGlobals.get(n); if (d) Object.defineProperty(globalThis, n, d); else delete globalThis[n]; }
    Math.random = realRandom;
  }
}
setTraps(true);
void globalThis.document; void globalThis.window; Math.random(); // planted: must count 2 and 1
const trapsCount = touched.length === 2 && randomCalls === 1;
touched.length = 0; randomCalls = 0;
const { createGame } = await import('../src/game.js');
const { buildIsland } = await import('../src/world/island.js');
const { creatureTrial, moveSampler } = await import('../src/creature/trial.js');
const { CREATURE } = await import('../src/creature/tunables.js');
const importTouched = [...touched], importRandom = randomCalls;
touched.length = 0; randomCalls = 0;

const fails = [];
let passes = 0;
function check(cond, msg) {
  if (cond) { passes++; console.log(`PASS ${msg}`); } else { fails.push(msg); console.log(`FAIL ${msg}`); }
  return !!cond;
}

// The art registry warns once per unknown sprite name; painters are not registered in node.
const warn = console.warn;
console.warn = (...a) => { if (!String(a[0]).startsWith('art registry:')) warn(...a); };

function newGame(seed) {
  const game = createGame({ seed });
  game.world.loadMap(buildIsland());
  game.systems.village.setup();
  game.systems.creature.setup();
  return game;
}

async function run(seed, label, { quiet = false } = {}) {
  const game = newGame(seed);
  const h = {
    step: (sec) => game.clock.run(Math.max(1, Math.round(sec / game.clock.step)), game.tick),
    assert: (cond, msg) => (quiet ? (cond ? passes++ : check(false, `${label}: ${msg}`)) : check(cond, `${label}: ${msg}`)),
    log: (...a) => { if (!quiet) console.log(`  ${label}:`, ...a); },
  };
  return { game, out: await creatureTrial(game, h) };
}

// ---- inert until setup
{
  const game = createGame({ seed: 1 });
  game.world.loadMap(buildIsland());
  game.systems.village.setup();
  game.clock.run(30, game.tick);
  check(game.world.query({ kind: 'creature' }).length === 0, 'inert until creature.setup(): no creature spawned by loading the map');
  game.systems.creature.setup();
  game.systems.creature.setup();
  game.clock.run(1, game.tick);
  check(game.world.query({ kind: 'creature' }).length === 1, 'setup() spawns exactly one creature, twice called');
  const api = game.systems.creature;
  check(api.entity && api.brain && typeof api.state === 'function' && api.state().id === api.entity.id, 'game.systems.creature exposes entity, brain and state()');
  game.world.loadMap(buildIsland());
  game.clock.run(1, game.tick);
  check(api.entity === null && game.world.query({ kind: 'creature' }).length === 0, 'a new map clears the creature until setup() again');
}

// ---- main trial, seed 1, still under the runtime traps
let a = null;
try {
  a = await run(1, 'seed 1');
} catch (err) {
  check(false, `seed 1 trial threw: ${err.stack || err}`);
}
setTraps(false);
check(trapsCount, 'runtime traps count a planted document/window access and a planted Math.random call');
check(importTouched.length === 0 && importRandom === 0, `loading the game modules reads no browser globals and calls no Math.random (${[...new Set(importTouched)].join(', ') || 'none'}, ${importRandom} random)`);
check(touched.length === 0, `setup, update and event handlers through the seed 1 trial read no browser globals (${[...new Set(touched)].join(', ') || 'none'})`);
check(randomCalls === 0, `no Math.random calls through the seed 1 trial (${randomCalls})`);

// ---- same seed again: identical run
if (a) {
  const b = await run(1, 'seed 1 again', { quiet: true });
  const same = a.out.trace.length === b.out.trace.length && a.out.trace.every((v, i) => v === b.out.trace[i]) &&
    JSON.stringify(a.out.summary) === JSON.stringify(b.out.summary);
  check(same, `deterministic: seed 1 twice gives the same path (${a.out.trace.length / 2} ticks) and the same learned table`);
}

// ---- another seed, behaviours only
try {
  await run(7, 'seed 7', { quiet: true });
  check(true, 'seed 7: the same trial passes (failures above, if any)');
} catch (err) {
  check(false, `seed 7 trial threw: ${err.stack || err}`);
}

// ---- untrained defaults (tunables harm / harmCooldown): free play costs the player village little
const STEP = 1 / 30;
const keyOf = (a) => `${a.verb}:${a.target}`;
const HARM = Object.keys(CREATURE.harm);
/** As the game boots: the terrain system loads the island itself, then village and creature setup. */
function bootGame(seed) {
  const game = createGame({ seed });
  game.systems.village.setup();
  game.systems.creature.setup();
  return game;
}
for (const seed of [13, 21, 4]) {
  const game = bootGame(seed);
  const { world, events } = game;
  const harmAt = { villager: [], building: [] };
  let deaths = 0, templeLow = Infinity, templeWrecked = 0;
  events.on('act', (a) => { const v = CREATURE.harm[keyOf(a)]; if (a.actor === 'creature' && v) harmAt[v].push(game.systems.creature.time); });
  events.on('villager-died', (p) => { if (world.get(p.id)?.owner === 'player') deaths++; });
  events.on('building-destroyed', (p) => { if (world.get(p.buildingId)?.type === 'temple') templeWrecked++; });
  const temples = world.query({ kind: 'building' }).filter((b) => b.type === 'temple');
  for (let i = 0; i < 300 * 30; i++) {
    game.tick(STEP);
    for (const t of temples) templeLow = Math.min(templeLow, t.hp);
  }
  const gaps = Object.entries(harmAt).map(([v, ts]) => [v, Math.min(Infinity, ...ts.slice(1).map((t, i) => t - ts[i]))]);
  check(deaths <= 2, `seed ${seed} untrained, 5 sim minutes: the player village loses ${deaths} villagers (at most 2)`);
  check(temples.length === 2 && templeLow > 0 && templeWrecked === 0 && temples.every((t) => world.get(t.id) === t && t.stage !== 'wrecked'),
    `seed ${seed} untrained: both temples stand (lowest hp ${templeLow.toFixed(2)}, ${templeWrecked} wrecked)`);
  check(gaps.every(([v, g]) => g >= CREATURE.harmCooldown[v] - 1e-6),
    `seed ${seed} untrained: harmful acts per victim kind at least a cooldown apart (${gaps.map(([v, g]) => `${v} ${harmAt[v].length} acts, min gap ${Number.isFinite(g) ? g.toFixed(1) : '-'} s`).join('; ')})`);
}

// ---- untrained and starving: grain beats villagers while grain is on offer; a control without
// grain shows villagers were within reach
for (const withGrain of [true, false]) {
  const game = bootGame(13);
  const { world, events } = game;
  const cs = game.systems.creature;
  const n = { 'eat:villager': 0, 'eat:grain': 0 };
  events.on('act', (a) => { if (a.actor === 'creature' && keyOf(a) in n) n[keyOf(a)]++; });
  const stock = () => {
    for (const b of world.query({ kind: 'building' })) {
      if (b.type === 'storehouse') b.grain = withGrain ? Math.max(b.grain, 30) : 0;
      if (b.type === 'field') b.growth = Math.min(b.growth, 0.5);
    }
  };
  cs.debug.holdHunger = 1;
  for (let i = 0; i < 120 * 30; i++) { if (i % 30 === 0) stock(); game.tick(STEP); }
  cs.debug.holdHunger = null;
  if (withGrain) check(n['eat:villager'] === 0 && n['eat:grain'] > 0, `untrained at hunger 1 with grain on offer: eats grain (${n['eat:grain']}), never a villager (${n['eat:villager']})`);
  else check(n['eat:villager'] > 0, `control, untrained at hunger 1 with no grain anywhere: it does eat a villager (${n['eat:villager']}), so villagers were within reach`);
}

// ---- training still decides: three strokes right after a forced act make it frequent; one slap
// makes it never happen
for (const k of HARM) {
  const count = (train) => {
    const game = bootGame(13);
    const { events } = game;
    const cs = game.systems.creature;
    game.clock.run(5 * 30, game.tick);
    let n = 0, pending = false, fed = 0;
    events.on('act', (a) => { if (a.actor === 'creature' && keyOf(a) === k) { n++; if (fed < Math.abs(train)) pending = true; } });
    if (train) {
      cs.debug.candidateFilter = (c) => c.key === k;
      for (let i = 0; i < 300 * 30 && fed < Math.abs(train); i++) {
        game.tick(STEP);
        if (pending) { pending = false; fed++; events.emit(train > 0 ? 'stroke' : 'slap', { creatureId: cs.entity.id, strength: 1 }); }
      }
      cs.debug.candidateFilter = null;
    }
    const before = n;
    game.clock.run(240 * 30, game.tick);
    return { n: n - before, fed, forbidden: cs.brain.isForbidden(k) };
  };
  const plain = count(0), stroked = count(3), slapped = count(-1);
  check(stroked.fed === 3 && stroked.n >= 5 && stroked.n >= 2 * plain.n,
    `${k}: stroked 3 times it is chosen ${stroked.n} times in 4 free minutes (untrained ${plain.n})`);
  check(slapped.fed === 1 && slapped.forbidden && slapped.n === 0, `${k}: slapped once it is never chosen in 4 free minutes (${slapped.n}, forbidden ${slapped.forbidden})`);
}

// ---- training across seeds 13, 21, 4: each harmful act forced once, then 4 sim minutes of free
// choice with feedback after every occurrence. Slapped twice, no harmful act happens again, even held
// at hunger 1. Stroked, eat:villager comes at least 3 times as often as with no feedback. (Stroked
// throw and smash are checked on seed 13 above: on seed 4 stroked smash came 3 times in this run
// and 20 times in the same run without hunger held at 0, so a per-seed bound there tests the dice.)
function trainedRun(seed, key, feedback, hunger) {
  const game = bootGame(seed);
  const { events } = game;
  const cs = game.systems.creature;
  game.clock.run(5 * 30, game.tick);
  let n = 0, pending = false;
  events.on('act', (a) => { if (a.actor === 'creature' && keyOf(a) === key) { n++; pending = true; } });
  cs.debug.candidateFilter = (c) => c.key === key;
  for (let i = 0; i < 90 * 30 && n === 0; i++) game.tick(STEP);
  cs.debug.candidateFilter = null;
  const feed = () => {
    if (!pending) return;
    pending = false;
    if (!feedback) return;
    events.emit(feedback, { creatureId: cs.entity.id, strength: 1 });
    if (feedback === 'slap') events.emit('slap', { creatureId: cs.entity.id, strength: 1 });
  };
  feed();
  const forced = n;
  // Round 43: the slap runs must give the brain the chance to choose the key, or "never again" cannot
  // fail. The untrained restraint (restrain() in src/systems/creature.js) drops eat:villager whenever
  // eat:grain is on offer, which on the island is always, so before this the key reached the brain 0
  // times. In the eat:villager slap runs grain is filtered out of the free minutes (any
  // candidateFilter also turns the restraint off), and every slap run counts the decisions that
  // offered the key to brain.choose; the check below wants at least one.
  if (feedback === 'slap' && key === 'eat:villager') cs.debug.candidateFilter = (c) => c.key !== 'eat:grain';
  let offered = 0;
  const choose = cs.brain.choose;
  cs.brain.choose = (list, now) => { if (list.some((c) => c.key === key)) offered++; return choose(list, now); };
  cs.debug.holdHunger = hunger;
  for (let i = 0; i < 240 * 30; i++) { game.tick(STEP); feed(); }
  cs.debug.holdHunger = null;
  cs.brain.choose = choose;
  cs.debug.candidateFilter = null;
  return { forced, after: n - forced, forbidden: cs.brain.isForbidden(key), offered };
}
for (const key of HARM) {
  const hunger = key === 'eat:villager' ? 0.8 : 0; // a meal needs hunger; throwing and smashing need boredom only
  for (const seed of [13, 21, 4]) {
    const slapped = trainedRun(seed, key, 'slap', 1);
    if (key === 'eat:villager') {
      const plain = trainedRun(seed, key, null, hunger), stroked = trainedRun(seed, key, 'stroke', hunger);
      check(plain.forced === 1 && stroked.forced === 1 && stroked.after >= 4 && stroked.after >= 3 * Math.max(1, plain.after),
        `seed ${seed}: stroked after each ${key}, it learns to do it often (${stroked.after} in 4 sim minutes vs ${plain.after} with no feedback)`);
    }
    check(slapped.forced === 1 && slapped.after === 0 && slapped.forbidden && slapped.offered >= 1,
      `seed ${seed}: slapped twice after ${key}, never again in 4 sim minutes at hunger 1 (${slapped.after}, forbidden ${slapped.forbidden}, offered to the brain in ${slapped.offered} decisions)`);
  }
}

// ---- a slap mid-act stops it (round 43). Slapped while it holds a villager in the eat or throw
// pose, the act is forbidden and is not finished: the villager is set down alive. Before, the slap
// forbade the key for later choices only, and the act under way still killed the villager. Seeds 1-2.
for (const key of ['eat:villager', 'throw:villager']) for (const seed of [1, 2]) {
  const game = newGame(seed);
  const { world, events } = game;
  const cs = game.systems.creature;
  cs.debug.candidateFilter = (c) => c.key === key;
  let slapped = null, after = 0;
  events.on('act', (a) => { if (slapped && a.actor === 'creature' && keyOf(a) === key) after++; });
  for (let i = 0; i < 120 * 30 && !slapped; i++) {
    game.tick(STEP);
    const st = cs.state();
    if (st.action?.key === key && st.action.phase === 'do') {
      slapped = { victim: world.get(st.action.target.id) };
      events.emit('slap', { creatureId: cs.entity.id, strength: 1 });
    }
  }
  for (let i = 0; i < 6 * 30; i++) game.tick(STEP);
  cs.debug.candidateFilter = null;
  const v = slapped?.victim;
  const last = [...cs.history].reverse().find((r) => r.key === key && r.phase !== 'choose');
  const down = v && world.get(v.id) === v && v.hp > 0 && !(v.dying > 0) && !v.held && !v.carriedBy && Math.abs(v.z - world.heightAt(v.x, v.y)) < 1e-6;
  check(slapped && cs.brain.isForbidden(key) && after === 0 && down && last?.phase === 'abort:forbidden',
    `seed ${seed}: slapped mid-${key}, the act stops (${slapped ? `${after} finished after the slap, last ${last?.phase}, villager ${v ? (down ? 'set down alive' : `hp ${v.hp}, held ${!!v.held}, dying ${v.dying ?? 0}`) : 'gone'}` : 'never reached the pose'})`);
}

// ---- credit for a haul lands at delivery (round 43). The player strokes the creature when it puts
// the wood in, after a walk of several seconds with the load. Before, the brain's credit time was the
// pickup (the first arrival), so a stroke at delivery came 8-9 s later and credit, which decays
// exp(-age / creditTau) and ends at creditWindow, moved haul:wood by about 0.01 of the 0.1 a fresh
// act gets (water:field got 0.053). Multi-stage acts now take their credit time from completion.
// Seeds 1-3: a far player blueprint that keeps needing wood, only haul:wood offered, one full stroke
// the tick after the delivery: the haul:wood aggregate rises by at least 0.9 of the zero-age amount
// (learnRate * aggregateRate * salience 1), so the credit is under half a second old.
for (const seed of [1, 2, 3]) {
  const game = newGame(seed);
  const { world, events } = game;
  const vs = game.systems.village, cs = game.systems.creature;
  const vc = world.sites.village;
  let id = null;
  for (let r = 2; r <= 8 && id === null; r++)
    for (let dy = -r; dy <= r && id === null; dy++)
      for (let dx = -r; dx <= r && id === null; dx++)
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r && vs.validate('house', vc.x + dx, vc.y + dy).ok) id = vs.placeBlueprint('house', vc.x + dx, vc.y + dy);
  world.get(id).woodCost = 1e6; // keeps needing wood, so every haul goes to it
  cs.debug.candidateFilter = (c) => c.key === 'haul:wood';
  const agg = () => cs.brain.table().aggregates.find((x) => x.key === 'haul:wood')?.score ?? 0;
  let delivered = null;
  events.on('act', (a) => { if (a.actor === 'creature' && a.verb === 'haul' && !delivered) delivered = { t: cs.time }; });
  let delta = null;
  for (let i = 0; i < 180 * 30 && delta === null; i++) {
    game.tick(STEP);
    if (delivered) { const a0 = agg(); events.emit('stroke', { creatureId: cs.entity.id, strength: 1 }); delta = agg() - a0; }
  }
  cs.debug.candidateFilter = null;
  const P = cs.brain.params, full = P.learnRate * P.aggregateRate;
  const start = cs.history.find((h) => h.key === 'haul:wood' && h.phase === 'start');
  check(delta !== null && delta >= 0.9 * full,
    `seed ${seed}: a stroke at the haul delivery (${start && delivered ? `${(delivered.t - start.t).toFixed(1)} s after the pickup` : 'no delivery'}) moves haul:wood by ${delta?.toFixed(3)} (want >= ${(0.9 * full).toFixed(3)}, zero-age ${full.toFixed(3)})`);
}

// ---- movement sampler self-test: it must catch a planted cliff jump and a water tile
{
  const W = 8;
  const height = new Uint8Array(W * W), ground = new Uint8Array(W * W).fill(3);
  for (let y = 0; y < W; y++) for (let x = 4; x < W; x++) height[y * W + x] = 3; // 3-high cliff at x 3|4
  ground[6 * W + 1] = 1; // water
  const game = createGame({ seed: 1 });
  game.world.loadMap({ w: W, h: W, height, ground, sites: {} });
  const ok = moveSampler(game.world);
  for (const [x, y] of [[1.5, 1.5], [2.5, 1.5], [3.5, 2.5], [3.5, 3.5]]) ok.sample(x, y); // legal moves
  check(ok.bad.water + ok.bad.step + ok.bad.jump === 0 && ok.steps === 3, `sampler passes legal moves (${JSON.stringify(ok.bad)})`);
  const cliff = moveSampler(game.world);
  cliff.sample(3.5, 2.5); cliff.sample(4.5, 2.5);
  check(cliff.bad.step === 1, `sampler catches a planted 3-high cliff step (${cliff.bad.first})`);
  const wet = moveSampler(game.world);
  wet.sample(1.5, 5.5); wet.sample(1.5, 6.5);
  check(wet.bad.water === 1, `sampler catches a planted water tile (${wet.bad.first})`);
  const hop = moveSampler(game.world);
  hop.sample(1.5, 1.5); hop.sample(3.5, 1.5);
  check(hop.bad.jump === 1, `sampler catches a planted two-tile jump (${hop.bad.first})`);
}

// ---- cliff map: a 3-high cliff and a ramp of a 2 step then a 1 step; water strip on the low side
{
  const W = 16;
  const height = new Uint8Array(W * W), ground = new Uint8Array(W * W).fill(3);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    height[i] = x < 8 ? 2 : 5; // the cliff between x 7 and 8 is 3 high
    if (y >= 12 && x === 8) height[i] = 4; // ramp: 2 -> 4 -> 5
    if (y === 6 && x < 6) ground[i] = 1; // water across most of the low side
  }
  const game = createGame({ seed: 1 });
  game.world.loadMap({ w: W, h: W, height, ground, sites: { creatureStart: { x: 2, y: 2 } } });
  const cs = game.systems.creature;
  cs.setup();
  const e = cs.entity;
  const s = moveSampler(game.world);
  game.events.emit('tether', { creatureId: e.id, x: 13.5, y: 2.5 });
  let maxY = 0, arrived = null;
  for (let i = 0; i < 90 * 30 && arrived === null; i++) {
    game.tick(1 / 30);
    s.sample(e.x, e.y);
    maxY = Math.max(maxY, e.y);
    if (cs.state().tether?.arrived) arrived = i / 30;
  }
  check(arrived !== null && Math.floor(e.x) >= 12, `cliff map: tethered across, arrived on the high side in ${arrived?.toFixed(1)} s at ${e.x.toFixed(1)},${e.y.toFixed(1)}`);
  check(maxY >= 12, `cliff map: took the ramp (reached row ${Math.floor(maxY)}), not the 3-high cliff`);
  check(s.steps > 10 && s.bad.water + s.bad.step + s.bad.jump === 0, `cliff map: ${s.steps} tile steps, none over ${CREATURE.maxStep} height or into water (${JSON.stringify(s.bad)})`);
}

// ---- tether by the sea, a tether for another creature, hp 0, removal
{
  const game = newGame(3);
  const cs = game.systems.creature;
  const { world, events } = game;
  game.clock.run(30, game.tick);
  const e = cs.entity;
  // the water tile 2 tiles straight off walkable ground the creature can reach, with water between,
  // whose shore is the cheapest to reach
  const f = cs.paths.field(Math.floor(e.y) * world.w + Math.floor(e.x));
  let sea = null, seaCost = Infinity;
  for (let i = 0; i < f.dist.length; i++) {
    if (world.ground[i] >= 2) continue;
    const x = i % world.w, y = (i / world.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x2 = x - 2 * dx, y2 = y - 2 * dy;
      if (!world.inBounds(x2, y2)) continue;
      const cost = f.dist[y2 * world.w + x2];
      if (!(cost < seaCost) || world.ground[(y - dy) * world.w + x - dx] >= 2) continue;
      sea = { x: x + 0.5, y: y + 0.5 }; seaCost = cost;
    }
  }
  check(!!sea && seaCost <= 80, `found a sea tile 2 tiles off a reachable shore (${JSON.stringify(sea)}, path cost ${seaCost.toFixed(1)})`);
  const s = moveSampler(world);
  events.emit('tether', { creatureId: e.id, x: sea.x, y: sea.y });
  let arrived = false;
  const walkFor = Math.max(45, (seaCost / CREATURE.walkSpeed) * 1.5); // seconds: the walk there with room to spare
  for (let i = 0; i < walkFor * 30 && !arrived; i++) { game.tick(1 / 30); s.sample(e.x, e.y); arrived = !!cs.state().tether?.arrived; }
  const g = world.ground[Math.floor(e.y) * world.w + Math.floor(e.x)];
  const off = Math.hypot(e.x - sea.x, e.y - sea.y);
  check(arrived && g >= 2 && g <= 4 && off <= CREATURE.tetherRadius + 0.5, `tether to the sea stops on the shore (ground ${g} at ${e.x.toFixed(1)},${e.y.toFixed(1)}, ${off.toFixed(1)} from the point)`);
  check(s.bad.water + s.bad.step + s.bad.jump === 0, `tether walk to the shore: never in water (${JSON.stringify(s.bad)})`);
  const before = JSON.stringify(cs.state().tether);
  events.emit('tether', { creatureId: e.id + 999, x: e.x + 6, y: e.y });
  events.emit('slap', { creatureId: e.id + 999, strength: 1 });
  check(JSON.stringify(cs.state().tether) === before && cs.state().feedback === null, 'tether and slap for another creature id are ignored');
  e.hp = 0;
  game.tick(1 / 30);
  check(cs.entity === e && e.hp === 1 && world.get(e.id) === e, 'hp set to 0 is back to 1 next tick');
  const at = { x: e.x, y: e.y }, brain = cs.brain;
  world.remove(e.id);
  game.tick(1 / 30);
  const e2 = cs.entity;
  check(e2 && e2 !== e && world.get(e2.id) === e2 && e2.hp === 1 && Math.hypot(e2.x - at.x, e2.y - at.y) < 0.5 && cs.brain === brain && world.query({ kind: 'creature' }).length === 1,
    `removed from the world: comes back where it stood with the same brain (${e2?.x?.toFixed(1)},${e2?.y?.toFixed(1)})`);
}

// ---- haul delivery (round 39). A flat 16x16 grass map with no village: one player destination
// building spawned by hand and one wood load beside the creature; only haul:wood of that load is
// offered. (1) The destination vanishes or stops being valid while the load is being put in: no
// crash, the whole load is set down on the ground. (2) A blueprint short of fewer logs than the load
// holds takes only what it needs; the rest is set down at the creature's feet.
function haulCase(dest, load = 2, water = () => false) {
  const W = 16;
  const game = createGame({ seed: 1 });
  const { world } = game;
  const ground = new Uint8Array(W * W).fill(3);
  for (let i = 0; i < W * W; i++) if (water(i % W, Math.floor(i / W))) ground[i] = 0;
  world.loadMap({ w: W, h: W, height: new Uint8Array(W * W).fill(1), ground, sites: { creatureStart: { x: 3, y: 3 } } });
  const cs = game.systems.creature;
  cs.setup();
  const b = world.spawn('building', { x: 11, y: 11, vx: 0, vy: 0, vz: 0, tx: 10, ty: 10, fw: 2, fh: 2, owner: 'player', hp: 1, burning: 0, flammable: false, grabbable: false, wood: 0, grain: 0, ...dest });
  const wood = world.spawn('wood', { x: 4.5, y: 3.5, vx: 0, vy: 0, vz: 0, amount: load, grabbable: true });
  cs.debug.candidateFilter = (c) => c.key === 'haul:wood' && c.target?.id === wood.id;
  /** Ticks until cond() (checked before each tick) or maxSec; true when cond() held. */
  const run = (cond, maxSec = 40) => { for (let i = 0; i < maxSec * 30; i++) { if (cond()) return true; game.tick(1 / 30); } return cond(); };
  const putting = () => cs.state().action?.key === 'haul:wood' && cs.state().action.stage === 1 && cs.state().action.phase === 'do';
  const last = () => [...cs.history].reverse().find((r) => r.key === 'haul:wood' && r.phase !== 'choose' && r.phase !== 'start');
  const onGround = (w) => !!w && !w.held && !w.carriedBy && Math.abs(w.z - world.heightAt(w.x, w.y)) < 1e-6;
  return { game, world, cs, b, wood, run, putting, last, onGround };
}
{
  const h = haulCase({ type: 'house', stage: 'blueprint', woodCost: 4, woodHave: 0 });
  const reached = h.run(h.putting);
  h.world.remove(h.b.id); // replaced by another blueprint, burned away or cleared while the load goes in
  let err = null;
  try { for (let i = 0; i < 60; i++) h.game.tick(1 / 30); } catch (e) { err = e; }
  const w = h.world.get(h.wood.id);
  check(reached && !err && h.onGround(w) && w.amount === 2 && /^abort/.test(h.last()?.phase ?? ''),
    `haul: blueprint removed while the load is put in: no crash, the whole load is set down (${err ? `threw ${err.message}` : `${h.last()?.phase}, ${w?.amount} logs, on the ground ${h.onGround(w)}`})`);
}
{
  const h = haulCase({ type: 'woodpile', stage: 'done' });
  const reached = h.run(h.putting);
  h.b.hp = 0; h.b.stage = 'wrecked'; // burned down while the load goes in
  let err = null;
  try { for (let i = 0; i < 60; i++) h.game.tick(1 / 30); } catch (e) { err = e; }
  const w = h.world.get(h.wood.id);
  check(reached && !err && h.b.wood === 0 && h.onGround(w) && w.amount === 2 && /^abort/.test(h.last()?.phase ?? ''),
    `haul: woodpile wrecked while the load is put in: nothing goes into the wreck, the load is set down (${err ? `threw ${err.message}` : `${h.last()?.phase}, pile ${h.b.wood}, ${w?.amount} logs on the ground ${h.onGround(w)}`})`);
}
{
  const h = haulCase({ type: 'house', stage: 'blueprint', woodCost: 4, woodHave: 3 });
  const done = h.run(() => h.last()?.phase === 'complete');
  const fx = h.last()?.effect;
  const w = h.world.get(h.wood.id), e = h.cs.entity;
  check(done && h.b.woodHave === 4 && h.b.stage === 'building' && fx?.field === 'woodHave' && fx.before === 3 && fx.after === 4,
    `haul: a blueprint 1 log short takes 1 of a 2-log load (woodHave ${h.b.woodHave} of ${h.b.woodCost}, stage ${h.b.stage}, effect ${JSON.stringify(fx)})`);
  check(h.onGround(w) && w.amount === 1 && Math.hypot(w.x - e.x, w.y - e.y) < 1e-6,
    `haul: the surplus log stays a wood item at the creature's feet (${w ? `${w.amount} logs, on the ground ${h.onGround(w)}, ${Math.hypot(w.x - e.x, w.y - e.y).toFixed(2)} from it` : 'gone'})`);
}
// A haul out of a woodpile takes no more than the blueprint it goes to still lacks: 3 of the pile's
// 100 for a site 3 short, so the pile keeps the rest and no surplus is left on the ground. The site
// sits within senseRadius of the creature: a woodpile haul is offered only while a site is in range.
{
  const h = haulCase({ type: 'house', stage: 'blueprint', woodCost: 10, woodHave: 7, x: 9, y: 9, tx: 8, ty: 8 });
  h.world.remove(h.wood.id);
  const pile = h.world.spawn('building', { x: 8, y: 4, vx: 0, vy: 0, vz: 0, tx: 7, ty: 3, fw: 2, fh: 2, owner: 'player', hp: 1, burning: 0, flammable: false, grabbable: false, type: 'woodpile', stage: 'done', wood: 100, grain: 0 });
  h.cs.debug.candidateFilter = (c) => c.key === 'haul:wood' && c.target?.id === pile.id;
  const done = h.run(() => h.last()?.phase === 'complete');
  const loose = h.world.query({ kind: 'wood' });
  check(done && h.b.woodHave === 10 && pile.wood === 97 && loose.length === 0,
    `haul: from a woodpile the creature takes only what the site lacks (site ${h.b.woodHave} of ${h.b.woodCost}, pile ${pile.wood} of 100, ${loose.reduce((s, w) => s + (w.amount ?? 1), 0)} logs left on the ground)`);
}
// The only site in range sits behind water (a moat of water tiles around it): with nowhere reachable
// to carry a load, the creature leaves the woodpile alone instead of taking pileHaul and dropping it.
{
  const moat = (x, y) => x >= 6 && x <= 12 && y >= 6 && y <= 12 && (x === 6 || x === 12 || y === 6 || y === 12);
  const h = haulCase({ type: 'house', stage: 'blueprint', woodCost: 10, woodHave: 7, x: 9, y: 9, tx: 8, ty: 8 }, 2, moat);
  h.world.remove(h.wood.id);
  const pile = h.world.spawn('building', { x: 8, y: 4, vx: 0, vy: 0, vz: 0, tx: 7, ty: 3, fw: 2, fh: 2, owner: 'player', hp: 1, burning: 0, flammable: false, grabbable: false, type: 'woodpile', stage: 'done', wood: 100, grain: 0 });
  h.cs.debug.candidateFilter = (c) => c.key === 'haul:wood' && c.target?.id === pile.id;
  const ended = h.run(() => /^(complete|abort)/.test(h.last()?.phase ?? ''));
  const loose = h.world.query({ kind: 'wood' });
  check(ended && h.last().phase === 'abort:no-dest' && pile.wood === 100 && loose.length === 0 && h.b.woodHave === 7,
    `haul: with the only site behind water, the woodpile is left alone (${h.last()?.phase}, pile ${pile.wood} of 100, ${loose.reduce((s, w) => s + (w.amount ?? 1), 0)} logs on the ground)`);
}

// ---- rocks (round 39): once the terrain system has made rock entities for a map, the creature
// senses only those. A rock the hand moved is offered where it lies now, never again at the map's
// original spot, and throwing it leaves the map's authored rock list alone (no second entity).
{
  const W = 16;
  const game = createGame({ seed: 1 });
  const { world } = game;
  world.loadMap({ w: W, h: W, height: new Uint8Array(W * W).fill(1), ground: new Uint8Array(W * W).fill(3), rocks: [{ x: 5.5, y: 3.5, size: 1 }], sites: { creatureStart: { x: 3, y: 3 } } });
  const cs = game.systems.creature;
  cs.setup();
  game.tick(1 / 30); // the terrain system turns the map rock into an entity
  const rock = world.query({ kind: 'rock' })[0];
  world.move(rock, 9.5, 8.5, world.heightAt(9.5, 8.5)); // the player carried it off
  const seen = [];
  cs.debug.candidateFilter = (c) => { if (c.key === 'throw:rock') seen.push(c.target); return false; };
  for (let i = 0; i < 40 * 30 && !seen.length; i++) game.tick(1 / 30); // the first decision (made before the filter) may run a while
  check(seen.length > 0 && seen.every((t) => t.id === rock.id && t.x === 9.5 && t.y === 8.5),
    `rocks: a moved rock is offered where it lies, not at its map spot (${JSON.stringify(seen.map((t) => ({ id: t.id, x: t.x, y: t.y })))}, rock #${rock.id})`);
  cs.debug.candidateFilter = (c) => c.key === 'throw:rock';
  let thrown = false;
  for (let i = 0; i < 40 * 30 && !thrown; i++) { game.tick(1 / 30); thrown = cs.history.some((r) => r.key === 'throw:rock' && r.phase === 'complete'); }
  check(thrown && world.query({ kind: 'rock' }).length === 1 && world.rocks.length === 1,
    `rocks: throwing it keeps one rock entity and the map's rock list (${thrown ? 'thrown' : 'not thrown'}, ${world.query({ kind: 'rock' }).length} entities, ${world.rocks.length} map rocks)`);
}

// ---- a rock the creature threw, caught by the hand and let go before the next tick (round 46): it
// lands once, through the hand. The creature dropped its own flight only when an update saw the
// rock held, so a press and a release between two ticks left that flight running next to the hand's:
// the rock landed through the hand, then again through the creature's stale flight.
{
  const W = 16;
  const game = createGame({ seed: 1 });
  const { world, events, camera } = game;
  game.display.setDevice(1920, 1080, 1);
  world.loadMap({ w: W, h: W, height: new Uint8Array(W * W).fill(1), ground: new Uint8Array(W * W).fill(3), rocks: [{ x: 5.5, y: 3.5, size: 1 }], sites: { creatureStart: { x: 3, y: 3 } } });
  const cs = game.systems.creature, hand = game.systems.hand, s = game.input.synth;
  cs.setup();
  game.tick(1 / 30);
  cs.debug.candidateFilter = (c) => c.key === 'throw:rock';
  let thrown = null;
  const landings = [];
  events.on('release', (p) => { if (p.by === 'creature' && p.kind === 'rock') thrown = p; });
  events.on('landed', (p) => { if (p.kind === 'rock' && thrown) landings.push(p); });
  for (let i = 0; i < 40 * 30 && !thrown; i++) game.tick(1 / 30);
  cs.debug.candidateFilter = () => false; // no second throw
  const rock = thrown && world.get(thrown.entityId);
  let caught = false;
  if (rock) {
    // catch it low on its way down: the hand looks for things around the ground point under the
    // pointer, which for a rock high in the air is tiles behind it
    // (the creature's flight moves the rock but leaves its vx/vy/vz at the launch values, so
    // "falling" is read from z)
    let zWas = rock.z;
    game.tick(1 / 30);
    for (let i = 0; i < 90 && rock.airborne && !(rock.z < zWas && rock.z - world.heightAt(rock.x, rock.y) < 2.5); i++) { zWas = rock.z; game.tick(1 / 30); }
    const flying = rock.airborne;
    camera.centerOn(rock.x, rock.y, rock.z);
    const v = camera.worldToView(rock.x, rock.y, rock.z);
    s.move(v.sx, v.sy - 1);
    s.down(0);
    caught = flying && hand.state.heldId === rock.id;
    s.up(0);
    for (let i = 0; i < 6 * 30; i++) game.tick(1 / 30);
  }
  check(rock && caught && landings.length === 1 && landings[0].by === undefined,
    `rocks: a creature-thrown rock caught and let go between ticks lands once, through the hand (${rock ? `caught ${caught}, ${landings.length} landings: ${landings.map((l) => `${l.by ?? 'hand'} at (${l.x.toFixed(2)}, ${l.y.toFixed(2)})`).join(', ')}` : 'never thrown'})`);
}

// ---- sources: no Math.random, no DOM in the creature code
{
  const files = ['src/systems/creature.js', ...readdirSync('src/creature').map((f) => `src/creature/${f}`)];
  for (const f of files) {
    const src = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
    check(!/Math\.random/.test(src), `${f}: no Math.random`);
    check(!/\b(window|document|HTMLCanvasElement|getContext)\b/.test(src), `${f}: no DOM access`);
  }
}

console.log(`\ncheck-creature: ${passes} passed, ${fails.length} failed`);
process.exitCode = fails.length ? 1 : 0;

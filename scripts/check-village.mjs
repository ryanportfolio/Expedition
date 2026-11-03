// Village simulation check: node only, no browser. Runs the island with seed 1 and checks setup,
// jobs, hauling, harvest, worship power, blueprints and construction, hand-drop reassignment,
// pathing safety, blueprint validation reasons, worship scaling, rival growth, death and wrecks,
// and determinism; then wreck clearing, pathfinding on a synthetic cliff and water map, a dropped
// wood load, the same core behaviour for seeds 2-12, and a 10-minute chaos run of hand and miracle
// abuse; recovery after fire (a rock dropped on a lost building's spot; no re-placed blueprint
// covers a rock), settlers, fire on the village every 60 s, and stone temples. Round 39: placement
// tests live rocks (a moved rock frees its map tile and blocks its new one), and villagers never
// pick up wood or fell trees that are airborne or sinking. Round 43: temples survive lightning and
// fire and worship resumes, wood or grain the hand takes from a carrier is picked up again, and
// unbuilt blueprints do not extend the village influence. Step 3: the one store and its cap, the mine
// and its miners, replanting, sapling growth, forest spread, rain seeding, ore salvage. Exits 1 and
// prints each failing check.
//
//   node scripts/check-village.mjs
import { createGame } from '../src/game.js';
import { createWorld } from '../src/world/world.js';
import { buildIsland, SCALE } from '../src/world/island.js';
import { createRng } from '../src/engine/rng.js';
import { VILLAGE, KINDS } from '../src/village/config.js';
import { createPaths } from '../src/village/path.js';
import { HAND } from '../src/hand/tunables.js';
import { CREATURE } from '../src/creature/tunables.js';
import { liveRocks } from '../src/systems/terrain.js';
import { removeTree } from '../src/village/sim.js';
import { registerPainters, getSprite } from '../src/art/registry.js';
import { readdirSync } from 'node:fs';

// Node has no Vite glob to register the painters: the village draw check needs them.
const PAINTERS = new URL('../src/art/painters/', import.meta.url);
for (const f of readdirSync(PAINTERS).filter((n) => n.endsWith('.js'))) registerPainters(await import(new URL(f, PAINTERS).href));

const fails = [];
let passes = 0;
function check(cond, msg) {
  if (cond) passes++;
  else { fails.push(msg); console.log(`FAIL ${msg}`); }
  return !!cond;
}
const MIN = 60 * 30; // ticks per sim minute
const W = 64 * SCALE;

function newGame(seed = 1) {
  const game = createGame({ seed });
  game.world.loadMap(buildIsland());
  game.systems.village.setup();
  return game;
}
const villagers = (game, owner) => game.world.query({ kind: 'villager' }).filter((v) => !owner || v.owner === owner);
const buildings = (game, owner, type) => game.world.query({ kind: 'building' }).filter((b) => b.owner === owner && (!type || b.type === type));

/** Call tick() after every sim tick: counts villager tile changes and flags any step from walkable
 * ground onto water or rock, over more than 1 height, or skipping a tile. Villagers that are held,
 * dying or for which skip(v) is true (a test moving them itself) are not sampled. */
function stepSampler(game, skip = () => false) {
  const { world } = game;
  const last = new Map();
  const s = { steps: 0, bad: 0, first: '' };
  s.tick = () => {
    for (const v of villagers(game)) {
      if (v.held || v.dying > 0 || skip(v)) { last.delete(v.id); continue; }
      const t = Math.floor(v.y) * world.w + Math.floor(v.x);
      const p = last.get(v.id);
      last.set(v.id, t);
      if (p === undefined || p === t) continue;
      s.steps++;
      const px = p % world.w, py = (p / world.w) | 0, tx = t % world.w, ty = (t / world.w) | 0;
      const g = world.ground[t], gp = world.ground[p];
      const dh = Math.abs(world.height[t] - world.height[p]);
      const adj = Math.max(Math.abs(px - tx), Math.abs(py - ty)) === 1;
      if (gp >= 2 && gp <= 4 && (g < 2 || g > 4 || dh > 1 || !adj)) {
        s.bad++;
        s.first ||= `villager #${v.id} ${px},${py} -> ${tx},${ty} ground ${g} dh ${dh}`;
      }
    }
  };
  return s;
}
/** Centre tile of the first spot in rings 2..8 around (cx, cy) where `kind` validates, or null. */
function spotNear(vs, kind, cx, cy) {
  for (let r = 2; r <= 8; r++)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (vs.validate(kind, cx + dx, cy + dy).ok) return [cx + dx, cy + dy];
    }
  return null;
}
/** Records every village event into lists by type. */
function record(game) {
  const log = { 'villager-died': [], 'building-destroyed': [], 'building-complete': [], 'building-placed': [] };
  for (const t of Object.keys(log)) game.events.on(t, (p) => log[t].push(p));
  return log;
}

// ---------------------------------------------------------------------------------------------
// 1. Setup
{
  const game = newGame();
  const { world } = game;
  const s = game.systems.village.stats();
  const temple = buildings(game, 'player', 'temple')[0];
  const rTemple = buildings(game, 'rival', 'temple')[0];
  check(temple && Math.hypot(temple.x - (world.sites.temple.x + 0.5), temple.y - (world.sites.temple.y + 0.5)) <= 2, 'player temple at sites.temple');
  check(rTemple && Math.hypot(rTemple.x - (world.sites.rivalTemple.x + 0.5), rTemple.y - (world.sites.rivalTemple.y + 0.5)) <= 2, 'rival temple at sites.rivalTemple');
  for (const owner of ['player', 'rival']) {
    const count = (t) => buildings(game, owner, t).length;
    check(count('house') >= 3 && count('store') >= 1 && count('field') >= 2 && count('mine') === 1,
      `${owner} start buildings: ${count('house')} houses, ${count('store')} store, ${count('field')} fields, ${count('mine')} mine`);
    const mine = buildings(game, owner, 'mine')[0];
    check(mine && mine.stage === 'done' && mine.ore === VILLAGE.mineOre && Math.hypot(mine.x - world.sites[owner === 'player' ? 'village' : 'rival'].x, mine.y - world.sites[owner === 'player' ? 'village' : 'rival'].y) < 16,
      `${owner} mine stands near the village holding ${mine?.ore} ore (want ${VILLAGE.mineOre})`);
    const st0 = buildings(game, owner, 'store')[0];
    check(st0 && st0.wood === VILLAGE.startWood[owner] && st0.grain === VILLAGE.startGrain[owner] && st0.ore === VILLAGE.startOre[owner],
      `${owner} store starts with the village's wood, grain and ore (${st0?.wood}, ${st0?.grain}, ${st0?.ore})`);
    check(s[owner].population >= 8 && s[owner].population <= 10, `${owner} starts with 8-10 villagers (${s[owner].population})`);
    for (const b of buildings(game, owner)) {
      let lo = 99, hi = -1, okGround = true;
      for (let y = b.ty; y < b.ty + b.fh; y++) for (let x = b.tx; x < b.tx + b.fw; x++) {
        const g = world.ground[y * W + x], h = world.height[y * W + x];
        if (g < 2 || g > 4) okGround = false;
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      check(okGround && hi - lo <= 1, `${owner} ${b.type} #${b.id} on walkable flat ground`);
      const treeIn = world.query({ kind: 'tree' }).some((t) => t.x >= b.tx && t.x < b.tx + b.fw && t.y >= b.ty && t.y < b.ty + b.fh);
      const rockIn = world.rocks.some((r) => r.x >= b.tx && r.x < b.tx + b.fw && r.y >= b.ty && r.y < b.ty + b.fh);
      check(!treeIn && !rockIn, `${owner} ${b.type} #${b.id} has no tree or rock in its footprint`);
      check(b.owner === owner && b.hp === 1 && b.flammable === (b.type !== 'mine') && b.grabbable === false, `${owner} ${b.type} carries owner/hp/flammable/grabbable (the stone mine never burns)`);
    }
    for (const v of villagers(game, owner))
      check(v.owner === owner && v.hp === 1 && v.grabbable === true && typeof v.job === 'string', `villager #${v.id} carries owner/hp/grabbable/job`);
  }
}

// ---------------------------------------------------------------------------------------------
// 2. Five sim minutes with seed 1: movement, wood, grain, power, path safety; house blueprint.
{
  const game = newGame();
  const { world } = game;
  const vs = game.systems.village;
  const start = new Map(villagers(game).map((v) => [v.id, { x: v.x, y: v.y }]));
  const sampler = stepSampler(game);
  const s0 = vs.stats();
  for (let i = 0; i < 5 * MIN; i++) { game.tick(1 / 30); sampler.tick(); }
  const s1 = vs.stats();
  const moved = villagers(game).filter((v) => start.has(v.id) && Math.hypot(v.x - start.get(v.id).x, v.y - start.get(v.id).y) > 2).length;
  check(moved >= 6, `villagers moved (${moved} moved more than 2 tiles)`);
  check(s1.player.woodDelivered > 0 && s1.player.wood > s0.player.wood, `player wood went up (delivered ${s1.player.woodDelivered}, stock ${s0.player.wood} -> ${s1.player.wood})`);
  check(s1.player.grainHarvested > 0, `player grain harvested (${s1.player.grainHarvested})`);
  check(s1.power > 0, `power > 0 (${s1.power.toFixed(2)})`);
  const jobsSeen = Object.entries(s1.player.jobs).filter(([j, n]) => n > 0 && j !== 'idle').length;
  check(jobsSeen >= 3, `player has at least 3 working jobs (${JSON.stringify(s1.player.jobs)})`);
  check(sampler.steps > 200 && sampler.bad === 0, `pathing: ${sampler.steps} tile steps, none onto water/rock, none over 1 height, none skipping a tile${sampler.first ? ` (first bad: ${sampler.first})` : ''}`);

  // House blueprint near the village: placed, hauled, built.
  const placed = [], complete = [];
  game.events.on('building-placed', (p) => placed.push(p));
  game.events.on('building-complete', (p) => complete.push(p));
  const site = world.sites.village;
  const at = spotNear(vs, 'house', site.x, site.y);
  const id = at ? vs.placeBlueprint('house', at[0], at[1]) : null;
  check(id !== null, `house blueprint placed at ${at}`);
  const house = world.get(id);
  check(house && house.stage === 'blueprint' && house.woodCost > 0, 'new house starts as a blueprint with a wood cost');
  check(placed.length === 1 && placed[0].buildingId === id && placed[0].kind === 'house', 'building-placed emitted once');
  const spent0 = vs.stats().player.woodSpent;
  let sawBuilding = false, t = 0;
  while (t < 4 * MIN && house.stage !== 'done') { game.tick(1 / 30); t++; if (house.stage === 'building') sawBuilding = true; }
  check(house.stage === 'done', `house completes within 4 sim minutes (${(t / 30).toFixed(0)} s)`);
  check(sawBuilding, 'house went blueprint -> building -> done');
  check(house.woodHave >= house.woodCost && vs.stats().player.woodSpent - spent0 >= house.woodCost, `wood hauled from the store (${vs.stats().player.woodSpent - spent0} >= cost ${house.woodCost})`);
  check(complete.some((p) => p.buildingId === id && p.kind === 'house'), 'building-complete emitted for the house');

  // Hand drop next to the temple: becomes a worshipper.
  const temple = buildings(game, 'player', 'temple')[0];
  const v = villagers(game, 'player').find((u) => u.job !== 'worshipper' && u.hp > 0);
  const dx = temple.tx + temple.fw + 0.5, dy = temple.ty + 1.5;
  game.events.emit('grab', { entityId: v.id, x: v.x, y: v.y, z: v.z });
  v.held = true; game.tick(1 / 30);
  v.held = false;
  world.move(v, dx, dy, world.heightAt(dx, dy));
  game.events.emit('release', { entityId: v.id, kind: 'villager', x: dx, y: dy, z: v.z, vx: 0, vy: 0, vz: 0 });
  game.events.emit('landed', { entityId: v.id, speed: 0.5 });
  game.clock.run(MIN / 2, game.tick);
  check(v.job === 'worshipper', `villager dropped by the temple becomes a worshipper (job ${v.job})`);
  check(v.pose === 'pray' || v.path, `dropped worshipper prays or walks to pray (pose ${v.pose})`);

  // Drop next to a field: farmer; next to a tree: forester.
  for (const [what, job] of [['field', 'farmer'], ['tree', 'forester']]) {
    const tgt = what === 'field' ? buildings(game, 'player', 'field').find((f) => f.stage === 'done')
      : world.query({ kind: 'tree', x: site.x, y: site.y, r: 12 })[0];
    const u = villagers(game, 'player').find((w) => w.job !== job && w.job !== 'worshipper' && w.hp > 0);
    if (!check(tgt && u, `found a ${what} and a villager to drop`)) continue;
    world.move(u, tgt.x + 0.6, tgt.y + 0.6);
    game.events.emit('release', { entityId: u.id, kind: 'villager', x: u.x, y: u.y, z: u.z, vx: 0, vy: 0, vz: 0 });
    game.events.emit('landed', { entityId: u.id, speed: 0.5 });
    game.clock.run(MIN / 2, game.tick);
    check(u.job === job, `villager dropped by a ${what} becomes a ${job} (job ${u.job})`);
  }
}

// ---------------------------------------------------------------------------------------------
// 3. Blueprint validation reasons.
{
  const game = newGame();
  const vs = game.systems.village;
  const { world } = game;
  const temple = buildings(game, 'player', 'temple')[0];
  const found = {};
  for (let ty = 2; ty < W - 2; ty++) for (let tx = 2; tx < W - 2; tx++) {
    const r = vs.validate('house', tx, ty);
    if (!r.ok) found[r.reason] ??= [tx, ty];
  }
  const want = {
    water: 'water',
    steep: 'too steep (height varies by more than 1)',
    overlap: 'overlaps a building',
    range: 'out of range (outside the village influence)',
  };
  for (const [k, reason] of Object.entries(want)) check(found[reason], `validation rejects ${k} with "${reason}" (e.g. ${found[reason]})`);
  const st = buildings(game, 'player', 'store')[0];
  const r1 = vs.placeBlueprint('house', st.tx, st.ty);
  check(r1 === null && vs.lastReason === want.overlap, `placing on the store returns null + "${vs.lastReason}"`);
  const r2 = vs.placeBlueprint('house', 3, 3);
  check(r2 === null && vs.lastReason === want.water, `placing in the sea returns null + "${vs.lastReason}"`);
  const [fx, fy] = found[want.range];
  check(vs.placeBlueprint('house', fx, fy) === null && Math.hypot(fx - temple.x, fy - temple.y) > VILLAGE.influenceR, 'out-of-range spot is beyond the temple influence');
  check(vs.placeBlueprint('castle', world.sites.village.x, world.sites.village.y) === null && /unknown/.test(vs.lastReason), `unknown kind rejected ("${vs.lastReason}")`);
  const unknownReason = vs.lastReason;
  check(vs.placeBlueprint('temple', world.sites.village.x, world.sites.village.y) === null && /cannot be placed/.test(vs.lastReason) && vs.lastReason !== unknownReason,
    `temple is not placeable, with its own reason ("${vs.lastReason}")`);
  const [sx, sy] = found[want.steep];
  let lo = 99, hi = -1;
  for (let y = sy; y < sy + 2; y++) for (let x = sx; x < sx + 2; x++) { lo = Math.min(lo, world.height[y * W + x]); hi = Math.max(hi, world.height[y * W + x]); }
  check(hi - lo > 1, `steep spot really has a height step over 1 (${lo}..${hi})`);
}

// ---------------------------------------------------------------------------------------------
// 4. Worship power scales with worshipper count (share 0 so only dropped villagers pray).
function worshipIncome(n) {
  const share = VILLAGE.worshipShare;
  VILLAGE.worshipShare = 0;
  try {
    const game = newGame();
    const temple = buildings(game, 'player', 'temple')[0];
    const spots = [];
    for (let y = temple.ty - 1; y <= temple.ty + temple.fh; y++)
      for (let x = temple.tx - 1; x <= temple.tx + temple.fw; x++)
        if (game.systems.village.sim.paths.walkable(x, y) && (x < temple.tx || y < temple.ty || x >= temple.tx + temple.fw || y >= temple.ty + temple.fh)) spots.push([x + 0.5, y + 0.5]);
    const list = villagers(game, 'player').slice(0, n);
    list.forEach((v, i) => {
      const [x, y] = spots[i % spots.length];
      game.world.move(v, x, y, game.world.heightAt(x, y));
      game.events.emit('release', { entityId: v.id, kind: 'villager', x, y, z: v.z, vx: 0, vy: 0, vz: 0 });
      game.events.emit('landed', { entityId: v.id, speed: 0.3 });
    });
    game.state.power = 0;
    game.clock.run(MIN, game.tick);
    return { power: game.state.power, worshippers: game.systems.village.stats().player.jobs.worshipper };
  } finally {
    VILLAGE.worshipShare = share;
  }
}
{
  const a = worshipIncome(2), b = worshipIncome(6);
  check(a.worshippers === 2 && b.worshippers === 6, `forced worshippers 2 and 6 (got ${a.worshippers}, ${b.worshippers})`);
  check(a.power > 0 && b.power >= 2.5 * a.power, `power over 60 s: 6 worshippers ${b.power.toFixed(2)} vs 2 worshippers ${a.power.toFixed(2)} (want >= 2.5x)`);
}

// ---------------------------------------------------------------------------------------------
// 5. Rival growth over 10 minutes, death, wreck, determinism.
function longRun(seed) {
  const game = newGame(seed);
  const rival0 = buildings(game, 'rival').filter((b) => b.stage === 'done').length;
  const rivalPlaced = [];
  game.events.on('building-placed', (p) => { if (p.owner === 'rival') rivalPlaced.push(p); });
  game.clock.run(10 * MIN, game.tick);
  const rival1 = buildings(game, 'rival').filter((b) => b.stage === 'done').length;
  const fp = villagers(game).map((v) => `${v.id}:${v.x.toFixed(4)},${v.y.toFixed(4)},${v.job},${v.pose}`).join('|');
  return { game, rival0, rival1, rivalPlaced, stats: game.systems.village.stats(), fp };
}
{
  const a = longRun(1);
  check(a.rival1 >= a.rival0 + 1, `rival village gains a building in 10 sim minutes (${a.rival0} -> ${a.rival1})`);
  check(a.rivalPlaced.length >= 1 && buildings(a.game, 'rival').every((b) => b.owner === 'rival'), `rival places its own blueprints (${a.rivalPlaced.map((p) => p.kind).join(', ')})`);
  const all = a.game.world.query({ kind: 'building' });
  const clash = [];
  for (const p of all) for (const q of all)
    if (p.id < q.id && p.tx < q.tx + q.fw && q.tx < p.tx + p.fw && p.ty < q.ty + q.fh && q.ty < p.ty + p.fh) clash.push(`${p.type}#${p.id}/${q.type}#${q.id}`);
  check(clash.length === 0, `no two building footprints overlap after 10 minutes (${all.length} buildings${clash.length ? `; ${clash.join(', ')}` : ''})`);
  check(a.stats.power <= VILLAGE.powerCap, `power capped at ${VILLAGE.powerCap} (${a.stats.power.toFixed(2)})`);
  const b = longRun(1);
  check(JSON.stringify(a.stats) === JSON.stringify(b.stats) && a.fp === b.fp, 'same seed twice gives identical stats and villager state');
  const c = longRun(2);
  check(c.fp !== a.fp, 'a different seed gives a different run');

  const game = a.game;
  const died = [], destroyed = [];
  game.events.on('villager-died', (p) => died.push(p));
  game.events.on('building-destroyed', (p) => destroyed.push(p));
  const v = villagers(game, 'player')[0];
  v.hp = 0;
  game.tick(1 / 30);
  check(died.length === 1 && died[0].id === v.id && typeof died[0].cause === 'string', `villager-died fired once (${JSON.stringify(died)})`);
  check(v.pose === 'dead' && game.world.get(v.id), 'dead villager lies in pose "dead" briefly');
  game.clock.run(3 * 30, game.tick);
  check(!game.world.get(v.id) && died.length === 1, 'dead villager removed, event not repeated');
  check(!game.systems.village.stats().player.population || villagers(game, 'player').every((u) => u.id !== v.id), 'dead villager not counted');

  const house = buildings(game, 'player', 'house').find((h) => h.stage === 'done');
  const cap0 = game.systems.village.stats().player.cap;
  house.hp = 0;
  game.clock.run(30, game.tick);
  check(house.stage === 'wrecked', `building with hp 0 becomes wrecked (${house.stage})`);
  check(destroyed.length === 1 && destroyed[0].buildingId === house.id && destroyed[0].kind === 'house', `building-destroyed fired once (${JSON.stringify(destroyed)})`);
  check(game.systems.village.stats().player.cap === cap0 - 3, 'wrecked house no longer raises the population cap');

  // Burning store stops working; nearby villagers flee from it and from a strike.
  const st = buildings(game, 'player', 'store')[0];
  st.burning = 1;
  const near = villagers(game, 'player').filter((u) => u.hp > 0 && Math.hypot(u.x - st.x, u.y - st.y) < 2);
  game.tick(1 / 30);
  check(near.every((u) => u.pose === 'flee' || u.held), `villagers near a burning building flee (${near.length})`);
  st.burning = 0;
  const target = villagers(game, 'rival').find((u) => u.hp > 0);
  game.events.emit('strike', { x: target.x + 0.5, y: target.y, r: 1, power: 1 });
  game.tick(1 / 30);
  check(target.pose === 'flee' && target.flee > 0, 'villager near a strike flees');
  game.clock.run(5 * 30, game.tick);
  check(target.flee <= 0 && target.pose !== 'flee', 'fear wears off after a few seconds');
}

// ---------------------------------------------------------------------------------------------
// 6. Hungry villagers slow down instead of dying; rain speeds field growth.
{
  const game = newGame();
  for (const st of game.world.query({ kind: 'building' })) if (st.type === 'store') st.grain = 0;
  for (const v of villagers(game)) v.hunger = 1;
  for (const f of game.world.query({ kind: 'building' })) if (f.type === 'store') f.hp = 0; // no food at all
  game.clock.run(MIN, game.tick);
  check(villagers(game).length > 0 && villagers(game).every((v) => v.hp > 0), 'no starvation deaths');
  const f1 = buildings(game, 'player', 'field')[0], f2 = buildings(game, 'player', 'field')[1];
  // nobody tends or harvests: a farmer caught mid-tend keeps tending until its work is cleared too
  for (const v of villagers(game)) { v.job = 'idle'; v.byHand = true; v.work = null; v.path = null; }
  f1.growth = 0; f2.growth = 0;
  game.events.emit('rain', { x: f1.x, y: f1.y, r: 1, dt: 1 / 30 });
  game.clock.run(10 * 30, game.tick);
  check(f1.growth > f2.growth * 1.5, `rain speeds field growth (${f1.growth.toFixed(3)} vs ${f2.growth.toFixed(3)})`);
}

// ---------------------------------------------------------------------------------------------
// 7. Wrecks: a new blueprint on a wrecked building clears the wreck; a temple set to hp 0 stands.
{
  const game = newGame();
  const vs = game.systems.village;
  const log = record(game);
  const house = buildings(game, 'player', 'house')[0];
  const cx = house.tx + ((house.fw - 1) >> 1), cy = house.ty + ((house.fh - 1) >> 1);
  check(vs.validate('house', cx, cy).reason === 'overlaps a building', 'a standing house blocks a blueprint on its spot');
  house.hp = 0;
  game.tick(1 / 30);
  check(house.stage === 'wrecked' && vs.stats().player.wrecked === 1, `house with hp 0 is wrecked (${house.stage})`);
  check(vs.validate('house', cx, cy).ok, `a blueprint may go on the wreck (${vs.validate('house', cx, cy).reason})`);
  const id = vs.placeBlueprint('house', cx, cy);
  const nb = id !== null && game.world.get(id);
  check(nb && nb.stage === 'blueprint' && nb.tx === house.tx && nb.ty === house.ty, 'new house blueprint sits on the old footprint');
  check(!game.world.get(house.id) && vs.stats().player.wrecked === 0, 'the wreck is cleared away');
  game.clock.run(30, game.tick);
  check(log['building-destroyed'].length === 1, `clearing a wreck does not fire building-destroyed again (${log['building-destroyed'].length})`);

  // Round 43 changed this rule. Before, a temple set to hp 0 was wrecked like any building and this
  // check asserted that the wreck still blocked blueprints. Nothing ever repaired a temple, so a wreck
  // ended worship for good. Now every hp write on a temple stops at VILLAGE.templeMinHp (stoneHp in
  // src/village/sim.js): hp 0 leaves it standing at the floor, and it still blocks blueprints.
  const temple = buildings(game, 'player', 'temple')[0];
  temple.hp = 0;
  game.tick(1 / 30);
  const tx = temple.tx + 1, ty = temple.ty + 1;
  check(temple.stage === 'done' && Math.abs(temple.hp - VILLAGE.templeMinHp) < 1e-9 && vs.validate('house', tx, ty).reason === 'overlaps a building' && game.world.get(temple.id),
    `a temple set to hp 0 stands at the floor (${temple.stage}, hp ${temple.hp}) and still blocks blueprints (${vs.validate('house', tx, ty).reason})`);
}

// ---------------------------------------------------------------------------------------------
// 8. Pathfinding on a small synthetic map that needs the height rule: a 2-high cliff with one ramp
// and a water channel with one ford. The island itself has no walkable cliffs to test against.
{
  const S = 14;
  const make = (ramp, ford) => {
    const height = new Uint8Array(S * S), ground = new Uint8Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      ground[i] = 3;
      height[i] = x < 7 ? 2 : 4; // cliff between x = 6 and x = 7
      if (ramp && y === 11 && (x === 6 || x === 7)) height[i] = 3;
      if (y === 4 && x < 7 && !(ford && x === 1)) { ground[i] = 1; height[i] = 1; } // water, one height below the land
    }
    return { w: S, h: S, seaLevel: 1, height, ground, trees: [], rocks: [], sites: {} };
  };
  const pathsFor = (map) => {
    const game = createGame({ seed: 1, worldSize: S });
    game.world.loadMap(map);
    return { world: game.world, paths: createPaths(game.world) };
  };
  const walk = (g) => g >= 2 && g <= 4;
  const stepProblems = (world, path) => {
    const bad = [];
    for (let k = 1; k < path.length; k++) {
      const a = world.tile(path[k - 1] % S, (path[k - 1] / S) | 0), b = world.tile(path[k] % S, (path[k] / S) | 0);
      if (Math.max(Math.abs(a.tx - b.tx), Math.abs(a.ty - b.ty)) !== 1) bad.push(`jump ${a.tx},${a.ty} -> ${b.tx},${b.ty}`);
      if (!walk(b.ground)) bad.push(`onto ground ${b.ground} at ${b.tx},${b.ty}`);
      if (Math.abs(a.height - b.height) > 1) bad.push(`step ${a.height} -> ${b.height} at ${b.tx},${b.ty}`);
      if (a.tx !== b.tx && a.ty !== b.ty) for (const c of [world.tile(a.tx, b.ty), world.tile(b.tx, a.ty)])
        if (!walk(c.ground) || Math.abs(c.height - a.height) > 1 || Math.abs(c.height - b.height) > 1) bad.push(`corner cut past ${c.tx},${c.ty}`);
    }
    return bad;
  };
  {
    const { world, paths } = pathsFor(make(true, true));
    const start = 1 * S + 1, goal = 1 * S + 12;
    const path = paths.find(start, goal);
    const tiles = (path ?? []).map((i) => [i % S, (i / S) | 0]);
    check(path && path[0] === start && path[path.length - 1] === goal, 'synthetic map: a route exists over the ramp and through the ford');
    check(path && tiles.some(([x, y]) => x === 1 && y === 4) && !tiles.some(([x, y]) => y === 4 && x < 7 && x !== 1), 'synthetic map: the route crosses the water only at the ford');
    check(path && tiles.some(([x, y]) => y === 11 && (x === 6 || x === 7)), 'synthetic map: the route climbs the cliff only at the ramp');
    const bad = path ? stepProblems(world, path) : ['no path'];
    check(bad.length === 0, `synthetic map: every step is on land, at most 1 height, never cuts a corner (${path?.length} tiles${bad.length ? `; ${bad.slice(0, 3).join(', ')}` : ''})`);
  }
  check(pathsFor(make(false, true)).paths.find(1 * S + 1, 1 * S + 12) === null, 'synthetic map: with no ramp the top of the cliff is unreachable (null)');
  check(pathsFor(make(true, false)).paths.find(1 * S + 1, 8 * S + 1) === null, 'synthetic map: with no ford the far bank of the water is unreachable (null)');
}
// A search runs only as far as the starts asked of it and resumes for the next (src/village/path.js):
// on the island, paths and distances from searches resumed start by start must equal those read off
// searches first run to the end, for near and far starts, unreachable ones and repeat goals; and the
// fields run to the end must equal a plain whole-map Dijkstra written here (array heap, live canStep:
// the search as it was before the typed heap and step masks), so a bug both share still shows.
{
  const world = createWorld().loadMap(buildIsland());
  const lazy = createPaths(world), full = createPaths(world);
  const reference = (goal) => {
    const W = world.w, dist = new Float64Array(W * world.h).fill(Infinity), heap = [];
    if (!full.walkable(goal % W, (goal / W) | 0)) return dist;
    dist[goal] = 0; heap.push([0, goal]);
    while (heap.length) {
      let m = 0;
      for (let k = 1; k < heap.length; k++) if (heap[k][0] < heap[m][0] || (heap[k][0] === heap[m][0] && heap[k][1] < heap[m][1])) m = k;
      const [d, i] = heap.splice(m, 1)[0];
      if (d > dist[i]) continue;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of full.D8) {
        if (!full.canStep(x, y, dx, dy)) continue;
        const j = (y + dy) * W + x + dx, nd = d + (dx && dy ? Math.SQRT2 : 1);
        if (nd < dist[j]) { dist[j] = nd; heap.push([nd, j]); }
      }
    }
    return dist;
  };
  const N = world.w * world.h, walk = [];
  for (let i = 0; i < N; i++) if (world.ground[i] >= 2 && world.ground[i] <= 4) walk.push(i);
  let seed = 11;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  const goals = Array.from({ length: 12 }, () => walk[(rnd() * walk.length) | 0]);
  let fieldBad = 0;
  for (const g of goals.slice(0, 3)) { const a = full.field(g), b = reference(g); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) fieldBad++; }
  check(fieldBad === 0, `paths: the whole field to a goal equals a plain Dijkstra over the island (3 goals, ${fieldBad} differing tiles)`);
  for (const g of goals) full.field(g); // run to the end
  let same = 0, unreachable = 0;
  const pairs = 600;
  for (let k = 0; k < pairs; k++) {
    const g = goals[(rnd() * goals.length) | 0], s = k % 20 === 0 ? (rnd() * N) | 0 : walk[(rnd() * walk.length) | 0];
    const a = lazy.find(s, g), b = full.find(s, g);
    if (JSON.stringify(a) === JSON.stringify(b) && lazy.distance(s, g) === full.distance(s, g)) same++;
    if (!b) unreachable++;
  }
  check(same === pairs && unreachable > 0 && unreachable < pairs / 2, `paths: searches resumed per start match searches run to the end (${same}/${pairs} pairs, ${unreachable} unreachable)`);
}

// ---------------------------------------------------------------------------------------------
// 9. Grabbing a wood carrier drops a loose, grabbable wood item that a forester takes to the store.
{
  const game = newGame();
  const { world } = game;
  const others = buildings(game, 'player').filter((b) => b.type !== 'store');
  const clearOf = (v) => others.every((b) => Math.hypot(Math.max(b.tx - v.x, 0, v.x - (b.tx + b.fw)), Math.max(b.ty - v.y, 0, v.y - (b.ty + b.fh))) > VILLAGE.dropRadius + 0.5);
  let v = null, item = null;
  for (let i = 0; i < 3 * MIN && !v; i++) {
    game.tick(1 / 30);
    item = world.query({ kind: 'wood' }).find((it) => {
      const c = it.carriedBy && world.get(it.carriedBy);
      return c && c.owner === 'player' && c.job === 'forester' && clearOf(c);
    });
    v = item ? world.get(item.carriedBy) : null;
  }
  if (check(v, 'found a player forester carrying wood away from other buildings')) {
    v.held = true;
    game.events.emit('grab', { entityId: v.id, x: v.x, y: v.y, z: v.z });
    game.tick(1 / 30);
    check(item.carriedBy === null && v.carry === null && world.get(item.id) === item, 'grabbing the carrier drops its wood');
    check(item.grabbable === true && item.amount > 0 && Math.abs(item.z - world.heightAt(item.x, item.y)) < 1e-6, `the dropped wood lies on the ground, grabbable, amount ${item.amount}`);
    v.held = false;
    game.events.emit('release', { entityId: v.id, kind: 'villager', x: v.x, y: v.y, z: v.z, vx: 0, vy: 0, vz: 0 });
    game.events.emit('landed', { entityId: v.id, speed: 0.5 });
    let pickedBy = null, lastPos = null, t = 0;
    for (; t < 2 * MIN && world.get(item.id); t++) {
      game.tick(1 / 30);
      if (!world.get(item.id)) break;
      if (item.carriedBy) pickedBy ??= world.get(item.carriedBy)?.job;
      lastPos = { x: item.x, y: item.y };
    }
    const pile = lastPos && nearestPile(game, lastPos);
    check(!world.get(item.id) && pickedBy === 'forester' && pile && pile.d <= 2,
      `a forester carries the loose wood to the store (picked by ${pickedBy}, gone after ${(t / 30).toFixed(0)} s, ${pile ? pile.d.toFixed(1) : '?'} tiles from a store)`);
  }
}
function nearestPile(game, p) {
  let best = null;
  for (const b of buildings(game, 'player', 'store')) {
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    if (!best || d < best.d) best = { b, d };
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// 10. Seeds 2-12: the same core behaviour as seed 1 (jobs, wood, grain, power, a house built, rival
// growth, safe steps, nobody dies without a cause).
for (let seed = 2; seed <= 12; seed++) {
  const game = newGame(seed);
  const vs = game.systems.village;
  const log = record(game);
  const sampler = stepSampler(game);
  const rival0 = buildings(game, 'rival').filter((b) => b.stage === 'done').length;
  const jobs = new Set();
  let s5 = null, id = null, placedAt = 0, builtIn = null;
  for (let i = 1; i <= 10 * MIN; i++) {
    game.tick(1 / 30);
    sampler.tick();
    if (i <= 5 * MIN) for (const v of villagers(game, 'player')) if (v.job !== 'idle') jobs.add(v.job);
    if (i === 5 * MIN) s5 = vs.stats();
    if (i === MIN) {
      const at = spotNear(vs, 'house', game.world.sites.village.x, game.world.sites.village.y);
      id = at ? vs.placeBlueprint('house', at[0], at[1]) : null;
      placedAt = i;
    }
    if (id !== null && builtIn === null && game.world.get(id)?.stage === 'done') builtIn = (i - placedAt) / 30;
  }
  const rival1 = buildings(game, 'rival').filter((b) => b.stage === 'done').length;
  const good = jobs.size >= 3 && s5.player.woodDelivered > 0 && s5.player.grainHarvested > 0 && s5.power > 0 &&
    builtIn !== null && builtIn <= 240 && rival1 > rival0 && sampler.bad === 0 && sampler.steps > 200 && log['villager-died'].length === 0;
  check(good, `seed ${seed}: jobs ${[...jobs].join('/')}, wood +${s5.player.woodDelivered}, grain +${s5.player.grainHarvested}, power ${s5.power.toFixed(2)}, ` +
    `house ${id === null ? 'not placed' : builtIn === null ? 'never built' : `built in ${builtIn.toFixed(0)} s`}, rival ${rival0} -> ${rival1}, ` +
    `steps ${sampler.steps} (${sampler.bad} bad${sampler.first ? `: ${sampler.first}` : ''}), deaths ${log['villager-died'].length}`);
}

// ---------------------------------------------------------------------------------------------
// The chaos procedure (sections 11 and 17): `minutes` sim minutes of what the hand and miracles may
// do, from a stand-in for the player seeded with `chaosSeed`, on the island with game seed
// `gameSeed`. `init(game)` runs once before the first tick, `each(game, i)` after every tick (tick
// index i). Returns what the checks need.
//
// Fire and lightning are real casts paid from worship power: game.systems.miracles.cast(miracle,
// x, y) without `free`, so the stand-in can only cast what the village's worship pays for. A cast it
// cannot afford fizzles (no effect). The power arithmetic:
//   - income: VILLAGE.worshipPower 0.08 power per second per praying worshipper; auto-assignment
//     sends VILLAGE.worshipShare 0.25 of adults to pray, round(n * 0.25) of n villagers. The
//     starting 9 give 2 worshippers, 0.16 power/s = 9.6 power per sim minute. The village grows
//     while the chaos runs (13-21 villagers at the end of the section 17 seeds), so it earns up to
//     4-5 worshippers' worth, about 20-24 power a minute, late in the run; less while it is smaller
//     (1 worshipper at 2-5 villagers, 0 at 1), starving (no worship at 0 grain), or walking to the
//     temple. Power starts at 0 (village setup).
//   - costs (src/miracles/tuning.js TUNING.costs): fire 20, lightning 30. One fire every 2.1 minutes
//     at the start, about one a minute once the village has grown. Measured over game seeds 1-50
//     with chaos seeds 5001-5050: 1-8 paid fire casts per 10-minute run, 5.0 on average, and 13
//     buildings lit (spread included) on average.
//   - the stand-in rolls a fire every ~13 s and a lightning every ~25 s (15% and 8% of one act per
//     ~2 s), so it spends power as soon as worship has paid for a cast. Before round 28 these acts
//     were free: 32-58 fire casts (45 on average) and ~24 strikes in 10 minutes, about 1600 power
//     and 9 times the fires worship paid for, which burnt down ~2 player buildings a minute.
// The other acts (hand throws, some lethal; buildings knocked to hp 0; rain; blueprints; trees
// removed) keep their frequencies and stay free: the hand costs no power, and rain here is a
// fertility stand-in that never harms.
function runChaos(gameSeed, chaosSeed, { minutes = 10, init = null, each = null } = {}) {
  const game = newGame(gameSeed);
  const { world } = game;
  const vs = game.systems.village;
  const M = game.systems.miracles;
  const log = record(game);
  init?.(game);
  const rnd = createRng(chaosSeed);
  const flights = new Map(); // villager id -> flight
  const sampler = stepSampler(game, (v) => flights.has(v.id));
  const site = world.sites.village;
  let threw = null, nan = 0, ticks = 0, ignitions = 0, emptyRun = 0, longestEmpty = 0;
  const casts = { fire: 0, lightning: 0 }, fizzles = { fire: 0, lightning: 0 };
  const alight = new Set(); // buildings burning at the last tick: a building newly in it is one ignition
  const finite = (e) => Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.z);
  try {
    for (let i = 0; i < minutes * MIN; i++) {
      ticks++;
      game.tick(1 / 30);
      sampler.tick();
      emptyRun = vs.stats().player.population === 0 ? emptyRun + 1 : 0;
      longestEmpty = Math.max(longestEmpty, emptyRun);
      for (const kind of ['villager', 'wood', 'grain']) for (const e of world.query({ kind })) if (!finite(e)) nan++;
      for (const b of world.query({ kind: 'building' })) {
        if (b.burning > 0) { if (!alight.has(b.id)) { alight.add(b.id); ignitions++; } } else alight.delete(b.id);
      }
      for (const [vid, f] of flights) {
        const e = world.get(vid);
        if (!e) { flights.delete(vid); continue; }
        f.t += 1 / 30;
        const k = Math.min(1, f.t / f.dur);
        const x = f.x0 + (f.x1 - f.x0) * k, y = f.y0 + (f.y1 - f.y0) * k;
        world.move(e, x, y, world.heightAt(x, y) + 3 * Math.sin(Math.PI * k));
        if (k < 1) continue;
        flights.delete(vid);
        if (world.ground[Math.floor(y) * world.w + Math.floor(x)] <= 1) { world.remove(vid); continue; }
        world.move(e, x, y, world.heightAt(x, y));
        if (f.lethal) e.hp = 0;
        game.events.emit('landed', { entityId: vid, speed: f.lethal ? 12 : 2 });
      }
      each?.(game, i);
      if (rnd.next() >= 1 / 60) continue; // about one act every 2 s
      const roll = rnd.next();
      const free = villagers(game).filter((v) => v.hp > 0 && !(v.dying > 0) && !v.held && !flights.has(v.id));
      if (roll < 0.45) {
        if (!free.length) continue;
        const v = free[rnd.int(free.length)];
        v.held = true;
        game.events.emit('grab', { entityId: v.id, x: v.x, y: v.y, z: v.z });
        v.held = false;
        const x1 = Math.min(world.w - 1.5, Math.max(1.5, v.x + rnd.range(-7, 7))), y1 = Math.min(world.h - 1.5, Math.max(1.5, v.y + rnd.range(-7, 7)));
        const f = { x0: v.x, y0: v.y, x1, y1, t: 0, dur: rnd.range(0.3, 2), lethal: rnd.next() < 0.1 };
        // A flight at throwMin or faster is a throw, as the hand reports it, and sets no job (step 4:
        // a slow drop sets a job for good).
        const thrown = Math.hypot(x1 - v.x, y1 - v.y) / f.dur >= HAND.throwMin;
        game.events.emit('release', { entityId: v.id, kind: 'villager', x: v.x, y: v.y, z: v.z + 2, vx: 0, vy: 0, vz: 0, thrown, shaken: false });
        flights.set(v.id, f);
      } else if (roll < 0.49) {
        const bs = world.query({ kind: 'building' }).filter((b) => b.type !== 'temple' && b.stage !== 'wrecked');
        if (bs.length) bs[rnd.int(bs.length)].hp = 0;
      } else if (roll < 0.64) {
        // a fire miracle on a building, paid from worship power (fizzles without it): the real fire
        // system burns, spreads, wrecks and dies out on its own
        const bs = world.query({ kind: 'building' });
        const b = bs[rnd.int(bs.length)];
        if (M.cast('fire', b.x, b.y)) casts.fire++; else fizzles.fire++;
      } else if (roll < 0.72) {
        // a lightning miracle on a villager, paid from worship power (fizzles without it)
        if (!free.length) continue;
        const v = free[rnd.int(free.length)];
        if (M.cast('lightning', v.x, v.y)) casts.lightning++; else fizzles.lightning++;
      } else if (roll < 0.82) {
        const f = buildings(game, 'player', 'field')[0];
        if (f) game.events.emit('rain', { x: f.x, y: f.y, r: 4, dt: 1 / 30 });
      } else if (roll < 0.94) {
        const kind = ['house', 'field', 'store', 'house'][rnd.int(4)];
        const at = spotNear(vs, kind, site.x + rnd.int(9) - 4, site.y + rnd.int(9) - 4);
        if (at) vs.placeBlueprint(kind, at[0], at[1]);
      } else {
        const trees = world.query({ kind: 'tree', x: site.x, y: site.y, r: 15 }).filter((t) => !t.held);
        if (trees.length) world.remove(trees[rnd.int(trees.length)].id);
      }
    }
  } catch (err) {
    threw = err;
  }
  return { game, world, vs, log, sampler, threw, nan, ticks, ignitions, longestEmpty, casts, fizzles };
}

// ---------------------------------------------------------------------------------------------
// 11. Chaos: 10 sim minutes of what the hand and miracles may do, from a seeded stand-in for the
// player (the procedure above). Throws villagers anywhere (water sinks them, as the hand does), some
// throws lethal, wrecks buildings, casts fire on buildings and lightning on villagers through the
// real miracles system whenever worship has paid for them (fire spreads, wrecks and burns out on its
// own), rain, blueprints, trees burnt away. The village must not throw, must keep positions finite
// and steps legal, fire each death and destruction once, survive, and rebuild 2+ lost buildings.
{
  const { game, world, vs, log, sampler, threw, nan, ticks, ignitions, longestEmpty, casts, fizzles } = runChaos(3, 99);
  check(!threw, `chaos: no exception in ${ticks} ticks${threw ? `: ${threw.stack || threw}` : ''}`);
  check(nan === 0, `chaos: no NaN positions (${nan})`);
  check(sampler.bad === 0 && sampler.steps > 1000, `chaos: ${sampler.steps} walking steps, all on walkable ground within 1 height${sampler.first ? ` (first bad: ${sampler.first})` : ''}`);
  const died = log['villager-died'], des = log['building-destroyed'];
  check(died.length > 0 && new Set(died.map((p) => p.id)).size === died.length, `chaos: villager-died fired once per villager (${died.length} deaths)`);
  check(died.every((p) => !world.get(p.id)), 'chaos: every dead villager was removed');
  check(des.length > 0 && new Set(des.map((p) => p.buildingId)).size === des.length, `chaos: building-destroyed fired once per building (${des.length})`);
  check(log['building-complete'].length > 0, `chaos: blueprints still get built (${log['building-complete'].length})`);
  check(ignitions > 0, `chaos: the real fire system lit buildings (${ignitions} ignitions)`);
  const st = vs.stats();
  check(st.player.population > 0, `chaos: the player village survives (${st.player.population} villagers, ${st.player.buildings} buildings, ${st.player.wrecked} wrecks)`);
  check(longestEmpty <= (VILLAGE.settlerInterval + 1) * 30,
    `chaos: the player village is never empty for longer than one settler interval (longest ${(longestEmpty / 30).toFixed(1)} s, limit ${VILLAGE.settlerInterval + 1} s)`);
  const rebuilt = buildings(game, 'player').filter((b) => b.auto && b.stage === 'done').length;
  check(rebuilt > 0, `chaos: the village rebuilt lost buildings itself (${rebuilt} re-placed and finished)`);
  check(rebuilt >= 2, `chaos: with margin, 2+ lost buildings re-placed and finished at the end (${rebuilt})`);
  const stuck = villagers(game).filter((v) => v.hp > 0 && !v.held && !vs.sim.paths.walkable(Math.floor(v.x), Math.floor(v.y)));
  console.log(`  chaos end: player ${JSON.stringify(st.player)}; ${stuck.length} live villagers off walkable ground; longest empty ${(longestEmpty / 30).toFixed(1)} s; ${rebuilt} rebuilt; ` +
    `paid casts fire ${casts.fire}, lightning ${casts.lightning} (fizzled ${fizzles.fire}, ${fizzles.lightning}); ${ignitions} building ignitions`);
}

// ---------------------------------------------------------------------------------------------
// 12. Recovery after a fire, through the real fire system. Seeds 1-6: fire miracles on the player
// village (the centre first, then standing buildings) until 3+ buildings are wrecked. Within 6 sim
// minutes of the first cast the village clears the wrecks, re-places at least 2 of the lost
// buildings near their old spots and finishes them, population is at least its pre-fire level minus
// 2, no type ends with more buildings than before the fire, and no footprints overlap. The rival
// village recovers from a fire the same way, in its own buildings.
function fireUntilLost(game, owner, centre, minLost) {
  const M = game.systems.miracles;
  const lost = [];
  game.events.on('building-destroyed', (p) => {
    const b = game.world.get(p.buildingId);
    if (b?.owner === owner) lost.push({ id: b.id, type: b.type, x: b.x, y: b.y });
  });
  let casts = 0, at = centre;
  while (at && casts < 4) {
    M.cast('fire', at.x, at.y, { free: true });
    casts++;
    game.clock.run(40 * 30, game.tick);
    if (lost.length >= minLost) break;
    at = buildings(game, owner).find((b) => b.stage === 'done' && b.type !== 'temple' && b.hp > 0.5 && !(b.burning > 0));
  }
  return { lost, casts };
}
/** Re-placed buildings of `owner`, finished, each matched to a different lost building of its type
 * whose old centre is within rebuildRadius + 1 tiles. */
function rebuiltFor(game, owner, lost) {
  const free = [...lost];
  let n = 0;
  for (const b of buildings(game, owner).filter((u) => u.auto && u.stage === 'done')) {
    const i = free.findIndex((l) => l.type === b.type && Math.hypot(l.x - b.x, l.y - b.y) <= VILLAGE.rebuildRadius + 1);
    if (i >= 0) { free.splice(i, 1); n++; }
  }
  return n;
}
const standingByType = (game, owner) => {
  const m = {};
  for (const b of buildings(game, owner)) if (b.stage !== 'wrecked') m[b.type] = (m[b.type] ?? 0) + 1;
  return m;
};
const overlaps = (game) => {
  const all = game.world.query({ kind: 'building' });
  const clash = [];
  for (const p of all) for (const q of all)
    if (p.id < q.id && p.tx < q.tx + q.fw && q.tx < p.tx + p.fw && p.ty < q.ty + q.fh && q.ty < p.ty + p.fh) clash.push(`${p.type}#${p.id}/${q.type}#${q.id}`);
  return clash;
};
{
  const rows = [];
  for (let seed = 1; seed <= 6; seed++) {
    const game = newGame(seed);
    const vs = game.systems.village;
    game.clock.run(MIN, game.tick);
    const pop0 = vs.stats().player.population;
    const before = standingByType(game, 'player');
    const t0 = vs.sim.time;
    const site = game.world.sites.village;
    vs.placeBlueprint('house', 3, 3); // in the sea: sets the player's lastReason to 'water'
    const reason0 = vs.lastReason;
    // Watch every write to lastReason. A re-placement that went through placeBlueprint would write null
    // just before its 'building-placed' event. The value itself need not stay 'water': the rival's
    // growth plan places through placeBlueprint too.
    let reason = vs.sim.lastReason, nullWrite = false, autoPlaced = 0, autoTouched = 0, onRock = 0;
    const rocks = liveRocks(game.world).length;
    Object.defineProperty(vs.sim, 'lastReason', { configurable: true, enumerable: true, get: () => reason, set: (v) => { reason = v; if (v === null) nullWrite = true; } });
    game.events.on('building-placed', (p) => {
      const nb = game.world.get(p.buildingId);
      if (nb?.auto) {
        autoPlaced++; if (nullWrite) autoTouched++;
        const inside = (q) => q.x >= nb.tx && q.x < nb.tx + nb.fw && q.y >= nb.ty && q.y < nb.ty + nb.fh;
        if (liveRocks(game.world).some(inside)) onRock++; // the rocks validate() tests
      }
      nullWrite = false;
    });
    // A rock lands on the first lost building's spot as it falls: its re-placed blueprint must avoid it.
    let rocked = false;
    game.events.on('building-destroyed', (p) => {
      const b = game.world.get(p.buildingId);
      if (rocked || b?.owner !== 'player') return;
      rocked = true;
      game.world.spawn('rock', { x: b.x, y: b.y, z: game.world.heightAt(b.x, b.y), vx: 0, vy: 0, vz: 0, size: 1, grabbable: true, hp: 1 });
    });
    const { lost, casts } = fireUntilLost(game, 'player', { x: site.x + 0.5, y: site.y + 0.5 }, 3);
    let firstTwo = null;
    while (vs.sim.time - t0 < 6 * 60) {
      game.tick(1 / 30);
      if (firstTwo === null && rebuiltFor(game, 'player', lost) >= 2) firstTwo = vs.sim.time - t0;
    }
    const after = standingByType(game, 'player');
    const extra = Object.keys(after).filter((k) => after[k] > (before[k] ?? 0)).map((k) => `${k} ${before[k] ?? 0} -> ${after[k]}`);
    rows.push({
      seed, casts, lost: lost.length, types: lost.map((l) => l.type).join('/'), rebuilt: rebuiltFor(game, 'player', lost), firstTwo,
      pop0, pop: vs.stats().player.population, wrecks: vs.stats().player.wrecked, extra, clash: overlaps(game),
      reason0, autoPlaced, autoTouched, rocks, onRock,
    });
  }
  for (const r of rows) console.log(`  info: recovery seed ${r.seed}: ${r.casts} casts, lost ${r.lost} (${r.types}), rebuilt ${r.rebuilt}, 2 finished after ${r.firstTwo?.toFixed(0)} s, population ${r.pop0} -> ${r.pop}, ${r.wrecks} wrecks left`);
  check(rows.every((r) => r.lost >= 3), `recovery: fire wiped 3+ player buildings on every seed (${rows.map((r) => `${r.seed}: ${r.lost}`).join(', ')})`);
  check(rows.every((r) => r.firstTwo !== null && r.firstTwo <= 6 * 60), `recovery: 2+ lost buildings re-placed near their old spots and finished within 6 sim minutes (${rows.map((r) => `${r.seed}: ${r.rebuilt}`).join(', ')})`);
  check(rows.every((r) => r.pop >= r.pop0 - 2), `recovery: population back to at least its pre-fire level minus 2 (${rows.map((r) => `${r.seed}: ${r.pop0} -> ${r.pop}`).join(', ')})`);
  check(rows.every((r) => r.extra.length === 0), `recovery: no building type ends above its pre-fire count${rows.some((r) => r.extra.length) ? ` (${rows.filter((r) => r.extra.length).map((r) => `${r.seed}: ${r.extra.join(', ')}`).join('; ')})` : ''}`);
  check(rows.every((r) => r.clash.length === 0), `recovery: no footprints overlap${rows.some((r) => r.clash.length) ? ` (${rows.map((r) => r.clash.join(', ')).join('; ')})` : ''}`);
  check(rows.every((r) => r.wrecks === 0), `recovery: every wreck was cleared away (${rows.map((r) => `${r.seed}: ${r.wrecks}`).join(', ')})`);
  check(rows.every((r) => r.rocks > 0 && r.onRock === 0),
    `recovery: rocks stand on the island and no re-placed blueprint covers one (${rows.map((r) => `${r.seed}: ${r.rocks} rocks, ${r.onRock} of ${r.autoPlaced} on a rock`).join(', ')})`);
  check(rows.every((r) => r.reason0 === 'water' && r.autoPlaced > 0 && r.autoTouched === 0),
    `recovery: the village's own re-placements never write lastReason (${rows.map((r) => `${r.seed}: ${r.autoTouched} of ${r.autoPlaced}`).join(', ')})`);

  // The rival village, in its own buildings.
  const game = newGame(1);
  const vs = game.systems.village;
  game.clock.run(MIN, game.tick);
  const before = standingByType(game, 'rival');
  const t0 = vs.sim.time;
  const rs = game.world.sites.rival;
  const { lost } = fireUntilLost(game, 'rival', { x: rs.x + 0.5, y: rs.y + 0.5 }, 3);
  game.clock.run(Math.max(0, Math.round((6 * 60 - (vs.sim.time - t0)) * 30)), game.tick);
  const n = rebuiltFor(game, 'rival', lost);
  const re = buildings(game, 'rival').filter((b) => b.auto);
  const after = standingByType(game, 'rival');
  // The rival also grows by its own plan, so its count may rise by the buildings that plan added.
  check(lost.length >= 3 && n >= 2 && re.length >= n && re.every((b) => b.owner === 'rival'),
    `recovery: the rival village re-places and finishes its own lost buildings (lost ${lost.length}: ${lost.map((l) => l.type).join('/')}; rebuilt ${n})`);
  console.log(`  info: rival recovery: before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);
}

// ---------------------------------------------------------------------------------------------
// 13. Recovery never blocks or duplicates the player's own blueprints: a house placed on a fresh
// wreck takes the lost house's place (no second house comes back), and a house placed over a
// re-placed blueprint that has no wood yet succeeds and replaces it (again one house, not two).
// With three houses lost and recovery under way, six player blueprints placed in a row are all
// accepted (no cap on the player's own sites), keep every lost house on its rebuild path, and both
// a re-placed house and a player blueprint get finished.
{
  const game = newGame(1);
  const vs = game.systems.village;
  game.clock.run(MIN, game.tick);
  const houses0 = buildings(game, 'player', 'house').filter((b) => b.stage !== 'wrecked').length;
  const [a, b] = buildings(game, 'player', 'house').filter((h) => h.stage === 'done');
  const centre = (h) => [h.tx + ((h.fw - 1) >> 1), h.ty + ((h.fh - 1) >> 1)];
  a.hp = 0;
  game.tick(1 / 30);
  const idA = vs.placeBlueprint('house', ...centre(a));
  check(idA !== null && vs.lastReason === null, `a house placed on a fresh wreck is accepted (${vs.lastReason})`);
  check(vs.sim.village('player').lost.every((r) => r.type !== 'house'), 'the placed house takes the lost house\'s place on the rebuild list');

  b.hp = 0;
  let auto = null;
  const off = game.events.on('building-placed', (p) => { const e = game.world.get(p.buildingId); if (e?.auto && e.type === 'house') auto ??= e; });
  for (let i = 0; i < 3 * MIN && !auto; i++) game.tick(1 / 30);
  off();
  check(auto && auto.stage === 'blueprint' && !(auto.woodHave > 0) && auto.tx === b.tx && auto.ty === b.ty,
    `the lost house comes back as a blueprint on its old footprint once its wreck is cleared (${auto ? `${auto.stage}, wood ${auto.woodHave}, at ${auto.tx},${auto.ty} vs ${b.tx},${b.ty}` : 'none'})`);
  const idB = auto ? vs.placeBlueprint('house', ...centre(auto)) : null;
  check(idB !== null && auto && !game.world.get(auto.id), `the player may place a house over a re-placed blueprint with no wood yet (${vs.lastReason})`);
  game.clock.run(4 * MIN, game.tick);
  const houses = buildings(game, 'player', 'house').filter((h) => h.stage !== 'wrecked');
  check(houses.length === houses0 && houses.every((h) => !h.auto), `no house is rebuilt twice (${houses0} houses before, ${houses.length} after, ${houses.filter((h) => h.auto).length} re-placed)`);
  check(game.world.get(idA)?.stage === 'done' && game.world.get(idB)?.stage === 'done', 'both player-placed houses got built');
  check(overlaps(game).length === 0, `no footprints overlap (${overlaps(game).join(', ')})`);

  // The player's own blueprints and recovery do not block each other. Three houses are lost; once
  // recovery has re-placed one (a re-placed blueprint open, the others waiting), six player
  // blueprints of other kinds placed in a row, none of them built yet, are all accepted (no cap on
  // the player's own sites); they leave the rebuild of all three houses in place (each lost house is
  // still waiting or re-placed: one placed over a re-placed blueprint with no wood yet sends that
  // house back to waiting, as above); and within 4 sim minutes the village finishes both a
  // re-placed house and one of the player's six.
  const site = game.world.sites.village;
  const isSite = (u) => (u.stage === 'blueprint' || u.stage === 'building') && u.hp > 0;
  const autoHouses = () => buildings(game, 'player', 'house').filter((u) => u.auto && u.stage !== 'wrecked');
  const lostHouses = () => vs.sim.village('player').lost.filter((r) => r.type === 'house').length;
  const doomed = buildings(game, 'player', 'house').filter((u) => u.stage === 'done').slice(0, 3);
  for (const h of doomed) h.hp = 0;
  for (let i = 0; i < 2 * MIN && !autoHouses().some(isSite); i++) game.tick(1 / 30);
  const autoBefore = autoHouses().filter(isSite).length, lostBefore = lostHouses();
  check(doomed.length === 3 && autoBefore >= 1 && lostBefore >= 1 && autoBefore + lostBefore === 3,
    `recovery is under way when the player starts placing (${doomed.length} houses lost: ${autoBefore} re-placed and open, ${lostBefore} waiting)`);
  const ownOpen = () => buildings(game, 'player').filter((u) => !u.auto && isSite(u)).length;
  const own0 = ownOpen();
  const kinds = ['store', 'field', 'store', 'store', 'field', 'store'];
  const ids = [];
  const got = kinds.map((kind, i) => {
    const at = spotNear(vs, kind, site.x + [-3, 3, 0, 0, -3, 3][i], site.y + [0, 0, -3, 3, 3, -3][i]);
    const id = at ? vs.placeBlueprint(kind, at[0], at[1]) : null;
    if (id !== null) ids.push(id);
    return id !== null ? 'ok' : `${kind} refused: ${at ? vs.lastReason : 'no valid spot'}`;
  });
  check(got.every((g) => g === 'ok') && ownOpen() === own0 + kinds.length,
    `six player blueprints in a row are all accepted beside recovery (${got.join(', ')}; player sites open ${own0} -> ${ownOpen()})`);
  const autoAfter = autoHouses().length, lostAfter = lostHouses();
  check(autoAfter + lostAfter === 3, `the player's six blueprints leave the rebuild of all 3 lost houses in place (${autoAfter} re-placed, ${lostAfter} waiting)`);
  game.clock.run(4 * MIN, game.tick);
  const autoDone = autoHouses().filter((u) => u.stage === 'done').length;
  const ownDone = ids.filter((id) => game.world.get(id)?.stage === 'done').length;
  check(autoDone >= 1 && ownDone >= 1,
    `4 sim minutes later both paths moved: ${autoDone} re-placed houses finished, ${ownDone} of the player's six finished (re-placed open ${autoHouses().filter(isSite).length}, still lost ${lostHouses()})`);
  check(overlaps(game).length === 0, `no footprints overlap after recovery and the player's six (${overlaps(game).join(', ')})`);
}

// ---------------------------------------------------------------------------------------------
// 14. Settlers: with fewer than settlerMinPop villagers and a temple, settlers arrive at the temple
// one per settlerInterval until the village is back to settlerMinPop; none while it is that big.
{
  const game = newGame(1);
  const vs = game.systems.village;
  const temple = buildings(game, 'player', 'temple')[0];
  const ring = (v) => Math.hypot(Math.max(temple.tx - v.x, 0, v.x - (temple.tx + temple.fw)), Math.max(temple.ty - v.y, 0, v.y - (temple.ty + temple.fh)));
  const known = new Set(villagers(game).map((v) => v.id));
  const keep = villagers(game, 'player')[0];
  for (const v of villagers(game, 'player')) if (v !== keep) v.hp = 0;
  const arrivals = [];
  let reachedAt = null;
  for (let i = 0; i < 2 * MIN; i++) {
    game.tick(1 / 30);
    for (const v of villagers(game, 'player')) if (!known.has(v.id)) { known.add(v.id); arrivals.push({ t: vs.sim.time, d: ring(v), pop: vs.stats().player.population }); }
    if (reachedAt === null && vs.stats().player.population >= VILLAGE.settlerMinPop) reachedAt = vs.sim.time;
  }
  const need = VILLAGE.settlerMinPop - 1;
  const limit = need * VILLAGE.settlerInterval + VILLAGE.dyingTime + 2;
  check(reachedAt !== null && reachedAt <= limit, `settlers bring a 1-villager village back to ${VILLAGE.settlerMinPop} within ${limit.toFixed(0)} s (at ${reachedAt?.toFixed(1)} s)`);
  const settlers = arrivals.filter((a) => a.d <= 1.5);
  check(settlers.length >= need && settlers.slice(0, need).every((a) => a.d <= 1.5), `settlers arrive beside the temple (${arrivals.map((a) => `${a.t.toFixed(0)} s at ${a.d.toFixed(1)} tiles`).join(', ')})`);
  check(settlers.length === need, `no settlers once the village has ${VILLAGE.settlerMinPop} (${settlers.length} arrived, ${need} needed)`);
  check(villagers(game, 'player').every((v) => v.hp > 0 && v.owner === 'player' && typeof v.job === 'string'), 'settlers are ordinary player villagers');

  // Once the rival is converted (alignment hands its villagers and buildings to the player), its
  // empty record gets no settlers and re-places nothing it lost before.
  const rb = buildings(game, 'rival').find((u) => u.type === 'house');
  rb.hp = 0;
  game.tick(1 / 30);
  for (const e of game.world.entities.values()) if ((e.kind === 'villager' || e.kind === 'building') && e.owner === 'rival') e.owner = 'player';
  game.clock.run(MIN, game.tick);
  const rivalNow = game.world.query({}).filter((e) => (e.kind === 'villager' || e.kind === 'building') && e.owner === 'rival');
  check(rivalNow.length === 0, `a converted rival village gets no settlers or re-placed buildings (${rivalNow.length} rival entities)`);
}

// ---------------------------------------------------------------------------------------------
// 15. Fire on the player village every 60 s for 10 sim minutes (seed 4), each cast on the most
// central standing building that is not the temple: the village ends with at least settlerMinPop
// villagers and still finishes 2+ buildings in the last 5 minutes.
{
  const game = newGame(4);
  const vs = game.systems.village;
  const site = game.world.sites.village;
  const done = [];
  game.events.on('building-complete', (p) => { if (p.owner === 'player') done.push(vs.sim.time); });
  const t0 = vs.sim.time;
  let casts = 0, destroyed = 0;
  game.events.on('building-destroyed', () => destroyed++);
  for (let m = 0; m < 10; m++) {
    const b = buildings(game, 'player').filter((u) => u.type !== 'temple' && u.stage === 'done' && u.hp > 0)
      .sort((a, c) => Math.hypot(a.x - site.x, a.y - site.y) - Math.hypot(c.x - site.x, c.y - site.y) || a.id - c.id)[0];
    if (b && game.systems.miracles.cast('fire', b.x, b.y, { free: true })) casts++;
    game.clock.run(MIN, game.tick);
  }
  const pop = vs.stats().player.population;
  const late = done.filter((t) => t - t0 > 5 * 60).length;
  console.log(`  info: fire every 60 s: ${casts} casts, ${destroyed} destroyed, population ${pop}, ${late} of ${done.length} completions in the last 5 minutes`);
  check(casts === 10 && pop >= VILLAGE.settlerMinPop && late >= 2,
    `fire every 60 s for 10 minutes: ${casts} casts, ${destroyed} destroyed, ${pop} villagers left (floor ${VILLAGE.settlerMinPop}), ${late} of ${done.length} completions in the last 5 minutes (want 2+)`);
}

// ---------------------------------------------------------------------------------------------
// 16. Temples are stone (VILLAGE.templeMinHp): rocks thrown through the hand and the creature's
// smash chip the player and rival temples but never take them to hp 0 or wreck them. Control: the
// same throws wreck a house. (Since round 43 no hp write takes a temple below the floor: hp 0 set
// directly in section 7, lightning and fire in "temples survive lightning and fire" below.)
{
  const game = newGame(2);
  const { world } = game;
  const log = record(game);
  const hand = game.systems.hand;
  /** Six rocks hurled down onto building b at full damage speed, 2 s apart; lowest hp seen. */
  const pelt = (b) => {
    let low = b.hp;
    for (let k = 0; k < 6; k++) {
      const rock = world.spawn('rock', { x: b.x, y: b.y, z: (b.z ?? world.heightAt(b.x, b.y)) + HAND.buildingHeight + 0.1, vx: 0, vy: 0, vz: 0, size: 1, grabbable: true, hp: 1 });
      hand.launch(rock, 0, 0, -HAND.fullDamageSpeed);
      for (let i = 0; i < 60; i++) { game.tick(1 / 30); low = Math.min(low, b.hp); }
      world.remove(rock.id);
    }
    return low;
  };
  const house = buildings(game, 'player', 'house')[0];
  pelt(house);
  game.tick(1 / 30);
  check(house.stage === 'wrecked', `control: six thrown rocks wreck a house (${house.stage}, hp ${house.hp.toFixed(2)})`);
  for (const owner of ['player', 'rival']) {
    const t = buildings(game, owner, 'temple')[0];
    const low = pelt(t);
    check(t.hp < 1 && low >= VILLAGE.templeMinHp - 1e-9 && t.stage !== 'wrecked' && world.get(t.id) === t,
      `${owner} temple under six thrown rocks: chipped to ${t.hp.toFixed(2)}, lowest ${low.toFixed(2)} (floor ${VILLAGE.templeMinHp}), ${t.stage}`);
  }

  // the creature, set on the player temple and offered only smash:building on it
  const cs = game.systems.creature;
  cs.setup();
  const t = buildings(game, 'player', 'temple')[0];
  t.hp = 1;
  world.move(cs.entity, t.x, t.y, world.heightAt(t.x, t.y));
  let smashes = 0, low = t.hp, reset = false;
  game.events.on('act', (a) => { if (a.actor === 'creature' && a.verb === 'smash') smashes++; });
  cs.debug.candidateFilter = (c) => c.key === 'smash:building' && c.target?.id === t.id;
  for (let i = 0; i < 60 * 30; i++) {
    // Room for one more smash: to the floor, not below. Set back on the temple only between actions:
    // a creature moved mid-walk walks on along its old path and decides far from the temple.
    if (!reset && i >= 30 * 30 && !cs.state().action) { reset = true; t.hp = 0.7; world.move(cs.entity, t.x, t.y, world.heightAt(t.x, t.y)); }
    game.tick(1 / 30);
    low = Math.min(low, t.hp);
  }
  cs.debug.candidateFilter = null;
  check(smashes >= 2 && low >= VILLAGE.templeMinHp - 1e-9 && t.stage !== 'wrecked',
    `creature smash on the player temple: ${smashes} smashes, lowest hp ${low.toFixed(2)} (floor ${VILLAGE.templeMinHp}), ${t.stage}`);
  check(!log['building-destroyed'].some((p) => world.get(p.buildingId)?.type === 'temple'), 'no temple was destroyed by throws or smashes');
}

// ---------------------------------------------------------------------------------------------
// 17. Recovery sweep: the section 11 chaos procedure on 10 more seeds (SWEEP: game seed g with chaos
// seed 1000 + g, g = 1..10), everything measured at the end of the 10 chaos minutes (no calm period
// after). In every seed: the player village never has more than VILLAGE.rebuildSites re-placed
// (lost-building) sites open at once; it finishes 2+ re-placed lost buildings while the chaos runs
// and has 2+ of them standing finished at the end; at the end its stores hold wood
// or grain (only standing, finished stores count; the temple holds no stock); it has 3+ villagers;
// the chaos god cast at least one paid fire or lightning (so a run where every cast fizzled, an
// easy run, fails); and every walking step was legal throughout.
{
  const SWEEP = [[1, 1001], [2, 1002], [3, 1003], [4, 1004], [5, 1005], [6, 1006], [7, 1007], [8, 1008], [9, 1009], [10, 1010]];
  const isOpen = (b) => (b.stage === 'blueprint' || b.stage === 'building') && b.hp > 0;
  const rows = [];
  for (const [g, c] of SWEEP) {
    let maxAuto = 0, autoDone = 0;
    const r = runChaos(g, c, {
      init: (game) => game.events.on('building-complete', (p) => {
        const b = game.world.get(p.buildingId);
        if (b?.auto && b.owner === 'player') autoDone++;
      }),
      each: (game) => { maxAuto = Math.max(maxAuto, buildings(game, 'player').filter((b) => b.auto && isOpen(b)).length); },
    });
    const pb = buildings(r.game, 'player');
    const stores = pb.filter((b) => b.type === 'store' && b.stage === 'done' && b.hp > 0);
    const wood = stores.reduce((s, b) => s + (b.wood ?? 0), 0), grain = stores.reduce((s, b) => s + (b.grain ?? 0), 0);
    const standing = pb.filter((b) => b.auto && b.stage === 'done').length;
    const own = pb.filter((b) => !b.auto && isOpen(b)).length;
    rows.push({ g, c, threw: r.threw, bad: r.sampler.bad, first: r.sampler.first, maxAuto, autoDone, standing, own, wood, grain,
      pop: r.vs.stats().player.population, casts: r.casts });
  }
  for (const r of rows) {
    console.log(`  info: sweep ${r.g}/${r.c}: ${r.pop} villagers, wood ${r.wood}, grain ${r.grain}, ${r.standing} re-placed standing, ${r.autoDone} re-placed finished, ` +
      `most re-placed sites open ${r.maxAuto}, ${r.own} other sites open; paid casts fire ${r.casts.fire}, lightning ${r.casts.lightning}`);
  }
  const per = (f) => rows.map((r) => `${r.g}/${r.c}: ${f(r)}`).join(', ');
  check(rows.every((r) => !r.threw), `sweep: no exception${rows.some((r) => r.threw) ? ` (${rows.filter((r) => r.threw).map((r) => `${r.g}/${r.c}: ${r.threw.stack || r.threw}`).join('; ')})` : ''}`);
  check(rows.every((r) => r.maxAuto <= VILLAGE.rebuildSites), `sweep: never more than ${VILLAGE.rebuildSites} re-placed sites open (most: ${per((r) => r.maxAuto)})`);
  check(rows.every((r) => r.autoDone >= 2), `sweep: 2+ re-placed lost buildings finished during the chaos (${per((r) => r.autoDone)})`);
  check(rows.every((r) => r.standing >= 2), `sweep: 2+ re-placed lost buildings standing finished at the end of the chaos (${per((r) => r.standing)})`);
  check(rows.every((r) => r.wood > 0 || r.grain > 0), `sweep: wood or grain in the stores at the end of the chaos (${per((r) => `wood ${r.wood} grain ${r.grain}`)})`);
  check(rows.every((r) => r.pop >= 3), `sweep: 3+ villagers at the end of the chaos (${per((r) => r.pop)})`);
  check(rows.every((r) => r.casts.fire + r.casts.lightning > 0), `sweep: the chaos god cast paid miracles in every seed (${per((r) => `fire ${r.casts.fire} lightning ${r.casts.lightning}`)})`);
  check(rows.every((r) => r.bad === 0), `sweep: every walking step legal${rows.some((r) => r.bad) ? ` (${rows.filter((r) => r.bad).map((r) => `${r.g}/${r.c}: ${r.first}`).join('; ')})` : ''}`);
}

// ---------------------------------------------------------------------------------------------
// 18. Fleeing beside a rock corner (fleeStep). Flat synthetic map with an L of bare rock and a rock
// block. (a) A villager in the L's inner corner, scared by a strike in front of it, gets out and ends
// 1+ tile farther from the strike than it started, never on rock. (Before round 26 it stepped out
// toward the strike and straight back into the corner for the whole scare.) (b) A villager scared,
// then thrown mid-flee to the far side of the rock block, never steps onto rock. (Before, it walked
// from where it landed straight back to its old flee tile, through the block.)
{
  const S = 32;
  const rock = [[10, 18], [10, 19], [10, 20], [11, 20], [12, 20]];
  for (let y = 9; y <= 11; y++) for (let x = 20; x <= 21; x++) rock.push([x, y]);
  const height = new Uint8Array(S * S).fill(2), ground = new Uint8Array(S * S).fill(3);
  for (const [x, y] of rock) ground[y * S + x] = 5;
  const game = createGame({ seed: 1, worldSize: S });
  const { world } = game;
  world.loadMap({ w: S, h: S, seaLevel: 1, height, ground, trees: [], rocks: [],
    sites: { temple: { x: 4, y: 4 }, village: { x: 5, y: 8 }, rival: { x: 26, y: 26 }, rivalTemple: { x: 26, y: 22 } } });
  game.systems.village.setup();
  const onRock = (v) => ground[Math.floor(v.y) * S + Math.floor(v.x)] === 5;
  const [v1, v2] = villagers(game, 'player');
  const place = (v, x, y) => { world.move(v, x, y, world.heightAt(x, y)); v.path = null; v.work = null; v.wait = 0; };

  // (a) the inner corner of the L, the strike in front of it
  const strikeA = { x: 13.5, y: 16.5 };
  place(v1, 11.5, 19.5);
  place(v2, 24.5, 4.5);
  const d0 = Math.hypot(v1.x - strikeA.x, v1.y - strikeA.y);
  const samplerA = stepSampler(game, (v) => v !== v1), rockA = 0;
  game.events.emit('strike', { x: strikeA.x, y: strikeA.y, r: 1, power: 1 });
  const fled = v1.flee > 0;
  for (let i = 0; i < VILLAGE.fleeTime * 30; i++) { game.tick(1 / 30); samplerA.tick(); if (onRock(v1)) rockA++; }
  const d1 = Math.hypot(v1.x - strikeA.x, v1.y - strikeA.y);
  check(fled && d1 >= d0 + 1 && rockA === 0 && samplerA.bad === 0,
    `flee: a villager scared in a rock corner gets out (${fled ? 'fled' : 'never scared'}, ${d0.toFixed(1)} -> ${d1.toFixed(1)} tiles from the strike, ${rockA} ticks on rock, ${samplerA.bad} bad steps${samplerA.first ? `: ${samplerA.first}` : ''})`);

  // (b) scared, then thrown across the rock block mid-flee
  const strikeB = { x: 15.5, y: 10.5 };
  place(v2, 17.5, 10.5);
  let hold = false;
  const samplerB = stepSampler(game, (v) => v !== v2 || hold);
  game.events.emit('strike', { x: strikeB.x, y: strikeB.y, r: 1, power: 1 });
  game.tick(1 / 30); samplerB.tick();
  const to = v2.fleeTo, tx = (to % S) + 0.5, ty = ((to / S) | 0) + 0.5;
  const bx = 2 * 21 - tx, by = 2 * 10.5 - ty; // mirrored through the block's centre: the way back crosses it
  hold = true; samplerB.tick();
  v2.held = true; game.events.emit('grab', { entityId: v2.id, x: v2.x, y: v2.y, z: v2.z });
  v2.held = false; game.events.emit('release', { entityId: v2.id, kind: 'villager', x: v2.x, y: v2.y, z: v2.z + 2, vx: 0, vy: 0, vz: 0 });
  world.move(v2, bx, by, world.heightAt(bx, by));
  game.events.emit('landed', { entityId: v2.id, speed: 2 });
  samplerB.tick(); hold = false;
  let rockB = 0;
  for (let i = 0; i < VILLAGE.fleeTime * 30; i++) { game.tick(1 / 30); samplerB.tick(); if (onRock(v2)) rockB++; }
  check(to >= 0 && rockB === 0 && samplerB.bad === 0 && samplerB.steps > 0,
    `flee: a villager thrown mid-flee to ${bx.toFixed(1)},${by.toFixed(1)} keeps off the rock between it and its old flee tile ${tx},${ty} (${rockB} ticks on rock, ${samplerB.steps} steps, ${samplerB.bad} bad${samplerB.first ? `: ${samplerB.first}` : ''})`);
}

// ---- live rocks (round 39): placement tests the map's rock records only until the terrain system
// has turned them into rock entities; from then on only the entities count, so a tile a rock was
// carried off is free and the tile it was put down on is blocked.
{
  const game = createGame({ seed: 1 });
  const { world } = game;
  world.loadMap(buildIsland());
  const vs = game.systems.village;
  vs.setup();
  const opts = { setup: true }; // isolates the ground, building and rock rules from influence and trees (sim.validate: the system's validate takes no options)
  const rec = world.rocks.find((r) => vs.sim.validate('house', Math.floor(r.x), Math.floor(r.y), 'player', opts).reason === 'a rock is in the way');
  check(!!rec, `live rocks: before the first tick a map rock record blocks a house on its tile (${rec ? `${rec.x},${rec.y}` : 'none found'})`);
  game.tick(1 / 30);
  const tx = Math.floor(rec.x), ty = Math.floor(rec.y);
  const rock = world.query({ kind: 'rock' }).find((r) => r.x === rec.x && r.y === rec.y);
  check(!!rock && vs.sim.validate('house', tx, ty, 'player', opts).reason === 'a rock is in the way', 'live rocks: after the first tick its rock entity blocks the same tile');
  // somewhere free to put it down: the nearest tile a house fits on
  let to = null;
  for (let r = 3; r <= 12 && !to; r++)
    for (let dy = -r; dy <= r && !to; dy++)
      for (let dx = -r; dx <= r && !to; dx++)
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r && vs.sim.validate('house', tx + dx, ty + dy, 'player', opts).ok) to = { tx: tx + dx, ty: ty + dy };
  world.move(rock, to.tx + 0.5, to.ty + 0.5, world.heightAt(to.tx + 0.5, to.ty + 0.5)); // the hand carried it there
  const old = vs.sim.validate('house', tx, ty, 'player', opts), now = vs.sim.validate('house', to.tx, to.ty, 'player', opts);
  check(old.ok && now.reason === 'a rock is in the way',
    `live rocks: once moved, its old tile ${tx},${ty} takes a house (${old.reason ?? 'ok'}) and its new tile ${to.tx},${to.ty} does not (${now.reason ?? 'ok'})`);
  check(world.rocks.includes(rec), 'live rocks: the map keeps its authored rock records');
}

// ---- items and trees in flight (round 39): villagers never pick up wood that is airborne (thrown by
// the hand or the creature) or sinking, and never fell a tree that is.
{
  const game = newGame(1);
  const { world } = game;
  game.clock.run(30 * 30, game.tick);
  const cutter = villagers(game, 'player').find((v) => v.job === 'forester' && !v.carry) ?? villagers(game, 'player').find((v) => v.job === 'forester');
  const at = (v) => ({ x: Math.floor(v.x) + 0.5, y: Math.floor(v.y) + 0.5 });
  const p = at(cutter);
  const flying = world.spawn('wood', { x: p.x, y: p.y, z: world.heightAt(p.x, p.y), vx: 0, vy: 0, vz: 0, amount: 2, grabbable: true, airborne: true });
  const sinking = world.spawn('wood', { x: p.x, y: p.y, z: world.heightAt(p.x, p.y), vx: 0, vy: 0, vz: 0, amount: 2, grabbable: true, sinking: true });
  let taken = 0;
  for (let i = 0; i < 20 * 30; i++) { game.tick(1 / 30); if (flying.carriedBy || sinking.carriedBy || !world.get(flying.id) || !world.get(sinking.id)) taken++; }
  check(taken === 0, `in flight: wood flagged airborne or sinking at a forester's feet is never picked up in 20 s (${taken} ticks taken)`);
  flying.airborne = false; // it landed
  let picked = false;
  for (let i = 0; i < 40 * 30 && !picked; i++) { game.tick(1 / 30); picked = !!flying.carriedBy || !world.get(flying.id); }
  check(picked, 'in flight: the same wood is picked up once it has landed (the check above can fail)');

  const trees = () => world.query({ kind: 'tree' });
  const felled = (flag) => {
    const before = new Set(trees().map((t) => t.id));
    for (const t of trees()) t[flag] = true;
    for (let i = 0; i < 30 * 30; i++) game.tick(1 / 30);
    for (const t of trees()) t[flag] = false;
    return [...before].filter((id) => !world.get(id)).length;
  };
  const air = felled('airborne'), sink = felled('sinking');
  const before = new Set(trees().map((t) => t.id));
  for (let i = 0; i < 60 * 30; i++) game.tick(1 / 30);
  const control = [...before].filter((id) => !world.get(id)).length;
  check(air === 0 && sink === 0 && control > 0,
    `in flight: no tree felled while every tree is airborne (${air}) or sinking (${sink}) for 30 s; ${control} felled in the next 60 s once they are not`);
}

// ---- temples survive lightning and fire (round 43). Before, a temple at hp 0 was wrecked like any
// building and nothing repaired it; worshippers pray only at a usable temple, so power stopped for
// good. One lightning bolt (buildingDamage 0.5 plus the fire it lights) took a fresh temple to 0, and
// so did a fire on a temple one creature smash had chipped to 0.5. Every hp write on a temple now
// stops at VILLAGE.templeMinHp (stoneHp in src/village/sim.js). Seeds 1-3, both cases, free casts:
// the temple catches fire, never drops below the floor or wrecks, the fire goes out, and in the two
// minutes after that worship earns power again.
for (const seed of [1, 2, 3]) {
  for (const how of ['lightning', 'smash then fire']) {
    const game = newGame(seed);
    const log = record(game);
    const t = buildings(game, 'player', 'temple')[0];
    game.clock.run(30 * 30, game.tick);
    if (how === 'lightning') game.systems.miracles.cast('lightning', t.x, t.y, { free: true });
    else { t.hp = 1 - CREATURE.smashDamage; game.systems.miracles.cast('fire', t.x, t.y, { free: true }); }
    let low = t.hp, burnt = false;
    for (let i = 0; i < 40 * 30; i++) { game.tick(1 / 30); low = Math.min(low, t.hp); burnt ||= t.burning > 0; }
    const p0 = game.state.power;
    game.clock.run(2 * MIN, game.tick);
    const gain = game.state.power - p0;
    const wrecked = log['building-destroyed'].some((p) => p.buildingId === t.id);
    check(burnt && low >= VILLAGE.templeMinHp - 1e-9 && t.stage === 'done' && !wrecked && !(t.burning > 0) && gain > 0,
      `seed ${seed}, ${how} on the player temple: burnt ${burnt}, lowest hp ${low.toFixed(3)} (floor ${VILLAGE.templeMinHp}), ${t.stage}, fire out ${!(t.burning > 0)}, power +${gain.toFixed(2)} in the next 2 minutes`);
  }
}

// ---- the hand takes wood or grain out of a villager's arms (round 43). The item stops being
// carried (its carriedBy and the carrier's carry are cleared), so once it is set down a villager
// picks it up again. Before, carriedBy kept naming the old carrier, and villagers (looseNear,
// pickUp) and the creature skip any item with carriedBy set, so it lay there for good. Seeds 1-2.
for (const kind of ['wood', 'grain']) for (const seed of [1, 2]) {
  const game = newGame(seed);
  const { world, events } = game;
  let it = null;
  for (let i = 0; i < 5 * MIN && !it; i++) {
    game.tick(1 / 30);
    it = world.query({ kind }).find((w) => w.carriedBy && world.get(w.carriedBy)?.owner === 'player');
  }
  if (!check(it, `grab from arms (${kind}, seed ${seed}): found a player villager carrying ${kind}`)) continue;
  const carrier = world.get(it.carriedBy);
  it.held = true; it.airborne = false; // as hand.grab sets them before it emits grab
  events.emit('grab', { entityId: it.id, kind, x: it.x, y: it.y, z: it.z });
  const freed = it.carriedBy === null && carrier.carry === null;
  for (let i = 0; i < 15; i++) game.tick(1 / 30);
  // a gentle drop one tile toward the village centre, as hand.release does for a slow release
  const s = world.sites.village;
  const dx = Math.sign(s.x + 0.5 - it.x), dy = Math.sign(s.y + 0.5 - it.y);
  world.move(it, it.x + dx, it.y + dy, world.heightAt(it.x + dx, it.y + dy) + 0.5);
  it.held = false;
  game.systems.hand.launch(it, 0, 0, 0, false);
  events.emit('release', { entityId: it.id, kind, x: it.x, y: it.y, z: it.z, vx: 0, vy: 0, vz: 0 });
  // picked up: delivered (gone), or carried by a villager whose carry names it
  const picked = () => { const c = it.carriedBy && world.get(it.carriedBy); return !world.get(it.id) || (c?.kind === 'villager' && c.carry === it.id); };
  let t = 0;
  for (; t < 3 * MIN && !picked(); t++) game.tick(1 / 30);
  check(freed && picked(),
    `grab from arms (${kind}, seed ${seed}): taking it frees it (carriedBy ${it.carriedBy === null ? 'cleared' : it.carriedBy}, ${freed ? 'freed at the grab' : 'still carried after the grab'}) and a villager picks it up again (${picked() ? `after ${(t / 30).toFixed(0)} s` : 'not within 3 minutes'})`);
}

// ---- blueprints do not extend the village influence (round 43). A blueprint may go within
// buildingInfluenceR of a finished building of ours (or within influenceR of the temple), not of an
// unbuilt blueprint. Before, any building not wrecked counted, so blueprints placed one from the next
// chained across the island without anything being built (6 store blueprints reached 2.8 tiles
// from the rival centre). Seed 1: a store blueprint on the in-range spot farthest from the
// temple; a spot near it that was out of range stays out of range while it is a blueprint and is
// accepted once it counts as finished (stage set to 'done' for the test), so that spot fails only on
// influence.
{
  const game = newGame(1);
  const vs = game.systems.village;
  const { world } = game;
  const temple = buildings(game, 'player', 'temple')[0];
  let far = null;
  for (let ty = 1; ty < W - 1; ty++) for (let tx = 1; tx < W - 1; tx++) {
    const d = Math.hypot(tx + 0.5 - temple.x, ty + 0.5 - temple.y);
    if ((!far || d > far.d) && vs.validate('store', tx, ty).ok) far = { tx, ty, d };
  }
  const R = Math.ceil(VILLAGE.buildingInfluenceR);
  const out = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++)
    if (vs.validate('store', far.tx + dx, far.ty + dy).reason === 'out of range (outside the village influence)') out.push([far.tx + dx, far.ty + dy]);
  const b = world.get(vs.placeBlueprint('store', far.tx, far.ty));
  const reason = (p) => vs.validate('store', p[0], p[1]).reason;
  b.stage = 'done';
  const spot = out.find((p) => reason(p) === null);
  const whenDone = spot && reason(spot);
  b.stage = 'blueprint';
  const whenBlueprint = spot && reason(spot);
  check(b && spot && whenBlueprint === 'out of range (outside the village influence)' && whenDone === null,
    `blueprint influence: tile ${spot} beside a store blueprint ${far.d.toFixed(1)} tiles from the temple is "${whenBlueprint ?? 'ok'}" while it is a blueprint and "${whenDone ?? 'ok'}" once finished`);
}

// ---------------------------------------------------------------------------------------------
// 19. Step 3 economy (docs/gameplay-spec.md): one store for grain, wood and ore with a cap on each;
// a finite mine near each village that miners work while the ore stock is under oreTarget;
// foresters replant; saplings grow; forests spread back toward their starting size; rain seeds
// saplings and the rain miracle grows them; a store wreck salvages its ore; the same seed replays
// the same forests and stocks.
{
  const game = newGame(1);
  const vs = game.systems.village, { world } = game;
  const mine = buildings(game, 'player', 'mine')[0];
  const playerOreCarried = () => world.query({ kind: 'ore' }).filter((it) => world.get(it.carriedBy)?.owner === 'player').reduce((s, it) => s + it.amount, 0);
  game.clock.run(2 * MIN, game.tick);
  const s2 = vs.stats().player;
  check(s2.jobs.miner >= 1 && s2.ore > 0 && VILLAGE.mineOre - mine.ore === s2.oreMined && s2.ore + playerOreCarried() === s2.oreMined,
    `miners carry ore from the mine to the store (${s2.jobs.miner} miners, store ore ${s2.ore} + ${playerOreCarried()} carried, mine ${mine.ore} of ${VILLAGE.mineOre}, mined ${s2.oreMined})`);
  game.clock.run(6 * MIN, game.tick);
  const s8 = vs.stats().player;
  check(s8.ore >= VILLAGE.oreTarget && s8.ore <= VILLAGE.oreTarget + VILLAGE.minersPerMine * VILLAGE.oreLoad && s8.jobs.miner === 0,
    `with nothing to spend ore on, mining stops at oreTarget (ore ${s8.ore}, target ${VILLAGE.oreTarget}, ${s8.jobs.miner} miners)`);
  // A villager dropped at the mine becomes a miner.
  const v = villagers(game, 'player').find((u) => u.hp > 0 && u.job !== 'miner');
  world.move(v, mine.x, mine.y, world.heightAt(mine.x, mine.y));
  game.events.emit('landed', { entityId: v.id, speed: 0.5 });
  check(v.job === 'miner' && v.byHand, `a villager dropped at the mine mines (${v.job}, by hand ${v.byHand})`);
  // The mine is no finished building of the town: it does not widen where the player may build.
  // Spots within 3 tiles of it that neither temple nor any other finished building reaches stay out
  // of range.
  const others = world.query({ kind: 'building' }).filter((b) => b.stage === 'done' && b.type !== 'mine');
  const temples = others.filter((b) => b.type === 'temple');
  const reached = (x, y) => temples.some((t) => Math.hypot(t.x - x, t.y - y) <= VILLAGE.influenceR) ||
    others.some((b) => Math.hypot(b.x - x, b.y - y) <= VILLAGE.buildingInfluenceR);
  const spots = [];
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (!reached(mine.x + dx, mine.y + dy)) spots.push([mine.x + dx, mine.y + dy]);
  const widened = spots.filter(([x, y]) => vs.sim.inTown(x, y));
  check(spots.length >= 5 && widened.length === 0, `the mine does not extend the village influence (${widened.length} of ${spots.length} spots beside it count as town)`);
}
{
  // The mine runs out: its last ore goes to the store, it says so once, and no one mines it after.
  const game = newGame(2);
  const vs = game.systems.village, { world } = game;
  const mine = buildings(game, 'player', 'mine')[0];
  mine.ore = 250;
  let empties = 0;
  game.events.on('mine-empty', (p) => { if (p.buildingId === mine.id) empties++; });
  game.clock.run(4 * MIN, game.tick);
  const s = vs.stats().player;
  check(mine.ore === 0 && empties === 1 && s.ore === 250 && s.jobs.miner === 0,
    `a mine worked out: ore ${mine.ore} left, ${empties} mine-empty event, all 250 in the store (${s.ore}), ${s.jobs.miner} miners after`);
  // Loose ore in the village is still brought in once the mine is worked out (Codex review, PR #9:
  // only miners take loose ore, and none were dealt without ore in a mine).
  const store = buildings(game, 'player', 'store').find((b) => b.stage === 'done');
  const at = { x: store.x + 3, y: store.y + 2 };
  const pile = world.spawn('ore', { x: at.x, y: at.y, z: world.heightAt(at.x, at.y), vx: 0, vy: 0, vz: 0, amount: 250, grabbable: true, carriedBy: null, madeBy: 'village' });
  const o0 = vs.stats().player.ore;
  game.clock.run(2 * MIN, game.tick);
  check(!world.get(pile.id) && vs.stats().player.ore === o0 + 250, `with the mine worked out, a 250-ore pile in the village is carried to the store (${world.get(pile.id) ? 'still lying' : 'taken'}, store ${o0} -> ${vs.stats().player.ore})`);
  // Ore within workRadius of the village centre but outside the influence (beside the mine, which
  // stands outside it) is brought in as well.
  const vill = vs.sim.village('player');
  let byMine = null;
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const x = Math.floor(mine.x) + dx + 0.5, y = Math.floor(mine.y) + dy + 0.5;
    if (!byMine && Math.hypot(x - vill.cx, y - vill.cy) <= VILLAGE.workRadius && !vs.sim.inTown(x, y) && vs.sim.paths.walkable(Math.floor(x), Math.floor(y))) byMine = { x, y };
  }
  const minePile = byMine && world.spawn('ore', { x: byMine.x, y: byMine.y, z: world.heightAt(byMine.x, byMine.y), vx: 0, vy: 0, vz: 0, amount: 100, grabbable: true, carriedBy: null, madeBy: 'village' });
  const oM = vs.stats().player.ore;
  if (minePile) game.clock.run(2 * MIN, game.tick);
  check(minePile && !world.get(minePile.id) && vs.stats().player.ore === oM + 100,
    `a 100-ore pile by the mine, outside the influence, is carried in (${!minePile ? 'no spot found' : world.get(minePile.id) ? 'still lying' : 'taken'}, store ${oM} -> ${vs.stats().player.ore})`);
  // Ore by an outlying store, past workRadius of the village centre but inside the influence, is
  // brought in too (Codex review, PR #9: only ore within workRadius of the centre was). Stores are
  // placed outward, each counted as finished, until one stands more than 2 tiles past workRadius.
  const R = VILLAGE.workRadius + 12;
  let edge = null;
  for (let n = 0; n < 6 && !edge; n++) {
    let far = null;
    for (let ty = Math.floor(vill.cy) - R; ty <= vill.cy + R; ty++) for (let tx = Math.floor(vill.cx) - R; tx <= vill.cx + R; tx++) {
      const d = Math.hypot(tx + 0.5 - vill.cx, ty + 0.5 - vill.cy);
      if ((!far || d > far.d) && vs.validate('store', tx, ty).ok) far = { tx, ty, d };
    }
    if (!far) break;
    const b = world.get(vs.placeBlueprint('store', far.tx, far.ty));
    b.stage = 'done';
    if (far.d > VILLAGE.workRadius + 2) edge = b;
  }
  let spot = null;
  for (let dy = -3; dy <= 3 && edge; dy++) for (let dx = -3; dx <= 3; dx++) {
    const x = Math.floor(edge.x) + dx + 0.5, y = Math.floor(edge.y) + dy + 0.5;
    const d = Math.hypot(x - vill.cx, y - vill.cy);
    if (d > VILLAGE.workRadius + 1 && vs.sim.inTown(x, y) && vs.sim.paths.walkable(Math.floor(x), Math.floor(y)) && (!spot || d > spot.d)) spot = { x, y, d };
  }
  const outer = spot && world.spawn('ore', { x: spot.x, y: spot.y, z: world.heightAt(spot.x, spot.y), vx: 0, vy: 0, vz: 0, amount: 250, grabbable: true, carriedBy: null, madeBy: 'village' });
  const o1 = vs.stats().player.ore;
  if (outer) game.clock.run(3 * MIN, game.tick);
  check(outer && !world.get(outer.id) && vs.stats().player.ore === o1 + 250,
    `a 250-ore pile by an outlying store ${spot?.d.toFixed(1) ?? '?'} tiles from the village centre is carried in (${!outer ? 'no outlying spot found' : world.get(outer.id) ? 'still lying' : 'taken'}, store ${o1} -> ${vs.stats().player.ore})`);
  // Ore past workRadius and outside the influence stays where it lies: no miner is dealt for it.
  let beyond = null;
  for (let dy = -8; dy <= 8 && edge; dy++) for (let dx = -8; dx <= 8; dx++) {
    const x = Math.floor(edge.x) + dx + 0.5, y = Math.floor(edge.y) + dy + 0.5;
    const d = Math.hypot(x - edge.x, y - edge.y);
    if (Math.hypot(x - vill.cx, y - vill.cy) > VILLAGE.workRadius + 1 && !vs.sim.inTown(x, y) && vs.sim.paths.walkable(Math.floor(x), Math.floor(y)) && (!beyond || d < beyond.d)) beyond = { x, y, d };
  }
  const away = beyond && world.spawn('ore', { x: beyond.x, y: beyond.y, z: world.heightAt(beyond.x, beyond.y), vx: 0, vy: 0, vz: 0, amount: 250, grabbable: true, carriedBy: null, madeBy: 'village' });
  let maxMiners = 0;
  for (let t = 0; away && t < 3 * MIN; t++) { game.tick(1 / 30); maxMiners = Math.max(maxMiners, vs.stats().player.jobs.miner); }
  check(away && world.get(away.id) && maxMiners === 0,
    `a 250-ore pile outside the influence and past workRadius stays (${!away ? 'no spot found' : world.get(away.id) ? 'still lying' : 'taken'}, ${beyond?.d.toFixed(1) ?? '?'} tiles from the edge store, at most ${maxMiners} miners)`);
}
{
  // The store's cap: grain beyond storeCap is not taken in, and with every store full of grain no one
  // farms (the crop waits in the fields).
  const game = newGame(3);
  const vs = game.systems.village, { world } = game;
  const store = buildings(game, 'player', 'store')[0];
  store.grain = VILLAGE.storeCap - 30;
  let most = 0;
  for (let i = 0; i < 3 * MIN; i++) { game.tick(1 / 30); most = Math.max(most, store.grain); }
  const s = vs.stats().player;
  check(most <= VILLAGE.storeCap && store.grain >= VILLAGE.storeCap - 30 - 400 && s.jobs.farmer === 0,
    `a store never holds more than storeCap grain (most ${most}, cap ${VILLAGE.storeCap}), and a full store sends no one to farm (${s.jobs.farmer} farmers)`);
}
{
  // Foresters replant: every tree felled outside town land has a sapling of its kind where it stood;
  // trees felled on town land (either village's influence) leave it clear for building, as before
  // step 3. Saplings grow 1/treeGrowTime a second.
  const game = newGame(1);
  const { world } = game;
  const vs = game.systems.village;
  const before = new Map(world.query({ kind: 'tree' }).map((t) => [t.id, { x: t.x, y: t.y, species: t.species, town: vs.sim.inTown(t.x, t.y) }]));
  game.clock.run(3 * MIN, game.tick);
  const gone = [...before].filter(([id]) => !world.get(id)).map(([, t]) => t);
  const now = world.query({ kind: 'tree' });
  const sapling = (t) => now.some((n) => !before.has(n.id) && n.species === t.species && Math.abs(n.x - t.x) < 1e-9 && Math.abs(n.y - t.y) < 1e-9);
  const wild = gone.filter((t) => !t.town), town = gone.filter((t) => t.town);
  check(wild.length >= 2 && wild.every(sapling), `foresters replant: ${wild.filter(sapling).length} of ${wild.length} trees felled outside town land have a sapling of their kind on their spot`);
  check(town.length >= 2 && !town.some(sapling), `trees felled on town land are not replanted (${town.filter(sapling).length} of ${town.length})`);
  const young = now.filter((t) => !before.has(t.id) && t.growth < 0.4);
  const g0 = new Map(young.map((t) => [t.id, t.growth]));
  game.clock.run(60 * 30, game.tick);
  const grew = young.filter((t) => world.get(t.id) && Math.abs(t.growth - g0.get(t.id) - 60 / VILLAGE.treeGrowTime) < 0.01);
  check(young.length > 0 && grew.length === young.filter((t) => world.get(t.id)).length,
    `saplings grow ${(60 / VILLAGE.treeGrowTime).toFixed(2)} a minute (${grew.length} of ${young.length})`);
  // A sapling the hand moves keeps growing where it is set down; a moved grown tree felled by a
  // forester is not replanted where it lay.
  const s0 = young.find((t) => world.get(t.id));
  s0.held = true; game.tick(1 / 30); s0.held = false; s0.uprooted = true;
  const g1 = s0.growth;
  game.clock.run(30 * 30, game.tick);
  check(s0.growth > g1 + 0.1, `a sapling picked up and set down keeps growing (${g1.toFixed(3)} -> ${s0.growth.toFixed(3)})`);
}
/** Clears up to n trees far from both villages (a wild wood), as the hand would, and returns them. */
function clearWood(game, n) {
  const { world } = game;
  const far = (t) => Math.min(Math.hypot(t.x - world.sites.village.x, t.y - world.sites.village.y), Math.hypot(t.x - world.sites.rival.x, t.y - world.sites.rival.y));
  const list = world.query({ kind: 'tree' }).filter((t) => far(t) > 30).sort((a, b) => a.y - b.y || a.x - b.x).slice(0, n);
  for (const t of list) removeTree(world, t);
  return list;
}
function forestRun(seed) {
  const game = newGame(seed);
  const vs = game.systems.village, { world } = game;
  const cap = vs.stats().treeCap;
  const cleared = clearWood(game, 60);
  const known = new Set(world.query({ kind: 'tree' }).map((t) => t.id));
  // Spots of the trees standing now: a new tree on one of them is a forester's replanting, not spread.
  const spot = (t) => `${t.x},${t.y}`;
  const stood = new Set(world.query({ kind: 'tree' }).map(spot));
  const fresh = [];
  let most = 0, bad = [];
  for (let i = 0; i < 6 * MIN; i++) {
    game.tick(1 / 30);
    if (i % 30) continue;
    const trees = world.query({ kind: 'tree' });
    most = Math.max(most, trees.length);
    for (const t of trees) {
      if (known.has(t.id)) continue;
      known.add(t.id);
      if (stood.has(spot(t))) continue; // replanted
      fresh.push(t);
      const tx = Math.floor(t.x), ty = Math.floor(t.y);
      const nearB = buildings(game, 'player').concat(buildings(game, 'rival')).some((b) => Math.max(0, Math.hypot(Math.max(b.tx - t.x, 0, t.x - (b.tx + b.fw)), Math.max(b.ty - t.y, 0, t.y - (b.ty + b.fh)))) <= VILLAGE.spreadClear);
      if (world.ground[ty * W + tx] !== 3 || nearB || vs.sim.inTown(t.x, t.y)) bad.push(`${t.x.toFixed(1)},${t.y.toFixed(1)}`);
    }
  }
  return { game, cap, cleared, fresh, most, bad, trees: world.query({ kind: 'tree' }).map((t) => `${t.x.toFixed(3)},${t.y.toFixed(3)},${t.species},${t.growth.toFixed(4)}`).join(';'), stats: JSON.stringify(vs.stats()) };
}
{
  const a = forestRun(4), b = forestRun(4);
  const spread = a.fresh.filter((t) => !a.cleared.some((c) => Math.abs(c.x - t.x) < 1e-9 && Math.abs(c.y - t.y) < 1e-9));
  check(spread.length >= 10 && a.most <= a.cap, `forests spread back: ${spread.length} saplings seeded in 6 minutes after 60 trees were cleared, never more than the ${a.cap} the island started with (most ${a.most})`);
  check(a.bad.length === 0, `seeded saplings stand on grass, clear of buildings and off town land${a.bad.length ? ` (${a.bad.slice(0, 5).join(' ')})` : ''}`);
  check(a.trees === b.trees && a.stats === b.stats, 'the same seed replays the same forests, stocks and jobs');
}
{
  // A rock anywhere on a tile keeps saplings off it, wherever on the tile the seed lands (Codex
  // review, PR #9: from a corner point the old radius-1 search missed a rock in the opposite corner).
  const game = newGame(1);
  const vs = game.systems.village, { world } = game;
  let tile = null;
  for (let ty = 20; ty < W - 20 && !tile; ty++) for (let tx = 20; tx < W - 20 && !tile; tx++)
    if (vs.sim.seedable(tx + 0.5, ty + 0.5) && vs.sim.seedable(tx + 0.01, ty + 0.01)) tile = { tx, ty };
  const rock = world.spawn('rock', { x: tile.tx + 0.99, y: tile.ty + 0.99, vx: 0, vy: 0, vz: 0, size: 1, grabbable: true, hp: 1 });
  check(!vs.sim.seedable(tile.tx + 0.01, tile.ty + 0.01) && !vs.sim.seedable(tile.tx + 0.5, tile.ty + 0.5),
    `no sapling on a tile with a rock in its far corner (tile ${tile.tx},${tile.ty}, rock at +0.99)`);
  world.remove(rock.id);
  check(vs.sim.seedable(tile.tx + 0.01, tile.ty + 0.01), 'the same tile takes a sapling once the rock is gone');
}
{
  // Rain seeds saplings on free grass under the cloud, and the rain miracle grows them.
  const game = newGame(5);
  const vs = game.systems.village, { world } = game;
  const cleared = clearWood(game, 80);
  const c = cleared[40];
  const ids = new Set(world.query({ kind: 'tree' }).map((t) => t.id));
  game.state.power = VILLAGE.powerCap;
  const cast = game.systems.miracles.cast('rain', c.x, c.y);
  game.clock.run(5 * 30, game.tick);
  const early = world.query({ kind: 'tree', x: c.x, y: c.y, r: 4 }).filter((t) => !ids.has(t.id));
  game.clock.run(5 * 30, game.tick);
  const sprouts = world.query({ kind: 'tree', x: c.x, y: c.y, r: 4 }).filter((t) => !ids.has(t.id));
  const parentless = sprouts.filter((t) => !world.query({ kind: 'tree', x: t.x, y: t.y, r: 2.9 }).some((o) => o !== t && ids.has(o.id)));
  check(cast && sprouts.length >= 2, `rain seeds saplings under the cloud (${sprouts.length} in 10 s, ${parentless.length} with no grown tree beside them)`);
  // Saplings there by mid-rain have 5 s of it left: 5 x growthRate (0.08/s) on top of treeGrowTime.
  check(early.length && early.every((t) => t.growth > 0.35), `the rain miracle grows its saplings (${early.length} sprouted in the first 5 s, growth ${early.map((t) => t.growth.toFixed(2)).join(' ')} at 10 s)`);
  check(vs.stats().trees <= vs.stats().treeCap, 'rain never grows the island past its starting tree count');
}
{
  // A blueprint placed over a store wreck sets down the wreck's salvage, as clearing it would.
  const game = newGame(2);
  const vs = game.systems.village, { world } = game;
  const store = buildings(game, 'player', 'store')[0];
  Object.assign(store, { grain: 1000, ore: 400 });
  const wood = Math.floor((store.woodHave + store.wood) * VILLAGE.salvageShare);
  store.hp = 0;
  game.tick(1 / 30);
  const at = { x: store.x, y: store.y };
  const id = vs.placeBlueprint('store', store.tx + 1, store.ty + 1);
  const piles = (kind) => world.query({ kind, x: at.x, y: at.y, r: 0.5 }).reduce((s, it) => s + it.amount, 0);
  check(id !== null && !world.get(store.id) && piles('grain') === 750 && piles('ore') === 300 && piles('wood') === wood,
    `a blueprint over a store wreck leaves its salvage (grain ${piles('grain')}, ore ${piles('ore')}, wood ${piles('wood')})`);
}
{
  // A store wreck: clearing it salvages salvageShare of its ore as a pile on its spot.
  const game = newGame(1);
  const { world } = game;
  const store = buildings(game, 'player', 'store')[0];
  store.ore = 1000;
  store.hp = 0;
  game.tick(1 / 30);
  const at = { x: store.x, y: store.y };
  let pile = null;
  for (let i = 0; i < 5 * MIN && !pile; i++) {
    game.tick(1 / 30);
    if (!world.get(store.id)) pile = world.query({ kind: 'ore', x: at.x, y: at.y, r: 0.5 })[0] ?? 'none';
  }
  check(pile && pile !== 'none' && pile.amount === Math.floor(1000 * VILLAGE.salvageShare),
    `clearing a store wreck leaves its ore salvage on the spot (${pile === 'none' ? 'none' : pile?.amount ?? 'wreck not cleared'}, want ${Math.floor(1000 * VILLAGE.salvageShare)})`);
}

// ---------------------------------------------------------------------------------------------
// Step 4: jobs by hand on top of automatic. A slow drop sets a job for good; a shake clears it; a
// throw sets none; a job whose place is gone goes back to automatic; breeders bring births sooner.
{
  const game = newGame(1);
  const vs = game.systems.village, { world } = game;
  /** Lets villager v go at (x, y) as the hand reports it: `how` is 'drop', 'throw' or 'shake'. */
  const letGo = (v, x, y, how = 'drop') => {
    world.move(v, x, y, world.heightAt(x, y));
    game.events.emit('release', { entityId: v.id, kind: 'villager', x, y, z: v.z, vx: 0, vy: 0, vz: 0, thrown: how === 'throw', shaken: how === 'shake' });
    game.events.emit('landed', { entityId: v.id, speed: 0.5 });
  };
  const fields = buildings(game, 'player', 'field');
  const autoFarmers = Math.min(fields.length, villagers(game, 'player').length);
  // Four villagers dropped on the fields: more farmers than automatic assignment deals (one per field).
  const four = villagers(game, 'player').filter((v) => v.job !== 'farmer').slice(0, 4);
  four.forEach((v, i) => letGo(v, fields[i % fields.length].x, fields[i % fields.length].y));
  check(four.every((v) => v.job === 'farmer' && v.byHand), `dropped on a field: a farmer by hand (${four.map((v) => `${v.job}/${v.byHand}`).join(', ')})`);
  game.clock.run(3 * MIN, game.tick);
  const farmers = vs.stats().player.jobs.farmer;
  check(four.every((v) => v.job === 'farmer' && v.byHand) && farmers >= 4 && farmers > autoFarmers,
    `a job set by hand outlasts the old 90 s lock and automatic assignment (after 3 min: ${farmers} farmers, automatic deals ${autoFarmers}; ${four.map((v) => v.job).join(', ')})`);
  // The villagers show it: the village draws a hand-set villager with the glow, and only those.
  game.systems.village.draw({});
  const looks = (v, glow) => getSprite('villager', { job: v.job, pose: v.pose, frame: v.frame, facing: v.facing, owner: v.owner, glow });
  const plain = villagers(game, 'player').find((v) => !v.byHand);
  check(four[0].sprite === looks(four[0], true) && looks(four[0], true) !== looks(four[0], false) && plain.sprite === looks(plain, false),
    'the village draws a hand-set villager with its glow and the others without');

  // A shake clears the job and hands the villager back: landing by a field does not set it again.
  const shaken = four[0];
  letGo(shaken, fields[0].x, fields[0].y, 'shake');
  check(!shaken.byHand, `a shake clears a hand-set job (by hand ${shaken.byHand})`);
  game.clock.run(MIN, game.tick);
  check(!shaken.byHand, `the shaken villager stays under automatic assignment (job ${shaken.job}, by hand ${shaken.byHand})`);
  // A throw that lands by the mine sets no job.
  const mine = buildings(game, 'player', 'mine')[0];
  const thrown = villagers(game, 'player').find((v) => !v.byHand && v.job !== 'miner' && v.hp > 0);
  const before = thrown.job;
  letGo(thrown, mine.x, mine.y, 'throw');
  check(thrown.job === before && !thrown.byHand, `a throw sets no job (${before} -> ${thrown.job}, by hand ${thrown.byHand})`);
  // A job whose place is gone goes back to automatic assignment: a miner by hand at a worked-out mine.
  letGo(thrown, mine.x, mine.y);
  check(thrown.job === 'miner' && thrown.byHand, `a slow drop by the mine makes a miner by hand (${thrown.job}, ${thrown.byHand})`);
  // A fire on the mine is not the mine gone (Codex review: usable() cleared the job while it burned).
  mine.burning = 1;
  game.clock.run(3 * 30, game.tick);
  check(thrown.job === 'miner' && thrown.byHand, `a hand-set miner keeps the job while the mine burns (${thrown.job}, by hand ${thrown.byHand})`);
  mine.burning = 0;
  mine.ore = 0;
  game.clock.run(3 * 30, game.tick);
  check(!thrown.byHand, `a hand-set miner goes back to automatic once the mine is worked out (job ${thrown.job}, by hand ${thrown.byHand})`);
}
{
  // Breeders: dropped on a house, or next to another adult away from any building; births come sooner.
  const births = (breed) => {
    const game = newGame(1);
    const { world } = game;
    const store = buildings(game, 'player', 'store')[0];
    store.grain = 20000;
    const houses = buildings(game, 'player', 'house');
    const list = villagers(game, 'player').slice(0, breed);
    list.forEach((v, i) => {
      const h = houses[i % houses.length];
      world.move(v, h.x, h.y, world.heightAt(h.x, h.y));
      game.events.emit('release', { entityId: v.id, kind: 'villager', x: h.x, y: h.y, z: v.z, vx: 0, vy: 0, vz: 0, thrown: false, shaken: false });
    });
    const ok = list.every((v) => v.job === 'breeder' && v.byHand);
    const n0 = villagers(game, 'player').length;
    game.clock.run(MIN, game.tick);
    return { ok, born: villagers(game, 'player').length - n0, game };
  };
  const cap = KINDS.house.cap;
  KINDS.house.cap = 20; // room in the houses, so births are paced by the timer alone
  let base, bred;
  try { base = births(0); bred = births(4); } finally { KINDS.house.cap = cap; }
  check(bred.ok, 'villagers dropped on houses become breeders by hand');
  check(bred.born >= 2 * base.born + 2, `breeders bring births sooner (1 minute: ${bred.born} born with 4 breeders, ${base.born} with none)`);
  // Next to another adult, clear of every building and tree: a breeder too.
  const game = bred.game, { world } = game;
  const vs = game.systems.village;
  const all = villagers(game, 'player');
  const R = VILLAGE.dropRadius + 1;
  const clear = (x, y) => world.query({ kind: 'building' }).every((b) => Math.hypot(b.x - x, b.y - y) > R + 3) &&
    !world.query({ kind: 'tree', x, y, r: R + 1 }).length && vs.sim.paths.walkable(Math.floor(x), Math.floor(y));
  const st = buildings(game, 'player', 'temple')[0];
  let spot = null;
  for (let r = 4; r < 30 && !spot; r++) for (let a = 0; a < 16 && !spot; a++) {
    const x = st.x + Math.cos(a * Math.PI / 8) * r, y = st.y + Math.sin(a * Math.PI / 8) * r;
    if (clear(x, y) && clear(x + 0.6, y)) spot = { x, y };
  }
  const host = all.find((v) => !v.byHand), guest = all.find((v) => v !== host && !v.byHand);
  if (check(spot && host && guest, 'found open ground clear of buildings and trees, and two villagers')) {
    world.move(host, spot.x, spot.y, world.heightAt(spot.x, spot.y));
    world.move(guest, spot.x + 0.6, spot.y, world.heightAt(spot.x + 0.6, spot.y));
    game.events.emit('release', { entityId: guest.id, kind: 'villager', x: guest.x, y: guest.y, z: guest.z, vx: 0, vy: 0, vz: 0, thrown: false, shaken: false });
    check(guest.job === 'breeder' && guest.byHand, `dropped next to another adult: a breeder (${guest.job})`);
    // An adult still in the air (a group put out of the hand lands side by side) does not count.
    const third = all.find((v) => v !== host && v !== guest && !v.byHand);
    host.airborne = true;
    const before = third.job;
    world.move(third, spot.x - 0.6, spot.y, world.heightAt(spot.x - 0.6, spot.y));
    game.events.emit('release', { entityId: third.id, kind: 'villager', x: third.x, y: third.y, z: third.z, vx: 0, vy: 0, vz: 0, thrown: false, shaken: false });
    host.airborne = false;
    check(third.job === before && !third.byHand, `dropped next to an adult still in the air: no breeder (${before} -> ${third.job})`);
  }
  // A workplace in reach beats an adult standing closer: dropped 1.3 tiles off a field beside
  // another villager, a farmer.
  {
    const field = buildings(game, 'player', 'field').find((b) => b.hp > 0);
    const [x, y] = [field.tx + field.fw + 1.3, field.ty + 1.5];
    const [stand, drop] = all.filter((v) => !v.byHand && !v.dying).slice(-2);
    world.move(stand, x, y + 0.05, world.heightAt(x, y + 0.05));
    world.move(drop, x, y, world.heightAt(x, y));
    game.events.emit('release', { entityId: drop.id, kind: 'villager', x, y, z: drop.z, vx: 0, vy: 0, vz: 0, thrown: false, shaken: false });
    check(drop.job === 'farmer', `dropped by a field next to another adult: a farmer (${drop.job})`);
  }
  // A rival villager dropped by its temple takes the job, but under the rival's own automatic
  // assignment: the player's hand never freezes the rival's jobs.
  {
    const rt = buildings(game, 'rival', 'temple')[0];
    const rv = villagers(game, 'rival').find((v) => !v.dying && v.job !== 'worshipper');
    const [x, y] = [rt.tx + rt.fw + 0.5, rt.ty + 1.5];
    world.move(rv, x, y, world.heightAt(x, y));
    game.events.emit('release', { entityId: rv.id, kind: 'villager', x, y, z: rv.z, vx: 0, vy: 0, vz: 0, thrown: false, shaken: false });
    check(rv.job === 'worshipper' && !rv.byHand, `a rival villager dropped by its temple prays, not set by hand (${rv.job}, by hand ${rv.byHand})`);
  }
  // With no house left standing, breeders go back to automatic assignment.
  for (const h of buildings(game, 'player', 'house')) h.hp = 0;
  game.clock.run(3 * 30, game.tick);
  const left = villagers(game, 'player').filter((v) => v.job === 'breeder');
  check(left.length === 0, `breeders go back to automatic once no house stands (${left.length} breeders left)`);
}

console.log(`check-village: ${passes} passed, ${fails.length} failed`);
process.exitCode = fails.length ? 1 : 0;

// Miracles check, node only (no browser). Runs the shared drive from src/miracles/testbed.js on
// createGame() (orbs, each miracle cast through the hand path, fizzle, respawn, power accounting),
// then: fire spread is deterministic for a seed, burning stops under rain and stays out, heal mends
// houses and trees that lightning and fire left standing (not wrecks), costs and
// power accounting are exact, the pedestals follow the player temple building (not the map's temple
// site) at its base height, and the miracles update never touches the DOM.
//
//   node scripts/check-miracles.mjs
//
// Exits 1 and prints each failing assertion.
import { createGame } from '../src/game.js';
import { registerPainters } from '../src/art/registry.js';
import * as testPattern from '../src/art/painters/test-pattern.js';
import { buildIsland } from '../src/world/island.js';
import { runMiracleSuite } from '../src/miracles/testbed.js';
import { TUNING } from '../src/miracles/tuning.js';

// Spots below are written round the player village's 64 x 64 centre (20, 40); OX, OY move them to
// where the village stands on the island now.
const { village: V0 } = buildIsland().sites;
const OX = V0.x - 20, OY = V0.y - 40;

registerPainters(testPattern);

const results = [];
const assert = (ok, msg) => { results.push({ ok: !!ok, msg }); return !!ok; };

// ---- DOM traps: any read of a browser global during a miracles update is counted
let inUpdate = false;
const touched = [];
for (const name of ['window', 'document', 'requestAnimationFrame', 'HTMLCanvasElement', 'ImageData', 'localStorage']) {
  const had = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() {
      if (inUpdate) touched.push(name);
      return had && 'value' in had ? had.value : had?.get?.call(globalThis);
    },
  });
}
function watch(game) {
  const sys = game.systems.miracles;
  const update = sys.update;
  sys.update = (dt) => { inUpdate = true; try { update(dt); } finally { inUpdate = false; } };
  return game;
}
const nodeT = (game) => ({
  step: (s) => game.clock.run(Math.max(1, Math.round(s / game.clock.step)), game.tick),
  assert,
  log: (...a) => console.log('  log', ...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))),
});

// ---- 1. the shared drive
{
  const game = watch(createGame({ seed: 1 }));
  await runMiracleSuite(nodeT(game), game);
}

// ---- 2. fire spread is deterministic for a seed
function fireRun(seed, { rainAt = null } = {}) {
  const game = watch(createGame({ seed }));
  game.world.loadMap(buildIsland());
  game.state.power = 0;
  const row = [];
  for (let i = 0; i < 8; i++) {
    row.push(game.world.spawn('building', { x: OX + 16 + i * 1.2, y: OY + 40.5, vx: 0, vy: 0, vz: 0, hp: 1, flammable: true }));
  }
  const M = game.systems.miracles;
  M.cast('fire', OX + 16, OY + 40.5, { free: true });
  const t = nodeT(game);
  const sig = [];
  let afterRain = null;
  for (let k = 0; k < 40; k++) {
    if (rainAt !== null && k === rainAt) {
      M.cast('rain', OX + 20, OY + 40.5, { free: true });
      afterRain = k;
    }
    t.step(0.5);
    sig.push(row.map((e) => `${(e.burning ?? 0).toFixed(9)}/${e.hp.toFixed(9)}`).join(','));
  }
  const caught = row.filter((e) => e.hp < 1).length;
  return { sig: sig.join('|'), caught, row, game, afterRain };
}
{
  const a = fireRun(3), b = fireRun(3), c = fireRun(4);
  assert(a.caught > 2, `fire spread past its radius along a row of houses (${a.caught} of 8 burned)`);
  assert(a.sig === b.sig, 'fire spread is identical for the same seed');
  console.log(`  info: seed 3 burned ${a.caught}/8, seed 4 burned ${c.caught}/8, same timeline: ${a.sig === c.sig}`);
}

// ---- 3. burning stops under rain and stays out while it rains
{
  const T = TUNING.rain;
  const game = watch(createGame({ seed: 5 }));
  game.world.loadMap(buildIsland());
  game.state.power = 0;
  const row = [];
  for (let i = 0; i < 5; i++) row.push(game.world.spawn('building', { x: OX + 18 + i * 1.2, y: OY + 40.5, vx: 0, vy: 0, vz: 0, hp: 1, flammable: true }));
  const M = game.systems.miracles, t = nodeT(game);
  for (const e of row) M.ignite(e, 1);
  t.step(1);
  assert(row.every((e) => e.burning > 0), 'test row burns before the rain');
  M.cast('rain', OX + 20.4, OY + 40.5, { free: true });
  t.step(T.extinguishTime + 0.1);
  assert(row.every((e) => e.burning === 0), `rain puts out every fire in range within ${T.extinguishTime} s (${row.map((e) => e.burning.toFixed(2))})`);
  assert(row.every((e) => !M.fire.states.has(e.id)), 'no fire state or flame effect left on the doused houses');
  let relit = 0;
  for (let i = 0; i < 60; i++) { t.step(0.1); relit += row.filter((e) => e.burning > 0).length; }
  assert(relit === 0, 'nothing reignites while it rains');
  assert(!M.ignite(row[0], 1) && M.isRaining(row[0].x, row[0].y), 'ignite refuses a house in the rain');
  t.step(T.duration);
  assert(!M.isRaining(row[0].x, row[0].y) && M.ignite(row[0], 1), 'after the rain the house can catch again');
}

// ---- 3b. a tree that burns to hp 0 is removed; a house at hp 0 is left to the village
{
  const game = watch(createGame({ seed: 2 }));
  game.world.loadMap(buildIsland());
  const tree = game.world.spawn('tree', { x: OX + 20.5, y: OY + 40.5, vx: 0, vy: 0, vz: 0, hp: 0.3, flammable: true, growth: 1 });
  const house = game.world.spawn('building', { x: OX + 30.5, y: OY + 30.5, vx: 0, vy: 0, vz: 0, hp: 0.3, flammable: true });
  const M = game.systems.miracles, t = nodeT(game);
  M.ignite(tree, 1);
  M.ignite(house, 1);
  t.step(2);
  assert(tree.hp < 0.3 && game.world.get(tree.id), `burning tree loses hp (${tree.hp.toFixed(3)})`);
  const flames = [...M.fire.states.values()].map((s) => s.fx);
  assert(flames.length === 2 && flames.every((h) => game.fx.live.includes(h)), 'each burning entity carries a live flame effect');
  t.step(8);
  assert(!game.world.get(tree.id), 'tree burnt to hp 0 is removed');
  assert(game.world.get(house.id) && house.hp === 0 && house.burning === 0 && M.fire.charred.has(house.id), 'house at hp 0 stays for its owner, fire out, charred');
  assert(!M.ignite(house, 1), 'a charred house does not catch again');
  assert(M.fire.states.size === 0 && flames.every((h) => !game.fx.live.includes(h)), 'no flames left after the fires burn out');
}

// ---- 3c. one fire cast in the player village burns a small cluster, then goes out
// Real village (village.setup()). For seeds 1-6: a cast on the village centre destroys 1-4 buildings,
// spreads to at most spreadBudget entities past the ones the cast lit, and every fire is out within
// one burn per generation the blaze can reach; a cast on a house destroys that house; for seeds 1-8 a
// cast on the most central house wrecks it, destroys 1-4 buildings and usually a neighbour; a cast on
// the temple leaves it standing.
{
  const F = TUNING.fire;
  const bound = F.igniteDelay + (F.spreadBudget + 1) * (F.burnTime + F.fadeTime);
  const villageGame = (seed) => {
    const game = watch(createGame({ seed }));
    game.world.loadMap(buildIsland());
    game.systems.village.setup();
    const destroyed = [];
    game.events.on('building-destroyed', (p) => destroyed.push(game.world.get(p.buildingId)?.type ?? p.kind));
    return { game, destroyed, M: game.systems.miracles, t: nodeT(game) };
  };
  const lit = (game) => [...game.world.entities.values()].filter((e) => e.burning > 0).map((e) => e.id);
  const rows = [];
  for (let seed = 1; seed <= 6; seed++) {
    const { game, destroyed, M, t } = villageGame(seed);
    const site = game.world.sites.village;
    M.cast('fire', site.x + 0.5, site.y + 0.5, { free: true });
    t.step(F.igniteDelay + 0.05);
    const byCast = new Set(lit(game));
    const caught = new Set(byCast);
    let outAt = null;
    for (let s = 0; s < 60 * 30; s++) {
      t.step(1 / 30);
      for (const id of lit(game)) caught.add(id);
      if (outAt === null && M.fire.states.size === 0 && lit(game).length === 0) outAt = F.igniteDelay + 0.05 + (s + 1) / 30;
    }
    rows.push({ seed, destroyed: destroyed.length, types: destroyed.join('/'), byCast: byCast.size, spread: caught.size - byCast.size, outAt });
  }
  const fmtRow = (r) => `seed ${r.seed}: ${r.destroyed} (${r.types}), spread ${r.spread}, out at ${r.outAt?.toFixed(1)} s`;
  assert(rows.every((r) => r.destroyed >= 1 && r.destroyed <= 4), `a fire cast on the village centre destroys 1-4 buildings (${rows.map((r) => `${r.seed}: ${r.destroyed}`).join(', ')})`);
  assert(rows.every((r) => r.byCast >= 1 && r.spread <= F.spreadBudget), `spread past the cast stays within the blaze budget of ${F.spreadBudget} (${rows.map((r) => r.spread).join(', ')})`);
  assert(rows.every((r) => r.outAt !== null && r.outAt <= bound), `every fire is out within ${bound.toFixed(1)} s of the cast (${rows.map((r) => r.outAt?.toFixed(1)).join(', ')})`);
  for (const r of rows) console.log(`  info: village fire ${fmtRow(r)}`);

  const houseRows = [];
  for (let seed = 1; seed <= 6; seed++) {
    const { game, destroyed, M, t } = villageGame(seed);
    const house = game.world.query({ kind: 'building' }).find((b) => b.owner === 'player' && b.type === 'house');
    M.cast('fire', house.x, house.y, { free: true });
    t.step(bound);
    houseRows.push({ seed, wrecked: house.stage === 'wrecked' && house.hp === 0, destroyed: destroyed.length });
  }
  assert(houseRows.every((r) => r.wrecked && r.destroyed <= 1 + F.spreadBudget), `a fire cast on a house wrecks that house, ${1 + F.spreadBudget} buildings at most (${houseRows.map((r) => `${r.seed}: ${r.wrecked ? 'wrecked' : 'standing'}, ${r.destroyed}`).join('; ')})`);

  // The house nearest the village centre, seeds 1-8: wrecked, 1-4 buildings in all, every fire out
  // within the bound, the temple standing; on at least half the seeds it takes a neighbour with it.
  const midRows = [];
  for (let seed = 1; seed <= 8; seed++) {
    const { game, destroyed, M, t } = villageGame(seed);
    const site = game.world.sites.village;
    const mine = game.world.query({ kind: 'building' }).filter((b) => b.owner === 'player');
    const house = mine.filter((b) => b.type === 'house').sort((a, b) => Math.hypot(a.x - site.x, a.y - site.y) - Math.hypot(b.x - site.x, b.y - site.y) || a.id - b.id)[0];
    const temple = mine.find((b) => b.type === 'temple');
    M.cast('fire', house.x, house.y, { free: true });
    t.step(F.igniteDelay + 0.05);
    let outAt = null;
    for (let s = 0; s < 60 * 30; s++) {
      t.step(1 / 30);
      if (outAt === null && M.fire.states.size === 0 && lit(game).length === 0) outAt = F.igniteDelay + 0.05 + (s + 1) / 30;
    }
    midRows.push({ seed, wrecked: house.stage === 'wrecked' && house.hp === 0, destroyed: destroyed.length, outAt, temple: temple.stage === 'done' && temple.hp > 0 });
  }
  assert(midRows.every((r) => r.wrecked && r.destroyed >= 1 && r.destroyed <= 4 && r.outAt !== null && r.outAt <= bound && r.temple),
    `a fire cast on the central house wrecks it, 1-4 buildings in all, out within ${bound.toFixed(1)} s, temple standing (${midRows.map((r) => `${r.seed}: ${r.wrecked ? 'wrecked' : 'standing'}, ${r.destroyed}, out ${r.outAt?.toFixed(1)} s${r.temple ? '' : ', temple lost'}`).join('; ')})`);
  const spreadSeeds = midRows.filter((r) => r.destroyed >= 2).length;
  assert(spreadSeeds >= midRows.length / 2, `a fire cast on the central house usually takes neighbours with it (${spreadSeeds} of ${midRows.length} seeds lose 2+)`);

  {
    const { game, M, t } = villageGame(1);
    const temple = game.world.query({ kind: 'building' }).find((b) => b.owner === 'player' && b.type === 'temple');
    M.cast('fire', temple.x, temple.y, { free: true });
    t.step(1);
    const caught = temple.burning > 0;
    t.step(bound);
    assert(caught && temple.hp > 0 && temple.stage === 'done', `a fire cast on the temple scorches it but leaves it standing (caught ${caught}, hp ${temple.hp.toFixed(2)}, ${temple.stage})`);
  }
}

// ---- 3d. heal mends what play damages (round 46). Villagers spawn healthy, can't burn and die
// outright, and the creature is back at full hp every tick, so a paid heal used to change nothing in
// normal play. Real village, real casts: a lightning bolt on a player house while rain keeps its fire
// off, and a fire miracle on a tree that rain then puts out, leave both standing and hurt; a paid heal
// raises both. A burning house is mended but keeps burning; a wreck stays a wreck.
{
  const H = TUNING.heal, L = TUNING.lightning, F = TUNING.fire;
  const villageGame = (seed) => {
    const game = watch(createGame({ seed }));
    game.world.loadMap(buildIsland());
    game.systems.village.setup();
    const houses = game.world.query({ kind: 'building' }).filter((b) => b.owner === 'player' && b.type === 'house');
    return { game, houses, M: game.systems.miracles, t: nodeT(game) };
  };
  const heal = (game, M, t, x, y) => {
    game.state.power = 100;
    const cast = M.cast('heal', x, y);
    t.step(H.delay + 0.05);
    return cast && game.state.power === 100 - TUNING.costs.heal;
  };
  {
    const { game, houses, M, t } = villageGame(1);
    const house = houses[0];
    M.cast('rain', house.x, house.y, { free: true });
    M.cast('lightning', house.x, house.y, { free: true });
    t.step(L.strokes[0] + 0.1);
    const hit = house.hp;
    assert(hit < 1 && hit > 0 && !(house.burning > 0) && house.stage === 'done',
      `lightning in the rain leaves a player house standing and hurt (hp ${hit.toFixed(2)}, burning ${house.burning}, ${house.stage})`);
    const paid = heal(game, M, t, house.x, house.y);
    assert(paid && house.hp > hit && house.hp <= 1 && house.stage === 'done',
      `a paid heal mends the struck house (hp ${hit.toFixed(2)} -> ${house.hp.toFixed(2)}, ${house.stage}, paid ${paid})`);
  }
  {
    const { game, M, t } = villageGame(1);
    const blds = game.world.query({ kind: 'building' });
    const clear = (e) => blds.every((b) => Math.hypot(b.x - e.x, b.y - e.y) > 6);
    const tree = game.world.query({ kind: 'tree' }).filter(clear).sort((a, b) => a.id - b.id)[0];
    M.cast('fire', tree.x, tree.y, { free: true });
    t.step(F.igniteDelay + 1.5);
    M.cast('rain', tree.x, tree.y, { free: true });
    t.step(TUNING.rain.extinguishTime + 0.5);
    const hit = tree.hp;
    assert(game.world.get(tree.id) === tree && hit < 1 && hit > 0 && !(tree.burning > 0),
      `a fire put out by rain leaves a tree standing and hurt (hp ${hit.toFixed(2)}, burning ${tree.burning})`);
    heal(game, M, t, tree.x, tree.y);
    assert(tree.hp > hit && tree.hp <= 1, `heal mends the scorched tree (hp ${hit.toFixed(2)} -> ${tree.hp.toFixed(2)})`);
  }
  {
    const { game, houses, M, t } = villageGame(2);
    const house = houses[0];
    M.cast('fire', house.x, house.y, { free: true });
    t.step(F.igniteDelay + 2);
    const lit = house.burning, hit = house.hp;
    heal(game, M, t, house.x, house.y);
    assert(lit > 0 && house.hp > hit && house.burning > 0,
      `heal mends a burning house but leaves the fire to rain (hp ${hit.toFixed(2)} -> ${house.hp.toFixed(2)}, burning ${lit.toFixed(2)} -> ${house.burning.toFixed(2)})`);
  }
  {
    const { game, houses, M, t } = villageGame(2);
    const house = houses[0];
    M.cast('fire', house.x, house.y, { free: true });
    t.step(F.igniteDelay + F.burnTime + F.fadeTime + 1);
    const was = house.stage;
    heal(game, M, t, house.x, house.y);
    assert(was === 'wrecked' && house.hp === 0 && house.stage === 'wrecked', `heal leaves a wreck a wreck (${was} -> ${house.stage}, hp ${house.hp})`);
  }
}

// ---- 4. costs and power accounting are exact
{
  const game = watch(createGame({ seed: 1 }));
  game.world.loadMap(buildIsland());
  const M = game.systems.miracles;
  const c = M.costs();
  assert(c.rain === 15 && c.heal === 20 && c.fire === 20 && c.lightning === 30, `costs ${JSON.stringify(c)}`);
  c.fire = 0;
  assert(M.costs().fire === 20, 'costs() returns a copy');
  const casts = [];
  game.events.on('miracle-cast', (p) => casts.push(p));
  game.state.power = 20;
  assert(M.cast('fire', 30, 30) === true && game.state.power === 0, `exactly enough power casts and leaves 0 (${game.state.power})`);
  game.state.power = 29.99;
  assert(M.cast('lightning', 30, 30) === false && game.state.power === 29.99 && casts.length === 1, 'too little power: no cast, power untouched');
  game.state.power = 0;
  assert(M.cast('heal', 30, 30, { free: true }) === true && game.state.power === 0 && casts.length === 2, 'free cast at 0 power');
  game.state.power = 100;
  for (const m of ['rain', 'heal', 'fire', 'lightning']) M.cast(m, 25, 25);
  assert(game.state.power === 100 - 15 - 20 - 20 - 30, `four casts spend exactly their costs (${game.state.power})`);
  let threw = false;
  try { M.cast('flood', 1, 1); } catch { threw = true; }
  assert(threw, 'unknown miracle throws');
  delete game.state.power;
  assert(M.cast('rain', 30, 30) === false && game.state.power === undefined, 'missing power counts as 0 and is not created');
  nodeT(game).step(12);
}

// ---- 4b. pedestals follow the player temple building, not the map's temple site
// On the island the site is too steep and the village builds the temple one tile west. The orbs start
// round the site (no temple yet), move onto the temple's painted stones at its base height once the
// village has built it, and leave a held orb where the hand has it.
{
  const game = watch(createGame({ seed: 2 }));
  game.world.loadMap(buildIsland());
  const t = nodeT(game), W = game.world, M = game.systems.miracles, O = TUNING.orbs;
  const site = W.sites.temple;
  t.step(0.1);
  const at = (m) => W.get(M.orbs.orbOn(m));
  const offFrom = (c, m) => { const o = at(m); return o ? [o.x - c.x, o.y - c.y] : null; };
  const matches = (c) => M.orbs.pedestals.every((p) => {
    const d = offFrom(c, p.miracle), want = O.pedestals[p.miracle];
    return d && Math.abs(d[0] - want[0]) < 1e-9 && Math.abs(d[1] - want[1]) < 1e-9;
  });
  assert(matches({ x: site.x + 0.5, y: site.y + 0.5 }), 'no temple building: orbs stand round the temple site tile');
  const held = at('fire');
  game.events.emit('grab', { entityId: held.id, x: held.x, y: held.y, z: held.z, vx: 0, vy: 0, vz: 0 });
  held.held = true;
  const heldAt = [held.x, held.y];
  game.systems.village.setup();
  const temple = W.query({ kind: 'building' }).find((b) => b.type === 'temple' && b.owner === 'player');
  assert(temple && Math.hypot(temple.x - (site.x + 0.5), temple.y - (site.y + 0.5)) > 0.5, `the village built the temple off its site (${temple && [temple.x, temple.y]} vs site ${site.x + 0.5}, ${site.y + 0.5})`);
  t.step(1 / 30);
  const others = ['rain', 'heal', 'lightning'];
  assert(others.every((m) => { const d = offFrom(temple, m), w = O.pedestals[m]; return d && Math.abs(d[0] - w[0]) < 1e-9 && Math.abs(d[1] - w[1]) < 1e-9; }),
    `once the temple stands, the waiting orbs move onto its pedestals (${others.map((m) => `${m} ${offFrom(temple, m)?.map((v) => +v.toFixed(2))}`).join('; ')})`);
  assert(others.every((m) => Math.abs(at(m).z - (temple.z + O.hover)) <= O.bobAmp + 1e-9),
    `they float ${O.hover} above the temple base (z ${temple.z}), not over the ground under each stone (${others.map((m) => `${m} ${at(m).z.toFixed(2)}`).join('; ')})`);
  assert(W.get(held.id) && held.x === heldAt[0] && held.y === heldAt[1], 'a held orb stays in the hand when the pedestals move');
  held.held = false;
  game.events.emit('release', { entityId: held.id, kind: 'orb', miracle: 'fire', x: held.x, y: held.y, z: held.z, vx: 0, vy: 0, vz: 0 });
  game.state.power = 0;
  t.step(O.respawn + 0.2);
  const fresh = offFrom(temple, 'fire');
  assert(fresh && Math.abs(fresh[0] - O.pedestals.fire[0]) < 1e-9 && Math.abs(fresh[1] - O.pedestals.fire[1]) < 1e-9, `the fire orb respawns on the temple's stone (${fresh})`);
}

// ---- 5. update never touched a browser global
assert(touched.length === 0, `miracles update read no browser globals (${[...new Set(touched)].join(', ') || 'none'})`);

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.msg}`);
console.log(`check-miracles: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;

// Shared miracles test drive, used by the browser scenario (src/dev/scenarios/miracles.js) and the node
// check (scripts/check-miracles.mjs). It loads the island, sets power to 100, places test villagers,
// flammable buildings and trees on the player village plateau, and casts each miracle once through
// the hand path with synthetic `grab` / `release` / `landed` events (the hand round is separate), the
// way the hand will: it sets `held`, carries the orb, and moves it through a throw.
//
// t: { step(seconds), assert(cond, msg), log(...), shot?(name) async, focus?(x, y) }
import { buildIsland, SCALE } from '../world/island.js';
import { getSprite } from '../art/registry.js';
import { TUNING } from './tuning.js';

// Written round the player village's 64 x 64 centre (20, 40); the island is drawn SCALE times larger
// now (src/world/island.js), which moves the village to (20, 40) x SCALE.
const OX = 20 * (SCALE - 1), OY = 40 * (SCALE - 1);
export const SPOTS = {
  fire: { x: OX + 17.5, y: OY + 40.5 },
  rain: { x: OX + 22.5, y: OY + 37.0 },
  heal: { x: OX + 24.5, y: OY + 43.5 },
  lightning: { x: OX + 17.0, y: OY + 45.0 },
};

/** Loads the island and places the test entities. Returns them by role. */
export function setupTestbed(game) {
  const { world } = game;
  world.loadMap(buildIsland());
  game.state ??= {};
  game.state.power = 100;
  const at = (s, dx = 0, dy = 0) => ({ x: s.x + dx, y: s.y + dy });
  const villager = (p, hp = 1) => world.spawn('villager', { ...p, vx: 0, vy: 0, vz: 0, hp, flammable: true, owner: 'player', sprite: getSprite('test-figure') });
  const building = (p) => world.spawn('building', { ...p, vx: 0, vy: 0, vz: 0, hp: 1, flammable: true, owner: 'player', sprite: getSprite('test-box', { ramp: 'thatch', h: 12 }) });
  const tree = (p, growth = 1) => world.spawn('tree', { ...p, vx: 0, vy: 0, vz: 0, hp: 1, flammable: true, growth, sprite: getSprite('test-tree') });
  const S = SPOTS;
  return {
    // fire: two houses inside the fire radius, a third 1.4 tiles past the second (only spread reaches
    // it), a tree inside the radius
    fireHouses: [building(at(S.fire)), building(at(S.fire, 1.6)), building(at(S.fire, 3.0))],
    fireTree: tree(at(S.fire, 0, 1.2)),
    // rain: a house and a young tree that a free fire sets alight first, and an unburnt sapling
    rainHouse: building(at(S.rain)),
    rainTree: tree(at(S.rain, -1.5, 1), 0.3),
    rainSapling: tree(at(S.rain, 2, -2), 0.2),
    // heal: a badly hurt villager and a lightly hurt one
    healHurt: villager(at(S.heal, -0.5, 0), 0.3),
    healScratched: villager(at(S.heal, 0.8, 0.6), 0.8),
    // lightning: a villager under the bolt, one well outside it, a house beside it
    boltVictim: villager(at(S.lightning, 0.4, 0.3)),
    boltBystander: villager(at(S.lightning, 3.2, 0)),
    boltHouse: building(at(S.lightning, 1.1, 0)),
  };
}

/** Records the events miracles emits (and the hand events the test sends). */
export function recordEvents(game) {
  const log = { 'miracle-cast': [], act: [], rain: [], heal: [], strike: [], 'miracle-fizzle': [] };
  for (const type of Object.keys(log)) game.events.on(type, (p) => log[type].push(p));
  return log;
}

/** Hand stand-in: grab the orb from its pedestal and carry it to (x, y) at 3 height units up. */
async function carry(t, game, id, to, seconds = 0.5) {
  const e = game.world.get(id);
  game.events.emit('grab', { entityId: id, x: e.x, y: e.y, z: e.z, vx: 0, vy: 0, vz: 0 });
  e.held = true;
  const from = { x: e.x, y: e.y };
  const n = Math.max(1, Math.round(seconds * 30));
  for (let i = 1; i <= n; i++) {
    const x = from.x + ((to.x - from.x) * i) / n, y = from.y + ((to.y - from.y) * i) / n;
    game.world.move(e, x, y, game.world.heightAt(x, y) + 3);
    t.step(1 / 30);
  }
  return e;
}
function drop(game, e) {
  e.held = false;
  game.events.emit('release', { entityId: e.id, kind: 'orb', miracle: e.miracle, x: e.x, y: e.y, z: e.z, vx: 0.3, vy: 0.2, vz: 0 });
}
/** Throw toward +x at 5 tiles/s; the stand-in hand flies it to `to`, then reports the landing.
 * Asserts the orb casts nothing while it is still in the air. */
function throwTo(t, game, e, to, events, seconds = 0.4) {
  const casts = events['miracle-cast'].length, fizzles = events['miracle-fizzle'].length, power = game.state.power;
  e.held = false;
  const from = { x: e.x, y: e.y, z: e.z };
  const vx = (to.x - from.x) / seconds, vy = (to.y - from.y) / seconds;
  game.events.emit('release', { entityId: e.id, kind: 'orb', miracle: e.miracle, x: e.x, y: e.y, z: e.z, vx, vy, vz: 1 });
  const n = Math.round(seconds * 30);
  for (let i = 1; i <= n; i++) {
    const k = i / n, x = from.x + (to.x - from.x) * k, y = from.y + (to.y - from.y) * k;
    const g = game.world.heightAt(x, y);
    game.world.move(e, x, y, g + (from.z - g) * (1 - k) + 1.5 * Math.sin(Math.PI * k));
    t.step(1 / 30);
  }
  t.assert(game.world.get(e.id) && events['miracle-cast'].length === casts && events['miracle-fizzle'].length === fizzles && game.state.power === power,
    `a thrown ${e.miracle} orb casts nothing in flight, before landed`);
  game.events.emit('landed', { entityId: e.id, speed: Math.hypot(vx, vy) });
}

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const fmt = (v) => (typeof v === 'number' ? +v.toFixed(3) : v);

/** The full drive. Returns { ents, events, power } for callers that check more. */
export async function runMiracleSuite(t, game) {
  const M = game.systems.miracles;
  const C = M.costs();
  const ents = setupTestbed(game);
  const events = recordEvents(game);
  const shot = async (name, spot, z = 1) => {
    if (!t.shot) return;
    t.focus?.(spot.x, spot.y, game.world.heightAt(spot.x, spot.y) + z);
    await t.shot(name);
  };
  let expect = 100;
  t.step(0.5);

  // ---- orbs on their pedestals
  const temple = game.world.sites.temple;
  const peds = M.orbs.pedestals;
  t.assert(peds.length === 4, `four pedestals (got ${peds.length})`);
  for (const p of peds) {
    const o = game.world.get(p.orbId);
    const d = o && Math.hypot(o.x - (temple.x + 0.5), o.y - (temple.y + 0.5));
    t.assert(o && o.kind === 'orb' && o.miracle === p.miracle && o.grabbable === true && o.sprite && near(d, 1.5, 0.01),
      `${p.miracle} orb waits on its pedestal 1.5 tiles from the temple (${o ? fmt(d) : 'missing'})`);
  }
  const z0 = game.world.get(peds[0].orbId).z;
  t.step(0.6);
  t.assert(!near(game.world.get(peds[0].orbId).z, z0, 0.01), 'pedestal orbs bob');
  await shot('orbs', { x: temple.x + 0.5, y: temple.y + 0.5 }, 2);

  // ---- fire, dropped by the hand
  const fireOrb = M.orbs.orbOn('fire');
  let e = await carry(t, game, fireOrb, SPOTS.fire);
  t.assert(M.orbs.orbOn('fire') === null, 'taking the fire orb empties its pedestal');
  drop(game, e);
  expect -= C.fire;
  t.assert(!game.world.get(fireOrb), 'fire orb removed after casting');
  t.assert(near(game.state.power, expect), `fire cost ${C.fire}: power ${fmt(game.state.power)} == ${expect}`);
  const fc = events['miracle-cast'].at(-1), fa = events.act.at(-1);
  t.assert(fc && fc.miracle === 'fire' && near(fc.x, SPOTS.fire.x, 0.01) && near(fc.y, SPOTS.fire.y, 0.01), `miracle-cast fire at the drop point ${JSON.stringify(fc)}`);
  t.assert(fa && fa.actor === 'player' && fa.verb === 'cast' && fa.target === 'fire' && near(fa.weight, -0.4), `act cast fire weight -0.4 ${JSON.stringify(fa)}`);
  t.step(0.5);
  const [h0, h1, h2] = ents.fireHouses;
  t.assert(h0.burning > 0 && h1.burning > 0 && ents.fireTree.burning > 0, `fire sets the houses and tree in its radius burning (${fmt(h0.burning)}, ${fmt(h1.burning)}, tree ${fmt(ents.fireTree.burning)})`);
  t.assert(!(h2.burning > 0), 'the house 3 tiles out does not catch at once');
  t.step(1.0);
  await shot('fire', { x: SPOTS.fire.x + 1, y: SPOTS.fire.y }, 2);
  t.assert(h0.hp < 1 && h1.hp < 1, `burning houses lose hp (${fmt(h0.hp)}, ${fmt(h1.hp)})`);

  // the orb comes back
  t.step(TUNING.orbs.respawn + 0.2);
  const fireOrb2 = M.orbs.orbOn('fire');
  t.assert(fireOrb2 !== null && fireOrb2 !== fireOrb && game.world.get(fireOrb2)?.miracle === 'fire', `a new fire orb respawned on its pedestal (id ${fireOrb2})`);
  t.assert(h2.burning > 0 || h2.hp < 1, `fire spread to the third house (burning ${fmt(h2.burning)}, hp ${fmt(h2.hp)})`);
  await shot('fire-spread', { x: SPOTS.fire.x + 1.5, y: SPOTS.fire.y }, 2);

  // ---- rain, thrown, onto a fire started first
  M.cast('fire', SPOTS.rain.x, SPOTS.rain.y, { free: true });
  t.assert(near(game.state.power, expect), 'a free cast costs nothing');
  t.step(1.5);
  const { rainHouse, rainTree, rainSapling } = ents;
  t.assert(rainHouse.burning > 0 && rainTree.burning > 0, `test fire burns before the rain (${fmt(rainHouse.burning)}, ${fmt(rainTree.burning)})`);
  const g0 = rainTree.growth, s0 = rainSapling.growth;
  const rainOrb = M.orbs.orbOn('rain');
  e = await carry(t, game, rainOrb, { x: SPOTS.rain.x - 2.5, y: SPOTS.rain.y });
  const rainEvents0 = events.rain.length;
  throwTo(t, game, e, SPOTS.rain, events);
  expect -= C.rain;
  const rc = events['miracle-cast'].at(-1);
  t.assert(rc && rc.miracle === 'rain' && near(rc.x, SPOTS.rain.x, 0.01) && near(rc.y, SPOTS.rain.y, 0.01), `thrown rain orb casts where it lands ${JSON.stringify(rc)}`);
  t.assert(near(events.act.at(-1).weight, 0.3), 'act cast rain weight +0.3');
  t.assert(near(game.state.power, expect), `rain cost ${C.rain}: power ${fmt(game.state.power)} == ${expect}`);
  t.step(1.2);
  await shot('rain', SPOTS.rain, 6);
  t.step(1.3);
  t.assert(rainHouse.burning === 0 && rainTree.burning === 0, `rain put the fire out within 2.5 s (${fmt(rainHouse.burning)}, ${fmt(rainTree.burning)})`);
  t.assert(rainSapling.growth > s0 && rainTree.growth > g0, `rain adds growth (${fmt(s0)} -> ${fmt(rainSapling.growth)}, ${fmt(g0)} -> ${fmt(rainTree.growth)})`);
  const re = events.rain.slice(rainEvents0);
  t.assert(re.length >= 70 && re.every((r) => r.r === TUNING.rain.radius && near(r.dt, 1 / 30, 1e-9)), `rain event every tick while raining (${re.length})`);
  t.assert(!M.ignite(rainHouse), 'nothing ignites under the rain');
  t.assert(h0.burning > 0 || h0.hp < 1, 'rain away from the fire spot leaves that fire alone');

  // ---- heal, dropped
  const hp0 = ents.healHurt.hp, hp1 = ents.healScratched.hp;
  e = await carry(t, game, M.orbs.orbOn('heal'), SPOTS.heal);
  drop(game, e);
  expect -= C.heal;
  t.assert(near(game.state.power, expect), `heal cost ${C.heal}: power ${fmt(game.state.power)} == ${expect}`);
  t.assert(near(events.act.at(-1).weight, 0.4), 'act cast heal weight +0.4');
  t.step(0.7);
  await shot('heal', SPOTS.heal, 1);
  t.assert(ents.healHurt.hp > hp0 && ents.healHurt.hp <= 1 && ents.healScratched.hp === 1,
    `heal raises villager hp toward 1 (${fmt(hp0)} -> ${fmt(ents.healHurt.hp)}, ${fmt(hp1)} -> ${fmt(ents.healScratched.hp)})`);
  const he = events.heal.at(-1);
  t.assert(he && he.r === TUNING.heal.radius && he.amount === TUNING.heal.amount && near(he.x, SPOTS.heal.x, 0.01), `heal event ${JSON.stringify(he)}`);

  // ---- lightning, dropped
  const lightOrb = M.orbs.orbOn('lightning');
  e = await carry(t, game, lightOrb, SPOTS.lightning);
  drop(game, e);
  expect -= C.lightning;
  t.assert(near(game.state.power, expect), `lightning cost ${C.lightning}: power ${fmt(game.state.power)} == ${expect}`);
  t.assert(near(events.act.at(-1).weight, -0.6), 'act cast lightning weight -0.6');
  t.step(0.5);
  t.assert(ents.boltVictim.hp === 1 && events.strike.length === 0, 'no damage before the bolt lands');
  t.step(0.6); // 1.1 s: second stroke
  await shot('lightning', SPOTS.lightning, 3);
  t.assert(ents.boltVictim.hp === 0, `villager under the bolt killed (hp ${ents.boltVictim.hp})`);
  t.assert(ents.boltBystander.hp === 1, 'villager 3 tiles away unharmed');
  t.assert(ents.boltHouse.hp <= 1 - TUNING.lightning.buildingDamage + 1e-9 && ents.boltHouse.burning > 0,
    `house beside the bolt damaged and set alight (hp ${fmt(ents.boltHouse.hp)}, burning ${fmt(ents.boltHouse.burning)})`);
  const se = events.strike.at(-1);
  t.assert(se && near(se.x, SPOTS.lightning.x, 0.01) && se.r === TUNING.lightning.damageRadius && se.power === 1, `strike event ${JSON.stringify(se)}`);
  // the aftermath once the flash has gone: the struck villager, the burning house
  t.step(0.4); // 1.5 s after the drop: past the last stroke (1.26 s) and its flash
  t.assert(M.effects.flash() === 0, `screen flash gone after the strokes (${fmt(M.effects.flash())})`);
  await shot('lightning-after', SPOTS.lightning, 3);

  // ---- fizzle: 15 power left, lightning costs 30
  t.step(TUNING.orbs.respawn);
  const casts = events['miracle-cast'].length;
  const fizzOrb = M.orbs.orbOn('lightning');
  t.assert(fizzOrb !== null && fizzOrb !== lightOrb, 'lightning orb respawned');
  e = await carry(t, game, fizzOrb, { x: SPOTS.heal.x - 2, y: SPOTS.heal.y - 2 });
  drop(game, e);
  t.assert(events['miracle-cast'].length === casts && near(game.state.power, expect), `too little power: no cast, power stays ${fmt(game.state.power)}`);
  t.assert(!game.world.get(fizzOrb) && events['miracle-fizzle'].at(-1)?.miracle === 'lightning', 'the orb fizzles and is removed');
  t.step(0.25);
  await shot('fizzle', { x: SPOTS.heal.x - 2, y: SPOTS.heal.y - 2 }, 2);

  // ---- every cast spent exactly its cost
  t.assert(near(game.state.power, 100 - C.fire - C.rain - C.heal - C.lightning), `power 100 - costs = ${fmt(game.state.power)}`);
  t.log('events', { casts: events['miracle-cast'].length, acts: events.act.length, rain: events.rain.length, heal: events.heal.length, strike: events.strike.length });
  return { ents, events, power: game.state.power };
}

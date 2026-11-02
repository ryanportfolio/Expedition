// Creature system: one giant driven by the creature brain (src/creature/brain.js). It senses the
// world around it, offers the brain verb:target candidates, walks to the chosen target and acts on
// the world (eat, throw, smash, haul, water, play, sleep, poop, idle, wander). haul:wood picks up
// loose wood or fells a tree and carries it to a player blueprint that needs wood, else a player
// woodpile (wood, woodDelivered); with a blueprint it may also take wood from a player woodpile,
// so hauling shows up in free play without a blueprint. The destination is checked again when the
// load goes in (it may be gone or full by then: the load is set down), and a blueprint takes only
// the wood it still needs (putWood, shared with the village's builders). Stroke and slap
// events teach the brain; a tether event sends it to a point where it stays for a while.
// Untrained, it holds back from harm (tunables `harm`, `harmCooldown`): eat:villager, throw:villager
// and smash:building come at most once per cooldown per victim kind, and grain beats villagers when
// both are on offer, until a stroke teaches otherwise. A temple is offered for a smash only while
// one more smash leaves it at or above VILLAGE.templeMinHp (the village floors its hp there anyway).
// A slap that forbids the act under way stops it (onFeedback). A multi-stage act (haul) takes its
// credit time from its completion (complete()).
//
// Spawn: like the village, the system is inert until setup() is called after world.loadMap() with a
// map that has sites.creatureStart; setup() spawns one creature there (a later loadMap clears it):
//   game.world.loadMap(buildIsland()); game.systems.village.setup(); game.systems.creature.setup();
// Spawning on every map load would put an untrained giant into the hand, miracles and village
// checks (it eats and throws villagers), which those checks do not expect.
// API on game.systems.creature: entity, brain, state(), setup(), debug { candidateFilter, holdHunger }.
// Sprites: the painter's when it exists, else src/creature/placeholder-art.js (imported below).
// Shared state written: game.state.creatureThought = { key, judged, until, feedback }.
// Events emitted: act { actor: 'creature', verb, target, weight, x, y }; release and landed for
// what it throws (so the village treats a thrown villager as airborne). update(dt) never touches the
// DOM; draw(ctx) only picks the sprite and LUT.
import { createBrain } from '../creature/brain.js';
import { createCreaturePaths } from '../creature/path.js';
import { CREATURE as T } from '../creature/tunables.js';
import { stepBody } from '../hand/flight.js';
import { HAND } from '../hand/tunables.js';
import { VILLAGE } from '../village/config.js';
import { putWood } from '../village/sim.js';
import { getSprite } from '../art/registry.js';
import { makeLut } from '../art/lut.js';
import '../creature/placeholder-art.js'; // creature and dung stand-ins until the painter lands

// Frame counts per pose from the creature painter when it exists (browser build); 1 otherwise.
let FRAMES = {};
try {
  for (const mod of Object.values(import.meta.glob('../art/painters/creature.js', { eager: true }))) FRAMES = mod.CREATURE_FRAMES ?? FRAMES;
} catch {
  FRAMES = {}; // node: import.meta.glob is undefined
}

const VERB_POSE = { eat: 'eat', throw: 'throw', smash: 'smash', haul: 'haul', water: 'water', play: 'play', sleep: 'sleep', poop: 'poop', idle: 'idle', wander: 'idle' };

export function create(game) {
  const { world, events } = game;
  game.state ??= {};
  const paths = createCreaturePaths(world, T.maxStep);
  const brain = createBrain({ rng: () => game.rng.next(), params: T.brainParams });
  const debug = { candidateFilter: null, holdHunger: null };

  let mapRef = null;
  let wanted = false; // setup() called on this map
  let entity = null;
  let time = 0;
  let act = null; // current action, see start()
  let wait = 0;
  let tether = null; // { x, y, arrived, until }
  let feedbackShow = null; // { kind, judged, until }
  let poseOverride = null; // { pose, until }
  let pose = 'idle', animT = 0, facing = 'se';
  let gut = 0;
  let lastChoice = null;
  let lastHarm = {}; // victim kind -> sim time of the last harmful act on it (untrained restraint)
  const dung = new Map(); // id -> seconds of fertilizing left
  const flights = new Map(); // id -> body { x, y, z, vx, vy, vz }
  const history = []; // { t, key, phase: 'start'|'complete'|'abort' }, last 400

  const tileOf = (e) => Math.floor(e.y) * world.w + Math.floor(e.x);
  const tileX = (i) => (i % world.w) + 0.5;
  const tileY = (i) => ((i / world.w) | 0) + 0.5;
  const live = (e) => e && world.get(e.id) === e;
  const note = (key, phase, effect) => { history.push({ t: time, key, phase, effect }); if (history.length > 400) history.shift(); };

  // ---- spawn and map changes -------------------------------------------------------------------

  function sync() {
    if (world.height !== mapRef) {
      mapRef = world.height;
      wanted = false;
      entity = null; act = null; tether = null; wait = 0; lastHarm = {};
      dung.clear(); flights.clear();
    }
    if (!entity && wanted && world.sites?.creatureStart) spawn();
    return !!entity;
  }

  function spawn(x, y) {
    const s = world.sites.creatureStart;
    x ??= Math.floor(s.x) + 0.5;
    y ??= Math.floor(s.y) + 0.5;
    entity = world.spawn('creature', { x, y, vx: 0, vy: 0, vz: 0, hp: 1, grabbable: false, flammable: false, burning: 0 });
  }

  function setup() {
    if (!world.sites?.creatureStart) throw new Error('creature.setup: map needs sites.creatureStart');
    sync();
    wanted = true;
    sync();
    return entity;
  }

  // ---- held and thrown things --------------------------------------------------------------------

  function hold(obj) {
    obj.held = true;
    obj.carriedBy = entity.id;
    act.holdId = obj.id;
  }
  function letGo(drop = true) {
    const obj = act?.holdId != null ? world.get(act.holdId) : null;
    if (act) act.holdId = null;
    if (!obj) return null;
    obj.held = false;
    obj.carriedBy = null;
    if (drop) world.move(obj, entity.x, entity.y, world.heightAt(entity.x, entity.y));
    return obj;
  }

  function launch(obj, vx, vy, vz) {
    flights.set(obj.id, { x: obj.x, y: obj.y, z: obj.z, vx, vy, vz });
    obj.airborne = true;
    obj.vx = vx; obj.vy = vy; obj.vz = vz;
    events.emit('release', { entityId: obj.id, kind: obj.kind, miracle: obj.miracle, x: obj.x, y: obj.y, z: obj.z, vx, vy, vz, by: 'creature' });
  }

  // The hand catching something the creature threw takes it over at once (round 46). The `held`
  // test in stepFlights alone missed a press and a release between two ticks: the hand's own
  // flight started, `held` was false again by the next update, and both flights moved and landed
  // the same object.
  events.on('grab', ({ entityId }) => { flights.delete(entityId); });

  function stepFlights(dt) {
    const bounds = { w: world.w, h: world.h };
    for (const [id, f] of flights) {
      const obj = world.get(id);
      if (!obj || obj.held) { flights.delete(id); continue; }
      const c = stepBody(f, dt, world.heightAt, HAND.gravity, bounds);
      if (!c) { world.move(obj, f.x, f.y, f.z); continue; }
      // Contact: the hand's landing rule (a fast landing or water kills a villager), no bounce.
      flights.delete(id);
      const speed = Math.hypot(f.vx, f.vy, f.vz);
      const t = world.tile(Math.floor(f.x), Math.floor(f.y));
      const water = !t || t.ground <= HAND.waterGround;
      if (obj.kind === 'villager' && (obj.hp ?? 1) > 0 && (speed > HAND.lethalSpeed || water)) obj.hp = 0;
      world.move(obj, f.x, f.y, world.heightAt(f.x, f.y));
      obj.vx = obj.vy = obj.vz = 0;
      obj.airborne = false;
      events.emit('landed', { entityId: id, speed, kind: obj.kind, x: f.x, y: f.y, z: obj.z, water, by: 'creature' });
      if (water && obj.kind !== 'villager' && live(obj)) world.remove(id);
    }
  }

  function stepDung(dt) {
    for (const [id, left] of dung) {
      const d = world.get(id);
      if (!d || left <= 0) { if (d) world.remove(id); dung.delete(id); continue; }
      dung.set(id, left - dt);
      let best = null, bd = T.dungRadius;
      for (const f of world.query({ kind: 'building', x: d.x, y: d.y, r: T.dungRadius + 2 })) {
        if (f.type !== 'field' || f.stage !== 'done' || !(f.hp > 0)) continue;
        const dd = Math.hypot(f.x - d.x, f.y - d.y);
        if (dd <= bd) { bd = dd; best = f; }
      }
      if (best && best.growth < 1) best.growth = Math.min(1, best.growth + T.dungGrowth * dt);
    }
  }

  // ---- sensing ---------------------------------------------------------------------------------

  const usableBuilding = (b) => b.hp > 0 && b.stage !== 'wrecked';
  const free = (o) => !o.held && !o.airborne && !o.sinking && !o.carriedBy && !flights.has(o.id);
  const playerPile = (b) => b.type === 'woodpile' && b.owner === 'player' && b.stage === 'done' && usableBuilding(b);
  const needsWood = (b) => b.stage === 'blueprint' && usableBuilding(b) && b.owner === 'player' && (b.woodHave ?? 0) < (b.woodCost ?? 0);
  // While tethered, hauled wood only goes to a site or woodpile by the tether point, so a haul never
  // walks it away from where the player sent it.
  const byTether = (b) => !tether || Math.hypot(b.x - tether.x, b.y - tether.y) <= T.tetherRadius + T.reach;
  /** Where hauled wood can go: player blueprints that need wood, and player woodpiles. */
  function haulDests() {
    const all = world.query({ kind: 'building' }).filter(byTether);
    return { sites: all.filter(needsWood), piles: all.filter(playerPile) };
  }

  /** One candidate per verb:target key: the reachable target with the shortest path. */
  function candidates(f, cx, cy, R) {
    const best = new Map();
    const add = (key, target) => {
      const goal = target ? paths.goalNear(f, target.x, target.y, T.reach) : f.start;
      if (goal < 0 || !Number.isFinite(f.dist[goal])) return;
      const prev = best.get(key);
      if (prev && prev.dist <= f.dist[goal]) return;
      best.set(key, { key, satisfies: T.satisfies[key], target, goal, dist: f.dist[goal] });
    };
    const ent = (e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y });
    const near = (kind) => world.query({ kind, x: cx, y: cy, r: R });
    const food = (b) => usableBuilding(b) && b.stage === 'done' && ((b.type === 'storehouse' && b.grain >= 1) || (b.type === 'field' && b.growth >= 1));
    let blueprint = false;
    for (const b of near('building')) {
      if (!usableBuilding(b)) continue;
      if (food(b)) add('eat:grain', ent(b));
      if (b.type === 'field' && b.stage === 'done' && b.growth < 1) add('water:field', ent(b));
      if (needsWood(b)) blueprint = true;
      if (b.type !== 'temple' || b.hp - T.smashDamage >= VILLAGE.templeMinHp - 1e-9) add('smash:building', ent(b)); // stone temples: chipped, never wrecked
    }
    // Hungry with no food in range (and not tethered): it smells grain anywhere on the island.
    if (!tether && !best.has('eat:grain') && brain.needs.hunger >= T.farFoodHunger) {
      for (const b of world.query({ kind: 'building' })) if (food(b)) add('eat:grain', ent(b));
    }
    for (const v of near('villager')) {
      if (!(v.hp > 0) || v.dying > 0 || !free(v)) continue;
      add('eat:villager', ent(v));
      if (brain.canThrow) add('throw:villager', ent(v));
    }
    if (brain.canThrow) {
      for (const tr of near('tree')) if (free(tr) && (tr.growth ?? 1) >= 0.5 && !(tr.burning > 0)) add('throw:tree', ent(tr));
      // Rock entities only. The map's rock records (world.rocks) are authored data: the terrain
      // system turns them into entities in its update, which runs before this system in every tick
      // (SYSTEM_ORDER), so by the time the creature senses, the entities are the live rocks (see
      // liveRocks in src/systems/terrain.js). Before round 39 the records were offered as well, so a
      // rock the hand had carried off was still offered at its map spot, and throwing that phantom
      // spawned a second rock entity and cut the record out of the map's list.
      for (const r of near('rock')) if (free(r)) add('throw:rock', ent(r));
    }
    // haul:wood: loose wood or a tree to fell, whenever a player blueprint or woodpile can take it
    const dests = haulDests();
    if (dests.sites.length || dests.piles.length) {
      for (const w of near('wood')) if (free(w)) add('haul:wood', ent(w));
      for (const tr of near('tree')) if (free(tr) && (tr.growth ?? 1) >= 0.5 && !(tr.burning > 0)) add('haul:wood', ent(tr));
    }
    if (blueprint && dests.sites.length) for (const wp of near('building')) if (playerPile(wp) && wp.wood >= 1) add('haul:wood', ent(wp));
    add('play:none', null);
    add('sleep:none', null);
    if (gut >= T.gutPerMeal) add('poop:none', null);
    add('idle:none', null);
    add('wander:none', null);
    if (!debug.candidateFilter) restrain(best);
    return [...best.values()];
  }

  /** Untrained restraint (tunables `harm`, `harmCooldown`): drops harmful keys the brain has not
   * been stroked for while their victim kind's cooldown runs, and eat:villager while grain is on offer. */
  function restrain(best) {
    const agg = new Map(brain.table().aggregates.map((a) => [a.key, a.score]));
    for (const [key, victim] of Object.entries(T.harm)) {
      if (!best.has(key) || (agg.get(key) ?? 0) > 0) continue;
      const cooling = time - (lastHarm[victim] ?? -Infinity) < T.harmCooldown[victim];
      if (cooling || (key === 'eat:villager' && best.has('eat:grain'))) best.delete(key);
    }
  }

  // ---- actions ---------------------------------------------------------------------------------

  function decide() {
    const f = paths.field(tileOf(entity));
    const cx = tether ? tether.x : entity.x, cy = tether ? tether.y : entity.y;
    let list = candidates(f, cx, cy, tether ? T.tetherRadius : T.senseRadius);
    if (debug.candidateFilter) list = list.filter(debug.candidateFilter);
    const pick = brain.choose(list, time);
    lastChoice = { key: pick.key, reason: pick.reason, at: time };
    const c = list.find((x) => x.key === pick.key) ?? { key: pick.key, satisfies: pick.satisfies ?? {}, target: null, goal: f.start };
    start(c, f, cx, cy);
  }

  function start(c, f, cx, cy) {
    const [verb, target] = c.key.split(':');
    act = { key: c.key, verb, target, c, phase: 'walk', path: [], pi: 0, t: 0, stage: 0, tries: 0, recorded: false, holdId: null, dest: null };
    let goal = c.goal;
    if (verb === 'wander') {
      const R = tether ? T.tetherRadius : T.wanderRadius;
      let ox = (game.rng.next() * 2 - 1) * R, oy = (game.rng.next() * 2 - 1) * R;
      // While tethered the target stays within tetherRadius of the point, as the tunable says: the two
      // draws span a square, whose corners reach 1.41 * R. Round 43: on the creature trial's seed 7 a
      // tethered wander ended 3.61 tiles from the point and the creature stayed there (sleep, play and
      // poop are done in place), so "stayed near the tether point" failed. Free wandering is unchanged.
      const od = Math.hypot(ox, oy);
      if (tether && od > R) { ox *= R / od; oy *= R / od; }
      const tx = Math.floor(cx + ox), ty = Math.floor(cy + oy);
      const g = paths.goalNear(f, tx + 0.5, ty + 0.5, 1.5);
      if (g >= 0) goal = g;
    }
    act.path = paths.pathTo(f, goal) ?? [];
    note(c.key, 'choose');
  }

  function abort(why) {
    if (!act) return;
    if (act.holdId != null) letGo(true);
    note(act.key, `abort:${why}`);
    act = null;
    wait = T.decisionInterval;
  }

  function moveToward(x, y, dist) {
    const dx = x - entity.x, dy = y - entity.y, d = Math.hypot(dx, dy);
    face(dx, dy);
    if (d <= dist) { world.move(entity, x, y, world.heightAt(x, y)); return true; }
    const nx = entity.x + (dx / d) * dist, ny = entity.y + (dy / d) * dist;
    world.move(entity, nx, ny, world.heightAt(nx, ny));
    return false;
  }
  function face(dx, dy) {
    const sx = dx - dy, sy = dx + dy;
    if (Math.abs(sx) + Math.abs(sy) > 1e-6) facing = (sy >= 0 ? 's' : 'n') + (sx >= 0 ? 'e' : 'w');
  }

  /** The live world object an action works on, or null when it is gone or taken. */
  function targetObj() {
    const t = act.c.target;
    if (!t) return null;
    const o = world.get(t.id);
    return o && o.kind === t.kind ? o : null;
  }

  function stillValid(o) {
    if (!o) return false;
    if (o.kind === 'building') return usableBuilding(o) && (act.verb !== 'haul' || o.wood >= 1);
    if (!free(o)) return false;
    return o.kind !== 'villager' || (o.hp > 0 && !(o.dying > 0));
  }

  function inReach(o) {
    return Math.hypot(o.x - entity.x, o.y - entity.y) <= T.reach + 0.6;
  }

  /** Path to a moving or moved target again. False when out of tries or unreachable. */
  function repath(x, y) {
    if (++act.tries > T.chaseTries) return false;
    const f = paths.field(tileOf(entity));
    const g = paths.goalNear(f, x, y, T.reach);
    const p = g >= 0 ? paths.pathTo(f, g) : null;
    if (!p) return false;
    act.path = p; act.pi = 0;
    return true;
  }

  function arrive() {
    const { verb } = act;
    let o = null;
    if (act.c.target && act.stage === 0) {
      o = targetObj();
      if (!stillValid(o)) return abort('target-gone');
      if (!inReach(o)) { if (!repath(o.x, o.y)) abort('out-of-reach'); return; }
      face(o.x - entity.x, o.y - entity.y);
    }
    if (verb === 'haul' && act.stage === 1) {
      const d = act.dest && world.get(act.dest);
      if (!d || !(d.kind === 'building' && usableBuilding(d))) return abort('dest-gone');
    }
    if (!act.recorded) { brain.recordAction(act.key, time); act.recorded = true; note(act.key, 'start'); }
    act.phase = 'do';
    act.t = verb === 'sleep' ? T.sleepMax : T.duration[verb] ?? 1;
    begin(o);
  }

  /** Effects at the start of the pose: pick up what is eaten or thrown or hauled. */
  function begin(o) {
    const { verb } = act;
    if (verb === 'eat' && o?.kind === 'villager') hold(o);
    if (verb === 'throw') {
      if (o.kind === 'tree') o.uprooted = true;
      hold(o);
    }
    if (verb === 'haul' && act.stage === 0) {
      if (o.kind === 'building') {
        o.wood -= 1;
        const vill = game.systems.village?.sim?.village?.(o.owner);
        if (vill) vill.woodSpent += 1;
        o = world.spawn('wood', { x: entity.x, y: entity.y, z: entity.z + T.carryZ, vx: 0, vy: 0, vz: 0, amount: 1, grabbable: true, sprite: getSprite('wood') });
      } else if (o.kind === 'tree') {
        // fell it: the tree becomes a load of wood, removed the way the village's woodcutters do
        world.remove(o.id);
        const i = o.src ? world.trees.indexOf(o.src) : -1;
        if (i >= 0) world.trees.splice(i, 1);
        o = world.spawn('wood', { x: entity.x, y: entity.y, z: entity.z + T.carryZ, vx: 0, vy: 0, vz: 0, amount: T.fellWood, grabbable: true, madeBy: 'creature', sprite: getSprite('wood') });
      }
      hold(o);
    }
  }

  function emitAct() {
    const t = act.c.target;
    events.emit('act', { actor: 'creature', verb: act.verb, target: act.target, weight: brain.moralOf(act.key), x: t ? t.x : entity.x, y: t ? t.y : entity.y });
  }

  /** effect = { id, field, before, after } of the world value the action changed (history, for tests). */
  function complete(satisfies, effect) {
    emitAct();
    if (T.harm[act.key]) lastHarm[T.harm[act.key]] = time;
    // An act of more than one stage (haul: pick up, carry, put in) is recorded at its first arrival
    // (arrive()), but the player judges it when it finishes. Round 43: credit decays exp(-age /
    // creditTau) from the recorded time, so a stroke at a delivery 8-9 s after the pickup moved
    // haul:wood by about 0.01 instead of 0.1. Its credit time now moves to the completion. One-stage
    // acts keep the time they were recorded at (the start of their pose).
    brain.completeAction(act.key, satisfies, act.stage > 0 ? time : undefined);
    note(act.key, 'complete', effect);
    act = null;
    wait = T.decisionInterval;
  }

  /** Effects when the pose ends. */
  function finish() {
    const { verb } = act;
    const o = verb === 'haul' || act.holdId != null ? (act.holdId != null ? world.get(act.holdId) : null) : targetObj();
    switch (verb) {
      case 'eat': {
        const field = o?.kind === 'villager' ? 'hp' : o?.type === 'storehouse' ? 'grain' : 'growth';
        const before = o?.[field];
        if (o?.kind === 'villager') {
          letGo(true);
          o.hp = 0;
        } else if (o?.type === 'storehouse' && o.grain >= 1) {
          o.grain -= Math.min(o.grain, T.grainBite);
        } else if (o?.type === 'field' && o.growth >= 1) {
          o.growth = 0;
        } else return abort('food-gone');
        gut += 1;
        return complete(undefined, { id: o.id, field, before, after: o[field] });
      }
      case 'throw': {
        if (!brain.canThrow) return abort('weak'); // went weak mid-throw: puts it down
        const obj = letGo(false);
        if (!obj) return abort('lost-grip');
        const a = game.rng.next() * Math.PI * 2;
        launch(obj, Math.cos(a) * T.throwSpeed, Math.sin(a) * T.throwSpeed, T.throwLift);
        return complete();
      }
      case 'smash':
        if (!o || !usableBuilding(o)) return abort('target-gone');
        {
          const before = o.hp;
          // A temple's hp setter (stoneHp in src/village/sim.js) floors this at VILLAGE.templeMinHp.
          o.hp = Math.max(0, o.hp - T.smashDamage);
          return complete(undefined, { id: o.id, field: 'hp', before, after: o.hp });
        }
      case 'water':
        if (!o || o.type !== 'field') return abort('target-gone');
        { const before = o.growth; o.growth = Math.min(1, o.growth + T.waterGrowth); return complete(undefined, { id: o.id, field: 'growth', before, after: o.growth }); }
      case 'haul': {
        if (act.stage === 0) {
          // picked up: carry it to a blueprint that needs wood, else a woodpile
          const { sites, piles: all } = haulDests();
          const piles = all.filter((b) => b.id !== act.c.target.id);
          const f = paths.field(tileOf(entity));
          let dest = null, bd = Infinity;
          for (const b of sites.length ? sites : piles) {
            const g = paths.goalNear(f, b.x, b.y, T.reach);
            if (g >= 0 && f.dist[g] < bd) { bd = f.dist[g]; dest = { b, g }; }
          }
          if (!dest) return abort('no-dest');
          act.stage = 1; act.dest = dest.b.id; act.phase = 'walk';
          act.path = paths.pathTo(f, dest.g) ?? []; act.pi = 0;
          act.c.target = { id: dest.b.id, kind: 'building', x: dest.b.x, y: dest.b.y };
          return;
        }
        // Put the load in. arrive() checked the destination when the creature got there, but the
        // pose lasts T.duration.haul seconds and the world moves on meanwhile: the blueprint can be
        // replaced (placeBlueprint removes an open re-placed one), burned, wrecked, cleared, filled
        // by builders or turned into a site under construction. So the destination is looked up and
        // validated again here, by the same rules that chose it (needsWood / playerPile). Before
        // round 39 a vanished destination left d undefined and needsWood(d) threw, which stopped the
        // game loop; a wrecked woodpile still took the load.
        const d = world.get(act.dest);
        const item = letGo(false);
        if (!item) return abort('lost-load');
        const setDown = () => world.move(item, entity.x, entity.y, world.heightAt(entity.x, entity.y));
        if (d && needsWood(d)) {
          // Only what the blueprint still needs goes in (putWood, the builders' rule too); the rest
          // stays a wood item set down at the creature's feet for the village or another haul.
          // Before round 39 the whole load went in and the surplus was lost.
          const before = d.woodHave;
          putWood(world, d, item);
          if (live(item)) setDown();
          return complete(undefined, { id: d.id, field: 'woodHave', before, after: d.woodHave });
        }
        if (d && playerPile(d)) {
          const amount = item.amount ?? 1, before = d.wood;
          d.wood += amount;
          const vill = game.systems.village?.sim?.village?.(d.owner);
          if (vill) vill.woodDelivered += amount;
          world.remove(item.id);
          return complete(undefined, { id: d.id, field: 'wood', before, after: d.wood });
        }
        // gone, or no longer takes wood (full, under construction, wrecked): set the whole load down
        setDown();
        return abort(d ? 'dest-full' : 'dest-gone');
      }
      case 'poop': {
        const d = world.spawn('dung', { x: entity.x + 0.3, y: entity.y + 0.3, vx: 0, vy: 0, vz: 0, grabbable: false, sprite: getSprite('dung') });
        dung.set(d.id, T.dungTime);
        gut = 0;
        return complete(undefined, { id: d.id, field: 'dung', before: 0, after: 1 });
      }
      case 'sleep':
        return complete({}); // fatigue already fell while asleep (tickNeeds asleep)
      default:
        return complete();
    }
  }

  function runAction(dt) {
    if (act.phase === 'walk') {
      if (act.verb === 'eat' || act.verb === 'throw') {
        // a moving target: keep chasing its current tile once the path runs out
        const o = act.stage === 0 && act.c.target ? targetObj() : null;
        if (act.c.target && !o) return abort('target-gone');
      }
      if (act.pi < act.path.length) {
        const i = act.path[act.pi];
        if (moveToward(tileX(i), tileY(i), T.walkSpeed * brain.speedMult * dt)) act.pi++;
        setPose(brain.weak ? 'weak' : act.holdId != null ? 'haul' : 'walk');
        return;
      }
      if (act.key === 'tether') {
        tether.arrived = true;
        tether.until = time + T.tetherTime;
        act = null;
        wait = 0;
        return;
      }
      arrive();
      return;
    }
    // do
    setPose(VERB_POSE[act.verb] ?? 'idle');
    act.t -= dt;
    if (act.verb === 'sleep' && brain.needs.fatigue <= T.sleepWake) act.t = 0;
    if (act.t <= 0) finish();
  }

  function setPose(p) {
    if (p !== pose) { pose = p; animT = 0; }
  }

  function carryHeld() {
    const obj = act?.holdId != null ? world.get(act.holdId) : null;
    if (obj) world.move(obj, entity.x, entity.y, entity.z + T.carryZ);
  }

  // ---- feedback and tether ---------------------------------------------------------------------

  function onFeedback(kind, p) {
    if (!sync() || p?.creatureId !== entity.id) return;
    const r = brain.feedback(kind, typeof p.strength === 'number' ? p.strength : 1, time);
    // A slap that leaves the act under way forbidden stops it: abort() sets down what it holds
    // (letGo(true)), so a villager held in the eat or throw pose lives. Round 43: the brain only
    // excludes forbidden keys when it next chooses, so a slapped eat or throw still killed its villager.
    // This also stops an unrecorded act (still walking to its target) whose key the slap forbade
    // through an earlier act of the same key: it would otherwise be done once more. The tether walk is
    // the player's order, not a brain choice, and has no verb:target key.
    if (kind === 'slap' && act && act.key !== 'tether' && brain.isForbidden(act.key)) abort('forbidden');
    poseOverride = { pose: kind === 'stroke' ? 'happy' : 'hurt', until: time + T.feedbackPose };
    feedbackShow = { kind, judged: r.judged, until: time + T.thoughtTime, result: r };
    writeThought();
  }
  events.on('stroke', (p) => onFeedback('stroke', p));
  events.on('slap', (p) => onFeedback('slap', p));

  events.on('tether', (p) => {
    if (!sync() || p?.creatureId !== entity.id || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    abort('tether');
    const f = paths.field(tileOf(entity));
    let g = paths.goalNear(f, p.x, p.y, 1);
    if (g < 0 || !Number.isFinite(f.dist[g])) g = paths.goalNear(f, p.x, p.y, T.tetherRadius);
    if (g < 0 || !Number.isFinite(f.dist[g])) { tether = null; return; }
    tether = { x: p.x, y: p.y, arrived: false, until: Infinity };
    act = { key: 'tether', verb: 'wander', target: 'none', c: { target: null }, phase: 'walk', path: paths.pathTo(f, g) ?? [], pi: 0, t: 0, stage: 0, tries: 0, recorded: true, holdId: null };
    wait = 0;
  });

  function writeThought() {
    const fb = feedbackShow && time < feedbackShow.until ? feedbackShow : null;
    const key = act && act.key !== 'tether' ? act.key : null;
    game.state.creatureThought = {
      key,
      judged: fb ? fb.judged ?? key : key,
      until: fb ? fb.until : time + T.decisionInterval,
      feedback: fb ? fb.kind : null,
    };
  }

  // ---- tick ------------------------------------------------------------------------------------

  function update(dt) {
    if (!sync()) return;
    time += dt;
    if (!live(entity)) { const { x, y } = entity; spawn(x, y); act = null; } // it never dies
    entity.hp = 1;
    if (debug.holdHunger != null) brain.needs.hunger = debug.holdHunger;
    brain.tickNeeds(dt, { asleep: act?.verb === 'sleep' && act.phase === 'do' });
    if (debug.holdHunger != null) brain.needs.hunger = debug.holdHunger;
    stepFlights(dt);
    stepDung(dt);
    if (tether?.arrived && time >= tether.until) tether = null;
    if (act) runAction(dt);
    else if (wait > 0) { wait -= dt; setPose('idle'); }
    else decide();
    if (poseOverride && time < poseOverride.until) setPose(poseOverride.pose);
    else poseOverride = null;
    carryHeld();
    animT += dt;
    writeThought();
  }

  function leanStep(lean) {
    return lean >= 0.33 ? 1 : lean <= -0.33 ? -1 : 0;
  }

  const frameNow = () => Math.floor(animT * T.animFps) % Math.max(1, FRAMES[pose] ?? 1);

  function draw() {
    if (!entity || !live(entity)) return;
    const lean = brain.alignmentLean();
    const frame = frameNow();
    // The renderer pushes the entity itself into the draw list; its `lut` field is the item's LUT.
    entity.sprite = getSprite('creature', { pose, frame, facing, lean: leanStep(lean) });
    entity.lut = makeLut(lean);
  }

  return {
    update,
    draw,
    setup,
    debug,
    brain,
    paths,
    get entity() { return entity; },
    get time() { return time; },
    get history() { return history; },
    state() {
      return {
        id: entity?.id ?? null, x: entity?.x, y: entity?.y, z: entity?.z, pose, frame: frameNow(), facing,
        action: act ? { key: act.key, phase: act.phase, stage: act.stage, target: act.c.target ? { ...act.c.target } : null } : null,
        waiting: !act && wait > 0,
        needs: { ...brain.needs }, weak: brain.weak, speedMult: brain.speedMult, canThrow: brain.canThrow,
        lean: brain.alignmentLean(), leanStep: leanStep(brain.alignmentLean()),
        tether: tether ? { ...tether } : null, thought: game.state.creatureThought ?? null,
        lastChoice, gut, time,
        feedback: feedbackShow ? { kind: feedbackShow.kind, judged: feedbackShow.judged, until: feedbackShow.until } : null,
      };
    },
  };
}

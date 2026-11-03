// Fire state machine. Miracles owns `burning` on every entity (spec): ignition, growth, damage,
// spread, extinguishing and burn-out.
//
// Per burning entity: burning ramps toward 1, the entity loses hp (damage * burning per second),
// after burnTime the fire dies down over fadeTime, and once burning reaches 0 the entity is charred
// and can't catch again. Damage is per kind or building type (tuning.js): a full burn takes a house,
// store or field to hp 0, so the village wrecks it; the stone temple comes out scorched but
// standing (the stone mine never catches). Trees that burn to hp 0 are removed here (brief); villagers and buildings at hp 0 are
// left to their owner (village), and their fire dies down at double speed.
//
// Spread is bounded so one ignition burns a small cluster, never a whole village:
// - Reach is measured edge to edge between footprints (buildings have tx/ty/fw/fh; other entities are
//   points), so the next house over catches the same whatever its size.
// - Fires lit together (same tick, within 2 * fire radius of the first) form one blaze. A blaze may
//   spread to at most `spreadBudget` more entities in total, however long its fires burn.
// - Each spread is one generation further from the blaze's first fires, and the chance to spread
//   falls by `spreadDecay` per generation. Fields and trees pass fire on less than buildings.
// Hot fires (burning >= spreadMin) roll game.rng once per flammable neighbor per tick, in id order,
// so spread is deterministic for a seed. Rain (isWet) stops growth and spread; the rain itself lowers
// burning, and a fire put out by rain early leaves the entity flammable.
//
// Burning entities are found by scanning the entity store in id order every tick, so a `burning`
// set by anything else is picked up too (as a blaze of its own).
import { TUNING } from './tuning.js';
import { FX } from './fx.js';

/** Footprint rectangle of an entity in tiles; a point for entities without one. */
function rect(e) {
  if (e.tx === undefined || !(e.fw > 0)) return { x0: e.x, y0: e.y, x1: e.x, y1: e.y };
  return { x0: e.tx, y0: e.ty, x1: e.tx + e.fw, y1: e.ty + (e.fh ?? e.fw) };
}
/** Edge-to-edge distance between two entities' footprints (0 when they touch or overlap). */
function gap(a, b) {
  const p = rect(a), q = rect(b);
  return Math.hypot(Math.max(0, p.x0 - q.x1, q.x0 - p.x1), Math.max(0, p.y0 - q.y1, q.y0 - p.y1));
}
/** Largest centre-to-corner distance of an entity's footprint (0 for a point). */
const halfDiag = (e) => (e.tx === undefined || !(e.fw > 0) ? 0 : Math.hypot(e.fw, e.fh ?? e.fw) / 2);

export function createFire(game, { isWet }) {
  const T = TUNING.fire;
  const states = new Map(); // id -> { age, dying, fx, gen, blaze }
  const charred = new Set();
  let time = 0, lastBlaze = null; // the blaze fires lit this tick join

  const canBurn = (e) => e && e.flammable === true && !charred.has(e.id) && !(typeof e.hp === 'number' && e.hp <= 0);
  /** Tuning table lookup: a building's type (house, field, temple...) when the table has a row for it, else its kind. */
  const byKind = (table, e) => (e.kind === 'building' ? table[e.type] : undefined) ?? table[e.kind] ?? table.other;
  const lift = (e) => byKind(T.lift, e);

  /** The blaze a fire lit from outside joins: this tick's blaze if it is near, else a new one. */
  function blazeFor(e) {
    if (lastBlaze && lastBlaze.at === time && Math.hypot(e.x - lastBlaze.x, e.y - lastBlaze.y) <= 2 * T.radius) return lastBlaze;
    lastBlaze = { at: time, x: e.x, y: e.y, left: T.spreadBudget };
    return lastBlaze;
  }

  /** Sets e burning to at least `amount`. False when it can't burn or stands in the rain.
   * A fire lit here (miracle, lightning, anything outside this module) starts or joins a blaze at
   * generation 0. */
  function ignite(e, amount = T.startBurning) {
    return light(e, amount, null);
  }

  function light(e, amount, from) {
    if (!canBurn(e) || isWet(e.x, e.y)) return false;
    e.burning = Math.max(e.burning > 0 ? e.burning : 0, amount);
    track(e, from);
    return true;
  }

  function track(e, from = null) {
    if (states.has(e.id)) return states.get(e.id);
    const [mod, opts] = e.kind === 'villager' ? FX.burnSmall(game.rng.int(1e6)) : FX.burnLarge(game.rng.int(1e6));
    const s = {
      age: 0, dying: false, gen: from ? from.gen + 1 : 0, blaze: from ? from.blaze : blazeFor(e),
      fx: game.fx.spawn(mod, { x: e.x, y: e.y, z: e.z + lift(e), ...opts }),
    };
    states.set(e.id, s);
    return s;
  }

  function end(id, s) {
    s.fx.stop();
    states.delete(id);
  }

  function spread(e, s, dt) {
    if (s.blaze.left <= 0) return;
    const rate = T.spreadChance * byKind(T.spreadFrom, e) * T.spreadDecay ** s.gen * e.burning;
    if (rate <= 0) return;
    const world = game.world;
    for (const n of world.query({ x: e.x, y: e.y, r: T.spreadReach + halfDiag(e) + T.maxHalfDiag })) {
      if (n === e || n.burning > 0 || !canBurn(n) || isWet(n.x, n.y) || gap(e, n) > T.spreadReach) continue;
      if (game.rng.next() < rate * dt && light(n, T.spreadStart, s)) {
        if (--s.blaze.left <= 0) return;
      }
    }
  }

  function update(dt) {
    time += dt;
    const world = game.world;
    // drop states whose entity is gone (removed by its owner, or the map was reloaded)
    for (const [id, s] of states) if (!world.get(id)) end(id, s);

    const burning = [];
    for (const e of world.entities.values()) if (e.burning > 0) burning.push(e);

    for (const e of burning) {
      const s = track(e);
      s.age += dt;
      const wet = isWet(e.x, e.y);
      const dead = typeof e.hp === 'number' && e.hp <= 0;
      if (!s.dying && (s.age >= T.burnTime || dead)) s.dying = true;
      if (s.dying) e.burning = Math.max(0, e.burning - (dead ? 2 : 1) * dt / T.fadeTime);
      else if (!wet) e.burning = Math.min(1, e.burning + T.rampRate * dt);
      if (typeof e.hp === 'number' && e.hp > 0) e.hp = Math.max(0, e.hp - byKind(T.damage, e) * e.burning * dt);

      if (!wet && !s.dying && e.burning >= T.spreadMin) spread(e, s, dt);
    }

    // every tracked fire, including ones doused outside this module (rain): end or follow the entity
    for (const [id, s] of states) {
      const e = world.get(id);
      if (!(e.burning > 0)) {
        e.burning = 0;
        if (s.dying) charred.add(e.id); // burnt out; put out by rain early stays flammable
        end(e.id, s);
        if (e.kind === 'tree' && typeof e.hp === 'number' && e.hp <= 0) {
          const [mod, opts] = FX.ash(game.rng.int(1e6));
          game.fx.spawn(mod, { x: e.x, y: e.y, z: e.z, ...opts });
          world.remove(e.id);
        }
        continue;
      }
      // the flames follow the entity; their light grows and fades with the fire
      s.fx.move(e.x, e.y, e.z + lift(e));
      s.fx.fx.options.light = 0.3 + 0.6 * e.burning;
    }
  }

  return { ignite, update, states, charred, canBurn };
}

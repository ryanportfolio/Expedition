// What each miracle does to the world once cast: rain, fire, heal, lightning. Effects with a delay
// (the fire ring reaching its targets, the heal ring rolling out, the lightning bolt landing) are
// queued on the miracles clock so the world changes when the picture does.
import { TUNING } from './tuning.js';
import { FX, PX_PER_TILE } from './fx.js';

/** Entity kinds a heal restores hp to (see apply.heal). */
const HEALS = new Set(['villager', 'creature', 'building', 'tree']);

export function createEffects(game, { getFire }) {
  let time = 0;
  const queue = []; // { at, fn }, run in insertion order once due
  const rains = []; // { x, y, r, until, fx }
  const flashes = []; // { at, until, k }
  const dist2 = (e, x, y) => (e.x - x) ** 2 + (e.y - y) ** 2;
  const later = (delay, fn) => queue.push({ at: time + delay, fn });
  const ground = (x, y) => game.world.heightAt(x, y);
  const seed = () => game.rng.int(1e6);
  const spawn = ([mod, opts], x, y, z = ground(x, y)) => game.fx.spawn(mod, { x, y, z, ...opts });

  function isWet(x, y) {
    for (const r of rains) if ((x - r.x) ** 2 + (y - r.y) ** 2 <= r.r * r.r) return true;
    return false;
  }

  const apply = {
    rain(x, y) {
      const R = TUNING.rain;
      // two clouds side by side across the screen so the downpour covers the radius
      const off = R.radius * 0.3;
      const fx = [spawn(FX.rain(seed()), x - off, y + off), spawn(FX.rain(seed()), x + off, y - off)];
      rains.push({ x, y, r: R.radius, until: time + R.duration, fx });
    },
    fire(x, y) {
      const F = TUNING.fire;
      spawn(FX.fireRing(Math.round(F.radius * PX_PER_TILE), seed()), x, y);
      later(F.igniteDelay, () => {
        for (const e of game.world.query({ x, y, r: F.radius })) getFire().ignite(e, F.startBurning);
      });
    },
    heal(x, y) {
      const H = TUNING.heal;
      spawn(FX.heal(Math.round(H.radius * PX_PER_TILE), seed()), x, y);
      later(H.delay, () => {
        // Heal mends buildings and trees as well as the living (round 46, user decision "Repair
        // buildings"). Villagers spawn healthy, can't burn and die outright, and the creature is
        // back at full hp every tick, so a heal that touched only them changed nothing in play.
        // Buildings and trees are what play leaves hurt: scorched by a fire that rain put out, struck
        // by lightning, hit by a thrown rock or the creature's smash.
        // - Only hp > 0 is mended. A wreck (hp 0) is already on its village's lost list and waits
        //   to be cleared and rebuilt; raising its hp would leave a wreck the village no longer
        //   wrecks or rebuilds. The same rule keeps the dead dead.
        // - Blueprints and building sites are mended too: lightning and rocks hurt them like any
        //   building, and hp is all heal changes.
        // - A burning building or tree is mended but keeps burning: heal buys time, rain puts fires
        //   out. Village and fire damage rules are unchanged.
        for (const e of game.world.query({ x, y, r: H.radius })) {
          if (HEALS.has(e.kind) && typeof e.hp === 'number' && e.hp > 0) {
            e.hp = Math.min(1, e.hp + H.amount);
          }
        }
        game.events.emit('heal', { x, y, r: H.radius, amount: H.amount });
      });
    },
    lightning(x, y) {
      const L = TUNING.lightning;
      spawn(FX.lightning(seed()), x, y);
      L.strokes.forEach((t, i) => {
        later(t, () => {
          flashes.push({ at: time, until: time + L.flashTime, k: L.flash[i] ?? 0.3 });
          if (i > 0) return;
          for (const e of game.world.query({ x, y, r: L.damageRadius })) {
            const d2 = dist2(e, x, y);
            if (e.kind === 'villager' && d2 <= L.killRadius ** 2 && typeof e.hp === 'number') e.hp = 0;
            if (e.kind === 'building' && typeof e.hp === 'number') e.hp = Math.max(0, e.hp - L.buildingDamage);
            if (d2 <= L.igniteRadius ** 2) getFire().ignite(e, TUNING.fire.startBurning);
          }
          game.events.emit('strike', { x, y, r: L.damageRadius, power: 1 });
        });
      });
    },
  };

  function update(dt) {
    time += dt;
    // rain: growth, extinguishing, the per-tick event; then let finished clouds drift off
    for (let i = rains.length - 1; i >= 0; i--) {
      const r = rains[i];
      if (time >= r.until) {
        r.fx.forEach((h) => h.stop());
        rains.splice(i, 1);
      }
    }
    const R = TUNING.rain;
    for (const r of rains) {
      for (const e of game.world.query({ x: r.x, y: r.y, r: r.r })) {
        if (typeof e.growth === 'number') e.growth = Math.min(1, e.growth + R.growthRate * dt);
        if (e.burning > 0) e.burning = Math.max(0, e.burning - dt / R.extinguishTime);
      }
      game.events.emit('rain', { x: r.x, y: r.y, r: r.r, dt });
    }
    // due actions (an action may queue more; those wait for their own time)
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].at <= time + 1e-9) {
        const [q] = queue.splice(i, 1);
        i--;
        q.fn();
      }
    }
    for (let i = flashes.length - 1; i >= 0; i--) if (time >= flashes[i].until) flashes.splice(i, 1);
  }

  /** Strength 0..1 of the screen flash right now. */
  function flash() {
    let k = 0;
    for (const f of flashes) k = Math.max(k, f.k * (1 - (time - f.at) / (f.until - f.at)));
    return Math.max(0, k);
  }

  function spawnFizzle(x, y, z) { spawn(FX.fizzle(seed()), x, y, z); }

  return { apply, update, isWet, flash, spawnFizzle, rains, get time() { return time; } };
}

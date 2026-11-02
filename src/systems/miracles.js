// Miracles system: rain, heal, fire and lightning, paid for with worship power (game.state.power).
//
// The player takes a miracle orb from its pedestal at the temple with the hand and casts by dropping
// or throwing it (src/miracles/orbs.js). What each miracle does to the world is in
// src/miracles/effects.js, the fire that fire and lightning start in src/miracles/fire.js, numbers in
// src/miracles/tuning.js and effect choices in src/miracles/fx.js.
//
// Events out: `miracle-cast { miracle, x, y }`, `act { actor: 'player', verb: 'cast', target, weight,
// x, y }`, `rain { x, y, r, dt }` each tick while raining, `heal { x, y, r, amount }`,
// `strike { x, y, r, power }`, and `miracle-fizzle { miracle, x, y, cost, power }` when an orb lands
// without enough power (for UI and audio feedback).
//
// API: game.systems.miracles.cast(miracle, x, y, { free }) and .costs().
// update(dt) touches only game state; draw(ctx) pushes the orb glows into the draw list and paints the
// lightning flash over the view buffer.
import { TUNING, MIRACLES } from '../miracles/tuning.js';
import { createFire } from '../miracles/fire.js';
import { createEffects } from '../miracles/effects.js';
import { createOrbs } from '../miracles/orbs.js';

const FLASH = { r: 0xf0, g: 0xe8, b: 0xff };

export function create(game) {
  game.state ??= {};
  const effects = createEffects(game, { getFire: () => fire });
  const fire = createFire(game, { isWet: effects.isWet });

  /** Casts `miracle` at (x, y). Pays its cost unless `free`; without enough power the cast fizzles
   * (a small puff, no effect) and returns false. Throws on an unknown miracle name. */
  function cast(miracle, x, y, { free = false, z } = {}) {
    if (!MIRACLES.includes(miracle)) throw new Error(`miracles.cast: unknown miracle "${miracle}"`);
    const cost = TUNING.costs[miracle];
    const power = Number.isFinite(game.state.power) ? game.state.power : 0;
    if (!free && power < cost) {
      effects.spawnFizzle(x, y, z ?? game.world.heightAt(x, y));
      game.events.emit('miracle-fizzle', { miracle, x, y, cost, power });
      return false;
    }
    if (!free) game.state.power = power - cost;
    effects.apply[miracle](x, y);
    game.events.emit('miracle-cast', { miracle, x, y });
    game.events.emit('act', { actor: 'player', verb: 'cast', target: miracle, weight: TUNING.weights[miracle], x, y });
    return true;
  }

  const orbs = createOrbs(game, { resolve: (miracle, x, y, z) => cast(miracle, x, y, { z }) });

  return {
    cast,
    costs: () => ({ ...TUNING.costs }),
    ignite: (e, amount) => fire.ignite(e, amount),
    isRaining: (x, y) => effects.isWet(x, y),
    orbs,
    fire,
    effects,
    update(dt) {
      orbs.update(dt);
      effects.update(dt);
      fire.update(dt);
    },
    draw(ctx) {
      orbs.draw(ctx);
      const k = effects.flash();
      if (k <= 0) return;
      ctx.overlay(({ buf }) => {
        const a = Math.min(1, k), ia = 1 - a;
        const fr = FLASH.r * a, fg = FLASH.g * a, fb = FLASH.b * a;
        for (let i = 0; i < buf.length; i++) {
          const c = buf[i];
          const r = (c & 255) * ia + fr, g = ((c >>> 8) & 255) * ia + fg, b = ((c >>> 16) & 255) * ia + fb;
          buf[i] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
        }
      });
    },
  };
}

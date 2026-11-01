// The game object every system receives. createGame works in node (no canvas): display, renderer
// and input then run as pure state, which is how scripts/check-engine.mjs exercises them.
import { createRng } from './engine/rng.js';
import { createClock } from './engine/clock.js';
import { createEvents } from './engine/events.js';
import { createInput } from './engine/input.js';
import { createDisplay } from './engine/display.js';
import { createCamera } from './engine/camera.js';
import { createWorld } from './world/world.js';
import { pickTile } from './world/iso.js';
import { createRenderer } from './render/renderer.js';
import { createFxLayer } from './render/fx.js';
import * as terrain from './systems/terrain.js';
import * as village from './systems/village.js';
import * as creature from './systems/creature.js';
import * as hand from './systems/hand.js';
import * as miracles from './systems/miracles.js';
import * as alignment from './systems/alignment.js';
import * as ui from './systems/ui.js';
import * as audio from './systems/audio.js';

/** Fixed system update and draw order (spec). */
export const SYSTEM_ORDER = ['terrain', 'village', 'creature', 'hand', 'miracles', 'alignment', 'ui', 'audio'];
const MODULES = { terrain, village, creature, hand, miracles, alignment, ui, audio };

export function createGame({ seed = 1, canvas = null, worldSize = 64 } = {}) {
  const events = createEvents();
  const world = createWorld({ w: worldSize, h: worldSize });
  const input = createInput(events);
  const display = createDisplay(canvas);
  const camera = createCamera({ display, input, world });
  const game = {
    world, events, input, display, camera,
    rng: createRng(seed),
    clock: createClock(),
    renderer: null,
    fx: createFxLayer(),
    systems: {},
    systemOrder: SYSTEM_ORDER,
    debug: {},
    scenario: null,
    running: false,

    /** One fixed sim step. */
    tick(dt) {
      camera.update(dt);
      input.refresh();
      for (const name of SYSTEM_ORDER) game.systems[name].update(dt);
      game.fx.update(dt);
    },
    /** Real-time frame: run due sim steps, then render. */
    frame(realDt) {
      game.clock.advance(realDt, game.tick);
      game.renderer.render();
    },
    /** Start the rAF loop (browser). */
    start() {
      if (game.running) return;
      game.running = true;
      let last = performance.now();
      const loop = (now) => {
        if (!game.running) return;
        game.frame(Math.min((now - last) / 1000, 0.25));
        last = now;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },
    stop() { game.running = false; },
  };
  input.toWorld = (sx, sy) => {
    const p = camera.viewToWorldPx(sx, sy);
    return pickTile(p.sx, p.sy, world.heightAt, { w: world.w, h: world.h });
  };
  game.renderer = createRenderer(game);
  for (const name of SYSTEM_ORDER) game.systems[name] = MODULES[name].create(game);
  return game;
}

// The game object every system receives. createGame works in node (no canvas): display, renderer
// and input then run as pure state, which is how scripts/check-engine.mjs exercises them.
import { createRng } from './engine/rng.js';
import { createClock } from './engine/clock.js';
import { createEvents } from './engine/events.js';
import { createInput } from './engine/input.js';
import { createDisplay } from './engine/display.js';
import { createCamera } from './engine/camera.js';
import { createWorld } from './world/world.js';
import { pickSurface } from './world/iso.js';
import { surfaceHeights } from './terrain/cache.js';
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
  const camera = createCamera({ display, input, world, events });
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
  // The pointer picks against the surface the terrain pass draws (pickSurface in world/iso.js has
  // the why), at the center of the world pixel under it. The tile heights are rebuilt when the map
  // changes: world.loadMap swaps the height and ground arrays; an in-place edit of them must call
  // game.surface.invalidate() (terrain.invalidate() does), as the terrain cache needs too.
  let surface = null;
  game.surface = {
    get() {
      if (!surface || surface.height !== world.height || surface.ground !== world.ground || surface.seaLevel !== world.seaLevel || surface.w !== world.w || surface.h !== world.h) {
        const surf = surfaceHeights(world);
        let max = 0;
        for (let i = 0; i < surf.length; i++) if (surf[i] > max) max = surf[i];
        surface = { surf, w: world.w, h: world.h, max, height: world.height, ground: world.ground, seaLevel: world.seaLevel };
      }
      return surface;
    },
    invalidate() { surface = null; },
  };
  input.toWorld = (sx, sy) => {
    const p = camera.viewToWorldPx(sx, sy);
    return pickSurface(p.sx + 0.5, p.sy + 0.5, game.surface.get());
  };
  game.renderer = createRenderer(game);
  for (const name of SYSTEM_ORDER) game.systems[name] = MODULES[name].create(game);
  return game;
}

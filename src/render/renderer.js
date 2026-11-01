// Renderer. Frame order:
//   1. clear the view buffer to the background color
//   2. terrain passes (registered with addTerrainPass), in registration order
//   3. systems' draw(ctx) in spec order: they push world items into ctx.list or queue overlays
//   4. world entities that carry a `sprite` are pushed into the draw list
//   5. fx back layer
//   6. draw list, sorted by depth key (x + y, then z, then id)
//   7. fx front layer
//   8. overlays (screen space, registration order), then present to the canvas
import { createViewBuffer, rgba } from './buffer.js';
import { createDrawList } from './drawlist.js';
import { blit } from './blit.js';
import { worldToScreen } from '../world/iso.js';

export function createRenderer(game) {
  const list = createDrawList();
  const terrainPasses = [];
  const overlays = [];
  let view = createViewBuffer(0, 0);

  const renderer = {
    clearColor: rgba('#0b1730'),
    /** Default LUT (Uint32Array(256)); the alignment system swaps it. */
    lut: new Uint32Array(256),
    get view() { return view; },
    list,
    /** fn(ctx) runs after clear and before entities. Returns an unregister function. */
    addTerrainPass(fn) {
      terrainPasses.push(fn);
      return () => { const i = terrainPasses.indexOf(fn); if (i >= 0) terrainPasses.splice(i, 1); };
    },
    render() {
      const { display, camera, world, fx, systems } = game;
      if (view.w !== display.w || view.h !== display.h) view = createViewBuffer(display.w, display.h);
      const camX = Math.round(camera.x), camY = Math.round(camera.y);
      const ctx = {
        buf: view.data, w: view.w, h: view.h, view, camX, camY, lut: renderer.lut, world, list, game,
        blit: (sprite, vx, vy, flipX = false, lut = renderer.lut) => blit(view.data, view.w, view.h, sprite, vx, vy, lut, flipX),
        toView: (x, y, z = 0) => { const p = worldToScreen(x, y, z); return { vx: Math.round(p.sx - camX), vy: Math.round(p.sy - camY) }; },
        overlay: (fn) => overlays.push(fn),
      };
      view.data.fill(renderer.clearColor);
      for (const pass of terrainPasses) pass(ctx);
      list.clear();
      overlays.length = 0;
      for (const name of game.systemOrder) systems[name].draw(ctx);
      for (const e of world.entities.values()) if (e.sprite) list.push(e);
      fx.draw(view, camX, camY, 'back');
      list.draw(ctx);
      fx.draw(view, camX, camY, 'front');
      for (const fn of overlays) fn(ctx);
      display.present(view.image);
      return ctx;
    },
  };
  return renderer;
}

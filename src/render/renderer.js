// Renderer. Frame order:
//   1. clear the view buffer to the background color
//   2. terrain passes (registered with addTerrainPass), in registration order
//   3. systems' draw(ctx) in spec order: they push world items into ctx.list or queue overlays
//   4. world entities that carry a `sprite` and overlap the view are pushed into the draw list
//      (spriteInView: on the island of step 2 most entities are off screen, and sorting and
//      projecting them all cost more than drawing the visible ones)
//   5. fx back layer
//   6. draw list, sorted by depth key (x + y, or an item's sortDepth; then z, then id)
//   7. fx front layer
//   8. overlays (screen space, registration order), then present to the canvas
import { createViewBuffer, rgba } from './buffer.js';
import { createDrawList } from './drawlist.js';
import { blit } from './blit.js';
import { worldToScreen } from '../world/iso.js';

/** True when entity e's sprite, anchored at its projected point, may cover a pixel of a w x h view
 * whose top-left is world pixel (camX, camY), grown by `pad` px on every side. Conservative by a
 * pixel: the draw list rounds the anchor, and a mirrored sprite spans w columns on the other side of
 * its anchor column. */
export function spriteInView(e, camX, camY, w, h, pad = 0) {
  const s = e.sprite, p = worldToScreen(e.x, e.y, e.z ?? 0);
  const vx = p.sx - camX, vy = p.sy - camY, reach = Math.max(s.ax, s.w - s.ax) + 1 + pad;
  return vx + reach >= 0 && vx - reach < w && vy + (s.h - s.ay) + 1 + pad >= 0 && vy - s.ay - 1 - pad < h;
}

export function createRenderer(game) {
  const list = createDrawList();
  const terrainPasses = [];
  const overlays = [];
  let view = createViewBuffer(0, 0);

  const renderer = {
    clearColor: rgba('#0b1730'),
    /** Default LUT (Uint32Array(256)); the alignment system swaps it. */
    lut: new Uint32Array(256),
    /** Draw only the entity sprites that overlap the view (spriteInView). Checks turn it off to
     * compare a frame against the same frame with every sprite drawn. */
    cull: true,
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
        buf: view.data, w: view.w, h: view.h, view, camX, camY, lut: renderer.lut, world, list, game, cull: renderer.cull,
        blit: (sprite, vx, vy, flipX = false, lut = renderer.lut) => blit(view.data, view.w, view.h, sprite, vx, vy, lut, flipX),
        toView: (x, y, z = 0) => { const p = worldToScreen(x, y, z); return { vx: Math.round(p.sx - camX), vy: Math.round(p.sy - camY) }; },
        overlay: (fn) => overlays.push(fn),
      };
      view.data.fill(renderer.clearColor);
      for (const pass of terrainPasses) pass(ctx);
      list.clear();
      overlays.length = 0;
      for (const name of game.systemOrder) systems[name].draw(ctx);
      for (const e of world.entities.values()) if (e.sprite && (!renderer.cull || spriteInView(e, camX, camY, view.w, view.h))) list.push(e);
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

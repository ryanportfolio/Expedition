// Camera: (x, y) is the world-pixel position of the view's top-left corner. Pans with WASD/arrows,
// middle-button drag and the view edge; the wheel steps the display scale through SCALES, keeping
// the world point under the pointer fixed. Position is clamped so the view stays over the map's
// world-pixel bounds (centered when the view is larger than the map). Runs on sim ticks; touches
// no DOM (display.setScale is pure math, the canvas is resized at present time).
import { worldToScreen } from '../world/iso.js';

const KEY_SPEED = 240; // world px / s
const EDGE = 2; // view px band that triggers edge pan
const MARGIN = 32; // world px of sea allowed past the map edge
const MAX_Z = 16;

export function createCamera({ display, input, world }) {
  let dragLast = null;
  const camera = {
    x: 0, y: 0,
    edgePan: true,
    /** World-pixel bounds of the map: { minX, maxX, minY, maxY }. */
    bounds() {
      return {
        minX: -world.h * 16 - MARGIN,
        maxX: world.w * 16 + MARGIN,
        minY: -MAX_Z * 8 - MARGIN,
        maxY: (world.w + world.h) * 8 + MARGIN,
      };
    },
    clamp() {
      const b = camera.bounds();
      const fit = (v, lo, hi, size) => (hi - lo <= size ? (lo + hi - size) / 2 : Math.min(Math.max(v, lo), hi - size));
      camera.x = fit(camera.x, b.minX, b.maxX, display.w);
      camera.y = fit(camera.y, b.minY, b.maxY, display.h);
    },
    /** Center the view on world point (x, y, z). */
    centerOn(x, y, z = 0) {
      const p = worldToScreen(x, y, z);
      camera.x = p.sx - display.w / 2;
      camera.y = p.sy - display.h / 2;
      camera.clamp();
    },
    /** View pixel -> world pixel. */
    viewToWorldPx(vx, vy) { return { sx: vx + Math.round(camera.x), sy: vy + Math.round(camera.y) }; },
    /** World point -> view pixel. */
    worldToView(x, y, z = 0) {
      const p = worldToScreen(x, y, z);
      return { sx: Math.round(p.sx - Math.round(camera.x)), sy: Math.round(p.sy - Math.round(camera.y)) };
    },
    /** Zoom one step about a view pixel; dir +1 zooms in. */
    zoomStep(dir, vx = display.w / 2, vy = display.h / 2) {
      const old = display.scale;
      const wx = camera.x + vx, wy = camera.y + vy;
      if (!display.stepScale(dir)) return false;
      const k = old / display.scale; // same device pixel -> new view pixel
      camera.x = wx - vx * k;
      camera.y = wy - vy * k;
      // the pointer stays on the same device pixel, which is a different view pixel at the new scale
      const p = input.pointer;
      p.sx = Math.floor(p.sx * k);
      p.sy = Math.floor(p.sy * k);
      camera.clamp();
      return true;
    },
    update(dt) {
      const k = input.keys, p = input.pointer;
      let dx = 0, dy = 0;
      if (k.has('KeyA') || k.has('ArrowLeft')) dx -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) dx += 1;
      if (k.has('KeyW') || k.has('ArrowUp')) dy -= 1;
      if (k.has('KeyS') || k.has('ArrowDown')) dy += 1;
      if (camera.edgePan && p.inside && !p.buttons) {
        if (p.sx < EDGE) dx -= 1; else if (p.sx >= display.w - EDGE) dx += 1;
        if (p.sy < EDGE) dy -= 1; else if (p.sy >= display.h - EDGE) dy += 1;
      }
      camera.x += Math.sign(dx) * KEY_SPEED * dt;
      camera.y += Math.sign(dy) * KEY_SPEED * dt;
      // middle drag: the world point under the pointer follows the pointer
      if (p.buttons & 4) {
        if (dragLast) { camera.x -= p.sx - dragLast.sx; camera.y -= p.sy - dragLast.sy; }
        dragLast = { sx: p.sx, sy: p.sy };
      } else dragLast = null;
      if (input.wheel) {
        camera.zoomStep(input.wheel < 0 ? 1 : -1, p.sx, p.sy);
        input.wheel = 0;
        if (dragLast) dragLast = null;
      }
      camera.clamp();
    },
  };
  return camera;
}

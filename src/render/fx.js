// World-anchored pixelfx layer.
//
// pixelfx draws an effect into a frame: `color` (opaque or translucent pixels, 0xAABBGGRR) and
// `light` (additive glow), both w*h, with the frame's top-left at (ox, oy) in the effect's coordinate
// space. Here that space is world pixels: each frame is the size of the view and its origin is the
// camera position, and each effect's origin is placed at worldToScreen(x, y, z) of its anchor.
//
// Compositing: color is blended over the view buffer by alpha and light is added on top; the
// background is never discarded, so effects draw over the existing world. compositeOver() below gives
// the same bytes as pixelfx's composite(frame, view.bytes, view.data) (same formula, written through
// the same clamped byte view), but leaves pixels the frame does not touch (color alpha 0, no light)
// as they are instead of recomputing them; those make up most of the view.
//
// Layering: pixelfx splits an effect into "back" (behind a character) and "front". The renderer
// composites the back layer after terrain and before entity sprites, and the front layer after them.
// Effects tick on sim steps (update(dt) from game.tick), never on render.
//
// Frame cache: an effect's picture is a function of its time, options and placement, and those change
// only on sim ticks (or when the camera moves), while the renderer runs at the display rate. Each
// layer keeps its own frame and a signature of what was drawn into it (camera, view size, and per
// live effect its id, time, anchor and option values); a render with the same signature reuses the
// frame and only composites it again over the new view buffer. Options are compared by value, so an
// option replaced between ticks (fire.js sets `light`) redraws; mutating an option array in place
// would not, and nothing does.
//
// Glow: installGlow() puts a faster Painter.glow on pixelfx, with the same output (src/render/glow.js).
import { createFrame, clearFrame, createFx } from 'pixelfx';
import { worldToScreen } from '../world/iso.js';
import { installGlow } from './glow.js';

installGlow();

/**
 * In-place composite of frame f over the view: out is the view's byte view, bg its Uint32Array over
 * the same memory. Byte-identical to pixelfx composite(f, out, bg) with lightK 1; untouched pixels
 * (color alpha 0 and no light) keep their background color, with alpha forced to 255 as pixelfx does.
 */
export function compositeOver(f, out, bg) {
  const n = f.w * f.h, C = f.color, L = f.light;
  for (let i = 0; i < n; i++) {
    const c = C[i], l = L[i] & 0xffffff, ca = c >>> 24;
    if (l === 0) {
      if (ca === 0) {
        if (bg[i] >>> 24 !== 255) out[i * 4 + 3] = 255;
        continue;
      }
      if (ca === 255) { bg[i] = c; continue; }
    }
    let r, g, b;
    if (ca === 255) {
      r = c & 255; g = (c >>> 8) & 255; b = (c >>> 16) & 255;
    } else {
      const k = bg[i], a = ca / 255;
      r = (c & 255) * a + (k & 255) * (1 - a); g = ((c >>> 8) & 255) * a + ((k >>> 8) & 255) * (1 - a);
      b = ((c >>> 16) & 255) * a + ((k >>> 16) & 255) * (1 - a);
    }
    if (l) {
      r = Math.min(255, r + (l & 255)); g = Math.min(255, g + ((l >>> 8) & 255)); b = Math.min(255, b + ((l >>> 16) & 255));
    }
    const j = i * 4;
    out[j] = r; out[j + 1] = g; out[j + 2] = b; out[j + 3] = 255;
  }
  return out;
}

export function createFxLayer() {
  const live = [];
  let nextId = 1;
  // per layer: the frame and the signature of what is drawn in it
  const layers = {};

  /** Writes the signature of the current draw into sig; returns true when it equals what was there. */
  function signature(sig, view, camX, camY) {
    let i = 0, same = true;
    const put = (v) => {
      if (same && (i >= sig.length || !Object.is(sig[i], v))) same = false;
      sig[i++] = v;
    };
    put(view.w); put(view.h); put(camX); put(camY); put(live.length);
    for (const h of live) {
      const o = h.fx.options;
      put(h); put(h.fx.t);
      for (const k in o) { put(k); put(o[k]); }
    }
    if (i !== sig.length) same = false;
    sig.length = i;
    return same;
  }

  const fx = {
    live,
    /** spawn(fxModule, { x, y, z, ...pixelfx options }) -> handle { id, fx, x, y, z, move, stop, done }. */
    spawn(mod, { x = 0, y = 0, z = 0, ...opts } = {}) {
      const inst = createFx(mod, opts);
      const h = {
        id: nextId++, fx: inst, x, y, z,
        move(nx, ny, nz = h.z) { h.x = nx; h.y = ny; h.z = nz; },
        stop() { inst.stop(); },
        done: () => inst.done(),
      };
      live.push(h);
      return h;
    },
    /** Advance every live effect by dt (sim time) and drop finished ones. */
    update(dt) {
      for (const h of live) h.fx.update(dt);
      for (let i = live.length - 1; i >= 0; i--) if (live[i].fx.done()) live.splice(i, 1);
    },
    clear() { live.length = 0; },
    /** Composite one layer ('back' or 'front') of every live effect over the view buffer. */
    draw(view, camX, camY, layer) {
      if (!live.length) return;
      const L = (layers[layer] ??= { frame: null, sig: [] });
      for (const h of live) {
        const p = worldToScreen(h.x, h.y, h.z);
        h.fx.options.x = Math.round(p.sx);
        h.fx.options.y = Math.round(p.sy);
      }
      let frame = L.frame;
      if (!frame || frame.w !== view.w || frame.h !== view.h) {
        frame = L.frame = createFrame(view.w, view.h);
        L.sig.length = 0;
      }
      if (!signature(L.sig, view, camX, camY)) {
        frame.ox = camX; frame.oy = camY;
        clearFrame(frame);
        for (const h of live) h.fx.draw(frame, layer);
      }
      compositeOver(frame, view.bytes, view.data);
    },
  };
  return fx;
}

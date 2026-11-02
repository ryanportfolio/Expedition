// Private pixelfx layer for small effects that follow an entity and sort in depth with it (the orb
// glows).
//
// Why not game.fx: the shared layer composites every effect in one plane, back layer under all
// sprites and front layer over all of them, so an orb glow would paint over a house standing in
// front of the orb. Its live list is also read by other code (scripts/check-engine.mjs expects
// exactly its own effect after loading a map with a temple site, where the orbs appear).
//
// Here each effect is two draw-list items beside its entity: the back layer just before the entity
// (id - 0.5) and the front layer just after it (id + 0.5). Each item paints the effect into a small
// frame of the effect's own size (meta.size) and composites it over the view pixels under it.
//
// Ticks on sim steps (update), paints on render (draw); update touches no DOM.
import { createFrame, clearFrame, createFx, composite } from 'pixelfx';

export function createGlowLayer() {
  const items = new Map(); // key -> { inst, frame, bg, out, out32, ox, oy, x, y, z, id }

  function paint(ctx, it, layer, left, top) {
    const { frame, bg, out32 } = it, fw = frame.w, fh = frame.h, W = ctx.w, H = ctx.h, buf = ctx.buf;
    const x0 = Math.max(0, -left), y0 = Math.max(0, -top);
    const x1 = Math.min(fw, W - left), y1 = Math.min(fh, H - top);
    if (x0 >= x1 || y0 >= y1) return;
    clearFrame(frame);
    it.inst.draw(frame, layer);
    for (let y = y0; y < y1; y++) {
      const s = (top + y) * W + left, d = y * fw;
      for (let x = x0; x < x1; x++) bg[d + x] = buf[s + x];
    }
    composite(frame, it.out, bg);
    for (let y = y0; y < y1; y++) {
      const s = (top + y) * W + left, d = y * fw;
      for (let x = x0; x < x1; x++) buf[s + x] = out32[d + x];
    }
  }

  return {
    items,
    /** Start effect `mod` under `key` (replacing any effect there). Its origin sits on the item's point. */
    add(key, mod, opts) {
      const [fw, fh] = mod.meta?.size ?? [64, 64];
      const [ox, oy] = mod.meta?.origin ?? [fw >> 1, fh >> 1];
      const out = new Uint8ClampedArray(fw * fh * 4);
      items.set(key, {
        inst: createFx(mod, { ...opts, x: ox, y: oy }), frame: createFrame(fw, fh),
        bg: new Uint32Array(fw * fh), out, out32: new Uint32Array(out.buffer), ox, oy, x: 0, y: 0, z: 0, id: 0,
      });
    },
    /** Put an item at a world point; `id` is the entity id it sorts beside. */
    place(key, x, y, z, id) {
      const it = items.get(key);
      if (!it) return;
      it.x = x; it.y = y; it.z = z; it.id = id;
    },
    remove(key) { items.delete(key); },
    clear() { items.clear(); },
    update(dt) { for (const it of items.values()) it.inst.update(dt); },
    /** Push the back and front draw-list items of every effect (render path only). */
    draw(ctx) {
      for (const it of items.values()) {
        for (const [layer, id] of [['back', it.id - 0.5], ['front', it.id + 0.5]]) {
          ctx.list.push({ x: it.x, y: it.y, z: it.z, id, draw: (c, vx, vy) => paint(c, it, layer, vx - it.ox, vy - it.oy) });
        }
      }
    },
  };
}

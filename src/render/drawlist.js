// Draw list: world items collected each frame, sorted by the spec depth key, drawn back to front.
// Item: { x, y, z, id, sprite, flipX?, lut?, draw?, sortDepth? } (sortDepth: see depthKey in iso.js). With draw(ctx, vx, vy) the item paints itself;
// otherwise its sprite is blitted with the anchor on the projected point.
import { compareDepth, worldToScreen } from '../world/iso.js';
import { blit } from './blit.js';

export function createDrawList() {
  const items = [];
  return {
    items,
    push(item) { items.push(item); },
    clear() { items.length = 0; },
    sort() { items.sort(compareDepth); return items; },
    draw(ctx) {
      items.sort(compareDepth);
      for (const it of items) {
        const p = worldToScreen(it.x, it.y, it.z ?? 0);
        const vx = Math.round(p.sx - ctx.camX), vy = Math.round(p.sy - ctx.camY);
        if (it.draw) it.draw(ctx, vx, vy);
        else if (it.sprite) blit(ctx.buf, ctx.w, ctx.h, it.sprite, vx, vy, it.lut ?? ctx.lut, !!it.flipX);
      }
    },
  };
}

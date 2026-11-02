// Build bar and placement ghost. The bar sits in the bottom-right corner: a header with the
// player village's wood stock, then one slot per building the player may plan (key number, picture,
// wood cost). While a kind is picked, a dithered ghost of that building follows the pointer, snapped
// to the tile under it, with its footprint outlined on the ground: green where the village would
// accept the blueprint, red (and the reason underneath) where it would not.
//
// Pure drawing and lookups: no game object, no DOM. The ui system owns the state and the input.
import { getSprite } from '../art/registry.js';
import { idx } from '../art/palette.js';
import { KINDS } from '../village/config.js';
import { BUILD } from './layout.js';
import { col, fill, panel, drawText, measure, icon } from './draw.js';

/** Bar order; keys 1-4 pick them in this order. */
export const BUILD_KINDS = Object.freeze(['house', 'field', 'storehouse', 'woodpile']);
export const BUILD_KEYS = Object.freeze({ Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 });

/** Wood cost of a kind, read from the village's building definitions. */
export const costOf = (kind) => KINDS[kind]?.cost ?? 0;

/** Footprint origin (top-left tile) for a kind centred on tile (tx, ty): the village's own rule
 * (even sizes extend toward +x / +y). */
export function footprint(kind, tx, ty) {
  const k = KINDS[kind];
  if (!k) return null;
  const ox = tx - ((k.fw - 1) >> 1), oy = ty - ((k.fh - 1) >> 1);
  return { ox, oy, fw: k.fw, fh: k.fh, cx: ox + k.fw / 2, cy: oy + k.fh / 2 };
}

// Village reasons are written for code; the player sees these. Unknown reasons show as they are.
const REASON_TEXT = [
  [/^water/, 'cannot build on water'],
  [/^bare rock/, 'cannot build on bare rock'],
  [/^not buildable/, 'cannot build on this ground'],
  [/^too steep/, 'ground too steep'],
  [/^out of range/, 'too far from your village'],
  [/^overlaps/, 'something already stands here'],
  [/^a rock/, 'a rock is in the way'],
  [/^trees/, 'trees are in the way'],
  [/^outside the map/, 'off the island'],
];
export function reasonText(reason) {
  if (!reason) return '';
  for (const [re, text] of REASON_TEXT) if (re.test(reason)) return text;
  return String(reason).replace(/["()]/g, '');
}

// ---------------------------------------------------------------- ghost
const TINT = { ok: 'heal', bad: 'fire' };
const ghostCache = new Map();

/** The building's finished player sprite recoloured into one ramp: green (heal) when ok, shades
 * lifted so the darkest outline still reads on dark ground; red when not, kept to the fire ramp's
 * low shades (its high shades turn orange and yellow). */
function tinted(kind, ok) {
  const src = getSprite(kind, { owner: 'player', stage: 'done' });
  const key = `${kind}|${ok}`;
  const hit = ghostCache.get(key);
  if (hit && hit.src === src) return hit.sprite;
  const ramp = ok ? TINT.ok : TINT.bad;
  const data = new Uint8Array(src.data.length);
  for (let i = 0; i < data.length; i++) {
    const v = src.data[i];
    if (!v) continue;
    const shade = (v - 1) % 8;
    data[i] = idx(ramp, ok ? Math.min(7, 1 + Math.round(shade * 0.85)) : 1 + Math.round(shade * 0.45));
  }
  const sprite = { w: src.w, h: src.h, ax: src.ax, ay: src.ay, data };
  ghostCache.set(key, { src, sprite });
  return sprite;
}

/**
 * Draws the placement ghost for hover { kind, tx, ty, ok, reason } and returns what it drew:
 * { rect (sprite bounds in view px), drawn (pixels written), label (reason text or null),
 * labelRect (the label's text box in view px, outline not included, or null) }.
 * The sprite goes down in a checkerboard (every other view pixel), except its darkest outline
 * shades, so the ground shows through; the footprint is outlined solid on the terrain.
 */
export function drawGhost(ctx, hover, heightAt) {
  const fp = footprint(hover.kind, hover.tx, hover.ty);
  if (!fp) return null;
  const { buf, w: W, h: H, lut } = ctx;
  const ok = !!hover.ok;
  const ramp = ok ? TINT.ok : TINT.bad;
  // footprint outline: the four edges of the tile rectangle, following the ground's height
  const edge = col(ctx, ramp, ok ? 6 : 3), edgeDark = col(ctx, ramp, ok ? 2 : 1);
  const corners = [[fp.ox, fp.oy], [fp.ox + fp.fw, fp.oy], [fp.ox + fp.fw, fp.oy + fp.fh], [fp.ox, fp.oy + fp.fh]];
  for (let e = 0; e < 4; e++) {
    const [ax, ay] = corners[e], [bx, by] = corners[(e + 1) % 4];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) * 24));
    for (let i = 0; i <= n; i++) {
      const x = ax + ((bx - ax) * i) / n, y = ay + ((by - ay) * i) / n;
      const p = ctx.toView(x, y, heightAt(x, y));
      if (p.vx >= 0 && p.vy >= 0 && p.vx < W && p.vy < H) buf[p.vy * W + p.vx] = edge;
      if (p.vx >= 0 && p.vy + 1 >= 0 && p.vx < W && p.vy + 1 < H) buf[(p.vy + 1) * W + p.vx] = edgeDark;
    }
  }
  // dithered sprite
  const sprite = tinted(hover.kind, ok);
  const at = ctx.toView(fp.cx, fp.cy, heightAt(fp.cx, fp.cy));
  const x0 = at.vx - sprite.ax, y0 = at.vy - sprite.ay;
  let drawn = 0;
  for (let sy = 0; sy < sprite.h; sy++) {
    const vy = y0 + sy;
    if (vy < 0 || vy >= H) continue;
    for (let sx = 0; sx < sprite.w; sx++) {
      const v = sprite.data[sy * sprite.w + sx];
      if (!v) continue;
      const vx = x0 + sx;
      if (vx < 0 || vx >= W) continue;
      const outline = (v - 1) % 8 <= 1;
      if (!outline && ((vx + vy) & 1)) continue;
      buf[vy * W + vx] = lut[v];
      drawn++;
    }
  }
  let label = null, labelRect = null;
  if (!ok && hover.reason) {
    label = reasonText(hover.reason);
    const tw = measure(label);
    const lx = Math.max(2, Math.min(W - tw - 3, Math.round(at.vx - tw / 2)));
    const ly = Math.max(2, Math.min(H - 8, at.vy + Math.round(fp.fh * 4) + 6));
    // small text straight over the world: a 1 px ink outline keeps it readable on sand, grass and water
    drawText(ctx, label, lx, ly, col(ctx, 'fire', 7), { outline: col(ctx, 'ui-ink', 0) });
    labelRect = { x: lx, y: ly, w: tw, h: 5 };
  }
  return { rect: { x: x0, y: y0, w: sprite.w, h: sprite.h }, drawn, label, labelRect, ramp };
}

// ---------------------------------------------------------------- bar
/**
 * Draws the build bar into L.build / L.buildSlots. state: { kind (picked or null), hoverSlot
 * (index or -1), wood (village stock), tip (text for the strip above the bar, or null), tipBad }.
 * Returns { rect, slots: [{ kind, rect, cost, picked }], tip: { x, y, w, h, text, bad } or null }.
 */
export function drawBuildBar(ctx, L, state) {
  const r = L.build;
  if (!r) return null;
  const ink = col(ctx, 'ui-ink', 0), soft = col(ctx, 'ui-ink', 3);
  panel(ctx, r);
  // header: label left, wood stock right
  const hy = r.y + BUILD.pad + 1;
  drawText(ctx, 'build', r.x + BUILD.pad + 2, hy, ink);
  const woodIcon = getSprite('ui-icon', { name: 'wood' });
  const stock = String(Math.max(0, Math.floor(state.wood || 0)));
  const sx = r.x + r.w - BUILD.pad - 2 - measure(stock);
  drawText(ctx, stock, sx, hy, ink);
  icon(ctx, woodIcon, sx - woodIcon.w - 2, hy - 1);
  // a rule under the header
  fill(ctx, r.x + BUILD.pad, r.y + BUILD.pad + BUILD.head - 2, r.w - 2 * BUILD.pad, 1, col(ctx, 'ui-parchment', 3));
  const slots = [];
  BUILD_KINDS.forEach((kind, i) => {
    const s = L.buildSlots[i];
    if (!s) return;
    const picked = state.kind === kind, hot = state.hoverSlot === i;
    if (picked) {
      // pressed in: dark rim, sunk body, lit bottom-right edge
      fill(ctx, s.x, s.y, s.w, s.h, ink);
      fill(ctx, s.x + 1, s.y + 1, s.w - 2, s.h - 2, col(ctx, 'ui-parchment', 2));
      fill(ctx, s.x + 1, s.y + s.h - 2, s.w - 2, 1, col(ctx, 'ui-parchment', 4));
      fill(ctx, s.x + s.w - 2, s.y + 1, 1, s.h - 2, col(ctx, 'ui-parchment', 4));
    } else if (hot) {
      fill(ctx, s.x, s.y, s.w, s.h, col(ctx, 'ui-parchment', 6));
      fill(ctx, s.x, s.y + s.h - 1, s.w, 1, col(ctx, 'ui-parchment', 3));
    } else {
      fill(ctx, s.x, s.y + s.h - 1, s.w, 1, col(ctx, 'ui-parchment', 4));
    }
    const pic = getSprite('ui-build', { kind });
    icon(ctx, pic, s.x + BUILD.icon.x + (picked ? 1 : 0), s.y + BUILD.icon.y + (picked ? 1 : 0));
    drawText(ctx, String(i + 1), s.x + BUILD.key.x - 1, s.y + BUILD.key.y - 1, picked ? col(ctx, 'ui-parchment', 6) : soft);
    const cost = costOf(kind);
    const ct = String(cost), cw = woodIcon.w + 1 + measure(ct);
    const cx = s.x + Math.round((s.w - cw) / 2), cy = s.y + BUILD.cost.y;
    icon(ctx, woodIcon, cx, cy);
    drawText(ctx, ct, cx + woodIcon.w + 1, cy + 1, picked ? col(ctx, 'ui-parchment', 7) : ink);
    slots.push({ kind, rect: s, cost, picked });
  });
  // the strip above the bar: what to do next, or why the last click did nothing
  let tip = null;
  if (state.tip) {
    const tw = measure(state.tip), th = 9;
    tip = { x: r.x + r.w - tw - 8, y: r.y - th - 2, w: tw + 8, h: th, text: state.tip, bad: !!state.tipBad };
    fill(ctx, tip.x, tip.y, tip.w, tip.h, ink);
    fill(ctx, tip.x + 1, tip.y + 1, tip.w - 2, tip.h - 2, state.tipBad ? col(ctx, 'fire', 1) : col(ctx, 'ui-ink', 2));
    drawText(ctx, state.tip, tip.x + 4, tip.y + 2, state.tipBad ? col(ctx, 'fire', 7) : col(ctx, 'ui-parchment', 7));
  }
  return { rect: r, slots, tip };
}

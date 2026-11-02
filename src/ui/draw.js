// Screen-space drawing helpers for the UI overlays. They write colors straight into the view buffer
// (ctx.buf, 0xAABBGGRR) through the frame's LUT, clip to the view and never allocate per pixel.
// Text uses pixelfx's pixel fonts ("mini" 3x5, "big" 5x7), optionally scaled by whole pixels, with
// the small font's W, M and N replaced by clearer capitals (src/ui/font.js).
import { fontOf, glyphFor, textWidthOf } from './font.js';
import { idx } from '../art/palette.js';

/** LUT color for a ramp + shade in this frame. */
export const col = (ctx, ramp, shade) => ctx.lut[idx(ramp, shade)];

export function put(ctx, x, y, c) {
  if (x >= 0 && y >= 0 && x < ctx.w && y < ctx.h) ctx.buf[y * ctx.w + x] = c;
}

export function fill(ctx, x, y, w, h, c) {
  const x0 = Math.max(0, x), y0 = Math.max(0, y);
  const x1 = Math.min(ctx.w, x + w), y1 = Math.min(ctx.h, y + h);
  for (let yy = y0; yy < y1; yy++) ctx.buf.fill(c, yy * ctx.w + x0, yy * ctx.w + Math.max(x0, x1));
}

/** Counts pixels equal to color c inside a rect (checks and the scenario sample bars with it). */
export function count(buf, W, H, r, c) {
  let n = 0;
  for (let y = Math.max(0, r.y); y < Math.min(H, r.y + r.h); y++)
    for (let x = Math.max(0, r.x); x < Math.min(W, r.x + r.w); x++) if (buf[y * W + x] === c) n++;
  return n;
}

/**
 * Parchment card: ink outline with clipped corners, a lit top edge, a shaded bottom edge and a
 * one-pixel drop shadow down-right (light from the top-left).
 */
export function panel(ctx, r, { body = 5 } = {}) {
  const { x, y, w, h } = r;
  const ink = col(ctx, 'ui-ink', 0), shadow = col(ctx, 'shadow', 0);
  const lit = col(ctx, 'ui-parchment', Math.min(7, body + 2)), mid = col(ctx, 'ui-parchment', body);
  const dark = col(ctx, 'ui-parchment', Math.max(0, body - 2));
  fill(ctx, x + 2, y + h, w - 2, 1, shadow);
  fill(ctx, x + w, y + 2, 1, h - 2, shadow);
  fill(ctx, x + 1, y, w - 2, 1, ink);
  fill(ctx, x + 1, y + h - 1, w - 2, 1, ink);
  fill(ctx, x, y + 1, 1, h - 2, ink);
  fill(ctx, x + w - 1, y + 1, 1, h - 2, ink);
  fill(ctx, x + 1, y + 1, w - 2, h - 2, mid);
  fill(ctx, x + 1, y + 1, w - 2, 1, lit);
  fill(ctx, x + 1, y + 1, 1, h - 3, lit);
  fill(ctx, x + 1, y + h - 2, w - 2, 1, dark);
  fill(ctx, x + w - 2, y + 2, 1, h - 3, dark);
}

/** Recessed trough for a bar: inner rect r, with a dark rim around it. */
export function trough(ctx, r) {
  const rim = col(ctx, 'ui-ink', 1);
  fill(ctx, r.x - 1, r.y - 1, r.w + 2, r.h + 2, rim);
  fill(ctx, r.x, r.y, r.w, r.h, col(ctx, 'ui-ink', 3));
  fill(ctx, r.x, r.y, r.w, 1, col(ctx, 'ui-ink', 2)); // shadow under the rim's top edge
}

/** Bar fill of n px from the left of r: body color c, its top row in the lighter color cLit. */
export function barRun(ctx, r, x0, n, c, cLit) {
  if (n <= 0) return;
  fill(ctx, r.x + x0, r.y, n, r.h, c);
  fill(ctx, r.x + x0, r.y, n, 1, cLit);
}

/** Width in view px of text drawn with drawText (uppercased, font scaled by `scale`). */
export function measure(str, font = 'mini', scale = 1) {
  return textWidthOf(String(str).toUpperCase(), font) * scale;
}

/** Offsets of the 1 px outline: the eight neighbours of every inked pixel. */
const RING = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/**
 * Draws text with its top-left at (x, y). Text is uppercased first: the fonts' lowercase "x" is a
 * multiplication sign. Optional shadow color draws a copy one pixel down-right underneath. Optional
 * outline color rings every inked pixel with a 1 px border (filling the counters and the gaps between
 * letters too), so the text reads on any ground; small text drawn straight over the world uses it.
 * Returns the drawn width.
 */
export function drawText(ctx, str, x, y, c, { font = 'mini', scale = 1, shadow = null, outline = null } = {}) {
  const F = fontOf(font);
  const s = String(str).toUpperCase();
  const pass = (ox, oy, color) => {
    let cx = x + ox;
    for (const ch of s) {
      const g = glyphFor(font, ch);
      if (!g) { cx += (F.space + F.gap) * scale; continue; }
      for (let r = 0; r < F.h; r++) for (let k = 0; k < g.w; k++) {
        if (g.rows[r][k]) fill(ctx, cx + k * scale, y + oy + r * scale, scale, scale, color);
      }
      cx += (g.w + F.gap) * scale;
    }
  };
  if (outline != null) for (const [ox, oy] of RING) pass(ox, oy, outline);
  if (shadow != null) pass(scale, scale, shadow);
  pass(0, 0, c);
  return measure(s, font, scale);
}

/** Icon sprite (anchor 0,0) with its top-left at (x, y), through the frame's LUT. */
export function icon(ctx, sprite, x, y) {
  ctx.blit(sprite, x + sprite.ax, y + sprite.ay, false, ctx.lut);
}

/**
 * Darkens the whole view, more toward the edges, in four flat bands (no smooth gradient): k is the
 * brightness kept in 1/256ths at the centre; each band outward keeps less.
 */
export function vignette(ctx, k = 150) {
  const { buf, w, h } = ctx;
  const cx = w / 2, cy = h / 2;
  const levels = [k, k - 22, k - 44, k - 66].map((v) => Math.max(0, v));
  for (let y = 0; y < h; y++) {
    const dy = (y - cy) / (h / 2);
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / (w / 2);
      const d = dx * dx * 0.7 + dy * dy;
      const m = levels[d < 0.35 ? 0 : d < 0.7 ? 1 : d < 1.05 ? 2 : 3];
      const i = y * w + x, v = buf[i];
      buf[i] = ((v & 0xff000000) | ((((v >>> 16) & 255) * m >> 8) << 16) | ((((v >>> 8) & 255) * m >> 8) << 8) | (((v & 255) * m) >> 8)) >>> 0;
    }
  }
}

// Full-view screens: the title over the live island, and the win banner.
import { getSprite } from '../art/registry.js';
import { col, fill, panel, drawText, measure, vignette, icon } from './draw.js';
import { FONTS } from 'pixelfx';

export const TITLE = 'Expedition';
export const TITLE_LINE = 'one island, one giant, and you above them';
export const TITLE_PROMPT = 'click to begin';
export const WIN_HEAD = 'The village is yours';
export const WIN_HOW = {
  impress: 'they kneel in awe of your kindness',
  scare: 'they kneel in terror of your wrath',
};
export const WIN_PROMPT = 'press enter to keep playing';

/**
 * Title lettering: the big pixel font at `scale`, each font pixel a scale x scale block of carved
 * stone (lit top edge, shaded bottom edge), a one-pixel ink outline and a drop shadow.
 */
function carvedText(ctx, str, x, y, scale) {
  const F = FONTS.big, s = String(str).toUpperCase();
  const cells = [];
  let cx = 0;
  for (const ch of s) {
    const g = F.glyphs[ch];
    if (!g) { cx += F.space + F.gap; continue; }
    for (let r = 0; r < F.h; r++) for (let k = 0; k < g.w; k++) if (g.rows[r][k]) cells.push([cx + k, r]);
    cx += g.w + F.gap;
  }
  const on = new Set(cells.map(([a, b]) => `${a},${b}`));
  const ink = col(ctx, 'ui-ink', 0), shadow = col(ctx, 'shadow', 0);
  const pass = (fn) => { for (const [a, b] of cells) fn(x + a * scale, y + b * scale, a, b); };
  pass((px, py) => fill(ctx, px + 2, py + 3, scale, scale, shadow)); // drop shadow
  pass((px, py) => fill(ctx, px - 1, py - 1, scale + 2, scale + 2, ink)); // outline
  pass((px, py, a, b) => {
    const top = !on.has(`${a},${b - 1}`), bottom = !on.has(`${a},${b + 1}`);
    fill(ctx, px, py, scale, scale, col(ctx, 'ui-parchment', 6));
    if (top) fill(ctx, px, py, scale, 1, col(ctx, 'ui-parchment', 7));
    if (bottom) fill(ctx, px, py + scale - 1, scale, 1, col(ctx, 'ui-parchment', 3));
    if (!on.has(`${a - 1},${b}`)) fill(ctx, px, py + (top ? 1 : 0), 1, scale - (top ? 1 : 0) - (bottom ? 1 : 0), col(ctx, 'ui-parchment', 7));
  });
  return cx * scale;
}

/** Title screen over the live view. Returns the rects it drew (for checks). */
export function drawTitle(ctx) {
  const { w: W, h: H } = ctx;
  vignette(ctx, 150);
  const scale = W >= 360 ? 4 : W >= 240 ? 3 : 2;
  const tw = (measure(TITLE, 'big') + 0) * scale;
  const tx = Math.round((W - tw) / 2), ty = Math.round(H * 0.38 - (7 * scale) / 2);
  carvedText(ctx, TITLE, tx, ty, scale);
  const ink = col(ctx, 'ui-ink', 0), pale = col(ctx, 'ui-parchment', 6), dim = col(ctx, 'ui-parchment', 4);
  // a rule with a small glow mark under the title
  const ry = ty + 7 * scale + 6;
  const rw = Math.min(tw, W - 16);
  fill(ctx, Math.round((W - rw) / 2), ry, rw, 1, dim);
  const mark = getSprite('ui-mark', { kind: 'glow' });
  ctx.blit(mark, Math.round(W / 2), ry, false, ctx.lut);
  const lw = measure(TITLE_LINE);
  drawText(ctx, TITLE_LINE, Math.round((W - lw) / 2), ry + 7, pale, { outline: ink }); // small text over the world
  const pw = measure(TITLE_PROMPT, 'mini', 2);
  const py = Math.round(H * 0.7);
  drawText(ctx, TITLE_PROMPT, Math.round((W - pw) / 2), py, col(ctx, 'ui-parchment', 7), { scale: 2, shadow: ink });
  return { title: { x: tx, y: ty, w: tw, h: 7 * scale }, prompt: { x: Math.round((W - pw) / 2), y: py, w: pw, h: 10 } };
}

/** Win banner in rect r; how is 'impress' or 'scare'. */
export function drawBanner(ctx, r, how) {
  panel(ctx, r, { body: 5 });
  const ink = col(ctx, 'ui-ink', 0), soft = col(ctx, 'ui-ink', 3);
  // inner rule frame, two pixels in
  const rule = col(ctx, 'ui-parchment', 3);
  fill(ctx, r.x + 3, r.y + 3, r.w - 6, 1, rule);
  fill(ctx, r.x + 3, r.y + r.h - 4, r.w - 6, 1, rule);
  const hw = measure(WIN_HEAD, 'big');
  const hx = Math.round(r.x + (r.w - hw) / 2);
  drawText(ctx, WIN_HEAD, hx, r.y + 7, ink, { font: 'big', shadow: col(ctx, 'ui-parchment', 7) });
  const glow = getSprite('ui-icon', { name: how === 'scare' ? 'evil' : 'good' });
  icon(ctx, glow, hx - 12, r.y + 7);
  icon(ctx, glow, hx + hw + 5, r.y + 7);
  const line = WIN_HOW[how === 'scare' ? 'scare' : 'impress'];
  drawText(ctx, line, Math.round(r.x + (r.w - measure(line)) / 2), r.y + 19, ink);
  drawText(ctx, WIN_PROMPT, Math.round(r.x + (r.w - measure(WIN_PROMPT)) / 2), r.y + 28, soft);
}

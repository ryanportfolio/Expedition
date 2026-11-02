// Creature debug panel (backquote toggles it): the brain's needs, weak state, current situation and
// lean, then its learned table, rows grouped under their situation: action key, score as a bar
// (red left of the centre line for negative, green right for positive) and a cross when the action
// is forbidden. Rows that do not fit are counted on a last "+N more" line; PageUp / PageDown scroll.
import { DEBUG, clampSigned, clamp01 } from './layout.js';
import { col, fill, panel, trough, barRun, drawText, measure } from './draw.js';

const NEED_LABEL = { hunger: 'hunger', fatigue: 'fatigue', boredom: 'boredom' };

/** Flat list of display lines for a brain table: headers and rows, the current situation first. */
export function tableLines(table) {
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  const bySit = new Map();
  for (const r of rows) {
    if (!bySit.has(r.situation)) bySit.set(r.situation, []);
    bySit.get(r.situation).push(r);
  }
  const sits = [...bySit.keys()].sort((a, b) => (a === table?.situation ? -1 : b === table?.situation ? 1 : a < b ? -1 : a > b ? 1 : 0));
  const lines = [];
  for (const s of sits) {
    lines.push({ kind: 'situation', situation: s, current: s === table?.situation });
    for (const r of bySit.get(s)) lines.push({ kind: 'row', ...r });
  }
  return lines;
}

/**
 * Draws the panel into rect r. info: { brain table (or null), needs, weak, lean } or null when
 * there is no creature. scroll: first table line shown. Returns { shown, total, scroll, rows }.
 */
export function drawDebug(ctx, r, info, scroll = 0) {
  panel(ctx, r, { body: 4 });
  const ink = col(ctx, 'ui-ink', 0), soft = col(ctx, 'ui-ink', 2), hot = col(ctx, 'fire', 2);
  const x0 = r.x + 4, right = r.x + r.w - 4;
  let y = r.y + 4;
  const bottom = r.y + r.h - 4;
  drawText(ctx, 'creature mind', x0, y, ink);
  y += DEBUG.line + 1;
  if (!info) {
    drawText(ctx, 'no creature', x0, y, soft);
    return { shown: 0, total: 0, scroll: 0, rows: [] };
  }
  // needs as small bars, then weak, situation and lean
  for (const n of ['hunger', 'fatigue', 'boredom']) {
    if (y + 5 > bottom) break;
    drawText(ctx, NEED_LABEL[n], x0, y, ink);
    const bar = { x: x0 + 32, y: y + 1, w: right - x0 - 32 - 14, h: 3 };
    trough(ctx, bar);
    const v = clamp01(info.needs?.[n]);
    barRun(ctx, bar, 0, Math.round(v * bar.w), col(ctx, v >= 0.66 ? 'fire' : 'clay', 4), col(ctx, v >= 0.66 ? 'fire' : 'clay', 6));
    drawText(ctx, String(Math.round(v * 100)), right - 11, y, ink);
    y += DEBUG.line;
  }
  const lean = clampSigned(info.lean);
  const state = `${info.weak ? 'weak' : 'strong'}  lean ${lean >= 0 ? '+' : '-'}${Math.abs(lean).toFixed(2)}`;
  if (y + 5 <= bottom) { drawText(ctx, state, x0, y, info.weak ? hot : ink); y += DEBUG.line; }
  fill(ctx, x0, y, right - x0, 1, col(ctx, 'ui-parchment', 1));
  y += 3;

  const lines = tableLines(info.table);
  const total = lines.length;
  if (!total && y + 5 <= bottom) { drawText(ctx, 'nothing learned yet', x0, y, soft); return { shown: 0, total, scroll: 0, rows: [] }; }
  const fit = Math.max(1, Math.floor((bottom - y + 2) / DEBUG.line));
  const maxScroll = Math.max(0, total - fit);
  const s = Math.max(0, Math.min(scroll, maxScroll));
  const room = s + fit < total ? fit - 1 : fit; // leave a line for "+N more"
  const rows = [];
  const barW = 26, barX = right - 8 - barW;
  for (let i = s; i < Math.min(total, s + room); i++) {
    const l = lines[i];
    if (l.kind === 'situation') {
      drawText(ctx, l.situation, x0, y, l.current ? ink : soft);
      if (l.current) fill(ctx, x0 - 2, y + 1, 1, 3, ink);
    } else {
      // key, clipped so it never runs into the bar
      let key = l.key;
      while (key.length > 3 && measure(key) > barX - x0 - 6) key = key.slice(0, -1);
      drawText(ctx, key, x0 + 4, y, l.forbidden ? hot : ink);
      const bar = { x: barX, y: y + 1, w: barW, h: 3 };
      trough(ctx, bar);
      const half = barW >> 1, v = clampSigned(l.score), n = Math.round(Math.abs(v) * half);
      if (v > 0) barRun(ctx, bar, half, n, col(ctx, 'heal', 4), col(ctx, 'heal', 6));
      else if (v < 0) barRun(ctx, bar, half - n, n, col(ctx, 'fire', 2), col(ctx, 'fire', 4));
      fill(ctx, bar.x + half, bar.y - 1, 1, bar.h + 2, col(ctx, 'ui-ink', 0));
      if (l.forbidden) { // a small cross
        const cx = right - 4, cy = y;
        for (let k = 0; k < 5; k++) { fill(ctx, cx + k - 1, cy + k, 1, 1, hot); fill(ctx, cx + 3 - k, cy + k, 1, 1, hot); }
      }
      rows.push({ key: l.key, situation: l.situation, score: l.score, forbidden: !!l.forbidden, fill: n * Math.sign(v) });
    }
    y += DEBUG.line;
  }
  if (room < fit) drawText(ctx, `+${total - (s + room)} more  pgdn`, x0, y, soft);
  return { shown: room, total, scroll: s, rows };
}

// HUD panels: miracle power (top-left), alignment (top-centre), rival belief (top-right) and the
// creature (bottom-left). drawHud paints them into the view buffer and returns what it drew: each
// bar's view rect, filled pixel count and fill colors, so checks can sample the frame against state.
import { getSprite } from '../art/registry.js';
import { PAD, POWER, ALIGN, RIVAL, CREATURE, barFill, tickX, signedFill, beliefFill, pct, clamp01 } from './layout.js';
import { col, fill, panel, trough, barRun, drawText, measure, icon } from './draw.js';

export const MIRACLE_ORDER = ['rain', 'heal', 'fire', 'lightning'];
const MIRACLE_RAMP = { rain: 'water', heal: 'heal', fire: 'fire', lightning: 'lightning' };
export const NEEDS = ['hunger', 'fatigue', 'boredom'];
const NEED_RAMP = { hunger: 'clay', fatigue: 'lightning', boredom: 'cloth-rival' };
export const NEED_HIGH = 0.66; // the brain's "high" level: the bar turns ember red from here
/** Rival panel legend once the village is won, by how it was won (game.state.wonHow). */
export const CONVERTED = Object.freeze({ impress: 'converted by awe', scare: 'converted by fear', other: 'converted' });

/** Fill color names (ramp, body shade, lit shade) per bar, shared with the checks. */
export const FILL = Object.freeze({
  power: ['fire', 3, 5],
  good: ['heal', 4, 6],
  evil: ['fire', 2, 4],
  impress: ['heal', 4, 6],
  scare: ['fire', 2, 4],
  need: (name, v) => (v >= NEED_HIGH ? ['fire', 3, 5] : [NEED_RAMP[name], 4, 6]),
});
const fc = (ctx, f) => [col(ctx, f[0], f[1]), col(ctx, f[0], f[2])];
const abs = (r, b) => ({ x: r.x + b.x, y: r.y + b.y, w: b.w, h: b.h });

/** Small ink caret pointing up at column x, tip at row y. */
function caret(ctx, x, y) {
  const ink = col(ctx, 'ui-ink', 0), lit = col(ctx, 'ui-parchment', 7);
  fill(ctx, x - 1, y, 3, 1, ink);
  fill(ctx, x - 2, y + 1, 5, 1, ink);
  fill(ctx, x - 1, y + 1, 3, 1, lit);
  fill(ctx, x, y, 1, 1, lit);
}

/** Centre-out signed scale with notches every quarter and a caret under the marker. */
function signedScale(ctx, r, v, caretY) {
  trough(ctx, r);
  const half = Math.floor(r.w / 2);
  const { fill: f, caret: cx } = signedFill(v, r.w);
  const [g, gl] = fc(ctx, FILL.good), [e, el] = fc(ctx, FILL.evil);
  if (f > 0) barRun(ctx, r, half, f, g, gl);
  else if (f < 0) barRun(ctx, r, half + f, -f, e, el);
  const notch = col(ctx, 'ui-ink', 1);
  for (const q of [0.25, 0.5, 0.75]) fill(ctx, r.x + Math.round(r.w * q) - (q === 0.5 ? 1 : 0), r.y + r.h, q === 0.5 ? 2 : 1, 1, notch);
  caret(ctx, r.x + cx, caretY);
  return { fill: f, caret: cx };
}

/**
 * data: { power, cap, costs: { rain, ... }, alignment, belief, mix, won, wonHow, creature: { needs,
 * weak, lean } or null }. L: layout(). Returns the drawn widget values.
 */
export function drawHud(ctx, L, data) {
  const out = {};
  const ink = col(ctx, 'ui-ink', 0), inkSoft = col(ctx, 'ui-ink', 3);

  // ---- power: altar icon, bar with a tick per miracle cost, value, miracle row lit when affordable
  {
    const r = L.power;
    panel(ctx, r);
    icon(ctx, getSprite('ui-icon', { name: 'power' }), r.x + POWER.icon.x, r.y + POWER.icon.y);
    const bar = abs(r, POWER.bar);
    trough(ctx, bar);
    const f = barFill(data.power, data.cap, bar.w);
    const [c, cl] = fc(ctx, FILL.power);
    barRun(ctx, bar, 0, f, c, cl);
    // cost ticks: an ink notch through the bar, and a colored pip under it per miracle (miracles
    // with the same cost share the notch and sit side by side under it)
    const byCost = new Map();
    for (const m of MIRACLE_ORDER) {
      const cost = data.costs?.[m];
      if (!Number.isFinite(cost)) continue;
      const tx = tickX(cost, data.cap, bar.w);
      if (!byCost.has(tx)) byCost.set(tx, []);
      byCost.get(tx).push(m);
    }
    const ticks = [];
    for (const [tx, ms] of byCost) {
      fill(ctx, bar.x + tx, bar.y - 2, 1, 2, ink); // notch above the bar; the fill stays whole
      const pw = ms.length > 1 ? 2 : 3, x0 = bar.x + tx - Math.floor((pw * ms.length - 1) / 2);
      ms.forEach((m, i) => {
        fill(ctx, x0 + i * pw, r.y + POWER.pips.y, pw, 2, col(ctx, MIRACLE_RAMP[m], 5));
        ticks.push({ miracle: m, x: tx });
      });
    }
    drawText(ctx, String(Math.floor(Math.max(0, Number.isFinite(data.power) ? data.power : 0))), r.x + POWER.value.x, r.y + POWER.value.y, ink);
    const lit = {};
    MIRACLE_ORDER.forEach((m, i) => {
      const cost = data.costs?.[m] ?? 0;
      const can = Number.isFinite(data.power) && data.power >= cost;
      lit[m] = can;
      const x = r.x + POWER.miracles.x + i * POWER.miracles.step, y = r.y + POWER.miracles.y;
      icon(ctx, getSprite('ui-icon', { name: m, lit: can }), x, y);
      drawText(ctx, String(cost), x + 8, y + 1, can ? ink : inkSoft);
    });
    out.power = { rect: bar, fill: f, inner: bar.w, color: c, colorLit: cl, ticks, lit };
  }

  // ---- alignment: evil ember, centre-out scale, good shoot
  {
    const r = L.align;
    panel(ctx, r);
    icon(ctx, getSprite('ui-icon', { name: 'evil' }), r.x + ALIGN.evil.x, r.y + ALIGN.evil.y);
    icon(ctx, getSprite('ui-icon', { name: 'good' }), r.x + ALIGN.good.x, r.y + ALIGN.good.y);
    const bar = abs(r, ALIGN.scale);
    const s = signedScale(ctx, bar, data.alignment, r.y + ALIGN.caret.y);
    out.align = { rect: bar, fill: s.fill, caret: s.caret, good: fc(ctx, FILL.good), evil: fc(ctx, FILL.evil) };
  }

  // ---- rival belief: bar split impress (green, left) / scare (red, right), percent, hut icon.
  // Once the village is won the meter reads full whatever belief says, and the legend row names the
  // village converted (by awe or by fear) instead of the awe / fear shares.
  {
    const r = L.rival;
    panel(ctx, r);
    const bar = abs(r, RIVAL.bar);
    trough(ctx, bar);
    const won = data.won === true;
    const belief = won ? 1 : data.belief;
    const hasMix = (data.mix?.impress || 0) + (data.mix?.scare || 0) > 0;
    const mix = won && !hasMix ? (data.wonHow === 'scare' ? { impress: 0, scare: 1 } : { impress: 1, scare: 0 }) : data.mix;
    const b = beliefFill(belief, mix, bar.w);
    const [ic, icl] = fc(ctx, FILL.impress), [sc, scl] = fc(ctx, FILL.scare);
    barRun(ctx, bar, 0, b.impress, ic, icl);
    barRun(ctx, bar, b.impress, b.scare, sc, scl);
    if (b.impress > 0 && b.scare > 0) { // the split: notches on the rim above and below
      fill(ctx, bar.x + b.impress, bar.y - 2, 1, 2, ink);
      fill(ctx, bar.x + b.impress, bar.y + bar.h, 1, 2, ink);
    }
    drawText(ctx, `${pct(belief)}%`, r.x + RIVAL.value.x, r.y + RIVAL.value.y, ink);
    icon(ctx, getSprite('ui-icon', { name: 'rival' }), r.x + RIVAL.icon.x, r.y + RIVAL.icon.y);
    // legend: share of the belief won by wonder and by fear
    const im = Math.max(0, mix?.impress || 0), scv = Math.max(0, mix?.scare || 0), tot = im + scv;
    const awe = tot > 0 ? Math.round((im / tot) * 100) : 0, fear = tot > 0 ? 100 - awe : 0;
    const ly = r.y + RIVAL.legend.y;
    let label = null;
    if (won) {
      label = CONVERTED[data.wonHow] ?? CONVERTED.other;
      const mark = getSprite('ui-icon', { name: data.wonHow === 'scare' ? 'evil' : 'good' });
      const lw = measure(label), lx = r.x + Math.round((r.w - lw - mark.w - 3) / 2);
      icon(ctx, mark, lx, ly - 1);
      drawText(ctx, label, lx + mark.w + 3, ly, ink);
    } else {
      fill(ctx, bar.x, ly + 1, 3, 3, ic);
      drawText(ctx, `awe ${awe}`, bar.x + 5, ly, ink);
      const fearTxt = `fear ${fear}`;
      const fx = r.x + r.w - PAD - 1 - measure(fearTxt);
      fill(ctx, fx - 5, ly + 1, 3, 3, sc);
      drawText(ctx, fearTxt, fx, ly, ink);
    }
    out.rival = { rect: bar, fill: b.fill, impress: b.impress, scare: b.scare, impressColor: ic, scareColor: sc, awe, fear, belief, won, label };
  }

  // ---- creature: hooded head, its own lean scale, three need bars, weak tab
  if (L.creature && data.creature) {
    const r = L.creature, cr = data.creature;
    if (L.weakTab && cr.weak) {
      const t = L.weakTab;
      fill(ctx, t.x + 1, t.y, t.w - 2, t.h, ink);
      fill(ctx, t.x, t.y + 1, t.w, t.h - 1, ink);
      fill(ctx, t.x + 1, t.y + 1, t.w - 2, t.h - 2, col(ctx, 'fire', 1));
      drawText(ctx, 'weak', t.x + Math.floor((t.w - measure('weak')) / 2), t.y + 2, col(ctx, 'fire', 6));
    }
    panel(ctx, r);
    icon(ctx, getSprite('ui-icon', { name: 'creature' }), r.x + CREATURE.icon.x, r.y + CREATURE.icon.y);
    icon(ctx, getSprite('ui-icon', { name: 'evil' }), r.x + CREATURE.lean.evil.x, r.y + CREATURE.lean.evil.y);
    icon(ctx, getSprite('ui-icon', { name: 'good' }), r.x + CREATURE.lean.good.x, r.y + CREATURE.lean.good.y);
    const lbar = abs(r, CREATURE.lean.scale);
    const s = signedScale(ctx, lbar, cr.lean, r.y + CREATURE.lean.caret.y);
    const needs = {};
    NEEDS.forEach((n, i) => {
      const y = r.y + CREATURE.needs.y + i * CREATURE.needs.step;
      icon(ctx, getSprite('ui-icon', { name: n }), r.x + CREATURE.needs.x, y);
      const bar = { x: r.x + CREATURE.needs.bar.x, y: y + CREATURE.needs.bar.dy, w: CREATURE.needs.bar.w, h: CREATURE.needs.bar.h };
      trough(ctx, bar);
      const v = clamp01(cr.needs?.[n]);
      const f = barFill(v, 1, bar.w);
      const [c, cl] = fc(ctx, FILL.need(n, v));
      barRun(ctx, bar, 0, f, c, cl);
      needs[n] = { rect: bar, fill: f, color: c, colorLit: cl };
    });
    out.creature = { lean: { rect: lbar, fill: s.fill, caret: s.caret }, needs, weak: !!cr.weak };
  }
  return out;
}

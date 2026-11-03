// UI layout and value mapping. Pure functions: no DOM, no game object, no drawing. The HUD, the
// checks and the scenario all call these, so what is drawn and what is tested come from one place.
//
// Panels hug the view's edges and corners (power top-left, alignment top-centre, rival belief
// top-right, creature bottom-left, debug panel down the right edge) and never reach the central
// region (the middle half of the view in each direction). Every rect is { x, y, w, h } in view px.

export const MARGIN = 4;
export const GAP = 4;
export const PAD = 4;

// Panel sizes (view px) and the inner geometry the HUD draws with.
export const POWER = Object.freeze({ w: 98, h: 25, icon: { x: PAD, y: PAD }, bar: { x: 16, y: 6, w: 64, h: 5 }, value: { x: 83, y: 6 }, pips: { y: 12 }, miracles: { x: 16, y: 15, step: 17 } });
export const ALIGN = Object.freeze({ w: 92, h: 18, evil: { x: PAD, y: 5 }, scale: { x: 14, y: 6, w: 64, h: 5 }, good: { x: 81, y: 5 }, caret: { y: 12 } });
export const RIVAL = Object.freeze({ w: 96, h: 25, bar: { x: PAD, y: 6, w: 56, h: 5 }, value: { x: 63, y: 6 }, icon: { x: 83, y: PAD }, legend: { y: 15 } });
export const CREATURE = Object.freeze({
  w: 72, h: 47,
  icon: { x: PAD, y: PAD },
  lean: { evil: { x: 19, y: 6 }, scale: { x: 28, y: 7, w: 28, h: 4 }, good: { x: 58, y: 6 }, caret: { y: 12 } },
  needs: { x: PAD, y: 19, step: 8, bar: { x: 14, w: 54, h: 4, dy: 2 } },
  weakTab: { w: 26, h: 9 },
});
export const DEBUG = Object.freeze({ minW: 96, maxW: 156, line: 7 });
/** Debug panel px above its table: padding, title, three needs, the state line and the rule. */
export const DEBUG_TOP = PAD + 8 + 4 * 7 + 3;
export const BANNER = Object.freeze({ maxW: 236, h: 40 });
/** Build bar (bottom-right): a header row (label, wood stock), then one slot per building kind. */
const B = { kinds: 3, slot: { w: 21, h: 22 }, gap: 2, pad: 3, head: 9, icon: { x: 4, y: 2 }, key: { x: 2, y: 2 }, cost: { y: 14 } };
export const BUILD = Object.freeze({
  ...B,
  w: B.pad * 2 + B.kinds * B.slot.w + (B.kinds - 1) * B.gap,
  h: B.pad * 2 + B.head + B.slot.h,
});

export const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
export const clampSigned = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(-1, v)) : 0);

/** The region panels must stay out of: the middle half of the view on both axes. */
export function centerRegion(W, H) {
  return { x: W / 4, y: H / 4, w: W / 2, h: H / 2 };
}

export function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function contains(r, x, y) {
  return !!r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

/**
 * Panel rects for a W x H view. opts.creature: draw the creature panel; opts.weak: add the weak
 * tab above it; opts.debug: the debug panel is open; opts.build: the build bar sits in the
 * bottom-right corner (the debug panel then stops above it). The alignment scale drops to a second
 * row when the top row is too narrow for all three panels side by side.
 */
export function layout(W, H, { creature = true, weak = false, debug = false, debugLines = Infinity, build = false } = {}) {
  const power = { x: MARGIN, y: MARGIN, w: POWER.w, h: POWER.h };
  const rival = { x: W - MARGIN - RIVAL.w, y: MARGIN, w: RIVAL.w, h: RIVAL.h };
  let align = { x: Math.round((W - ALIGN.w) / 2), y: MARGIN, w: ALIGN.w, h: ALIGN.h };
  if (align.x < power.x + power.w + GAP || align.x + align.w > rival.x - GAP) {
    align = { ...align, y: MARGIN + Math.max(power.h, rival.h) + GAP };
  }
  const topBottom = Math.max(power.y + power.h, rival.y + rival.h, align.y + align.h);
  const out = { W, H, power, align, rival, creature: null, weakTab: null, debug: null, center: centerRegion(W, H) };
  if (creature) {
    out.creature = { x: MARGIN, y: H - MARGIN - CREATURE.h, w: CREATURE.w, h: CREATURE.h };
    if (weak) out.weakTab = { x: out.creature.x + CREATURE.w - CREATURE.weakTab.w - 3, y: out.creature.y - CREATURE.weakTab.h + 1, ...CREATURE.weakTab };
  }
  if (build) {
    out.build = { x: W - MARGIN - BUILD.w, y: H - MARGIN - BUILD.h, w: BUILD.w, h: BUILD.h };
    out.buildSlots = [];
    for (let i = 0; i < BUILD.kinds; i++) {
      out.buildSlots.push({ x: out.build.x + BUILD.pad + i * (BUILD.slot.w + BUILD.gap), y: out.build.y + BUILD.pad + BUILD.head, w: BUILD.slot.w, h: BUILD.slot.h });
    }
  } else {
    out.build = null;
    out.buildSlots = [];
  }
  if (debug) {
    // right-hand column, at most a quarter of the view wide so it stays out of the central region
    const w = Math.max(DEBUG.minW, Math.min(DEBUG.maxW, Math.floor(W / 4) - 6));
    const y = rival.y + rival.h + GAP;
    // as tall as its lines need (header, needs, state, rule, then the table), at most to the bottom
    // (or to the build bar's top edge)
    const want = DEBUG_TOP + debugLines * DEBUG.line + PAD;
    const bottom = out.build ? out.build.y - GAP : H - MARGIN;
    out.debug = { x: W - MARGIN - w, y, w, h: Math.max(DEBUG.line * 3, Math.min(want, bottom - y)) };
  }
  // win banner: centred in the band under the top row, clear of the view's centre
  const bw = Math.min(W - 2 * MARGIN, BANNER.maxW);
  out.banner = { x: Math.round((W - bw) / 2), y: topBottom + GAP + 2, w: bw, h: BANNER.h };
  out.topBottom = topBottom;
  return out;
}

/** HUD panel rects that capture the pointer (the hand must not act through them). */
export function captureRects(L) {
  return [L.power, L.align, L.rival, L.creature, L.weakTab, L.debug, L.build].filter(Boolean);
}

// ---------------------------------------------------------------- values -> pixels

/** Filled pixels of a bar `inner` px long for value v in [0, max]. */
export function barFill(v, max, inner) {
  if (!(max > 0)) return 0;
  return Math.round(clamp01(v / max) * inner);
}

/** Tick position (px from the bar's inner left edge) for a cost on a bar of capacity max. */
export function tickX(cost, max, inner) {
  return Math.min(inner - 1, Math.max(0, Math.round(clamp01(cost / max) * inner) - 1));
}

/** Signed scale: half = px either side of centre. Returns { fill (signed px), caret (px from the
 * scale's left edge) }. */
export function signedFill(v, w) {
  const half = Math.floor(w / 2);
  const a = clampSigned(v);
  const fill = Math.round(Math.abs(a) * half) * Math.sign(a);
  return { fill, caret: Math.min(w - 1, Math.max(0, half + fill - (fill > 0 ? 1 : 0))) };
}

/** Belief bar: total fill and the impress share of it (scare is the rest). */
export function beliefFill(belief, mix, inner) {
  const fill = barFill(belief, 1, inner);
  const im = Math.max(0, Number.isFinite(mix?.impress) ? mix.impress : 0);
  const sc = Math.max(0, Number.isFinite(mix?.scare) ? mix.scare : 0);
  const impress = im + sc > 0 ? Math.round((fill * im) / (im + sc)) : fill; // no mix recorded: one colour, as the world belief bar does
  return { fill, impress, scare: fill - impress, impressShare: im + sc > 0 ? im / (im + sc) : 0 };
}

/** Whole-number percent for display. */
export const pct = (v) => Math.round(clamp01(v) * 100);

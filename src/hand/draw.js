// Hand drawing: ground shadows, hover and selection outlines, the carried object and the hand
// itself. Every picture comes from getSprite() by name or from the entity's own sprite; nothing
// here holds art. Runs in draw(ctx) only, never on sim ticks.
import { getSprite } from '../art/registry.js';
import { idx } from '../art/palette.js';
import { makeLut } from '../art/lut.js';
import { drawText, measure } from '../ui/draw.js';
import { HAND } from './tunables.js';

const SHADOWS = ['shadow-s', 'shadow-m', 'shadow-l'];
const RING = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const flatLuts = new Map();
const STEP_LUTS = Array.from({ length: 17 }, (_, i) => makeLut((i - 8) / 8)); // alignment -1..1 in steps of 1/8

/**
 * LUT the hand is drawn with, given the world's LUT. The palette blends every ramp linearly from evil
 * to good, so at alignment 0 the hand would be half icy cyan, half crimson: a grey-violet that reads as
 * neither. The god's hand keeps its icy good look until the player actually leans evil, then turns
 * twice as fast: every step from 0 up draws the full good look, a step s below 0 draws step 8 + 2s,
 * so the hand is the half blend at alignment -0.5 and full crimson-ash at -1. Any LUT that is not one
 * of the alignment LUTs (test LUTs, a LUT someone else set) is used as it is.
 */
export function handLut(lut) {
  const i = STEP_LUTS.indexOf(lut);
  if (i < 0) return lut;
  const s = i - 8;
  return STEP_LUTS[(s >= 0 ? 8 : Math.max(-8, 8 + 2 * s)) + 8];
}

/**
 * Blit that skips indices whose LUT color is fully transparent. renderer.lut starts all zero until the
 * alignment system installs a palette LUT, and test LUTs cover only a few ramps; the engine's blit
 * would write those zeros as holes in the view buffer. Same anchor and flipX rules as render/blit.js.
 */
export function blitOpaque(ctx, sprite, x, y, lut, flipX = false) {
  const { w, h, ax, ay, data } = sprite;
  const dst = ctx.buf, dw = ctx.w, dh = ctx.h;
  x |= 0; y |= 0;
  const top = y - ay, dir = flipX ? -1 : 1, base = x - dir * ax;
  for (let r = Math.max(0, -top); r < Math.min(h, dh - top); r++) {
    const drow = (top + r) * dw;
    for (let c = 0; c < w; c++) {
      const v = data[r * w + c];
      if (!v) continue;
      const dx = base + dir * c, col = lut[v];
      if (dx >= 0 && dx < dw && col >>> 24) dst[drow + dx] = col;
    }
  }
}

/** LUT that paints every opaque index in one color (for 1 px outlines). */
function flatLut(color) {
  let lut = flatLuts.get(color);
  if (!lut) { lut = new Uint32Array(256).fill(color); lut[0] = 0; flatLuts.set(color, lut); }
  return lut;
}

function colorOf(ctx, ramp, shade) {
  try { return ctx.lut[idx(ramp, shade)]; } catch { return ctx.lut[idx('ink', 7)]; }
}

/** Shadow size for an object of this sprite width, one size smaller when it is high up. */
export function shadowFor(e, above) {
  const w = e.sprite?.w ?? (e.kind === 'tree' ? 24 : 8);
  let i = w <= 10 ? 0 : w <= 20 ? 1 : 2;
  if (above > 4) i = Math.max(0, i - 1);
  return SHADOWS[i];
}

/** Draw-list item: a shadow on the terrain at (x, y), sorted just before things standing there. */
export function shadowItem(world, x, y, name, id) {
  const sprite = getSprite(name);
  return { x, y, z: world.heightAt(x, y) - 0.01, id, draw: (ctx, vx, vy) => blitOpaque(ctx, sprite, vx, vy, ctx.lut) };
}

/** Draw-list item: 1 px outline around entity e's sprite, sorted just before e itself. */
export function outlineItem(e, ramp, shade) {
  return {
    x: e.x, y: e.y, z: (e.z ?? 0) - 1e-4, id: e.id,
    draw(ctx) {
      if (!e.sprite) return;
      const v = ctx.toView(e.x, e.y, e.z ?? 0);
      const lut = flatLut(colorOf(ctx, ramp, shade));
      for (const [dx, dy] of RING) blitOpaque(ctx, e.sprite, v.vx + dx, v.vy + dy, lut, !!e.flipX);
    },
  };
}

/**
 * Screen overlay drawn after the world and effects: the carried objects again, back to front (so
 * nothing in front of them in the world hides what is in the hand), then the hand sprite for the
 * current pose, then `tag` ({ text, icon } or null): the amount carried, to the hand's right (its left
 * when it would run past the view's right edge), with the resource's item sprite before it when
 * `icon` names one.
 */
export function drawTop(ctx, hand, held, tag = null) {
  const list = (Array.isArray(held) ? held : held ? [held] : []).filter((e) => e.sprite);
  list.sort((a, b) => a.x + a.y - (b.x + b.y) || (a.z ?? 0) - (b.z ?? 0));
  for (const e of list) {
    const v = ctx.toView(e.x, e.y, e.z);
    blitOpaque(ctx, e.sprite, v.vx, v.vy, e.lut ?? ctx.lut, !!e.flipX);
  }
  const v = ctx.toView(hand.x, hand.y, hand.z);
  const sprite = getSprite(hand.pose);
  blitOpaque(ctx, sprite, v.vx, v.vy, handLut(ctx.lut));
  if (!tag) return;
  const ic = tag.icon ? getSprite(tag.icon) : null;
  // + 1 for the text outline's right column (its left column is the 1 px gap after the icon, or just outside the label)
  const width = (ic ? ic.w + 1 : 0) + measure(tag.text) + 1;
  const left = v.vx - sprite.ax;
  let x = left + sprite.w + HAND.labelGap;
  // near the right edge of the view the label goes on the hand's left instead
  if (x + width > ctx.w) x = left - HAND.labelGap - width;
  const y = v.vy - sprite.ay + Math.floor(sprite.h / 2) - 3;
  if (ic) {
    blitOpaque(ctx, ic, x + ic.ax, y + 5, ctx.lut);
    x += ic.w + 1;
  }
  drawText(ctx, tag.text, x, y, colorOf(ctx, 'ui-parchment', 7), { outline: colorOf(ctx, 'ui-ink', 0) });
}

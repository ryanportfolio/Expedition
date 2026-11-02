// Thought bubble over the creature: the verb icon and, unless the target is 'none', the target icon,
// for the action in game.state.creatureThought. Right after a stroke or slap the creature system
// keeps the judged action in the thought (feedback 'stroke' or 'slap'); the bubble then shows that
// action with a warm glow mark (stroke) or a jagged burst (slap) on its top-right corner.
import { getSprite } from '../art/registry.js';
import { BUBBLE } from '../art/painters/ui.js';
import { icon } from './draw.js';

/** { key, verb, target, mark } for a thought, or null when there is nothing to show. */
export function thoughtView(thought) {
  if (!thought || typeof thought !== 'object') return null;
  const key = thought.feedback ? thought.judged ?? thought.key : thought.key;
  if (typeof key !== 'string') return null;
  const i = key.indexOf(':');
  const verb = i > 0 ? key.slice(0, i) : key, target = i > 0 ? key.slice(i + 1) : 'none';
  const mark = thought.feedback === 'stroke' ? 'glow' : thought.feedback === 'slap' ? 'jag' : null;
  return { key, verb, target, mark };
}

/**
 * Draws the bubble so its trailing dot sits just up-right of the top of the creature's sprite.
 * Returns { rect, view } or null.
 */
export function drawThought(ctx, entity, thought) {
  const view = thoughtView(thought);
  if (!view || !entity) return null;
  const p = ctx.toView(entity.x, entity.y, entity.z ?? 0);
  const top = entity.sprite ? entity.sprite.ay : 64;
  const slots = view.target === 'none' ? 1 : 2;
  const bubble = getSprite('ui-bubble', { slots });
  const ax = p.vx + 8, ay = p.vy - top - 1;
  ctx.blit(bubble, ax, ay, false, ctx.lut);
  const bx = ax - bubble.ax, by = ay - bubble.ay;
  icon(ctx, getSprite('ui-verb', { verb: view.verb }), bx + BUBBLE.pad, by + BUBBLE.top + BUBBLE.pad);
  if (slots === 2) icon(ctx, getSprite('ui-target', { target: view.target }), bx + BUBBLE.pad + BUBBLE.slot + BUBBLE.gap, by + BUBBLE.top + BUBBLE.pad);
  if (view.mark) {
    const m = getSprite('ui-mark', { kind: view.mark });
    ctx.blit(m, bx + bubble.w - 1, by + BUBBLE.top + 1, false, ctx.lut);
  }
  return { rect: { x: bx, y: by, w: bubble.w, h: bubble.h }, view };
}

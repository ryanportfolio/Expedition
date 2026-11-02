// village system: both villages' simulation (internals in src/village/). update(dt) runs on sim
// ticks and never touches the DOM, canvas or window; draw(ctx) only picks sprites by name, and only
// for entities near the view (SPRITE_PAD): the rest keep their last sprite until they come near,
// which they do before they show, since the renderer culls by the same sprite.
//
// The system is inert until setup() is called after world.loadMap() with a map that has sites:
//   game.world.loadMap(buildIsland()); game.systems.village.setup();
// API: setup(), placeBlueprint(kind, tx, ty[, owner]) -> building id or null (reason in
// lastReason), validate(kind, tx, ty[, owner]) -> { ok, reason }, stats().
import { createVillageSim } from '../village/sim.js';
import { getSprite } from '../art/registry.js';
import { spriteInView } from '../render/renderer.js';

/** Px round the view inside which sprites are picked afresh: more than any village sprite grows by
 * between two picks (a blueprint becoming a building, a villager changing pose). */
const SPRITE_PAD = 64;

export function create(game) {
  const sim = createVillageSim(game);
  const picked = new WeakMap();
  return {
    get ready() { return sim.ready; },
    get lastReason() { return sim.lastReason; },
    setup: sim.setup,
    placeBlueprint: sim.placeBlueprint,
    validate: (kind, tx, ty, owner) => { const r = sim.validate(kind, tx, ty, owner); return { ok: r.ok, reason: r.reason }; },
    stats: sim.stats,
    sim,
    update(dt) { sim.update(dt); },
    draw(ctx) {
      if (!sim.ready) return;
      const near = (e) => !ctx || !e.sprite || spriteInView(e, ctx.camX, ctx.camY, ctx.w, ctx.h, SPRITE_PAD);
      // getSprite serializes its options into a sorted key on every call; with hundreds of villagers
      // in view that was most of this draw, so the sprite is looked up again only when what it is
      // picked by changes (picked: entity -> the options last looked up, as a plain string).
      const same = (e, k) => { if (picked.get(e) === k && e.sprite) return true; picked.set(e, k); return false; };
      for (const e of game.world.entities.values()) {
        if (e.kind === 'villager' && e.job !== undefined) {
          if (!near(e) || same(e, `${e.job}|${e.pose}|${e.frame}|${e.facing}|${e.owner}`)) continue;
          e.sprite = getSprite('villager', { job: e.job, pose: e.pose, frame: e.frame, facing: e.facing, owner: e.owner });
        } else if (e.kind === 'building' && e.madeBy === 'village') {
          if (!near(e)) continue;
          const opts = { owner: e.owner, stage: e.stage };
          if (e.type === 'field') {
            opts.growth = Math.floor(e.growth * 4) / 4;
            // A field is a flat footprint, not an upright sprite: sort it by its back corner so the
            // villagers working on it draw over it (depthKey in src/world/iso.js has the why). Just
            // under the corner, so a villager standing exactly on it still draws on top.
            e.sortDepth = e.tx + e.ty - 1e-3;
          }
          if (same(e, `${e.type}|${opts.owner}|${opts.stage}|${opts.growth}`)) continue;
          e.sprite = getSprite(e.type, opts);
        } else if (e.madeBy === 'village' && !e.sprite) {
          e.sprite = e.kind === 'tree' ? getSprite('tree', { species: e.species }) : getSprite(e.kind);
        }
      }
    },
  };
}

// village system: both villages' simulation (internals in src/village/). update(dt) runs on sim
// ticks and never touches the DOM, canvas or window; draw(ctx) only picks sprites by name.
//
// The system is inert until setup() is called after world.loadMap() with a map that has sites:
//   game.world.loadMap(buildIsland()); game.systems.village.setup();
// API: setup(), placeBlueprint(kind, tx, ty[, owner]) -> building id or null (reason in
// lastReason), validate(kind, tx, ty[, owner]) -> { ok, reason }, stats().
import { createVillageSim } from '../village/sim.js';
import { getSprite } from '../art/registry.js';

export function create(game) {
  const sim = createVillageSim(game);
  return {
    get ready() { return sim.ready; },
    get lastReason() { return sim.lastReason; },
    setup: sim.setup,
    placeBlueprint: sim.placeBlueprint,
    validate: (kind, tx, ty, owner) => { const r = sim.validate(kind, tx, ty, owner); return { ok: r.ok, reason: r.reason }; },
    stats: sim.stats,
    sim,
    update(dt) { sim.update(dt); },
    draw() {
      if (!sim.ready) return;
      for (const e of game.world.entities.values()) {
        if (e.kind === 'villager' && e.job !== undefined) {
          e.sprite = getSprite('villager', { job: e.job, pose: e.pose, frame: e.frame, facing: e.facing, owner: e.owner });
        } else if (e.kind === 'building' && e.madeBy === 'village') {
          const opts = { owner: e.owner, stage: e.stage };
          if (e.type === 'field') {
            opts.growth = Math.floor(e.growth * 4) / 4;
            // A field is a flat footprint, not an upright sprite: sort it by its back corner so the
            // villagers working on it draw over it (depthKey in src/world/iso.js has the why). Just
            // under the corner, so a villager standing exactly on it still draws on top.
            e.sortDepth = e.tx + e.ty - 1e-3;
          }
          e.sprite = getSprite(e.type, opts);
        } else if (e.madeBy === 'village' && !e.sprite) {
          e.sprite = e.kind === 'tree' ? getSprite('tree', { species: e.species }) : getSprite(e.kind);
        }
      }
    },
  };
}

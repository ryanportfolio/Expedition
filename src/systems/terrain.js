// terrain system: owns the map's look. On create it loads the island when the world has no map,
// spawns one rock entity per map rock (unless rock entities exist) and registers a terrain pass
// that draws every tile from a cached palette-index buffer (src/terrain/). The cache is rebuilt
// when the world's map changes (world.loadMap swaps the height and ground arrays).
// Rocks per map: world.loadMap clears every entity and swaps world.rocks for a new array, so on the
// first update() or terrain pass after a map change the system spawns the new map's rocks again,
// through the same spawnRocks as at create: one per map rock, none when rock entities already exist
// (a scenario that placed its own), none for a map without rocks. Rocks destroyed or carried off on
// the same map are never respawned.
// Live rocks (round 39): world.rocks is the map's authored data and is never edited (hasMap and the
// island checks read it). It describes the live rocks only until spawnRocks has run for that map:
// from then on the rock entities are the only rocks, wherever the hand or the creature has put them,
// and none when all are gone. Placement (village validate) and sensing (creature) read liveRocks(),
// so a rock carried off no longer blocks or shows up at its map spot. Before round 39 they read the
// records as well, which kept refusing a moved rock's old tile and offered the creature a second,
// phantom rock there.
// update(dt) runs on sim ticks and never touches the DOM, canvas or window.
import { buildIsland } from '../world/island.js';
import { getSprite } from '../art/registry.js';
import { makeLut } from '../art/lut.js';
import { buildTerrainCache } from '../terrain/cache.js';
import { drawTerrain } from '../terrain/pass.js';

/** True when the world holds a map: a fresh world is all zero with no sites, trees or rocks. */
export function hasMap(world) {
  if (Object.keys(world.sites ?? {}).length || world.trees.length || world.rocks.length) return true;
  return world.height.some((h) => h !== 0) || world.ground.some((g) => g !== 0);
}

// Map rock lists (world.rocks arrays; world.loadMap makes a new one per map) that spawnRocks has
// handled: turned into entities, or passed over because a scenario had placed its own rocks. Keyed by
// the array, so world.js needs no extra field; a WeakSet lets old maps' lists be collected.
const handled = new WeakSet();

/** One rock entity per map rock, once per map, and none when rock entities already exist. Returns
 * the number spawned. Once run for a map it spawns nothing again on it, even after every rock is gone
 * (rocks destroyed or carried off are never respawned). */
export function spawnRocks(world) {
  if (handled.has(world.rocks)) return 0;
  handled.add(world.rocks);
  if (world.query({ kind: 'rock' }).length) return 0;
  for (const r of world.rocks) {
    world.spawn('rock', {
      x: r.x, y: r.y, vx: 0, vy: 0, vz: 0, size: r.size, grabbable: true, hp: 1,
      sprite: getSprite('rock', { size: r.size }),
    });
  }
  return world.rocks.length;
}

/** The rocks that stand in the world now, each with x, y and size: the rock entities once spawnRocks
 * has run for this map (or a scenario placed its own, which spawnRocks would keep), else the map's
 * records, which is the window between world.loadMap and the terrain system's next update or pass
 * (village setup places its start layout in it). Read-only: callers must not edit the list. */
export function liveRocks(world) {
  const ents = world.query({ kind: 'rock' });
  return handled.has(world.rocks) || ents.length ? ents : world.rocks;
}

const SAMPLES = 30;

export function create(game) {
  const { world, renderer } = game;
  if (!hasMap(world)) world.loadMap(buildIsland());
  spawnRocks(world);
  let rocksFor = world.rocks; // the map rock list rock entities were last spawned for
  const syncRocks = () => {
    if (world.rocks === rocksFor) return;
    rocksFor = world.rocks;
    spawnRocks(world);
  };
  // The renderer starts with an all-zero LUT, which draws nothing; until the alignment system owns
  // it, install the neutral one so the boot view shows the map.
  if (renderer && renderer.lut.every((v) => v === 0)) renderer.lut = makeLut(0);

  let cache = null;
  const stats = { builds: 0, buildMs: 0, passMs: [], lastMs: 0 };
  const current = () => {
    if (!cache || cache.height !== world.height || cache.ground !== world.ground || cache.mapW !== world.w || cache.mapH !== world.h) {
      const t0 = performance.now();
      cache = buildTerrainCache(world);
      stats.buildMs = performance.now() - t0;
      stats.builds++;
    }
    return cache;
  };
  // Timed per frame: the window copy only; the one-time cache build is reported in stats.buildMs.
  const pass = (ctx) => {
    syncRocks(); // before the renderer collects entity sprites, so a new map's rocks show at once
    const c = current();
    const t0 = performance.now();
    drawTerrain(ctx, c, game.clock.time);
    stats.lastMs = performance.now() - t0;
    stats.passMs.push(stats.lastMs);
    if (stats.passMs.length > SAMPLES) stats.passMs.shift();
  };
  renderer?.addTerrainPass(pass);

  return {
    stats,
    pass,
    /** The cache for the current map (built on demand). */
    get cache() { return current(); },
    /** Drop the cache, e.g. after editing world.height in place. */
    invalidate() { cache = null; },
    update(dt) { syncRocks(); },
    draw(ctx) {},
  };
}

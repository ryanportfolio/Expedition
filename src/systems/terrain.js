// terrain system: owns the map's look. On create it loads the island when the world has no map,
// spawns one rock entity per map rock (unless rock entities exist) and registers a terrain pass
// that draws every tile from a cached palette-index buffer (src/terrain/). The cache is rebuilt
// when the world's map changes (world.loadMap swaps the height and ground arrays).
// Rocks per map: world.loadMap clears every entity and swaps world.rocks for a new array, so on the
// first update() or terrain pass after a map change the system spawns the new map's rocks again,
// through the same spawnRocks as at create: one per map rock, none when rock entities already exist
// (a scenario that placed its own), none for a map without rocks. Rocks destroyed or carried off on
// the same map are never respawned.
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

/** One rock entity per map rock, unless rock entities already exist. Returns the number spawned. */
export function spawnRocks(world) {
  if (world.query({ kind: 'rock' }).length) return 0;
  for (const r of world.rocks) {
    world.spawn('rock', {
      x: r.x, y: r.y, vx: 0, vy: 0, vz: 0, size: r.size, grabbable: true, hp: 1,
      sprite: getSprite('rock', { size: r.size }),
    });
  }
  return world.rocks.length;
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

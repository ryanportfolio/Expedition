// Island scenario: the real terrain system on the real island. The terrain system loads the island
// when the game is created (the world starts with no map), spawns the rock entities and draws every
// tile from its cached buffer; the village system then sets up both villages (trees become entities).
// Screenshots: the boot view before village setup, overview at scale 2, village close-up at zoom 1,
// rocky ridge, beach and cove, the village again through the evil (-1) and good (+1) LUTs, and a
// second map loaded afterwards.
// Asserts: the terrain pass alone covers every view pixel inside the map's screen diamond (no pixel
// left at the clear color), land tiles in view are drawn, the median terrain pass time over 30
// frames at the 640 x 360 view is under 3 ms with the camera moving a few px each frame, water
// shimmers with sim time (land never changes, same time gives the same pixels), and loading another
// map rebuilds the cache once with no holes.
import { makeLut } from '../../art/lut.js';
import { screenToWorld } from '../../world/iso.js';
import { WATER_LO, WATER_HI } from '../../terrain/cache.js';
import { drawTerrain } from '../../terrain/pass.js';
import { makeTestMap } from '../test-art.js';

const CLIFFS = { x: 18, y: 19 }; // Greyspine ridge, front face
const COVE = { x: 44, y: 47 }; // Quiet Cove and its strand

/**
 * The 16 x 16 dev test map inside a one-tile border of deep water. The terrain draws no side faces
 * past the map edge, so like the island the second map needs a sea border for the map diamond at
 * sea level to be fully drawn.
 */
function seaBorderedTestMap() {
  const m = makeTestMap(), w = m.w + 2, h = m.h + 2;
  const height = new Uint8Array(w * h), ground = new Uint8Array(w * h); // deep water, height 0
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    height[(y + 1) * w + x + 1] = m.height[y * m.w + x];
    ground[(y + 1) * w + x + 1] = m.ground[y * m.w + x];
  }
  const sites = {};
  for (const [k, v] of Object.entries(m.sites)) sites[k] = { ...v, x: v.x + 1, y: v.y + 1 };
  return { ...m, w, h, height, ground, sites };
}

/** Runs the terrain pass alone into a fresh clear-color buffer for the current camera. */
function terrainOnly(game) {
  const { display, camera, renderer } = game;
  const w = display.w, h = display.h, clear = renderer.clearColor;
  const buf = new Uint32Array(w * h).fill(clear);
  const ctx = { buf, w, h, camX: Math.round(camera.x), camY: Math.round(camera.y), lut: renderer.lut, world: game.world };
  game.systems.terrain.pass(ctx);
  return { buf, w, h, ctx, clear };
}

/** Coverage of the terrain pass in the current view: pixels inside the map diamond at sea level. */
function coverage(game) {
  const { world } = game;
  const { buf, w, h, ctx, clear } = terrainOnly(game);
  let inside = 0, holes = 0, firstHole = null;
  for (let vy = 0; vy < h; vy++) for (let vx = 0; vx < w; vx++) {
    const p = screenToWorld(vx + ctx.camX + 0.5, vy + ctx.camY + 0.5, world.seaLevel);
    if (p.x < 0.02 || p.y < 0.02 || p.x > world.w - 0.02 || p.y > world.h - 0.02) continue;
    inside++;
    if (buf[vy * w + vx] === clear) { holes++; firstHole ??= [vx, vy]; }
  }
  // Land tile tops in view: the pixel just above each land tile's projected center is drawn.
  let land = 0, landDrawn = 0;
  for (let ty = 0; ty < world.h; ty++) for (let tx = 0; tx < world.w; tx++) {
    const i = ty * world.w + tx;
    if (world.ground[i] <= 1) continue;
    const vx = (tx + 0.5 - (ty + 0.5)) * 16 - ctx.camX, vy = (tx + ty + 1) * 8 - world.height[i] * 8 - ctx.camY - 1;
    if (vx < 0 || vy < 0 || vx >= w || vy >= h) continue;
    land++;
    if (buf[vy * w + vx] !== clear) landDrawn++;
  }
  return { inside, holes, firstHole, land, landDrawn };
}

export default async function island(t, game) {
  const { world, renderer, camera, display } = game;
  const terrain = game.systems.terrain;

  t.assert(world.w === 64 && world.h === 64 && world.sites.village, `terrain system loaded the island (${world.w}x${world.h})`);
  const rocks = world.query({ kind: 'rock' });
  t.assert(rocks.length === world.rocks.length && rocks.length >= 20, `one rock entity per map rock (${rocks.length} of ${world.rocks.length})`);
  t.assert(rocks.every((r) => r.grabbable === true && r.hp === 1 && r.sprite && r.sprite.h >= 4), 'rock entities carry size, grabbable, hp and a sprite');

  const check = (label) => {
    const c = coverage(game);
    t.log(label, c);
    t.assert(c.inside > 0 && c.holes === 0, `${label}: no clear-color pixel inside the map diamond (${c.holes} of ${c.inside}, first ${c.firstHole})`);
    t.assert(c.land === 0 || c.landDrawn === c.land, `${label}: every land tile in view drawn (${c.landDrawn} of ${c.land})`);
  };

  // What the player sees on boot, before the village sets up: the LUT the terrain system installed.
  t.assert(renderer.lut.some((v) => v !== 0), 'terrain installed a usable default LUT');
  check('boot');
  await t.shot('boot');
  renderer.lut = makeLut(0);

  const vs = game.systems.village;
  vs.setup();
  t.step(1);
  const trees = world.query({ kind: 'tree' });
  t.assert(trees.length === world.trees.length && trees.length >= 150, `village spawned the trees (${trees.length})`);
  t.assert(world.query({ kind: 'rock' }).length === rocks.length, 'village setup kept the rock entities');

  // Overview at scale 2 (the step that shows the most), centered on the island.
  display.setScale(2);
  camera.centerOn(32, 32, 3);
  t.step(1 / 30);
  check('overview');
  await t.shot('overview');

  // Village close-up at zoom 1, then the timing run at the same 640 x 360 view.
  display.setScale(3);
  const site = world.sites.village;
  camera.centerOn(site.x, site.y, world.heightAt(site.x, site.y));
  t.step(1 / 30);
  t.assert(display.w === 640 && display.h === 360, `zoom 1 view is 640x360 (${display.w}x${display.h})`);
  check('village');
  await t.shot('village');
  // Move the camera a few px each frame so every timed frame copies a fresh window.
  for (let i = 0; i < 30; i++) {
    camera.x += i & 1 ? 3 : -2;
    t.step(1 / 30);
  }
  const ms = [...terrain.stats.passMs].sort((a, b) => a - b);
  const median = (ms[14] + ms[15]) / 2;
  t.log('terrain pass ms (30 frames at 640x360)', { median: +median.toFixed(3), max: +ms[ms.length - 1].toFixed(3), cacheBuildMs: +terrain.stats.buildMs.toFixed(1), builds: terrain.stats.builds });
  t.assert(ms.length === 30 && median < 3, `median terrain pass ${median.toFixed(3)} ms per frame (< 3 ms)`);
  t.assert(terrain.stats.builds === 1, `terrain cache built once for this map (${terrain.stats.builds})`);

  camera.centerOn(CLIFFS.x, CLIFFS.y, world.heightAt(CLIFFS.x, CLIFFS.y));
  t.step(1 / 30);
  check('cliffs');
  await t.shot('cliffs');

  camera.centerOn(COVE.x, COVE.y, world.seaLevel);
  t.step(1 / 30);
  check('beach');
  await t.shot('beach');

  // Water shimmer on the beach view: the terrain copy alone, same window at sim times 10, 11, 10.
  {
    const w = display.w, h = display.h, cache = terrain.cache;
    const camX = Math.round(camera.x), camY = Math.round(camera.y);
    const at = (time) => {
      const ctx = { buf: new Uint32Array(w * h), w, h, camX, camY, lut: renderer.lut };
      drawTerrain(ctx, cache, time);
      return ctx.buf;
    };
    const a = at(10), b = at(11), c = at(10);
    let water = 0, changed = 0, landChanged = 0, same = true;
    for (let vy = 0; vy < h; vy++) for (let vx = 0; vx < w; vx++) {
      const i = vy * w + vx;
      const v = cache.data[(vy + camY - cache.oy) * cache.w + vx + camX - cache.ox];
      const isW = v >= WATER_LO && v <= WATER_HI;
      if (isW) water++;
      if (a[i] !== c[i]) same = false;
      if (a[i] === b[i]) continue;
      changed++;
      if (!isW) landChanged++;
    }
    t.log('water shimmer', { water, changed, landChanged, same });
    t.assert(water > 1000 && changed > 50 && landChanged === 0 && same, `water shimmer: ${changed} of ${water} water px change over 1 s of sim time, ${landChanged} land px, deterministic ${same}`);
  }

  camera.centerOn(site.x, site.y, world.heightAt(site.x, site.y));
  renderer.lut = makeLut(-1);
  t.step(1 / 30);
  await t.shot('village-evil');
  renderer.lut = makeLut(1);
  t.step(1 / 30);
  await t.shot('village-good');
  renderer.lut = makeLut(0);

  // Another map loaded afterwards: the cache rebuilds once, to the new map's size, with no holes.
  // No sim ticks after the swap: the village still holds the island's state.
  const before = terrain.cache, builds = terrain.stats.builds;
  world.loadMap(seaBorderedTestMap());
  camera.centerOn(9, 9, world.heightAt(9, 9));
  check('map-change');
  const after = terrain.cache;
  t.assert(after !== before && after.mapW === 18 && after.w < before.w && terrain.stats.builds === builds + 1, `cache rebuilt once for the new map (${before.w}x${before.h} -> ${after.w}x${after.h}, builds ${terrain.stats.builds})`);
  await t.shot('map-change');
}

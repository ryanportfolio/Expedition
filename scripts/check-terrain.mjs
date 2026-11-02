// Node check for the terrain system and terrain painters (no browser).
//   node scripts/check-terrain.mjs
// Checks: the cached index buffer is deterministic for the island; every tile's top diamond sits at
// worldToScreen of its center; side faces appear only where a front neighbor is lower (and do appear
// there on an unoccluded test map); the pointer pick resolves every drawn pixel to the tile that drew
// it and every undrawn pixel to nothing (island and test map); rock entities spawn once, and again per map after world.loadMap
// (never duplicated, in the draw list on the first frame after a reload, none for a rock-less map,
// exactly its own for a map with 2 rocks); liveRocks gives the map records only until the rocks
// are entities, then the entities alone (moved, removed, all gone, a scenario's own rock); the cache rebuilds on map change; the
// tree, stump and rock painters give non-empty, deterministic sprites anchored at their base;
// water glints one cell at a time, never all at once; update() touches no DOM; no Math.random in
// terrain code.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame } from '../src/game.js';
import { createWorld } from '../src/world/world.js';
import { buildIsland } from '../src/world/island.js';
import { worldToScreen } from '../src/world/iso.js';
import { buildTerrainCache, PART, surfaceHeights, WATER_LO } from '../src/terrain/cache.js';
import { drawTerrain } from '../src/terrain/pass.js';
import * as terrainSystem from '../src/systems/terrain.js';
import * as painters from '../src/art/painters/terrain.js';
import { registerPainters, getSprite, placeholderSprite } from '../src/art/registry.js';
import { makeLut } from '../src/art/lut.js';
import { makeTestMap } from '../src/dev/test-art.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
registerPainters(painters);

let pass = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) pass++; else { fails.push(msg); console.log(`FAIL ${msg}`); } };

/** FNV-1a over bytes, for a short fingerprint in the log. */
function fnv(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ------------------------------------------------------------------ determinism
const island = buildIsland();
const w1 = createWorld().loadMap(island), w2 = createWorld().loadMap(buildIsland());
const c1 = buildTerrainCache(w1, { owner: true }), c2 = buildTerrainCache(w2);
ok(c1.w === c2.w && c1.h === c2.h && c1.data.length === c2.data.length, `cache sizes match (${c1.w}x${c1.h})`);
let diff = 0;
for (let i = 0; i < c1.data.length; i++) if (c1.data[i] !== c2.data[i]) diff++;
ok(diff === 0, `island cache is byte-identical across builds (${diff} differing bytes)`);
ok(c1.w === (64 + 64) * 16 && c1.ox === -64 * 16, `cache covers the whole map in world pixels (${c1.w}x${c1.h}, origin ${c1.ox},${c1.oy})`);
const filledIdx = c1.data.reduce((n, v) => n + (v ? 1 : 0), 0);
ok(filledIdx > c1.w * c1.h * 0.45, `cache is mostly drawn (${filledIdx} of ${c1.w * c1.h} pixels)`);
console.log(`island cache ${c1.w}x${c1.h} fnv ${fnv(c1.data)}`);

// ------------------------------------------------------------------ diamonds at worldToScreen
{
  const W = w1.w, H = w1.h, surf = surfaceHeights(w1), own = c1.owner;
  let tested = 0, hit = 0, strictMiss = 0, strict = 0;
  const firstMiss = [];
  for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
    const i = ty * W + tx, S = surf[i];
    const p = worldToScreen(tx + 0.5, ty + 0.5, S);
    const cx = p.sx - c1.ox, cy = p.sy - c1.oy; // pixel corner at the projected center
    const four = [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]];
    const mine = four.every(([x, y]) => own[y * c1.w + x] === (i + 1) * 4 + PART.TOP);
    tested++;
    if (mine) hit++;
    // Unoccluded tiles: nothing in the 4 x 4 block in front is higher.
    let clear = true;
    for (let dy = 0; dy <= 3 && clear; dy++) for (let dx = 0; dx <= 3; dx++) {
      if (!dx && !dy) continue;
      const x = tx + dx, y = ty + dy;
      if (x < W && y < H && surf[y * W + x] > S) { clear = false; break; }
    }
    if (clear) { strict++; if (!mine) { strictMiss++; if (firstMiss.length < 3) firstMiss.push([tx, ty]); } }
  }
  // Exact footprint: every top pixel lies inside its own tile's diamond (pixel-center test around
  // worldToScreen of the center), and unoccluded tiles keep all 256 diamond pixels.
  const topCount = new Int32Array(W * H);
  let outside = 0, firstOut = null;
  for (let y = 0; y < c1.h; y++) for (let x = 0; x < c1.w; x++) {
    const v = own[y * c1.w + x];
    if ((v & 3) !== PART.TOP) continue;
    const i = (v >> 2) - 1, tx = i % W, ty = (i - tx) / W;
    topCount[i]++;
    const p = worldToScreen(tx + 0.5, ty + 0.5, surf[i]);
    const dx = x + c1.ox + 0.5 - p.sx, dy = y + c1.oy + 0.5 - p.sy;
    if (Math.abs(dx) / 16 + Math.abs(dy) / 8 > 1) { outside++; firstOut ??= [tx, ty, x, y]; }
  }
  ok(outside === 0, `every top pixel lies inside its tile's projected diamond (${outside} outside, first ${firstOut})`);
  let fullCount = 0;
  for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
    const i = ty * W + tx;
    let clear = true;
    for (let dy = 0; dy <= 3 && clear; dy++) for (let dx = 0; dx <= 3; dx++) {
      if ((dx || dy) && tx + dx < W && ty + dy < H && surf[(ty + dy) * W + tx + dx] > surf[i]) { clear = false; break; }
    }
    if (clear && topCount[i] === 256) fullCount++;
  }
  ok(fullCount === strict, `unoccluded tiles keep their full 256-pixel diamond (${fullCount}/${strict})`);
  ok(strict > 2000 && strictMiss === 0, `every unoccluded tile's top diamond covers worldToScreen of its center (${strict - strictMiss}/${strict}; misses ${JSON.stringify(firstMiss)})`);
  ok(hit / tested > 0.8, `top diamonds at their projected centers overall (${hit}/${tested})`);
}

// ------------------------------------------------------------------ side faces only toward lower front neighbors
function faceCounts(world, cache) {
  const n = world.w * world.h, left = new Int32Array(n), right = new Int32Array(n);
  for (const v of cache.owner) {
    if (!v) continue;
    const i = (v >> 2) - 1, part = v & 3;
    if (part === PART.LEFT) left[i]++;
    else if (part === PART.RIGHT) right[i]++;
  }
  return { left, right };
}
{
  const W = w1.w, H = w1.h, surf = surfaceHeights(w1);
  const left = c1.faces.filter((_, k) => !(k & 1)), right = c1.faces.filter((_, k) => k & 1); // pixels written
  let badL = 0, badR = 0, withFace = 0;
  for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
    const i = ty * W + tx, S = surf[i];
    const lowerL = ty + 1 < H && surf[i + W] < S, lowerR = tx + 1 < W && surf[i + 1] < S;
    if (left[i] && !lowerL) badL++;
    if (right[i] && !lowerR) badR++;
    if (left[i] || right[i]) withFace++;
  }
  ok(badL === 0 && badR === 0, `island: no side face written toward a front neighbor that is not lower (${badL} left, ${badR} right)`);
  ok(withFace > 300, `island: cliffs and banks draw side faces (${withFace} tiles)`);
}
{
  // Unoccluded test: a 5 x 5 flat map with one raised tile in the middle.
  const n = 25, height = new Uint8Array(n).fill(3), ground = new Uint8Array(n).fill(3);
  height[12] = 5; ground[12] = 5;
  const wt = createWorld({ w: 5, h: 5 }).loadMap({ w: 5, h: 5, seaLevel: 1, height, ground });
  const ct = buildTerrainCache(wt, { owner: true });
  const { left, right } = faceCounts(wt, ct);
  // The raised tile's faces: 16 columns x 2 units x 8 px each; the tiles in front of it are lower and
  // drawn later, but their tops start below the face, so every face pixel survives.
  ok(left[12] === 16 * 16 && right[12] === 16 * 16, `raised tile draws full left and right faces (${left[12]}, ${right[12]})`);
  const others = [...left, ...right].reduce((a, b) => a + b, 0) - left[12] - right[12];
  ok(others === 0, `flat tiles draw no side faces (${others} pixels)`);
  // A tile behind the raised one (lower) draws no face toward it.
  ok(left[7] === 0 && right[11] === 0, 'tiles behind a higher tile draw no face');
}

// ------------------------------------------------------------------ the pointer picks the tile drawn under it (round 42)
// Every pixel the cache draws, through the game's own pointer pick (input.toWorld, the path every
// mouse move takes), must resolve to the tile that drew it: Math.floor of the picked x, y (what the
// build ghost and the hand read) and the returned tx, ty. Pixels the cache leaves empty must pick
// nothing. The camera sits at world pixel (0, 0) so a view pixel is the world pixel. Before round 42
// the pick ran on world.heightAt (smooth between tile centers) at the pixel's corner: 46% of the
// island's top pixels (most of them water, picked on the sea bed) and 10.7% of its land top pixels,
// even sampled at pixel centers, picked another tile.
{
  const pickCase = (label, map) => {
    const game = createGame({ seed: 1 });
    if (map) game.world.loadMap(map);
    const c = buildTerrainCache(game.world, { owner: true });
    game.camera.x = 0; game.camera.y = 0;
    const n = [0, 0, 0, 0], bad = [0, 0, 0, 0], first = [];
    let ghost = 0;
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
      const o = c.owner[y * c.w + x];
      const p = game.input.toWorld(x + c.ox, y + c.oy);
      if (!o) { if (p) { ghost++; if (first.length < 3) first.push(`empty px (${x + c.ox}, ${y + c.oy}) picked ${p.tx},${p.ty}`); } continue; }
      const part = o & 3, ti = (o >> 2) - 1, tx = ti % game.world.w, ty = (ti - tx) / game.world.w;
      n[part]++;
      if (!p || Math.floor(p.x) !== tx || Math.floor(p.y) !== ty || p.tx !== tx || p.ty !== ty) {
        bad[part]++;
        if (first.length < 3) first.push(`px (${x + c.ox}, ${y + c.oy}) drawn by ${tx},${ty} ${['', 'top', 'left face', 'right face'][part]} picked ${p ? `${p.x.toFixed(3)},${p.y.toFixed(3)} z ${p.z.toFixed(3)}` : 'nothing'}`);
      }
    }
    ok(n[1] > 0 && n[2] > 0 && n[3] > 0, `${label}: the map has top and both side-face pixels (${n.slice(1).join(', ')})`);
    ok(bad[1] + bad[2] + bad[3] === 0 && ghost === 0, `${label}: every drawn pixel picks the tile that drew it (wrong: top ${bad[1]} of ${n[1]}, left ${bad[2]} of ${n[2]}, right ${bad[3]} of ${n[3]}; undrawn pixels that picked a tile: ${ghost}) ${first.join('; ')}`);
    return game;
  };
  pickCase('island', null);
  // the engine test map: water below sea level (drawn flat at sea level), a plateau, and land on the
  // map's front edges, where the cache draws no wall
  const game = pickCase('test map', makeTestMap());
  // an in-place height edit plus terrain.invalidate(): the pick follows the new height
  const { world } = game, i = 2 * world.w + 2;
  world.height[i] = 9;
  game.systems.terrain.invalidate();
  const top = worldToScreen(2.5, 2.5, 9);
  const p = game.input.toWorld(Math.floor(top.sx), Math.floor(top.sy));
  ok(p && p.tx === 2 && p.ty === 2 && p.z === 9, `after an in-place edit and terrain.invalidate() the pick finds the raised tile top (${JSON.stringify(p)})`);
}

// ------------------------------------------------------------------ system: map load, rocks, cache rebuild, timing
{
  const game = createGame({ seed: 1 });
  const { world } = game;
  ok(world.w === 64 && world.sites.village && world.rocks.length === island.rocks.length, 'createGame(): terrain system loaded the island');
  const rocks = () => world.query({ kind: 'rock' });
  ok(rocks().length === world.rocks.length && world.rocks.length >= 20, `one rock entity per map rock (${rocks().length} of ${world.rocks.length})`);
  const r0 = rocks()[0];
  ok(r0.grabbable === true && r0.hp === 1 && [1, 2, 3].includes(r0.size) && r0.sprite === getSprite('rock', { size: r0.size }), 'rock entity fields: size, grabbable, hp, sprite');
  ok(rocks().every((r) => Math.abs(r.z - world.heightAt(r.x, r.y)) < 1e-9), 'rocks sit on the terrain');
  terrainSystem.create(game);
  terrainSystem.create(game);
  ok(rocks().length === world.rocks.length, `creating the terrain system again does not duplicate rocks (${rocks().length})`);
  ok(world.w === 64 && world.query({ kind: 'rock' }).length === world.rocks.length, 'second create keeps the loaded map');

  const sys = game.systems.terrain;
  const a = sys.cache;
  ok(a.mapW === 64 && sys.stats.builds === 1, `cache built for the island (${a.w}x${a.h})`);
  ok(sys.cache === a && sys.stats.builds === 1, 'cache reused while the map is unchanged');
  world.loadMap(makeTestMap());
  const b = sys.cache;
  ok(b !== a && b.mapW === 16 && b.w === 32 * 16 && sys.stats.builds === 2, `cache rebuilt for a new map (${b.w}x${b.h})`);
  world.loadMap(buildIsland());
  ok(sys.cache.mapW === 64 && sys.stats.builds === 3, 'cache rebuilt when the island is loaded again');

  // A full 640 x 360 render through the real renderer: the pass runs and fills the view.
  game.display.setDevice(1920, 1080, 1);
  game.renderer.lut = makeLut(0);
  game.camera.centerOn(30, 34, 5); // view lies wholly inside the map diamond
  game.renderer.render();
  const v = game.renderer.view;
  const clear = game.renderer.clearColor;
  let cleared = 0;
  for (const px of v.data) if (px === clear) cleared++;
  ok(v.w === 640 && v.h === 360 && cleared === 0, `640x360 view fully drawn by the terrain pass (${cleared} clear pixels)`);
  const times = [];
  for (let i = 0; i < 30; i++) { game.tick(1 / 30); game.renderer.render(); times.push(sys.stats.lastMs); }
  times.sort((x, y) => x - y);
  console.log(`node terrain pass median ${((times[14] + times[15]) / 2).toFixed(3)} ms at 640x360 (cache build ${sys.stats.buildMs.toFixed(1)} ms)`);

  // Water shimmer is a function of sim time only.
  const buf1 = new Uint32Array(640 * 360), buf2 = new Uint32Array(640 * 360), buf3 = new Uint32Array(640 * 360);
  const ctx = (buf) => ({ buf, w: 640, h: 360, camX: -600, camY: 500, lut: makeLut(0) });
  drawTerrain(ctx(buf1), sys.cache, 2.0);
  drawTerrain(ctx(buf2), sys.cache, 2.0);
  drawTerrain(ctx(buf3), sys.cache, 2.4);
  let same = 0, moved = 0;
  for (let i = 0; i < buf1.length; i++) { if (buf1[i] === buf2[i]) same++; if (buf1[i] !== buf3[i]) moved++; }
  ok(same === buf1.length && moved > 0, `water shimmer is deterministic in sim time and animates (${moved} pixels change over 0.4 s)`);
}

// ------------------------------------------------------------------ system: rocks per map after loadMap
{
  const game = createGame({ seed: 3 });
  const { world, renderer } = game;
  const rocks = () => world.query({ kind: 'rock' }).length;
  const N = island.rocks.length;
  ok(rocks() === N, `create: ${rocks()} rock entities for ${N} map rocks`);
  world.loadMap(buildIsland());
  ok(rocks() === 0, 'loadMap clears the rock entities (engine)');
  game.tick(1 / 30);
  ok(rocks() === N, `after loadMap(buildIsland()) and one tick: ${rocks()} rock entities (${N} expected)`);
  for (let i = 0; i < 30; i++) game.tick(1 / 30);
  game.display.setDevice(1920, 1080, 1);
  renderer.render();
  ok(rocks() === N, `more ticks and a draw do not duplicate them (${rocks()})`);
  world.loadMap(buildIsland());
  renderer.render(); // a draw alone, no tick
  ok(rocks() === N, `reload again, draw only: ${rocks()} rock entities`);
  const drawn = renderer.list.items.filter((it) => it.kind === 'rock').length;
  ok(drawn === N, `that first frame after the reload already draws them (${drawn} rocks in the draw list)`);
  const r = world.query({ kind: 'rock' })[0];
  ok(r.grabbable === true && r.hp === 1 && r.sprite === getSprite('rock', { size: r.size }) && Math.abs(r.z - world.heightAt(r.x, r.y)) < 1e-9, 'respawned rocks have the create-time fields and sit on the terrain');
  game.tick(1 / 30);
  ok(rocks() === N, `a tick after that keeps ${rocks()}`);
  // Rocks thrown away or destroyed on the same map are not respawned.
  world.remove(r.id);
  for (let i = 0; i < 5; i++) game.tick(1 / 30);
  renderer.render();
  ok(rocks() === N - 1, `a removed rock stays gone on the same map (${rocks()})`);
  // A map without rocks spawns none.
  const plain = makeTestMap();
  ok(plain.rocks.length === 0, 'test map has no rocks');
  world.loadMap(plain);
  game.tick(1 / 30);
  renderer.render();
  ok(rocks() === 0, `rock-less map: ${rocks()} rock entities spawned`);
  // A scenario that places its own rock right after loadMap keeps just that one.
  world.loadMap(buildIsland());
  world.spawn('rock', { x: 10.5, y: 10.5, size: 1 });
  game.tick(1 / 30);
  ok(rocks() === 1, `own rock placed after loadMap: map rocks not added on top (${rocks()})`);
  // A map with its own 2 rocks spawns exactly those 2.
  world.loadMap({ ...plain, rocks: [{ x: 3.5, y: 3.5, size: 1 }, { x: 6.5, y: 2.5, size: 3 }] });
  game.tick(1 / 30);
  renderer.render();
  const two = world.query({ kind: 'rock' });
  ok(two.length === 2 && two.some((r) => r.x === 3.5 && r.y === 3.5 && r.size === 1) && two.some((r) => r.x === 6.5 && r.y === 2.5 && r.size === 3), `a map with its own 2 rocks spawns exactly those (${two.length})`);
}

// ------------------------------------------------------------------ system: live rocks (round 39)
// liveRocks(world) is the one list of rocks the village (placement) and the creature (sensing) use:
// the map's rock records until the terrain system has made entities for that map, the rock entities
// from then on (even when none are left). world.rocks stays the map's authored list.
{
  const live = terrainSystem.liveRocks;
  ok(typeof live === 'function', 'terrain exports liveRocks(world)');
  if (typeof live === 'function') {
    const game = createGame({ seed: 4 });
    const { world } = game;
    const N = island.rocks.length;
    const ents = () => world.query({ kind: 'rock' });
    const isEnts = (list) => list.length === ents().length && list.every((r) => r.kind === 'rock' && world.get(r.id) === r);
    ok(isEnts(live(world)) && live(world).length === N, `after create: ${live(world).length} live rocks, all entities`);
    world.loadMap(buildIsland());
    ok(live(world) === world.rocks && live(world).length === N, 'after loadMap and before a tick: the map records are the live rocks');
    game.tick(1 / 30);
    ok(isEnts(live(world)) && live(world).length === N, 'after one tick: the rock entities are');
    const [a, b] = ents();
    world.move(a, a.x + 3, a.y, a.z);
    world.remove(b.id);
    ok(isEnts(live(world)) && live(world).length === N - 1 && live(world).includes(a) && world.rocks.length === N,
      `a moved rock counts where it lies, a removed one not at all, and the map keeps its ${world.rocks.length} records`);
    for (const r of ents()) world.remove(r.id);
    game.tick(1 / 30);
    ok(live(world).length === 0 && ents().length === 0 && terrainSystem.spawnRocks(world) === 0 && ents().length === 0,
      `with every rock gone: no live rocks, nothing respawned, records not offered (${live(world).length})`);
    world.loadMap(buildIsland());
    const own = world.spawn('rock', { x: 10.5, y: 10.5, size: 1 });
    ok(live(world).length === 1 && live(world)[0] === own, 'own rock placed right after loadMap: it is the only live rock, before a tick');
    game.tick(1 / 30);
    ok(live(world).length === 1 && live(world)[0] === own && ents().length === 1, 'and after a tick');
  }
}

// ------------------------------------------------------------------ painters
{
  const variants = [];
  for (const name of Object.keys(painters.sprites)) for (const opts of [{}, ...(painters.previews[name] ?? [])]) variants.push([name, opts]);
  ok(variants.length >= 14, `every opts variant listed (${variants.length})`);
  for (const [name, opts] of variants) {
    const label = `${name} ${JSON.stringify(opts)}`;
    const s = getSprite(name, opts);
    ok(s !== placeholderSprite(), `${label}: painted (not the placeholder)`);
    const again = painters.sprites[name](opts);
    ok(again.w === s.w && again.h === s.h && again.ax === s.ax && again.ay === s.ay && again.data.every((v, i) => v === s.data[i]), `${label}: deterministic`);
    let opaque = 0, lowest = -1, anchorCol = false;
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.data[y * s.w + x]) { opaque++; lowest = y; }
    for (let x = s.ax - 1; x <= s.ax + 1; x++) for (let y = s.ay - 1; y <= s.ay; y++) if (x >= 0 && y >= 0 && x < s.w && y < s.h && s.data[y * s.w + x]) anchorCol = true;
    ok(opaque > 6, `${label}: non-empty (${opaque} px)`);
    ok(Math.abs(s.ay - lowest) <= 1 && anchorCol, `${label}: anchored at the base (ay ${s.ay}, lowest row ${lowest}, ${s.w}x${s.h})`);
  }
  const full = (sp) => getSprite('tree', { species: sp, growth: 1 });
  for (const sp of ['pine', 'broad']) {
    const h = full(sp).h;
    ok(h >= 20 && h <= 30, `full ${sp} is 20-28 px tall plus outline (${h})`);
    const hs = [0, 0.25, 0.5, 0.75, 1].map((growth) => getSprite('tree', { species: sp, growth }).h);
    ok(hs.every((v, i) => i === 0 || v > hs[i - 1]), `${sp} grows taller at each stage (${hs.join(', ')})`);
  }
  ok(getSprite('tree', { species: 'pine', growth: 0.6 }) === getSprite('tree', { species: 'pine', growth: 0.5 }) || getSprite('tree', { species: 'pine', growth: 0.6 }).h === getSprite('tree', { species: 'pine', growth: 0.5 }).h, 'growth quantizes to 0.25 steps');
  const rh = [1, 2, 3].map((size) => getSprite('rock', { size }));
  ok(rh.every((s, i) => s.h >= 5 && s.h <= 18 && (i === 0 || s.w > rh[i - 1].w)), `rocks 6-16 px, larger per size (${rh.map((s) => `${s.w}x${s.h}`).join(', ')})`);
}

// ------------------------------------------------------------------ update touches no DOM; no Math.random
{
  const touched = [];
  for (const key of ['window', 'document', 'HTMLCanvasElement', 'requestAnimationFrame']) {
    Object.defineProperty(globalThis, key, { configurable: true, get() { touched.push(key); return undefined; } });
  }
  const game = createGame({ seed: 2 });
  const sys = game.systems.terrain;
  for (let i = 0; i < 60; i++) sys.update(1 / 30);
  for (let i = 0; i < 30; i++) game.tick(1 / 30);
  for (const key of ['window', 'document', 'HTMLCanvasElement', 'requestAnimationFrame']) delete globalThis[key];
  ok(touched.length === 0, `terrain create and update touch no DOM globals (${touched.join(', ') || 'none'})`);
  const files = ['src/systems/terrain.js', 'src/art/painters/terrain.js', 'src/dev/scenarios/island.js',
    ...readdirSync(join(ROOT, 'src/terrain')).map((f) => `src/terrain/${f}`)];
  const bad = files.filter((f) => /Math\.random|document\.|window\./.test(readFileSync(join(ROOT, f), 'utf8').replace(/\/\/.*$/gm, '')));
  ok(bad.length === 0, `no Math.random or DOM access in terrain sources (${bad.join(', ') || 'none'})`);
}

// Water glint (round 46): a glinting water cell lights for one step in 64 and most cells never
// glint. The never-glint cells held 255, and (255 + 1) & 63 === 0, so all of them (about 5/8 of the
// sea) lit together at step 1: a flash across the water every 64 / 5 = 12.8 s. A flat 128 x 64 water
// buffer covers every one of the 64 x 64 glint cells (each cell is 2 px across). Over one cycle no
// pixel may light twice, about 3/8 of them light once, and no step lights more than 1/16 of them.
{
  const W = 128, H = 64, base = WATER_LO + 2; // shade 2: a shade that glints
  const cache = { data: new Uint8Array(W * H).fill(base), w: W, h: H, ox: 0, oy: 0 };
  const lut = new Uint32Array(256);
  lut[base] = 1; lut[base + 2] = 2; // 2 = a glinting pixel
  const buf = new Uint32Array(W * H), times = new Uint8Array(W * H), perStep = [];
  for (let s = 0; s < 64; s++) {
    buf.fill(0);
    drawTerrain({ buf, w: W, h: H, camX: 0, camY: 0, lut }, cache, (s + 0.5) / 5); // GLINT_RATE 5 steps/s
    let n = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] === 2) { n++; times[i]++; }
    perStep.push(n);
  }
  const N = W * H, total = perStep.reduce((a, b) => a + b, 0), most = Math.max(...perStep);
  ok(times.every((t) => t <= 1), `water glint: no pixel lights twice in one 64-step cycle (most ${Math.max(...times)})`);
  ok(total >= 0.25 * N && total <= 0.5 * N, `water glint: about 3/8 of the water glints once per cycle (${total} of ${N} px)`);
  ok(most <= N / 16, `water glint: no step lights the sea at once (most in one step ${most} of ${N} px, at step ${perStep.indexOf(most)})`);
}

console.log(`check-terrain: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exitCode = 1;

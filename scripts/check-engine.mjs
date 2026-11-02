// Engine checks in node, no browser: iso math, height-aware picking, depth order, blit, rng, clock,
// events, world model and spatial query, display size math, camera (wheel steps per 100 of delta,
// middle drag from the press), input, system stubs, one full render of the test map into the view
// buffer, DOM input through input.attach on a stand-in page (edge pan in the strip right of the
// canvas, chorded buttons, lost capture and blur, which end a press with no pointer speed; a blur
// also leaves the window), the scenario pass rule, and that fields never cover the villagers on them.
//
//   node scripts/check-engine.mjs
//
// Exit 0 when every check passes; otherwise prints each failing check and exits 1.
import { worldToScreen, screenToWorld, pickTile, pickSurface, compareDepth, depthKey } from '../src/world/iso.js';
import { surfaceHeights } from '../src/terrain/cache.js';
import { createWorld } from '../src/world/world.js';
import { blit } from '../src/render/blit.js';
import { createDrawList } from '../src/render/drawlist.js';
import { createRng } from '../src/engine/rng.js';
import { createClock, STEP } from '../src/engine/clock.js';
import { createEvents } from '../src/engine/events.js';
import { createDisplay, SCALES } from '../src/engine/display.js';
import { createGame, SYSTEM_ORDER } from '../src/game.js';
import { makeTestMap, makeTestLut, makeTestSprite, debugTerrainPass } from '../src/dev/test-art.js';
import * as campfire from 'pixelfx/fx/fire/campfire';
import { readdirSync } from 'node:fs';
import { registerPainters } from '../src/art/registry.js';
import { scenarioOk } from '../src/dev/scenario.js';

let pass = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) pass++;
  else { fails.push(msg); console.log(`FAIL ${msg}`); }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
function section(name, fn) {
  try { fn(); } catch (err) { fails.push(`${name} threw: ${err.stack || err}`); console.log(`FAIL ${name} threw: ${err.stack || err}`); }
}

// independent mulberry32 reference, written from the published algorithm
function refMulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

section('iso', () => {
  // projection formula per spec, on known values
  const p = worldToScreen(3, 1, 2);
  ok(p.sx === 32 && p.sy === 16, `worldToScreen(3,1,2) = (32,16), got (${p.sx},${p.sy})`);
  const q = worldToScreen(0, 5, 0);
  ok(q.sx === -80 && q.sy === 40, `worldToScreen(0,5,0) = (-80,40), got (${q.sx},${q.sy})`);
  const rng = refMulberry(7);
  let worst = 0;
  for (let i = 0; i < 500; i++) {
    const x = rng() * 64, y = rng() * 64, z = rng() * 16;
    const s = worldToScreen(x, y, z), w = screenToWorld(s.sx, s.sy, z);
    worst = Math.max(worst, Math.abs(w.x - x), Math.abs(w.y - y));
  }
  ok(worst < 1e-9, `iso round trip over 500 points, worst error ${worst}`);
  ok(depthKey({ x: 2, y: 3 }) === 5, 'depthKey = x + y');
});

section('pick', () => {
  const world = createWorld({ w: 16, h: 16 }).loadMap(makeTestMap());
  const opts = { w: world.w, h: world.h };
  const pickAt = (x, y, z) => { const s = worldToScreen(x, y, z); return pickTile(s.sx, s.sy, world.heightAt, opts); };
  // every tile center picks itself (tile centers sit on the surface)
  let wrong = 0, total = 0, occluded = 0;
  for (let ty = 0; ty < 16; ty++)
    for (let tx = 0; tx < 16; tx++) {
      const z = world.heightAt(tx + 0.5, ty + 0.5);
      const h = pickAt(tx + 0.5, ty + 0.5, z);
      total++;
      if (!h) { wrong++; continue; }
      // a hit in front (larger x + y) means the center is hidden behind higher ground: legal only
      // when that hit is higher than the tile
      if (h.tx !== tx || h.ty !== ty) {
        if (h.x + h.y > tx + ty + 1 && h.z > z) occluded++;
        else wrong++;
      }
    }
  ok(wrong === 0, `tile centers pick themselves or a higher tile in front (${wrong} of ${total} wrong, ${occluded} occluded)`);
  ok(occluded > 0, `test map has occluded tiles behind the plateau (${occluded})`);
  // explicit occlusion: (7.5, 7.5) at height 2 is hidden by plateau tile (9, 9) at height 6
  const hid = pickAt(7.5, 7.5, 2);
  ok(hid && hid.tx === 9 && hid.ty === 9 && near(hid.z, 6, 0.05), `occluded pick returns front plateau tile 9,9: ${JSON.stringify(hid)}`);
  // flat-height picking would have returned 7,7: prove the height matters
  const flat = screenToWorld(worldToScreen(7.5, 7.5, 2).sx, worldToScreen(7.5, 7.5, 2).sy, 0);
  ok(Math.floor(flat.x) !== 7 || Math.floor(flat.y) !== 7, 'z=0 inverse would pick a different tile (height-aware test is meaningful)');
  // the picked point lies on the surface and projects back to the same pixel
  const s = worldToScreen(7.5, 7.5, 2), back = worldToScreen(hid.x, hid.y, hid.z);
  ok(near(back.sx, s.sx, 1e-6) && near(back.sy, s.sy, 1e-6), 'picked point projects back to the query pixel');
  ok(near(world.heightAt(hid.x, hid.y), hid.z, 0.05), 'picked point lies on the terrain surface');
  ok(pickAt(-4, -4, 0) === null, 'off-map pixel picks nothing');
});

// pickSurface (the pointer's pick against the drawn, stepped terrain). Whether each drawn pixel picks
// the tile that drew it is checked against the terrain cache in check-terrain.mjs; here: any float
// pixel, including ones where rounding lands the tile walk exactly on a tile boundary (these hung
// an earlier version of the walk), returns a point that projects back onto the query pixel and lies
// in the tile it names, on its top or a front face.
section('pick-surface', () => {
  const world = createWorld({ w: 16, h: 16 }).loadMap(makeTestMap());
  const surf = surfaceHeights(world);
  const surface = { surf, w: 16, h: 16, max: Math.max(...surf) };
  const rng = refMulberry(11);
  const pts = [[359.956, 457.207], [-544.15, 406.533], [-961.2994757529053, 616.8622124097421]];
  for (let i = 0; i < 100000; i++) pts.push([rng() * 512 - 256, rng() * 304 - 48]); // the test map spans x -256..256, y -48..256
  let hits = 0, bad = 0;
  const first = [];
  for (const [sx, sy] of pts) {
    const p = pickSurface(sx, sy, surface);
    if (!p) continue;
    hits++;
    const back = worldToScreen(p.x, p.y, p.z), S = surf[p.ty * 16 + p.tx];
    const why = Math.abs(back.sx - sx) > 1e-4 || Math.abs(back.sy - sy) > 1e-4 ? 'does not project back'
      : Math.floor(p.x) !== p.tx || Math.floor(p.y) !== p.ty ? 'outside the tile it names'
        : p.z > S + 1e-9 || p.z < 0 ? `z ${p.z} not on the column (top ${S})` : null;
    if (why) { bad++; if (first.length < 3) first.push(`(${sx}, ${sy}): ${why}`); }
  }
  ok(hits > 30000 && bad === 0, `pickSurface on ${pts.length} float pixels: ${hits} hits, ${bad} bad ${first.join('; ')}`);
});

section('depth', () => {
  const list = createDrawList();
  const items = [
    { id: 4, x: 5, y: 5, z: 0 },
    { id: 2, x: 1, y: 1, z: 3 },
    { id: 3, x: 4, y: 6, z: 1 },
    { id: 1, x: 6, y: 4, z: 1 },
    { id: 5, x: 0, y: 3, z: 0 },
  ];
  items.forEach((it) => list.push(it));
  const order = list.sort().map((it) => it.id).join(',');
  // keys: 2 -> 2, 5 -> 3, then x+y = 10 for 4 (z 0), 1 (z 1, id 1), 3 (z 1, id 3)
  ok(order === '2,5,4,1,3', `depth order by x+y, then z, then id: got ${order}`);
  ok(compareDepth({ x: 1, y: 1, z: 0, id: 9 }, { x: 1, y: 1, z: 0, id: 2 }) > 0, 'id breaks full ties');
});

section('blit', () => {
  const lut = new Uint32Array(256);
  lut[1] = 0xff0000ff; lut[2] = 0xff00ff00; lut[9] = 0xffff0000;
  // 3x2 sprite, anchor (1, 1):  row0 = [1, 0, 2], row1 = [9, 1, 0]
  const sp = { w: 3, h: 2, ax: 1, ay: 1, data: Uint8Array.from([1, 0, 2, 9, 1, 0]) };
  const W = 6, H = 4, BG = 0xff777777;
  const mk = () => new Uint32Array(W * H).fill(BG);
  const at = (d, x, y) => d[y * W + x];

  let d = mk();
  blit(d, W, H, sp, 2, 2, lut, false);
  // anchor (1,1) lands on (2,2): sprite (0,0) -> (1,1)
  ok(at(d, 1, 1) === lut[1] && at(d, 3, 1) === lut[2] && at(d, 1, 2) === lut[9] && at(d, 2, 2) === lut[1], 'blit places pixels relative to the anchor through the LUT');
  ok(at(d, 2, 1) === BG && at(d, 3, 2) === BG, 'index 0 is transparent');
  ok(d.filter((v) => v !== BG).length === 4, 'blit writes exactly the 4 opaque pixels');

  d = mk();
  blit(d, W, H, sp, 2, 2, lut, true);
  // mirrored about the anchor column: sprite col c -> x = 2 - (c - 1)
  ok(at(d, 3, 1) === lut[1] && at(d, 1, 1) === lut[2] && at(d, 3, 2) === lut[9] && at(d, 2, 2) === lut[1] && at(d, 2, 1) === BG, 'flipX mirrors about the anchor column');

  d = mk();
  blit(d, W, H, sp, 0, 0, lut, false); // only sprite (1,1) and (2,1)... -> (0,0) is index 1, (1,0) is 0
  ok(at(d, 0, 0) === lut[1] && d.filter((v) => v !== BG).length === 1, 'clips at top-left');
  d = mk();
  blit(d, W, H, sp, 6, 4, lut, false); // sprite (0,0) -> (5,3); rest off the right/bottom
  ok(at(d, 5, 3) === lut[1] && d.filter((v) => v !== BG).length === 1, 'clips at bottom-right');
  d = mk();
  blit(d, W, H, sp, 0, 1, lut, true); // mirrored: col 0 -> x 1, col 1 -> x 0, col 2 -> x -1 (clipped)
  ok(at(d, 1, 0) === lut[1] && at(d, 1, 1) === lut[9] && at(d, 0, 1) === lut[1] && d.filter((v) => v !== BG).length === 3, 'flipX clips at the left edge');
  d = mk();
  blit(d, W, H, sp, 100, 100, lut, false);
  blit(d, W, H, sp, -100, -100, lut, true);
  ok(d.every((v) => v === BG), 'fully off-screen blits write nothing');
  const lut2 = Uint32Array.from(lut); lut2[1] = 0xff123456;
  d = mk();
  blit(d, W, H, sp, 2, 2, lut2, false);
  ok(at(d, 1, 1) === 0xff123456 && at(d, 2, 2) === 0xff123456, 'swapping the LUT recolors without touching the sprite');
});

section('rng', () => {
  const a = createRng(1), b = createRng(1), c = createRng(2), ref = refMulberry(1);
  const sa = Array.from({ length: 50 }, () => a.next());
  const sb = Array.from({ length: 50 }, () => b.next());
  const sr = Array.from({ length: 50 }, () => ref());
  const sc = Array.from({ length: 50 }, () => c.next());
  ok(sa.every((v, i) => v === sb[i]), 'same seed -> same sequence');
  ok(sa.every((v, i) => v === sr[i]), 'matches reference mulberry32');
  ok(sa.some((v, i) => v !== sc[i]), 'different seed -> different sequence');
  ok(sa.every((v) => v >= 0 && v < 1), 'values in [0, 1)');
  const r = createRng(9);
  const ints = Array.from({ length: 1000 }, () => r.int(6));
  ok(ints.every((v) => Number.isInteger(v) && v >= 0 && v < 6) && new Set(ints).size === 6, 'int(n) covers 0..n-1');
});

section('clock', () => {
  ok(STEP === 1 / 30, 'fixed step is 1/30 s');
  const c = createClock();
  let n = 0;
  const tick = (dt) => { n++; ok(dt === STEP, 'tick receives the fixed step'); };
  c.advance(0.1, tick);
  ok(n === 3, `0.1 s -> 3 ticks (got ${n})`);
  n = 0;
  c.advance(1 / 60, tick);
  const first = n;
  c.advance(1 / 60, tick);
  ok(first === 0 && n === 1, `two 1/60 s frames -> 1 tick (got ${first}, ${n})`);
  n = 0;
  const ran = c.advance(10, tick);
  ok(ran === c.maxSteps && n === c.maxSteps, `10 s stall capped at ${c.maxSteps} ticks (got ${n})`);
  n = 0;
  c.advance(STEP, tick);
  ok(n === 1, 'accumulator reset after a capped stall (no spiral)');
  const before = c.ticks;
  c.run(7, () => {});
  ok(c.ticks === before + 7 && near(c.time, c.ticks * STEP), 'run(n) advances exactly n ticks');
});

section('events', () => {
  const ev = createEvents();
  const got = [];
  const a = (p) => got.push(`a${p.v}`);
  const off = ev.on('x', a);
  ev.on('x', (p) => got.push(`b${p.v}`));
  ev.emit('x', { v: 1 });
  ok(got.join(',') === 'a1,b1', `listeners in subscription order (${got})`);
  off();
  ev.emit('x', { v: 2 });
  ok(got.join(',') === 'a1,b1,b2', 'unsubscribe function removes the listener');
  ev.on('y', a);
  ev.off('y', a);
  ev.emit('y', { v: 3 });
  ok(!got.includes('a3'), 'off removes the listener');
  ev.emit('none', {});
  ok(true, 'emit with no listeners is a no-op');
});

section('world', () => {
  const world = createWorld({ w: 64, h: 64 });
  const map = makeTestMap();
  world.loadMap(map);
  ok(world.w === 16 && world.h === 16 && world.seaLevel === 1, 'loadMap takes size and sea level');
  const t = world.tile(10, 10);
  ok(t && t.height === 6 && t.ground === 5, `tile(10,10) is the plateau: ${JSON.stringify(t)}`);
  ok(world.tile(-1, 0) === null && world.tile(16, 0) === null, 'tile outside the map is null');
  ok(near(world.heightAt(10.5, 10.5), 6) && near(world.heightAt(4.5, 2.5), 2), 'heightAt equals tile height at tile centers');
  // bilinear between tile 8 (height 4) and tile 9 (height 6) centers on row 9
  ok(near(world.heightAt(9, 9.5), 5), `heightAt halfway between centers is the mean (${world.heightAt(9, 9.5)})`);
  // (9, 9) sits between centers of tiles (8,8)=4, (9,8)=4, (8,9)=4, (9,9)=6
  ok(near(world.heightAt(9, 9), 4.5), `heightAt blends four neighbours (${world.heightAt(9, 9)})`);
  ok(world.sites.temple.x === 10 && world.sites.village.r === 3, 'sites copied');
  map.height[0] = 15;
  ok(world.height[0] !== 15, 'loadMap copies the arrays');

  const rng = refMulberry(3);
  const made = [];
  for (let i = 0; i < 300; i++) made.push(world.spawn(i % 3 ? 'tree' : 'villager', { x: rng() * 16, y: rng() * 16 }));
  ok(made.every((e, i) => e.id === made[0].id + i), 'spawn assigns increasing ids');
  ok(near(made[0].z, world.heightAt(made[0].x, made[0].y)), 'spawn defaults z to the terrain height');
  const brute = (kind, x, y, r) => made.filter((e) => world.get(e.id) && (kind === undefined || e.kind === kind) && (e.x - x) ** 2 + (e.y - y) ** 2 <= r * r).map((e) => e.id).join(',');
  let mism = 0;
  for (let i = 0; i < 100; i++) {
    const x = rng() * 18 - 1, y = rng() * 18 - 1, r = rng() * 6, kind = i % 2 ? 'tree' : undefined;
    if (world.query({ kind, x, y, r }).map((e) => e.id).join(',') !== brute(kind, x, y, r)) mism++;
  }
  ok(mism === 0, `spatial query matches brute force on 100 circles (${mism} mismatches)`);
  for (let i = 0; i < 100; i++) world.move(made[i], rng() * 16, rng() * 16);
  for (let i = 100; i < 150; i++) world.remove(made[i].id);
  mism = 0;
  for (let i = 0; i < 100; i++) {
    const x = rng() * 16, y = rng() * 16, r = rng() * 6;
    if (world.query({ x, y, r }).map((e) => e.id).join(',') !== brute(undefined, x, y, r)) mism++;
  }
  ok(mism === 0, `spatial query correct after move and remove (${mism} mismatches)`);
  ok(world.query({ kind: 'villager' }).length === made.filter((e) => world.get(e.id) && e.kind === 'villager').length, 'kind-only query');
  ok(world.query({ x: 8, y: 8, r: 30 }).length === 250, 'query sees every live entity');
  ok(world.get(made[120].id) === undefined && world.remove(made[120].id) === false, 'removed entity is gone');
});

section('display', () => {
  const cases = [
    [1920, 1080, 1, 640, 360],
    [1920, 970, 1, 640, 323],
    [1536, 864, 1.25, 640, 360],
    [2560, 1440, 1, 853, 480],
  ];
  for (const [w, h, dpr, ew, eh] of cases) {
    const d = createDisplay();
    d.setDevice(w, h, dpr);
    ok(d.scale === 3 && d.zoom === 1 && d.w === ew && d.h === eh, `${w}x${h}@${dpr}: view ${d.w}x${d.h} == ${ew}x${eh}`);
    ok(d.w === Math.floor(Math.round(w * dpr) / 3) && d.h === Math.floor(Math.round(h * dpr) / 3), `${w}x${h}@${dpr}: floor(device px / 3)`);
    for (const s of SCALES) {
      d.setScale(s);
      const z = s / 3;
      ok(d.w === Math.floor(Math.round(w * dpr) / (3 * z)) && Number.isInteger(d.w) && Number.isInteger(d.h), `${w}x${h}@${dpr} scale ${s}: view ${d.w}x${d.h}`);
      // the strip left uncovered at the right and bottom edge is under one game pixel
      ok(d.w * s <= d.devW && d.devW - d.w * s < s && d.h * s <= d.devH && d.devH - d.h * s < s,
        `${w}x${h}@${dpr} scale ${s}: leftover strip ${d.devW - d.w * s}x${d.devH - d.h * s} device px is under ${s}`);
    }
  }
  const d = createDisplay();
  d.setDevice(1920, 1080, 1);
  ok(JSON.stringify(SCALES) === '[2,3,4,6]', 'zoom steps are 2, 3, 4, 6 device px');
  ok(d.stepScale(1) && d.scale === 4 && d.stepScale(1) && d.scale === 6 && !d.stepScale(1) && d.scale === 6, 'stepScale walks up and stops at 6');
  d.setScale(2);
  ok(!d.stepScale(-1) && d.scale === 2, 'stepScale stops at 2');
  let threw = false;
  try { d.setScale(5); } catch { threw = true; }
  ok(threw, 'non-step scale rejected');
});

section('game', () => {
  ok(typeof globalThis.window === 'undefined' && typeof globalThis.document === 'undefined', 'node has no DOM (stubs must run without one)');
  const game = createGame({ seed: 5 });
  for (const k of ['world', 'events', 'rng', 'clock', 'input', 'camera', 'display', 'renderer', 'fx', 'systems', 'debug', 'scenario'])
    ok(k in game, `game.${k} exists`);
  ok(JSON.stringify(SYSTEM_ORDER) === JSON.stringify(['terrain', 'village', 'creature', 'hand', 'miracles', 'alignment', 'ui', 'audio']), 'system order per spec');
  ok(JSON.stringify(Object.keys(game.systems)) === JSON.stringify(SYSTEM_ORDER), 'systems created in spec order');
  // wrap every system's update to record the call order
  const calls = [];
  for (const name of SYSTEM_ORDER) {
    const s = game.systems[name];
    ok(typeof s.update === 'function' && typeof s.draw === 'function', `${name}: create(game) returns { update, draw }`);
    const u = s.update;
    s.update = (dt) => { calls.push(name); return u.call(s, dt); };
  }
  game.display.setDevice(1920, 1080, 1);
  game.clock.run(3, game.tick);
  ok(calls.length === 24 && calls.slice(0, 8).join(',') === SYSTEM_ORDER.join(','), `every stub update ran in order each tick (${calls.length} calls)`);

  // camera: keys pan, wheel zooms about the pointer, clamp holds
  const { camera, input, display } = game;
  game.renderer.lut = makeTestLut();
  camera.centerOn(8, 8, 2);
  const x0 = camera.x;
  input.synth.keyDown('KeyD');
  game.clock.run(3, game.tick);
  input.synth.keyUp('KeyD');
  ok(near(camera.x - x0, 240 * 3 * STEP, 1e-6), `KeyD pans right 24 px in 3 ticks (${camera.x - x0})`);
  input.synth.move(100, 100);
  input.synth.wheel(-100); // one mouse notch
  game.tick(STEP);
  ok(display.scale === 4 && input.pointer.sx === 75, `wheel up -> scale 4, pointer rescaled to 75 (${display.scale}, ${input.pointer.sx})`);
  // touchpad: many small deltas add up to one step per 100 (round 42: any delta was a full step,
  // so one flick jumped 3 -> 4 -> 6)
  display.setScale(3);
  const scales = [];
  for (let i = 0; i < 24; i++) { input.synth.wheel(-4); game.tick(STEP); scales.push(display.scale); }
  ok(scales.every((s) => s === 3), `24 touchpad deltas of -4 (96 in all) do not zoom (${[...new Set(scales)].join(',')})`);
  input.synth.wheel(-4); game.tick(STEP);
  ok(display.scale === 4 && input.wheel === 0, `the 25th reaches 100: one step to scale 4, nothing left over (${display.scale}, ${input.wheel})`);
  input.synth.wheel(-60); game.tick(STEP);
  input.synth.wheel(80); game.tick(STEP);
  ok(display.scale === 4 && input.wheel === 80, `turning the other way drops the remainder (scale ${display.scale}, wheel ${input.wheel})`);
  input.synth.wheel(250); game.tick(STEP);
  ok(display.scale === 2 && input.wheel === 0, `330 out: two steps to scale 2, the rest dropped at the last scale (${display.scale}, ${input.wheel})`);
  display.setScale(4);
  // middle drag: the press anchors the drag, so a move before the next tick still pans, and so does
  // the move between the last tick and the release (round 42: both were lost)
  camera.centerOn(32, 32, 2);
  game.tick(STEP);
  const mx = camera.x;
  input.synth.move(100, 100);
  input.synth.down(1);
  input.synth.move(130, 100);
  game.tick(STEP);
  ok(near(camera.x, mx - 30), `middle drag: movement before the first tick pans (${(camera.x - mx).toFixed(1)}, want -30)`);
  input.synth.move(140, 100);
  input.synth.up(1);
  ok(near(camera.x, mx - 40), `middle drag: movement before the release pans (${(camera.x - mx).toFixed(1)}, want -40)`);
  game.tick(STEP);
  ok(near(camera.x, mx - 40), 'no pan after the release');
  for (let i = 0; i < 200; i++) { input.synth.keyDown('KeyW'); game.tick(STEP); }
  input.synth.keyUp('KeyW');
  ok(near(camera.y, camera.bounds().minY), `camera clamps at the north bound (${camera.y})`);

  // input: drag events and velocity in sim time
  input.now = () => game.clock.time * 1000;
  const seen = [];
  game.events.on('drag-start', () => seen.push('start'));
  game.events.on('drag-end', (p) => seen.push(`end ${Math.round(p.vsx)}`));
  input.synth.move(50, 50);
  input.synth.down(0);
  for (let i = 1; i <= 6; i++) { game.tick(STEP); game.clock.ticks++; input.synth.move(50 + i * 2, 50); }
  input.synth.up(0);
  ok(seen.join(',') === 'start,end 60', `drag-start/end with ~60 px/s release velocity (${seen})`);
  ok(input.pointer.hit !== undefined && typeof input.pointer.x === 'number', 'pointer has a world position');

  // full render in node: terrain pass, sorted sprites, fx composite into the view buffer
  display.setScale(3);
  game.world.loadMap(makeTestMap());
  game.renderer.addTerrainPass(debugTerrainPass);
  camera.centerOn(8, 8, 2);
  const sprite = makeTestSprite();
  const e = game.world.spawn('post', { x: 4.5, y: 4.5, sprite });
  const fxh = game.fx.spawn(campfire, { x: 12.5, y: 3.5, z: 2 });
  game.clock.run(15, game.tick);
  game.renderer.render();
  const view = game.renderer.view, lut = game.renderer.lut;
  ok(view.w === 640 && view.h === 360, `view buffer ${view.w}x${view.h}`);
  const a = camera.worldToView(e.x, e.y, e.z);
  const anchorIdx = sprite.data[sprite.ay * sprite.w + sprite.ax];
  ok(view.data[a.sy * view.w + a.sx] === lut[anchorIdx], 'entity sprite anchor pixel drawn at its projected point');
  const f = camera.worldToView(12.5, 3.5, 2);
  let lit = 0;
  for (let y = f.sy - 30; y < f.sy; y++) for (let x = f.sx - 10; x < f.sx + 10; x++) {
    const v = view.data[y * view.w + x];
    if ((v & 255) > 200 && ((v >>> 8) & 255) > 120) lit++;
  }
  ok(lit > 20, `campfire composited over the terrain (${lit} hot pixels)`);
  ok(game.fx.live.length === 1 && near(fxh.fx.t, 15 * STEP, 1e-9), `effect advanced exactly 15 sim ticks (t = ${fxh.fx.t})`);
  ok(view.data.every((v) => v >>> 24 === 255), 'view buffer stays opaque after compositing');
});

// DOM input through input.attach, with a stand-in page built from node's EventTarget: a canvas, the
// body around it and the window, and a mouse that fires what Chrome fires. Hit testing: a point on
// the canvas rectangle targets the canvas, the rest of the window targets the body, and outside the
// window targets nothing. Events bubble target -> window. Crossing from one target to another fires
// pointerout (bubbles, relatedTarget = the new target or null) and pointerleave (target only).
function fakePage(game, cssW, cssH) {
  const { display, input } = game;
  display.setDevice(cssW, cssH, 1);
  const win = new EventTarget(), body = new EventTarget();
  const canvas = Object.assign(new EventTarget(), { width: display.w, height: display.h, setPointerCapture() {} });
  const canvasCssW = display.w * display.scale, canvasCssH = display.h * display.scale;
  input.attach(canvas, win, (cx, cy) => ({ sx: Math.floor(cx / display.scale), sy: Math.floor(cy / display.scale) }));
  const fire = (target, type, props, bubbles = true) => {
    if (!target) return;
    const ev = new Event(type, { cancelable: true });
    for (const [k, v] of Object.entries(props)) Object.defineProperty(ev, k, { value: v });
    target.dispatchEvent(ev);
    if (bubbles && target !== win) win.dispatchEvent(ev);
  };
  let over = null, buttons = 0, x = 0, y = 0;
  const hit = (px, py) => (px < 0 || py < 0 || px >= cssW || py >= cssH ? null : px < canvasCssW && py < canvasCssH ? canvas : body);
  const base = () => ({ clientX: x, clientY: y, buttons, pointerId: 1 });
  return {
    canvas, win,
    move(px, py) {
      x = px; y = py;
      const t = hit(px, py);
      if (t !== over) {
        fire(over, 'pointerout', { ...base(), relatedTarget: t });
        fire(over, 'pointerleave', { ...base(), relatedTarget: t }, false);
        over = t;
      }
      fire(t, 'pointermove', { ...base(), button: -1 });
    },
    /** Chrome: pointerdown for the first button, pointerup for the last; any other change is a pointermove. */
    press(button, down) {
      const bit = button === 0 ? 1 : button === 1 ? 4 : button === 2 ? 2 : 1 << button;
      const before = buttons;
      buttons = down ? buttons | bit : buttons & ~bit;
      const type = down && before === 0 ? 'pointerdown' : !down && buttons === 0 ? 'pointerup' : 'pointermove';
      fire(hit(x, y), type, { ...base(), button });
    },
    lostCapture() { fire(canvas, 'lostpointercapture', base(), false); },
    blur() { fire(win, 'blur', {}); },
  };
}

section('dom-input', () => {
  // edge pan at the right edge of a window whose width is not a multiple of the scale: 1366 / 3 =
  // 455 game px shown on 1365 device px, so x = 1365 is outside the canvas
  for (const [w, h] of [[1366, 768], [1600, 900], [2560, 1440], [1280, 720], [1920, 1080]]) {
    const game = createGame({ seed: 1 });
    const page = fakePage(game, w, h);
    const { camera, display, input } = game;
    camera.centerOn(32, 32, 2);
    page.move(w / 2, h / 2);
    game.tick(STEP);
    const c0 = camera.x;
    page.move(w - 1, h / 2);
    game.clock.run(6, game.tick);
    ok(camera.x > c0 + 30 && input.pointer.inside && input.pointer.sx === display.w - 1,
      `${w}x${h}: mouse at x = ${w - 1} pans right (${(camera.x - c0).toFixed(1)} px; pointer sx ${input.pointer.sx} of view ${display.w}, inside ${input.pointer.inside})`);
    const y0 = camera.y;
    page.move(w / 2, h - 1);
    game.clock.run(6, game.tick);
    ok(camera.y > y0 + 30, `${w}x${h}: mouse at y = ${h - 1} pans down (${(camera.y - y0).toFixed(1)} px)`);
    page.move(w + 5, h / 2); // off the window
    const c1 = camera.x;
    game.clock.run(6, game.tick);
    ok(!input.pointer.inside && camera.x === c1, `${w}x${h}: no edge pan once the mouse leaves the window`);
  }

  // chorded buttons: left held, middle added, left released, middle released
  {
    const game = createGame({ seed: 1 });
    const page = fakePage(game, 1366, 768);
    const { input, events } = game;
    const log = [];
    for (const t of ['pointer-down', 'pointer-up']) events.on(t, (p) => log.push(`${t === 'pointer-down' ? 'down' : 'up'}${p.button}`));
    page.move(600, 400);
    page.press(0, true);
    page.press(1, true);
    ok(input.pointer.buttons === 5, `left then middle held: buttons ${input.pointer.buttons}, want 5`);
    page.move(560, 400);
    page.press(0, false);
    ok(input.pointer.buttons === 4 && !input.pointer.drag, `left released while middle held: buttons ${input.pointer.buttons}, want 4; left drag ended (${JSON.stringify(input.pointer.drag)})`);
    page.press(1, false);
    page.lostCapture();
    ok(input.pointer.buttons === 0 && log.join(',') === 'down0,down1,up0,up1', `both released: buttons ${input.pointer.buttons}, events ${log.join(',')} (want down0,down1,up0,up1)`);
    // capture lost or window blurred while held: every button goes up
    page.press(2, true);
    page.lostCapture();
    ok(input.pointer.buttons === 0 && log.at(-1) === 'up2', `lostpointercapture releases a held button (buttons ${input.pointer.buttons}, last event ${log.at(-1)})`);
    page.press(2, false);
    page.press(0, true);
    page.blur();
    ok(input.pointer.buttons === 0 && log.at(-1) === 'up0', `window blur releases a held button (buttons ${input.pointer.buttons}, last event ${log.at(-1)})`);
  }

  // A blur, a lost capture or a cancelled pointer ends a press without a gesture (round 46): the
  // release carries no pointer speed, so the hand drops what it carries instead of throwing it with
  // the speed of the last moves. A blur also takes the pointer out of the window, so edge panning
  // stops. A lost capture keeps the pointer inside: it also fires after every ordinary pointerup.
  // An ordinary release keeps its speed.
  {
    const game = createGame({ seed: 1 });
    const page = fakePage(game, 1920, 1080);
    const { input, events, camera } = game;
    input.now = () => game.clock.time * 1000;
    const ups = [];
    events.on('pointer-up', (p) => ups.push(p));
    camera.centerOn(32, 32, 2);
    const fling = (end) => {
      page.move(600, 500);
      page.press(0, true);
      for (let i = 1; i <= 4; i++) { page.move(600 + 40 * i, 500); game.clock.run(1, game.tick); }
      const speed = input.pointer.vsx;
      end();
      const inside = input.pointer.inside;
      page.press(0, false); // the stand-in mouse lets go too
      return { speed, inside, up: ups.at(-1), n: ups.length };
    };
    const still = (u) => u && u.vx === 0 && u.vy === 0 && u.vsx === 0 && u.vsy === 0;
    const n0 = ups.length;
    const a = fling(() => page.blur());
    ok(a.speed > 200 && still(a.up) && a.n === n0 + 1, `blur during a fast drag releases with no speed (pointer ${a.speed.toFixed(0)} px/s before, release vsx ${a.up?.vsx}, vx ${a.up?.vx}, ${a.n - n0} releases)`);
    ok(!a.inside, `blur takes the pointer out of the window (inside ${a.inside})`);
    const b = fling(() => page.lostCapture());
    ok(b.speed > 200 && still(b.up), `lost capture during a fast drag releases with no speed (release vsx ${b.up?.vsx})`);
    ok(b.inside, 'lost capture leaves the pointer inside');
    const c = fling(() => {});
    ok(c.speed > 200 && c.up?.vsx > 200, `an ordinary release keeps the pointer speed (${c.up?.vsx?.toFixed(0)} px/s)`);
    page.lostCapture(); // what Chrome fires after that pointerup
    ok(ups.length === c.n, `lost capture after an ordinary release adds no release (${ups.length - c.n})`);
    // edge pan: mouse resting on the right edge, then the window loses focus
    page.move(1919, 540);
    game.clock.run(3, game.tick);
    const x0 = camera.x;
    game.clock.run(3, game.tick);
    const panning = camera.x > x0;
    page.blur();
    const x1 = camera.x;
    game.clock.run(6, game.tick);
    ok(panning && camera.x === x1, `blur stops edge panning (${panning ? 'panning before' : 'not panning before'}, ${(camera.x - x1).toFixed(1)} px after)`);
  }
});

// The scenario pass rule (round 46): an empty scenario passed the browser gate, because
// `asserts.every(ok)` holds for no asserts. It needs at least one assert, all true, and one screenshot.
section('scenario pass rule', () => {
  const yes = { ok: true, msg: 'a' }, no = { ok: false, msg: 'b' }, shot = { name: 's' };
  ok(!scenarioOk({ error: null, asserts: [], shots: [] }), 'a scenario with no asserts and no screenshot fails');
  ok(!scenarioOk({ error: null, asserts: [], shots: [shot] }), 'a scenario with no asserts fails');
  ok(!scenarioOk({ error: null, asserts: [yes], shots: [] }), 'a scenario with no screenshot fails');
  ok(!scenarioOk({ error: null, asserts: [yes, no], shots: [shot] }), 'a failed assert fails');
  ok(!scenarioOk({ error: 'Error: x', asserts: [yes], shots: [shot] }), 'a scenario that threw fails');
  ok(scenarioOk({ error: null, asserts: [yes], shots: [shot] }), 'asserts all true and a screenshot passes');
});

// Fields are flat footprints: villagers standing on one draw over it (round 42: sorted by its centre,
// a field covered the villagers on its back half). Real sprites, both villages, 60 s of sim.
try {
  const dir = new URL('../src/art/painters/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js')).sort()) registerPainters(await import(new URL(f, dir)));
  const game = createGame({ seed: 1 });
  game.display.setDevice(1920, 1080, 1);
  game.state ??= {};
  game.state.screen = 'play';
  game.systems.village.setup();
  game.systems.creature.setup?.();
  const { world, camera, renderer } = game;
  const shown = (v) => {
    camera.centerOn(v.x, v.y, v.z);
    renderer.render();
    const view = renderer.view, s = v.sprite, lut = v.lut ?? renderer.lut, p = camera.worldToView(v.x, v.y, v.z);
    let n = 0;
    for (let r = 0; r < s.h; r++) for (let c = 0; c < s.w; c++) {
      const k = s.data[r * s.w + c];
      if (!k) continue;
      const x = p.sx + (v.flipX ? -1 : 1) * (c - s.ax), y = p.sy + r - s.ay;
      if (x >= 0 && y >= 0 && x < view.w && y < view.h && view.data[y * view.w + x] === lut[k]) n++;
    }
    return n;
  };
  const onField = (v, f) => v.x >= f.tx && v.x < f.tx + f.fw && v.y >= f.ty && v.y < f.ty + f.fh;
  let samples = 0, hidden = 0;
  const first = [];
  for (let sec = 0; sec < 120; sec++) {
    game.clock.run(30, game.tick);
    for (const f of world.query({ kind: 'building' }).filter((b) => b.type === 'field' && b.stage === 'done')) {
      for (const v of world.query({ kind: 'villager' }).filter((v) => onField(v, f))) {
        samples++;
        const withField = shown(v);
        const keep = f.sprite, by = f.madeBy;
        f.sprite = null; f.madeBy = 'check'; // the village draw skips it; the renderer has no sprite
        const without = shown(v);
        f.sprite = keep; f.madeBy = by;
        if (without - withField > 0) { hidden++; if (first.length < 3) first.push(`t ${game.clock.time.toFixed(0)} s villager ${v.id} on field ${f.id} at (${(v.x - f.tx).toFixed(2)}, ${(v.y - f.ty).toFixed(2)}): ${without - withField} of ${without} px covered`); }
      }
    }
  }
  console.log(`field depth: ${samples} villager samples on finished fields, ${hidden} covered by the field`);
  ok(samples > 50, `villagers stood on finished fields (${samples} samples)`);
  ok(hidden === 0, `no field covers a villager standing on it (${hidden} of ${samples} samples covered) ${first.join('; ')}`);
} catch (err) { fails.push(`field-depth threw: ${err.stack || err}`); console.log(`FAIL field-depth threw: ${err.stack || err}`); }

console.log(`${pass} passed, ${fails.length} failed`);
if (fails.length) process.exitCode = 1;

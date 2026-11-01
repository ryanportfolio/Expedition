// Engine checks in node, no browser: iso math, height-aware picking, depth order, blit, rng, clock,
// events, world model and spatial query, display size math, camera, input, system stubs, and one
// full render of the test map into the view buffer.
//
//   node scripts/check-engine.mjs
//
// Exit 0 when every check passes; otherwise prints each failing check and exits 1.
import { worldToScreen, screenToWorld, pickTile, compareDepth, depthKey } from '../src/world/iso.js';
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
  input.synth.wheel(-1);
  game.tick(STEP);
  ok(display.scale === 4 && input.pointer.sx === 75, `wheel up -> scale 4, pointer rescaled to 75 (${display.scale}, ${input.pointer.sx})`);
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

console.log(`${pass} passed, ${fails.length} failed`);
if (fails.length) process.exitCode = 1;

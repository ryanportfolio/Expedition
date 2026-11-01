// Engine smoke test: inline 16x16 map, test sprites, one pixelfx campfire, camera pan and zoom,
// view-size, iso round-trip and height-aware picking asserts, screenshots at zoom 1 and zoom 2.
import * as campfire from 'pixelfx/fx/fire/campfire';
import { makeTestMap, makeTestLut, makeTestSprite, debugTerrainPass } from '../test-art.js';
import { worldToScreen, screenToWorld, pickTile } from '../../world/iso.js';

export default async function smoke(t, game) {
  const { world, camera, display, renderer, input, events } = game;
  world.loadMap(makeTestMap());
  renderer.lut = makeTestLut();
  renderer.addTerrainPass(debugTerrainPass);
  const sprite = makeTestSprite();
  const posts = [
    world.spawn('post', { x: 3.5, y: 3.5, sprite }),
    world.spawn('post', { x: 5.5, y: 8.5, sprite, flipX: true }),
    world.spawn('post', { x: 10.5, y: 10.5, sprite }),
    world.spawn('post', { x: 12.5, y: 4.5, sprite }),
  ];
  const fire = { x: 7.5, y: 4.5 };
  fire.z = world.heightAt(fire.x, fire.y);
  const fxHandle = game.fx.spawn(campfire, { ...fire, height: 18 });
  t.assert(game.fx.live.length === 1, 'one live effect after spawn');

  const checkView = (label) => {
    const devW = Math.round(window.innerWidth * window.devicePixelRatio);
    const devH = Math.round(window.innerHeight * window.devicePixelRatio);
    const ew = Math.floor(devW / (3 * display.zoom)), eh = Math.floor(devH / (3 * display.zoom));
    t.assert(display.w === ew && display.h === eh, `${label}: view ${display.w}x${display.h} == floor(${devW}x${devH} / (3*${display.zoom})) = ${ew}x${eh}`);
    const canvas = display.canvas;
    t.assert(canvas.width === ew && canvas.height === eh, `${label}: canvas buffer ${canvas.width}x${canvas.height} == view`);
    const cssW = parseFloat(canvas.style.width) * window.devicePixelRatio;
    t.assert(Math.abs(cssW - ew * display.scale) < 0.01, `${label}: canvas shows ${cssW} device px == view * ${display.scale}`);
    const sw = devW - ew * display.scale, sh = devH - eh * display.scale;
    t.assert(sw >= 0 && sw < display.scale && sh >= 0 && sh < display.scale, `${label}: uncovered strip ${sw}x${sh} device px is under one game pixel (${display.scale})`);
  };

  // ---- zoom 1
  camera.centerOn(8, 7, 2);
  t.step(0.5);
  t.assert(display.scale === 3 && display.zoom === 1, 'starts at zoom 1 (scale 3)');
  checkView('zoom 1');
  t.log('zoom1 view', { w: display.w, h: display.h });

  // ---- sprites sit on their tiles: each post's anchor pixel lands on its projected view pixel, and
  // every opaque sprite pixel shows at its offset from there (mirrored for flipX). Rendered without
  // effects (the campfire glow tints nearby pixels); the effects go back before the screenshot.
  const liveFx = game.fx.live.splice(0);
  renderer.render();
  for (const p of posts) {
    const v = camera.worldToView(p.x, p.y, p.z);
    const dir = p.flipX ? -1 : 1;
    let opaque = 0, wrong = 0;
    for (let r = 0; r < sprite.h; r++) {
      for (let c = 0; c < sprite.w; c++) {
        const k = sprite.data[r * sprite.w + c];
        if (!k) continue;
        opaque++;
        const x = v.sx + dir * (c - sprite.ax), y = v.sy + (r - sprite.ay);
        if (x < 0 || y < 0 || x >= display.w || y >= display.h || renderer.view.data[y * display.w + x] !== renderer.lut[k]) wrong++;
      }
    }
    t.assert(opaque > 0 && wrong === 0, `post ${p.id}${p.flipX ? ' (flipX)' : ''} anchored at view (${v.sx}, ${v.sy}): ${wrong}/${opaque} sprite pixels misplaced`);
  }
  game.fx.live.push(...liveFx);
  await t.shot('zoom1');

  // ---- iso round trip
  for (const [x, y, z] of [[0, 0, 0], [3.25, 7.5, 2], [15.9, 0.1, 6], [8, 8, 15]]) {
    const p = worldToScreen(x, y, z), q = screenToWorld(p.sx, p.sy, z);
    t.assert(Math.abs(q.x - x) < 1e-9 && Math.abs(q.y - y) < 1e-9, `iso round trip (${x}, ${y}, ${z})`);
  }

  // ---- height-aware picking on the test map
  const pick = (x, y, z) => { const p = worldToScreen(x, y, z); return pickTile(p.sx, p.sy, world.heightAt, { w: world.w, h: world.h }); };
  const flat = pick(4.5, 2.5, world.heightAt(4.5, 2.5));
  t.assert(flat && flat.tx === 4 && flat.ty === 2 && Math.abs(flat.z - 2) < 0.05, `flat tile picks itself: ${JSON.stringify(flat)}`);
  const top = pick(10.5, 10.5, 6);
  t.assert(top && top.tx === 10 && top.ty === 10 && Math.abs(top.z - 6) < 0.05, `plateau tile picks itself: ${JSON.stringify(top)}`);
  // tile (7, 7) at height 2 lies behind the height-6 plateau: the front-most hit is plateau tile (9, 9)
  const hid = pick(7.5, 7.5, 2);
  t.assert(hid && hid.tx === 9 && hid.ty === 9 && Math.abs(hid.z - 6) < 0.05, `occluded tile picks the plateau in front: ${JSON.stringify(hid)}`);
  const back = hid && worldToScreen(hid.x, hid.y, hid.z), want = worldToScreen(7.5, 7.5, 2);
  t.assert(back && Math.abs(back.sx - want.sx) < 0.01 && Math.abs(back.sy - want.sy) < 0.01, 'picked point projects back to the picked pixel');
  t.assert(pick(-5, -5, 0) === null, 'pixel off the map picks nothing');

  // sweep ~1000 world pixels over the map: every hit projects back to its pixel, lies on the surface
  // (or on a front map-edge wall, where the ray enters the map below the surface), and nothing on the
  // ray nearer the viewer is solid
  let hits = 0, bad = 0;
  const firstBad = [];
  for (let sy = -60; sy <= 270; sy += 13) {
    for (let sx = -260; sx <= 260; sx += 13) {
      const p = pickTile(sx, sy, world.heightAt, { w: world.w, h: world.h });
      if (!p) continue;
      hits++;
      const back = worldToScreen(p.x, p.y, p.z);
      let why = null;
      if (Math.abs(back.sx - sx) > 1e-6 || Math.abs(back.sy - sy) > 1e-6) why = 'does not project back';
      const ground = world.heightAt(p.x, p.y);
      const wall = p.x > world.w - 1e-3 || p.y > world.h - 1e-3;
      if (!why && (wall ? p.z > ground + 0.02 : Math.abs(ground - p.z) > 0.02)) why = `off the surface (z ${p.z.toFixed(3)}, ground ${ground.toFixed(3)})`;
      for (let z = p.z + 0.05; !why && z <= 16; z += 0.05) {
        const q = screenToWorld(sx, sy, z);
        if (q.x < 0 || q.y < 0 || q.x >= world.w || q.y >= world.h) continue;
        if (world.heightAt(q.x, q.y) > z + 1e-6) why = `solid ground nearer at z ${z.toFixed(2)}`;
      }
      if (why) { bad++; if (firstBad.length < 3) firstBad.push(`(${sx}, ${sy}): ${why}`); }
    }
  }
  t.assert(hits > 400 && bad === 0, `pick sweep: ${hits} hits, ${bad} not front-most or off the surface ${firstBad.join('; ')}`);

  // pointer world position goes through the same pick
  const onTop = t.input.move(10.5, 10.5, { world: true });
  t.step();
  t.assert(Math.floor(input.pointer.x) === 10 && Math.floor(input.pointer.y) === 10 && input.pointer.hit, `pointer at view ${onTop.sx},${onTop.sy} resolves to tile 10,10`);

  // ---- pointer velocity and drag events
  const seen = [];
  const offs = ['drag-start', 'drag-end'].map((type) => events.on(type, () => seen.push(type)));
  t.input.drag([200, 150], [212, 150], { seconds: 0.2 });
  t.assert(seen.join(',') === 'drag-start,drag-end', `drag events fired: ${seen.join(',')}`);
  t.assert(Math.abs(input.pointer.vsx - 60) < 1, `pointer velocity ${input.pointer.vsx.toFixed(1)} px/s ~ 60`);
  offs.forEach((off) => off());

  // ---- zoom about the campfire: wheel up twice -> scale 4 -> scale 6 (zoom 2)
  const before = t.input.move(fire.x, fire.y, { world: true, z: fire.z });
  t.input.wheel(-100);
  t.step();
  t.assert(display.scale === 4, `one wheel step -> scale 4 (got ${display.scale})`);
  t.input.wheel(-100);
  t.step();
  t.assert(display.scale === 6 && display.zoom === 2, `two wheel steps -> scale 6, zoom 2 (got ${display.scale})`);
  checkView('zoom 2');
  const after = camera.worldToView(fire.x, fire.y, fire.z);
  const expect = { sx: before.sx * 3 / 6, sy: before.sy * 3 / 6 };
  t.assert(Math.abs(after.sx - expect.sx) <= 1 && Math.abs(after.sy - expect.sy) <= 1, `zoom keeps the campfire under the pointer: ${JSON.stringify(after)} vs ${JSON.stringify(expect)}`);
  camera.centerOn(fire.x, fire.y + 1, fire.z + 2);
  t.step(0.5);
  await t.shot('zoom2');

  // ---- pan: keys, then middle drag
  const k0 = { x: camera.x, y: camera.y };
  t.input.key('KeyD', 0.2);
  t.assert(camera.x - k0.x > 40, `KeyD pans right (${(camera.x - k0.x).toFixed(1)} px)`);
  t.input.key('ArrowUp', 0.2);
  t.assert(k0.y - camera.y > 40, `ArrowUp pans up (${(k0.y - camera.y).toFixed(1)} px)`);
  const m0 = { x: camera.x, y: camera.y };
  t.input.drag([160, 90], [140, 80], { button: 1, seconds: 0.2 });
  t.assert(Math.abs(camera.x - m0.x - 20) < 0.01 && Math.abs(camera.y - m0.y - 10) < 0.01, `middle drag pans with the pointer (${camera.x - m0.x}, ${camera.y - m0.y})`);
  // edge pan: pointer on the left edge scrolls left; back in the middle, or gone from the window, it stops
  camera.centerOn(8, 8, 2);
  t.step();
  const e0 = camera.x;
  t.input.move(0, Math.floor(display.h / 2));
  t.step(0.2);
  t.assert(camera.x < e0 - 30, `pointer on the left edge pans left (${e0.toFixed(1)} -> ${camera.x.toFixed(1)})`);
  t.input.move(Math.floor(display.w / 2), Math.floor(display.h / 2));
  const e1 = camera.x;
  t.step(0.2);
  t.assert(camera.x === e1, 'no edge pan with the pointer mid-view');
  t.input.move(display.w - 1, Math.floor(display.h / 2));
  t.input.leave();
  const e2 = camera.x;
  t.step(0.2);
  t.assert(camera.x === e2, 'no edge pan once the pointer leaves the window');

  const b = camera.bounds();
  for (let i = 0; i < 30; i++) t.input.key('KeyA', 0.2);
  t.assert(Math.abs(camera.x - b.minX) < 0.01, `camera clamps at the west bound (${camera.x} vs ${b.minX})`);

  // ---- back to zoom 1 so the run ends at the reference view size
  t.input.move(display.w / 2, display.h / 2);
  t.input.wheel(100);
  t.step();
  t.input.wheel(100);
  t.step();
  t.assert(display.scale === 3, `wheel down twice returns to scale 3 (got ${display.scale})`);
  checkView('zoom 1 again');
  // the last zoom step out: scale 2, then the wheel stops there
  t.input.wheel(100);
  t.step();
  t.assert(display.scale === 2, `wheel down once more -> scale 2 (got ${display.scale})`);
  checkView('scale 2');
  t.input.wheel(100);
  t.step();
  t.assert(display.scale === 2, `zoom stops at scale 2 (got ${display.scale})`);
  t.input.wheel(-100);
  t.step();
  t.assert(display.scale === 3, `wheel up returns to scale 3 (got ${display.scale})`);
  checkView('zoom 1 final');
  t.assert(posts.every((p) => world.get(p.id) === p) && fxHandle.fx.t > 1, 'entities alive, effect ticked on sim steps');
}

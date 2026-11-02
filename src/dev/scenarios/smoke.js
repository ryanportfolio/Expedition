// Engine smoke test: inline 16x16 map, test sprites, one pixelfx campfire, camera pan and zoom,
// view-size, iso round-trip and picking-against-what-is-drawn asserts, a page-level edge pan,
// screenshots at zoom 1 and zoom 2.
import * as campfire from 'pixelfx/fx/fire/campfire';
import { makeTestMap, makeTestLut, makeTestSprite, debugTerrainPass } from '../test-art.js';
import { worldToScreen, screenToWorld } from '../../world/iso.js';
import { buildTerrainCache } from '../../terrain/cache.js';

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

  // ---- picking against what is drawn. The terrain cache (src/terrain/cache.js, what the game's
  // terrain pass draws) records which tile drew each pixel of this map: a top diamond at the tile's
  // drawn height (water flat at sea level), or a side face. The pointer pick (input.toWorld, the
  // path of every mouse move) must name that tile, as Math.floor of the picked x, y (what the build
  // ghost and the hand read). Before round 42 these asserts and the sweep checked the pick only
  // against world.heightAt, which blends tile centers into a slope the terrain never draws, so they
  // passed while 13% of the top pixels in view picked another tile (7,968 of 59,524 at 1366 x 768). (The debug pass behind
  // this scenario's screenshots draws water at its sea-bed height, 8 px under the cache's.)
  const own = buildTerrainCache(world, { owner: true });
  const cam = { x: Math.round(camera.x), y: Math.round(camera.y) };
  const drawnBy = (wx, wy) => {
    const o = own.owner[(wy - own.oy) * own.w + (wx - own.ox)];
    return o ? { tx: ((o >> 2) - 1) % world.w, ty: Math.floor(((o >> 2) - 1) / world.w), part: ['', 'top', 'left face', 'right face'][o & 3] } : null;
  };
  const pickPx = (wx, wy) => input.toWorld(wx - cam.x, wy - cam.y);
  const pickAt = (x, y, z) => { const p = worldToScreen(x, y, z); return pickPx(Math.floor(p.sx), Math.floor(p.sy)); };
  const flat = pickAt(4.5, 2.5, 2);
  t.assert(flat && Math.floor(flat.x) === 4 && Math.floor(flat.y) === 2 && Math.abs(flat.z - 2) < 1e-9, `flat tile picks itself: ${JSON.stringify(flat)}`);
  const top = pickAt(10.5, 10.5, 6);
  t.assert(top && Math.floor(top.x) === 10 && Math.floor(top.y) === 10 && Math.abs(top.z - 6) < 1e-9, `plateau tile picks itself: ${JSON.stringify(top)}`);
  // tile (7, 7) at height 2 lies behind the height-6 plateau: its center pixel shows plateau tile (9, 9)
  const hidPx = worldToScreen(7.5, 7.5, 2), hid = pickAt(7.5, 7.5, 2), hidDrawn = drawnBy(hidPx.sx, hidPx.sy);
  t.assert(hidDrawn && hidDrawn.tx === 9 && hidDrawn.ty === 9 && hid && Math.floor(hid.x) === 9 && Math.floor(hid.y) === 9 && Math.abs(hid.z - 6) < 1e-9, `occluded tile picks the plateau drawn in front: ${JSON.stringify(hid)}, drawn ${JSON.stringify(hidDrawn)}`);
  const back = hid && worldToScreen(hid.x, hid.y, hid.z);
  t.assert(back && Math.abs(back.sx - (hidPx.sx + 0.5)) < 0.01 && Math.abs(back.sy - (hidPx.sy + 0.5)) < 0.01, 'picked point projects back to the center of the picked pixel');
  const off = worldToScreen(-5, -5, 0);
  t.assert(pickPx(off.sx, off.sy) === null, 'pixel off the map picks nothing');

  // sweep every world pixel of the cache that is in view: a drawn pixel picks the tile that drew it
  // (top or side face), an empty one (background, under the map's front edge) picks nothing
  const tally = { top: [0, 0], 'left face': [0, 0], 'right face': [0, 0], empty: [0, 0] };
  const firstBad = [];
  for (let wy = own.oy; wy < own.oy + own.h; wy++) {
    for (let wx = own.ox; wx < own.ox + own.w; wx++) {
      const vx = wx - cam.x, vy = wy - cam.y;
      if (vx < 0 || vy < 0 || vx >= display.w || vy >= display.h) continue;
      const d = drawnBy(wx, wy), p = pickPx(wx, wy), row = tally[d ? d.part : 'empty'];
      row[0]++;
      const wrong = d ? !p || Math.floor(p.x) !== d.tx || Math.floor(p.y) !== d.ty : !!p;
      if (wrong) { row[1]++; if (firstBad.length < 3) firstBad.push(`(${wx}, ${wy}) drawn ${d ? `${d.tx},${d.ty} ${d.part}` : 'nothing'}, picked ${p ? `${p.x.toFixed(3)},${p.y.toFixed(3)} z ${p.z.toFixed(3)}` : 'nothing'}`); }
    }
  }
  t.log('pick sweep', tally);
  t.assert(tally.top[0] > 10000 && tally['left face'][0] > 500 && tally['right face'][0] > 500, `pick sweep covers the map's tops and both face kinds (${JSON.stringify(tally)})`);
  const wrongAll = Object.values(tally).reduce((n, r) => n + r[1], 0);
  t.assert(wrongAll === 0, `pick sweep: every pixel picks what is drawn there; wrong ${JSON.stringify(Object.fromEntries(Object.entries(tally).map(([k, r]) => [k, `${r[1]} of ${r[0]}`])))} ${firstBad.join('; ')}`);

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
  // the same through the page: a pointermove at the window's last column, sent to the element there.
  // When the window width is not a multiple of the scale (1366 or 2560 wide, any width at scale 4 or
  // 6) that is the body beside the canvas, and before round 42 the pointer counted as gone.
  camera.centerOn(8, 8, 2);
  t.step();
  const ex = innerWidth - 1, ey = Math.floor(innerHeight / 2);
  const under = document.elementFromPoint(ex, ey) ?? document.body;
  under.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: ex, clientY: ey, pointerId: 1, buttons: 0 }));
  const e3 = camera.x;
  t.step(0.2);
  t.assert(camera.x > e3 + 30 && input.pointer.sx === display.w - 1, `a page pointermove at x = ${ex} (on the ${under.tagName.toLowerCase()}, canvas ${display.w * display.scale} px wide) pans right (${e3.toFixed(1)} -> ${camera.x.toFixed(1)}, pointer sx ${input.pointer.sx} of ${display.w})`);
  t.input.move(Math.floor(display.w / 2), Math.floor(display.h / 2));

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

// Creature art scenario: the real island on the engine's debug terrain pass, the village set up
// for scale (houses and villagers from the village painters), and the slate giant (gaunt and stooped, built of heavy chipped
// boulder slabs) standing beside them. Screenshots: idle se at lean 0 with the alignment-0 LUT and again at scale 6
// (idle-close: the hood hollow is pure shadow, no eyes, no mouth), the walk cycle as a strip, every
// pose once (two strips), key action frames, the four facings, a standing ('feet') and a sleeping
// ('seat') creature side by side, and idle at lean +1 / -1 with the good / evil LUTs. Every strip
// stands on ground cleared of houses, villagers, trees and rocks, and asserts nothing covers it. Asserts the painter's contract: 13 poses, frame counts, sizes, anchors per
// ground contact ('feet' or 'seat', exported on every sprite as `contact`), mirrors, lean.
import { buildIsland } from '../../world/island.js';
import { debugTerrainPass } from '../test-art.js';
import { makeLut } from '../../art/lut.js';
import { getSprite, placeholderSprite } from '../../art/registry.js';
import { CREATURE_FRAMES, CREATURE_CONTACT } from '../../art/painters/creature.js';
import { worldToScreen } from '../../world/iso.js';

export default async function creatureArt(t, game) {
  const { world, renderer, camera } = game;
  world.loadMap(buildIsland());
  renderer.lut = makeLut(0);
  renderer.addTerrainPass(debugTerrainPass);
  game.systems.village.setup();
  const site = world.sites.village;
  const sea = world.seaLevel ?? 1;

  // A free land spot by the village: above sea level, no building or villager within 2 tiles,
  // and none in the tiles behind it (screen-up, smaller x + y) that the giant's ~75 px body
  // covers on screen, so its silhouette reads against open ground rather than a roof.
  // Nothing may stand in front of it either (screen-down, larger x + y).
  // The strips below stand up to max(7, walk frames) creatures 1.5 tiles apart, centred on the spot
  // along +x / -y, so every strip position (every 0.75 tile, which also covers the two
  // contact-shot positions at +-0.75) must be clear the same way; otherwise houses cover poses.
  const free = (x, y, r) => world.query({ x, y, r }).every((e) => !['building', 'villager', 'orb', 'tree', 'rock'].includes(e.kind));
  const clearOne = (x, y) => world.heightAt(x, y) > sea + 0.2
    && [-4.5, -3, -1.5, 0, 1.5].every((k) => free(x + k, y + k, 2));
  const half = 0.75 * (Math.max(7, CREATURE_FRAMES.walk) - 1);
  const ROW = Array.from({ length: Math.round(half / 0.75) * 2 + 1 }, (_, i) => -half + 0.75 * i);
  const clear = (x, y) => ROW.every((j) => clearOne(x + j, y - j));
  let spot = null;
  for (let r = 3; r <= 24 && !spot; r++)
    for (let dy = -r; dy <= r && !spot; dy++)
      for (let dx = -r; dx <= r && !spot; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = site.x + dx + 0.5, y = site.y + dy + 0.5;
        if (clear(x, y)) spot = { x, y };
      }
  t.assert(spot, `found a free spot by the village (${JSON.stringify(spot)})`);
  const houses = world.query({ kind: 'building' }).filter((b) => b.owner === 'player').length;
  const villagers = world.query({ kind: 'villager' }).filter((v) => v.owner === 'player').length;
  t.log('village for scale', { houses, villagers, spot });
  t.assert(houses >= 1 && villagers >= 3, `player buildings (${houses}) and villagers (${villagers}) placed for scale`);

  const spawned = [];
  const place = (opts, x, y, lut) => {
    const e = world.spawn('creature', { x, y, z: world.heightAt(x, y), sprite: getSprite('creature', opts), lut });
    spawned.push(e);
    return e;
  };
  const clearAll = () => { for (const e of spawned.splice(0)) world.remove(e.id); };
  const show = (x, y) => { camera.centerOn(x, y - 1.2, world.heightAt(x, y)); t.step(1 / 30); };

  // The blit check: every opaque pixel of the creature's sprite must land on the view at its
  // offset from the projected anchor in the LUT's color, except where a nearer item covers it.
  const landed = (e) => {
    const s = e.sprite, q = worldToScreen(e.x, e.y, e.z), buf = renderer.view.data, w = renderer.view.w;
    let hit = 0, total = 0;
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const v = s.data[y * s.w + x];
      if (!v) continue;
      // Same rounding as the draw list: anchor = round(world px - rounded camera).
      const vx = Math.round(q.sx - Math.round(camera.x)) + x - s.ax, vy = Math.round(q.sy - Math.round(camera.y)) + y - s.ay;
      if (vx < 0 || vy < 0 || vx >= w || vy >= renderer.view.h) continue;
      total++;
      if (buf[vy * w + vx] === e.lut[v]) hit++;
    }
    return { hit, total };
  };

  // Every pose and frame paints a real sprite (not the placeholder) of a sane size.
  let bad = [];
  for (const [pose, n] of Object.entries(CREATURE_FRAMES))
    for (let frame = 0; frame < n; frame++)
      for (const facing of ['se', 'sw', 'ne', 'nw']) {
        const s = getSprite('creature', { pose, frame, facing, lean: 0 });
        if (s === placeholderSprite() || s.h < 30 || s.h > 100) bad.push(`${pose}/${frame}/${facing}`);
      }
  t.assert(bad.length === 0, `every pose x frame x facing paints (${bad.join(', ') || 'all ok'})`);
  const SPEC_POSES = ['idle', 'walk', 'eat', 'throw', 'smash', 'haul', 'water', 'play', 'sleep', 'poop', 'weak', 'happy', 'hurt'];
  const poseNames = Object.keys(CREATURE_FRAMES);
  t.assert(poseNames.length === SPEC_POSES.length && SPEC_POSES.every((p) => CREATURE_FRAMES[p] >= 1),
    `CREATURE_FRAMES covers the 13 spec poses (${poseNames.join(', ')})`);
  t.assert(CREATURE_FRAMES.walk >= 6 && CREATURE_FRAMES.idle >= 2, 'walk has >= 6 frames, idle >= 2');
  const standing = getSprite('creature', { pose: 'idle', frame: 0, facing: 'se', lean: 0 });
  t.assert(standing.ay + 1 >= 74 && standing.ay + 1 <= 80, `standing creature is 74-80 px tall (${standing.ay + 1} px)`);
  // Every sprite says how it touches the ground; seated poses anchor at the seat.
  const contactBad = [];
  for (const [pose, n] of Object.entries(CREATURE_FRAMES))
    for (let frame = 0; frame < n; frame++) {
      const s = getSprite('creature', { pose, frame, facing: 'se', lean: 0 });
      if (s.contact !== CREATURE_CONTACT[pose] || !['feet', 'seat'].includes(s.contact)) contactBad.push(`${pose}/${frame}: ${s.contact}`);
    }
  t.assert(contactBad.length === 0, `contact metadata on every frame (${contactBad.join(', ') || 'all ok'}; sleep = seat)`);
  // The anchor sits on the ground contact: the lowest opaque row of every frame is the anchor row (+-1).
  const lowest = (s) => { for (let y = s.h - 1; y >= 0; y--) for (let x = 0; x < s.w; x++) if (s.data[y * s.w + x]) return y; return -1; };
  const offFeet = [];
  for (const [pose, n] of Object.entries(CREATURE_FRAMES))
    for (let frame = 0; frame < n; frame++) {
      const s = getSprite('creature', { pose, frame, facing: 'se', lean: 0 });
      if (Math.abs(lowest(s) - s.ay) > 1) offFeet.push(`${pose}/${frame}: anchor ${s.ay}, lowest ${lowest(s)}`);
    }
  t.assert(offFeet.length === 0, `anchor on the feet row in every frame (${offFeet.join('; ') || 'all ok'})`);
  // sw / nw are exact mirrors of se / ne, anchor included.
  const notMirrored = [];
  for (const [a, b] of [['se', 'sw'], ['ne', 'nw']])
    for (const pose of ['idle', 'walk', 'throw', 'haul']) {
      const p = getSprite('creature', { pose, frame: 1, facing: a, lean: 0 }), m = getSprite('creature', { pose, frame: 1, facing: b, lean: 0 });
      let same = p.w === m.w && p.h === m.h && m.ax === p.w - 1 - p.ax && m.ay === p.ay;
      for (let y = 0; same && y < p.h; y++) for (let x = 0; x < p.w; x++) if (p.data[y * p.w + x] !== m.data[y * p.w + p.w - 1 - x]) { same = false; break; }
      if (!same) notMirrored.push(`${pose} ${a}/${b}`);
    }
  t.assert(notMirrored.length === 0, `sw / nw mirror se / ne (${notMirrored.join(', ') || 'all ok'})`);
  t.assert(getSprite('dung') !== placeholderSprite(), 'dung item paints');

  // 1. Idle, se, lean 0, alignment-0 LUT, beside the village.
  const idle = place({ pose: 'idle', frame: 0, facing: 'se', lean: 0 }, spot.x, spot.y, makeLut(0));
  const dung = world.spawn('dung', { x: spot.x + 1.2, y: spot.y + 0.6, sprite: getSprite('dung'), lut: makeLut(0) });
  spawned.push(dung);
  show(spot.x, spot.y);
  const l0 = landed(idle);
  t.assert(l0.total > 300 && l0.hit / l0.total > 0.9, `idle creature drawn at its anchor (${l0.hit}/${l0.total} pixels match)`);
  await t.shot('idle-se-lean0');

  // 1b. The same at the largest zoom (scale 6), to check the hood up close: the face hollow is
  // pure shadow (no eyes, no mouth); ember only in the chest and joint seams.
  const startScale = game.display.scale;
  while (game.display.scale < 6 && camera.zoomStep(1)) t.step(1 / 30);
  t.assert(game.display.scale === 6, `zoomed in to scale 6 (${game.display.scale})`);
  camera.centerOn(spot.x, spot.y - 1.2, world.heightAt(spot.x, spot.y) + 1);
  t.step(1 / 30);
  const lc = landed(idle);
  t.assert(lc.total > 300 && lc.hit / lc.total > 0.9, `close-up creature drawn at its anchor (${lc.hit}/${lc.total})`);
  await t.shot('idle-close');
  while (game.display.scale > startScale && camera.zoomStep(-1)) t.step(1 / 30);
  t.assert(game.display.scale === startScale, `zoomed back out to scale ${startScale} (${game.display.scale})`);
  clearAll();

  // A row of creatures, 1.5 tiles apart along +x / -y (48 view px, same depth), centred on the
  // free spot (the spot search cleared every position a row of up to seven uses).
  const row = (list, lut) => {
    const x0 = spot.x - 0.75 * (list.length - 1), y0 = spot.y + 0.75 * (list.length - 1);
    const es = list.map((opts, i) => place(opts, x0 + 1.5 * i, y0 - 1.5 * i, lut));
    show(spot.x, spot.y);
    // Nothing covers any creature in the strip: each lands >= 90% of its pixels.
    const worst = es.map(landed).map((l, i) => ({ i, r: l.total ? l.hit / l.total : 0 })).sort((a, b) => a.r - b.r)[0];
    t.assert(worst.r > 0.9, `strip of ${list.length} unobstructed (worst: creature ${worst.i} at ${(worst.r * 100).toFixed(0)}%)`);
  };

  // 2. Walk cycle strip.
  row(Array.from({ length: CREATURE_FRAMES.walk }, (_, frame) => ({ pose: 'walk', frame, facing: 'se', lean: 0 })), makeLut(0));
  t.assert(new Set(spawned.map((e) => e.sprite)).size === CREATURE_FRAMES.walk, 'walk frames are distinct sprites');
  await t.shot('walk-strip');
  clearAll();

  // 3. Every pose once (first frame of each, then a key frame where the action shows best).
  const poses = Object.keys(CREATURE_FRAMES);
  const key = { eat: 3, throw: 3, smash: 3, play: 3, hurt: 0 };
  row(poses.slice(0, 7).map((pose) => ({ pose, frame: 0, facing: 'se', lean: 0 })), makeLut(0));
  await t.shot('poses-a');
  clearAll();
  row(poses.slice(7).map((pose) => ({ pose, frame: 0, facing: 'se', lean: 0 })), makeLut(0));
  await t.shot('poses-b');
  clearAll();
  row(Object.entries(key).map(([pose, frame]) => ({ pose, frame, facing: 'se', lean: 0 })), makeLut(0));
  await t.shot('poses-key-frames');
  clearAll();

  // 4. The four facings.
  row(['se', 'sw', 'ne', 'nw'].map((facing) => ({ pose: 'walk', frame: 1, facing, lean: 0 })), makeLut(0));
  await t.shot('facings');
  clearAll();

  // 4b. Ground contact side by side: a standing creature (contact 'feet', anchored between the
  // feet) and a sleeping one (contact 'seat', anchored at the pelvis) on neighbouring ground
  // points. Both anchors must land on their ground point: the seated one neither floats nor sinks.
  const st = place({ pose: 'idle', frame: 0, facing: 'se', lean: 0 }, spot.x - 0.75, spot.y + 0.75, makeLut(0));
  const sl = place({ pose: 'sleep', frame: 0, facing: 'se', lean: 0 }, spot.x + 0.75, spot.y - 0.75, makeLut(0));
  show(spot.x, spot.y);
  const lt = landed(st), ls = landed(sl);
  t.assert(st.sprite.contact === 'feet' && sl.sprite.contact === 'seat', `contact fields: standing ${st.sprite.contact}, sleeping ${sl.sprite.contact}`);
  t.assert(lt.total > 300 && lt.hit / lt.total > 0.9 && ls.total > 150 && ls.hit / ls.total > 0.9,
    `standing and seated creatures drawn at their anchors, unobstructed (${lt.hit}/${lt.total}, ${ls.hit}/${ls.total})`);
  await t.shot('contact-feet-seat');
  clearAll();

  // 5. Lean +1 with the good LUT, lean -1 with the evil LUT (the whole scene shifts with it).
  for (const lean of [1, -1]) {
    renderer.lut = makeLut(lean);
    const e = place({ pose: 'idle', frame: 0, facing: 'se', lean }, spot.x, spot.y, makeLut(lean));
    show(spot.x, spot.y);
    const l = landed(e);
    t.assert(l.hit / l.total > 0.9, `lean ${lean} creature drawn with its LUT (${l.hit}/${l.total})`);
    await t.shot(lean > 0 ? 'idle-lean-plus1' : 'idle-lean-minus1');
    clearAll();
  }
  const good = getSprite('creature', { pose: 'idle', frame: 0, facing: 'se', lean: 1 });
  const evil = getSprite('creature', { pose: 'idle', frame: 0, facing: 'se', lean: -1 });
  t.assert(good !== standing && evil !== standing && good.data.some((v, i) => v !== evil.data[i]), 'lean changes shape details');
  renderer.lut = makeLut(0);
}

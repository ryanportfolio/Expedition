// Hand art scenario: the painted hand poses, ground shadows and miracle orbs in the real game at zoom 1.
// The island with the engine's debug terrain pass, a few figures for scale, a rock and a stand-in
// creature near the player village. The hand system draws its real poses, driven only through
// game.input.synth: hover (open), grab, carry a rock with its shadow (hold), stroke, slap and point at
// the creature; then the open hand under the evil and good LUTs, and the four orbs the miracles system
// sets on the temple pedestals. Asserts that every hand, shadow and orb name is served by the painter
// modules in src/art/painters/ (not the hand's placeholder art or the registry's checker); that at
// every shot the painted pose's pixels are in the view buffer at the hand's anchor (so the screenshot
// shows that pose, under each LUT); and that while carrying, the rock hangs under the grip point with
// the fingertips just inside its top and its shadow drawn on the terrain below it.
// Screenshots: pose-open, pose-grab, pose-hold, pose-stroke, pose-slap, pose-point, lut-evil,
// lut-good, orbs.
import { buildIsland } from '../../world/island.js';
import { debugTerrainPass } from '../test-art.js';
import { makeLut } from '../../art/lut.js';
import { idx } from '../../art/palette.js';
import { getSprite, listSprites, placeholderSprite } from '../../art/registry.js';
import { createSprite, ellipse, rect, outline, sphereShade } from '../../art/sprite.js';
import { PLACEHOLDERS } from '../../hand/placeholder-art.js';
import { shadowFor } from '../../hand/draw.js';
import * as handArt from '../../art/painters/hand.js';
import * as shadowArt from '../../art/painters/shadows.js';
import * as orbArt from '../../art/painters/orbs.js';

const POSES = ['hand-open', 'hand-grab', 'hand-hold', 'hand-point', 'hand-stroke', 'hand-slap'];
const SHADOWS = ['shadow-s', 'shadow-m', 'shadow-l'];
const MIRACLES = ['rain', 'fire', 'heal', 'lightning'];
const named = (name, opts, fallback, fallbackOpts) => (listSprites().includes(name) ? getSprite(name, opts) : getSprite(fallback, fallbackOpts));
const same = (a, b) => a.w === b.w && a.h === b.h && a.ax === b.ax && a.ay === b.ay && a.data.every((v, i) => v === b.data[i]);

/** Stand-in creature for stroke and slap: a tall slate figure, about 60 px. */
function creatureStandIn() {
  const s = createSprite(24, 60, 12, 59);
  const slate = idx('rock', 3);
  rect(s, 8, 14, 8, 22, slate);
  ellipse(s, 12, 8, 4, 5, slate);
  rect(s, 4, 16, 3, 20, slate);
  rect(s, 17, 16, 3, 20, slate);
  rect(s, 8, 36, 3, 24, slate);
  rect(s, 13, 36, 3, 24, slate);
  sphereShade(s, 'rock', { lo: 1, hi: 6 });
  return outline(s, idx('ink', 0));
}

export default async function handArtScenario(t, game) {
  const { world, camera, renderer, input } = game;
  const s = input.synth, p = input.pointer, handSys = game.systems.hand;

  // ---- the names come from the painters, not from the placeholders
  const have = new Set(listSprites());
  for (const [mod, names] of [[handArt, POSES], [shadowArt, SHADOWS]]) {
    for (const n of names) {
      const painted = mod.sprites[n]?.({});
      t.assert(have.has(n) && painted && same(getSprite(n), painted), `${n}: registered sprite is the painter module's`);
      t.assert(painted && !same(painted, PLACEHOLDERS[n]()) && getSprite(n) !== placeholderSprite(), `${n}: not the hand placeholder or the checker`);
    }
  }
  for (const m of MIRACLES) {
    const painted = orbArt.sprites.orb?.({ miracle: m });
    t.assert(have.has('orb') && painted && same(getSprite('orb', { miracle: m }), painted) && getSprite('orb', { miracle: m }) !== placeholderSprite(),
      `orb ${m}: registered sprite is the painter module's`);
  }
  for (const n of POSES) {
    const hs = getSprite(n);
    t.assert(hs.w >= 18 && hs.w <= 34 && hs.h >= 20 && hs.h <= 34, `${n} is ${hs.w}x${hs.h} px`);
  }

  // ---- scene
  world.loadMap(buildIsland());
  renderer.lut = makeLut(0);
  renderer.addTerrainPass(debugTerrainPass);
  t.assert(game.display.zoom === 1, `zoom 1 (got ${game.display.zoom})`);
  const site = world.sites.village;
  camera.centerOn(site.x + 4, site.y + 1, world.heightAt(site.x, site.y));
  const fig = named('villager', { pose: 'idle' }, 'test-figure');
  const sp = (kind, x, y, extra) => world.spawn(kind, { x, y, z: world.heightAt(x, y), ...extra });
  sp('villager', 26.5, 39.5, { hp: 1, sprite: fig });
  sp('villager', 23.5, 42.5, { hp: 1, sprite: fig });
  const rock = sp('rock', 24.5, 39.5, { sprite: named('rock', { size: 2 }, 'test-sphere', { ramp: 'rock', r: 3 }) });
  const creature = sp('creature', 25.5, 43.5, { sprite: creatureStandIn() });
  t.step(0.2);

  const tick = () => t.step(game.clock.step);
  const ground = (x, y) => camera.worldToView(x, y, world.heightAt(x, y));
  const middle = (e) => {
    const v = camera.worldToView(e.x, e.y, e.z);
    return { sx: v.sx, sy: v.sy - Math.floor((e.sprite?.ay ?? 8) / 2) };
  };
  const moveTo = (q) => { s.move(q.sx, q.sy); tick(); };
  // the open and carry poses hang over grass (ground type 3 on the island map), off the village square
  const OPEN = [27.5, 42.5], CARRY = [28.5, 43.5];
  const grass = ([x, y]) => world.ground[Math.floor(y) * world.w + Math.floor(x)] === 3;
  t.assert(grass(OPEN) && grass(CARRY), 'hover and carry spots are grass');
  /** Share of `sprite`'s opaque pixels found in the view buffer, drawn at view (vx, vy) under the LUT. */
  const inView = (sprite, vx, vy) => {
    const { data: buf, w: bw, h: bh } = renderer.view, lut = renderer.lut;
    let n = 0, hit = 0;
    for (let r = 0; r < sprite.h; r++) for (let c = 0; c < sprite.w; c++) {
      const v = sprite.data[r * sprite.w + c];
      const x = vx - sprite.ax + c, y = vy - sprite.ay + r;
      if (!v || x < 0 || y < 0 || x >= bw || y >= bh) continue;
      n++;
      if (buf[y * bw + x] === lut[v]) hit++;
    }
    return n ? hit / n : 0;
  };
  const pose = async (want, shot) => {
    const hand = handSys.state;
    t.assert(hand.pose === want, `${shot}: hand pose ${hand.pose} (want ${want})`);
    renderer.render();
    const hv = camera.worldToView(hand.x, hand.y, hand.z), share = inView(getSprite(hand.pose), hv.sx, hv.sy);
    t.assert(share > 0.97, `${shot}: painted ${hand.pose} pixels in the view at the anchor (${(share * 100).toFixed(1)}%)`);
    await t.shot(shot);
  };

  // hover over empty grass
  moveTo(ground(...OPEN));
  t.step(0.2);
  await pose('hand-open', 'pose-open');

  // press on the rock: grab pose for a moment
  moveTo(middle(rock));
  s.down(0);
  await pose('hand-grab', 'pose-grab');

  // carry it over the grass: hold pose, rock shadow on the ground
  moveTo(ground(...CARRY));
  t.step(0.5);
  t.assert(handSys.state.heldId === rock.id, 'the rock is in the hand');
  {
    // grip: the rock hangs under the grip point, fingertips just inside its top (HAND.gripGap < 0)
    const hv = camera.worldToView(handSys.state.x, handSys.state.y, handSys.state.z);
    const rv = camera.worldToView(rock.x, rock.y, rock.z), top = rv.sy - rock.sprite.ay;
    t.assert(Math.abs(hv.sx - rv.sx) <= 1, `held rock hangs under the grip point (dx ${hv.sx - rv.sx})`);
    t.assert(hv.sy > top && hv.sy <= Math.min(top + 6, rv.sy), `fingertips just inside the rock top (grip y ${hv.sy}, rock top ${top}, foot ${rv.sy})`);
    // shadow: drawn on the terrain under the rock (same placement as src/hand/draw.js shadowItem)
    renderer.render();
    const sh = getSprite(shadowFor(rock, rock.z - world.heightAt(rock.x, rock.y)));
    const gv = camera.worldToView(rock.x, rock.y, world.heightAt(rock.x, rock.y) - 0.01);
    const share = inView(sh, gv.sx, gv.sy);
    t.assert(share > 0.6, `carry shadow drawn on the terrain under the rock (${(share * 100).toFixed(0)}% of its pixels)`);
  }
  await pose('hand-hold', 'pose-hold');
  s.up(0);
  t.step(1);

  // rub back and forth over the creature: stroke pose
  moveTo(middle(creature));
  s.down(0);
  tick();
  for (const d of [1, -1, 1, -1]) for (let i = 0; i < 3; i++) { s.move(p.sx + 4 * d, p.sy); tick(); }
  await pose('hand-stroke', 'pose-stroke');
  s.up(0);
  t.step(0.6);

  // right click on the creature: slap pose
  moveTo(middle(creature));
  s.down(2); s.up(2);
  await pose('hand-slap', 'pose-slap');
  t.step(0.6);

  // click the creature, then aim at the ground: point pose
  moveTo(middle(creature));
  s.down(0); s.up(0);
  tick();
  moveTo(ground(23.5, 44.5));
  await pose('hand-point', 'pose-point');
  t.input.key('Escape');
  tick();

  // the open hand under the evil and good palettes
  moveTo(ground(...OPEN));
  t.step(0.2);
  renderer.lut = makeLut(-1);
  await pose('hand-open', 'lut-evil');
  renderer.lut = makeLut(1);
  await pose('hand-open', 'lut-good');
  renderer.lut = makeLut(0);

  // the four orbs on the temple pedestals (set up by the miracles system)
  const temple = world.sites.temple;
  camera.centerOn(temple.x + 0.5, temple.y + 0.5, world.heightAt(temple.x, temple.y) + 2);
  t.step(0.5);
  const peds = game.systems.miracles.orbs.pedestals;
  t.assert(peds.length === 4, `four pedestals (got ${peds.length})`);
  for (const ped of peds) {
    const o = world.get(ped.orbId);
    t.assert(o && o.sprite === getSprite('orb', { miracle: ped.miracle }) && o.sprite !== placeholderSprite(), `${ped.miracle} orb on its pedestal wears the painted orb`);
  }
  moveTo(ground(temple.x + 2.5, temple.y + 2));
  t.step(0.2);
  await t.shot('orbs');
  t.log('poses', POSES.map((n) => `${n} ${getSprite(n).w}x${getSprite(n).h}`).join(', '));
}

// Hand art scenario: the hand poses (baked from concept 12 by scripts/bake-hand.mjs into
// src/art/painters/hand-data.js), ground shadows and miracle orbs in the real game at zoom 1.
// The island with the engine's debug terrain pass, a few figures for scale, a rock and a stand-in
// creature near the player village. The hand system draws its real poses, driven only through
// game.input.synth: hover (open), grab, carry a rock with its shadow (hold), stroke, slap and point at
// the creature; then the open hand under the evil and good LUTs, and the four orbs the miracles system
// sets on the temple pedestals. Asserts that every hand, shadow and orb name is served by the painter
// modules in src/art/painters/ (not the hand's placeholder art or the registry's checker); that at
// every shot the painted pose's pixels are in the view buffer at the hand's anchor (so the screenshot
// shows that pose, under each LUT); and that while carrying, the rock hangs under the grip point with
// the fingertips just inside its top and its shadow drawn on the terrain below it. The hand is drawn
// with handLut() (src/hand/draw.js): icy at neutral and good, crimson-ash only when leaning evil;
// a probe checks that mapping at alignment +1, 0, -0.5 and -1. The hand body (palm, thumb, fingers,
// forearm; not the halo, motes, sparkles, hearts or impact lines) must be 44-56 px along its longest
// side, and each pose's grip point must sit on the hand (within 1 px of a hand-glow pixel, 2 px for
// the hold's thumb-index pinch). After the rock, the hand pinches a villager and holds it over open
// water. Every pose shot
// also carries a 3x inset of the hand, copied from the finished frame into the screen corner away
// from it, so one screenshot shows the pose at native size and at 3x in its in-game colours.
// Then all six poses side by side at hover height, over grass and over open water, at the game's
// zoom (3 device px per game pixel) and at the closest zoom (6), with the neutral LUT a new game has,
// and once more over grass at full evil (alignment -1).
// Screenshots: pose-open, pose-grab, pose-hold, pose-hold-villager-water, pose-stroke, pose-slap,
// pose-point, lut-evil, lut-good, board-grass, board-grass-close, board-water, board-water-close,
// board-grass-evil, board-grass-evil-close, orbs.
import { buildIsland, SCALE } from '../../world/island.js';
import { debugTerrainPass } from '../test-art.js';
import { makeLut, rgbaOf } from '../../art/lut.js';
import { idx } from '../../art/palette.js';
import { getSprite, listSprites, placeholderSprite } from '../../art/registry.js';
import { createSprite, ellipse, rect, outline, sphereShade } from '../../art/sprite.js';
import { PLACEHOLDERS } from '../../hand/placeholder-art.js';
import { shadowFor, handLut } from '../../hand/draw.js';
import { HAND } from '../../hand/tunables.js';
import * as handArt from '../../art/painters/hand.js';
import * as shadowArt from '../../art/painters/shadows.js';
import * as orbArt from '../../art/painters/orbs.js';

// Spots below are written round the player village's 64 x 64 centre (20, 40); the island is drawn
// SCALE times larger now (src/world/island.js), which moves the village to (20, 40) x SCALE.
const OX = 20 * (SCALE - 1), OY = 40 * (SCALE - 1);

const POSES = ['hand-open', 'hand-grab', 'hand-hold', 'hand-point', 'hand-stroke', 'hand-slap'];
const SHADOWS = ['shadow-s', 'shadow-m', 'shadow-l'];
const MIRACLES = ['rain', 'fire', 'heal', 'lightning'];
const named = (name, opts, fallback, fallbackOpts) => (listSprites().includes(name) ? getSprite(name, opts) : getSprite(fallback, fallbackOpts));
const same = (a, b) => a.w === b.w && a.h === b.h && a.ax === b.ax && a.ay === b.ay && a.data.every((v, i) => v === b.data[i]);
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Size of the hand body in a pose sprite: palm, thumb, fingers and forearm, without the halo, wrist
 * motes, sparkles, hearts or impact lines. Keeps the `hand-glow` pixels whose four neighbours are
 * `hand-glow` too (that drops 1 px lines, the dithered halo and 1-2 px motes; hearts are `clay`), takes
 * the largest 4-connected group of them and grows its box back by the 1 px the erosion took.
 */
function handBody(sprite) {
  const { w, h, data } = sprite, g0 = idx('hand-glow', 0);
  const glow = (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] >= g0 && data[y * w + x] < g0 + 8;
  const core = (x, y) => glow(x, y) && N4.every(([dx, dy]) => glow(x + dx, y + dy));
  const seen = new Uint8Array(w * h);
  let best = null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (seen[y * w + x] || !core(x, y)) continue;
    const box = [x, y, x, y], stack = [[x, y]];
    let n = 0;
    seen[y * w + x] = 1;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      n++;
      box[0] = Math.min(box[0], cx); box[1] = Math.min(box[1], cy); box[2] = Math.max(box[2], cx); box[3] = Math.max(box[3], cy);
      for (const [dx, dy] of N4) {
        const nx = cx + dx, ny = cy + dy;
        if (core(nx, ny) && !seen[ny * w + nx]) { seen[ny * w + nx] = 1; stack.push([nx, ny]); }
      }
    }
    if (!best || n > best.n) best = { n, box };
  }
  return best ? { w: best.box[2] - best.box[0] + 3, h: best.box[3] - best.box[1] + 3 } : { w: 0, h: 0 };
}

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
  // the god's hand is big next to a 10 px villager: 44-56 px of hand body along its longest side
  // (its halo, wrist motes and effects such as hearts and impact rays come on top)
  for (const n of POSES) {
    const hs = getSprite(n), b = handBody(hs), long = Math.max(b.w, b.h);
    t.assert(long >= 44 && long <= 56 && Math.min(b.w, b.h) >= 20, `${n} hand body is ${b.w}x${b.h} px of a ${hs.w}x${hs.h} sprite (longest side 44-56)`);
    // palette indices only from the hand's two ramps; the warm `heart` ramp only on the stroke
    const g0 = idx('hand-glow', 0), h0 = idx('heart', 0);
    const odd = hs.data.filter((v) => v && !(v >= g0 && v < g0 + 8) && !(n === 'hand-stroke' && v >= h0 && v < h0 + 8)).length;
    t.assert(odd === 0, `${n} uses only hand-glow${n === 'hand-stroke' ? ' and heart' : ''} pixels (${odd} others)`);
    // the anchor is the grip point, so it sits on the hand: a hand-glow pixel at or next to it
    // (Chebyshev distance), except hand-hold, whose pinch point is in the gap between thumb and index
    let gap = Infinity;
    for (let y = 0; y < hs.h; y++) for (let x = 0; x < hs.w; x++) {
      const v = hs.data[y * hs.w + x];
      if (v >= g0 && v < g0 + 8) gap = Math.min(gap, Math.max(Math.abs(x - hs.ax), Math.abs(y - hs.ay)));
    }
    const tol = n === 'hand-hold' ? 2 : 1;
    t.assert(gap <= tol, `${n} grip point (${hs.ax}, ${hs.ay}) is ${gap} px from the hand (at most ${tol})`);
  }
  // hand colour by alignment (handLut): icy at +1 and 0, the half blend at -0.5, crimson-ash at -1;
  // any LUT that is not an alignment LUT passes through unchanged
  {
    const rgb = (lut, shade) => rgbaOf(lut, idx('hand-glow', shade));
    const icy = ([r, g, b]) => b > r + 60 && g > r + 40, ember = ([r, , b]) => r > b + 40;
    for (const [a, want] of [[1, 1], [0, 1], [-0.5, 0], [-1, -1]]) {
      t.assert(handLut(makeLut(a)) === makeLut(want), `hand at alignment ${a} draws with the alignment ${want} LUT`);
    }
    t.assert([4, 5, 6].every((k) => icy(rgb(handLut(makeLut(0)), k))), `hand reads icy cyan at alignment 0 (shade 5 ${rgb(handLut(makeLut(0)), 5).slice(0, 3)})`);
    // evil: crimson to ember in the darks and body, pale ash in the highlights
    t.assert([2, 3, 4].every((k) => ember(rgb(handLut(makeLut(-1)), k))), `hand reads crimson-ash at alignment -1 (shade 4 ${rgb(handLut(makeLut(-1)), 4).slice(0, 3)})`);
    const other = new Uint32Array(256);
    t.assert(handLut(other) === other, 'a LUT that is not an alignment LUT is used as it is');
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
  const villager = sp('villager', OX + 26.5, OY + 39.5, { hp: 1, sprite: fig });
  sp('villager', OX + 23.5, OY + 42.5, { hp: 1, sprite: fig });
  const rock = sp('rock', OX + 24.5, OY + 39.5, { sprite: named('rock', { size: 2 }, 'test-sphere', { ramp: 'rock', r: 3 }) });
  const creature = sp('creature', OX + 25.5, OY + 43.5, { sprite: creatureStandIn() });
  t.step(0.2);

  // 3x inset of the hand for the pose shots: the last system in the draw order queues an overlay three
  // levels deep, so it runs after the hand's own overlay (two levels deep, src/systems/hand.js) and
  // copies the finished hand pixels, in the colours handLut gave them, into the corner away from it
  const INSET = 3, inset = { on: false };
  const last = game.systems[game.systemOrder[game.systemOrder.length - 1]], lastDraw = last.draw;
  last.draw = (ctx) => {
    lastDraw.call(last, ctx);
    if (!inset.on) return;
    ctx.overlay((a) => a.overlay((b) => b.overlay((c) => {
      const hand = handSys.state, hv = c.toView(hand.x, hand.y, hand.z), hs = getSprite(hand.pose);
      const cw = hs.w + 4, ch = hs.h + 4, x0 = hv.vx - hs.ax - 2, y0 = hv.vy - hs.ay - 2;
      const ow = cw * INSET + 2, oh = ch * INSET + 2;
      const ox = hv.vx < c.w / 2 ? c.w - ow - 2 : 2, oy = 2;
      inset.last = { ox, oy, x0, y0 };
      const src = c.buf.slice(), frame = c.lut[idx('ink', 0)] || 0xff000000;
      for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
        const dx = ox + x, dy = oy + y;
        if (dx < 0 || dy < 0 || dx >= c.w || dy >= c.h) continue;
        const sx = x0 + Math.floor((x - 1) / INSET), sy = y0 + Math.floor((y - 1) / INSET);
        const edge = x === 0 || y === 0 || x === ow - 1 || y === oh - 1;
        c.buf[dy * c.w + dx] = edge || sx < 0 || sy < 0 || sx >= c.w || sy >= c.h ? frame : src[sy * c.w + sx];
      }
    })));
  };

  const tick = () => t.step(game.clock.step);
  const ground = (x, y) => camera.worldToView(x, y, world.heightAt(x, y));
  const middle = (e) => {
    const v = camera.worldToView(e.x, e.y, e.z);
    return { sx: v.sx, sy: v.sy - Math.floor((e.sprite?.ay ?? 8) / 2) };
  };
  const moveTo = (q) => { s.move(q.sx, q.sy); tick(); };
  // the open and carry poses hang over grass (ground type 3 on the island map), off the village square
  const OPEN = [OX + 27.5, OY + 42.5], CARRY = [OX + 28.5, OY + 43.5];
  const grass = ([x, y]) => world.ground[Math.floor(y) * world.w + Math.floor(x)] === 3;
  t.assert(grass(OPEN) && grass(CARRY), 'hover and carry spots are grass');
  /** Share of `sprite`'s opaque pixels found in the view buffer, drawn at view (vx, vy) under the LUT. */
  const inView = (sprite, vx, vy, lut = renderer.lut) => {
    const { data: buf, w: bw, h: bh } = renderer.view;
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
    inset.on = true;
    inset.last = null;
    renderer.render();
    const hs = getSprite(hand.pose), hv = camera.worldToView(hand.x, hand.y, hand.z), share = inView(hs, hv.sx, hv.sy, handLut(renderer.lut));
    t.assert(share > 0.97, `${shot}: painted ${hand.pose} pixels in the view at the anchor (${(share * 100).toFixed(1)}%)`);
    {
      // the inset shows the same pixels 3x: the middle of each 3x3 block equals the native pixel
      const { data: buf, w: bw, h: bh } = renderer.view, L = inset.last;
      let n = 0, hit = 0;
      if (L) for (let r = 0; r < hs.h; r++) for (let c = 0; c < hs.w; c++) {
        const x = hv.sx - hs.ax + c, y = hv.sy - hs.ay + r;
        const ix = L.ox + 1 + (x - L.x0) * INSET + 1, iy = L.oy + 1 + (y - L.y0) * INSET + 1;
        if (!hs.data[r * hs.w + c] || x < 0 || y < 0 || x >= bw || y >= bh || ix >= bw || iy >= bh) continue;
        n++;
        if (buf[iy * bw + ix] === buf[y * bw + x]) hit++;
      }
      t.assert(n > 0 && hit / n > 0.97, `${shot}: 3x inset shows the hand (${n ? ((hit / n) * 100).toFixed(1) : 0}% of ${n} pixels)`);
    }
    await t.shot(shot);
    inset.on = false;
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

  // pinch a villager and hold it out over open water (the nearest tile with water two tiles around
  // it), the camera between the two; then back over the grass to set it down gently. The sea is far
  // from the village on the island, so the villager is first moved to grass 3 to 6 tiles from that
  // water (nearest the village), and is set down there again.
  {
    const isWater = (x, y) => world.ground[y * world.w + x] <= HAND.waterGround;
    let sea = null;
    for (let ty = 2; ty < world.h - 2; ty++) for (let tx = 2; tx < world.w - 2; tx++) {
      let open = true;
      for (let dy = -2; dy <= 2 && open; dy++) for (let dx = -2; dx <= 2; dx++) if (!isWater(tx + dx, ty + dy)) { open = false; break; }
      const d = Math.hypot(tx + 0.5 - villager.x, ty + 0.5 - villager.y);
      if (open && (!sea || d < sea.d)) sea = { x: tx + 0.5, y: ty + 0.5, d };
    }
    let rest = null;
    if (sea) for (let ty = 2; ty < world.h - 2; ty++) for (let tx = 2; tx < world.w - 2; tx++) {
      const gap = Math.hypot(tx + 0.5 - sea.x, ty + 0.5 - sea.y), d = Math.hypot(tx + 0.5 - villager.x, ty + 0.5 - villager.y);
      if (world.ground[ty * world.w + tx] === 3 && gap >= 3 && gap <= 6 && (!rest || d < rest.d)) rest = { x: tx + 0.5, y: ty + 0.5, d };
    }
    t.assert(sea && rest, `open water with grass 3 to 6 tiles off it (${sea ? `${sea.d.toFixed(1)} tiles from the villager` : 'none'})`);
    if (sea && rest) {
      world.move(villager, rest.x, rest.y, world.heightAt(rest.x, rest.y));
      Object.assign(villager, { path: null, work: null, wait: 5 });
      sea.d = Math.hypot(sea.x - rest.x, sea.y - rest.y);
      camera.centerOn((sea.x + villager.x) / 2, (sea.y + villager.y) / 2, world.heightAt(villager.x, villager.y));
      t.step(0.2);
      moveTo(middle(villager));
      s.down(0);
      tick();
      t.assert(handSys.state.heldId === villager.id, 'the villager is in the hand');
      moveTo(ground(sea.x, sea.y));
      t.step(0.5);
      const hand = handSys.state;
      t.assert(hand.heldId === villager.id && isWater(Math.floor(hand.x), Math.floor(hand.y)), `villager held over open water (ground ${world.ground[Math.floor(hand.y) * world.w + Math.floor(hand.x)]})`);
      const hv = camera.worldToView(hand.x, hand.y, hand.z);
      const vv = camera.worldToView(villager.x, villager.y, villager.z), top = vv.sy - villager.sprite.ay;
      t.assert(Math.abs(hv.sx - vv.sx) <= 1, `held villager hangs under the grip point between thumb and index (dx ${hv.sx - vv.sx})`);
      t.assert(hv.sy > top && hv.sy <= Math.min(top + 6, vv.sy), `pinch just inside the villager's top (grip y ${hv.sy}, villager top ${top}, foot ${vv.sy})`);
      await pose('hand-hold', 'pose-hold-villager-water');
      // set it down on the grass: pointer at rest there first, so the release is a drop, not a throw
      moveTo(ground(rest.x, rest.y));
      t.step(0.6);
      s.up(0);
      t.step(1.5);
      t.assert(handSys.state.heldId == null && (world.get(villager.id)?.hp ?? 0) > 0, 'villager set down on the grass, unharmed');
      camera.centerOn(site.x + 4, site.y + 1, world.heightAt(site.x, site.y));
      t.step(0.2);
    }
  }

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
  moveTo(ground(OX + 23.5, OY + 44.5));
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

  // all six poses side by side at hover height, over grass and over open water, at zoom 1 and zoom 6
  const ground3 = (x, y) => world.ground[y * world.w + x] === 3;
  const water = (x, y) => world.ground[y * world.w + x] <= HAND.waterGround;
  // three columns 80 view px apart (+x -y) and two rows 68 view px apart (+x +y)
  const SLOTS = POSES.map((n, i) => [n, (i % 3) * 2.5 + Math.floor(i / 3) * 4.25, -(i % 3) * 2.5 + Math.floor(i / 3) * 4.25]);
  const MID = [SLOTS.reduce((a, [, dx]) => a + dx, 0) / 6, SLOTS.reduce((a, [, , dy]) => a + dy, 0) / 6];
  /** Board origin nearest the map center where every pose sits over `ok` ground (2 tiles around each anchor). */
  const findBoard = (ok) => {
    let best = null;
    for (let by = 8; by < world.h - 7; by++) for (let bx = 2; bx < world.w - 12; bx++) {
      const fits = SLOTS.every(([, dx, dy]) => {
        const cx = Math.floor(bx + dx), cy = Math.floor(by + dy);
        for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) if (!world.inBounds(x, y) || !ok(x, y)) return false;
        return true;
      });
      const d = Math.hypot(bx + MID[0] - world.w / 2, by + MID[1] - world.h / 2);
      if (fits && (!best || d < best.d)) best = { x: bx + 0.5, y: by + 0.5, d };
    }
    return best;
  };
  const board = async (label, ok, alignment = 0) => {
    const at = findBoard(ok);
    t.assert(at, `${label}: found a spot where all six poses hang over the ground it needs`);
    if (!at) return;
    renderer.lut = makeLut(alignment);
    const lut = handLut(renderer.lut);
    // one height for the whole board (the highest ground under it), so the poses line up on rows
    const z = Math.max(...SLOTS.map(([, dx, dy]) => world.heightAt(at.x + dx, at.y + dy))) + HAND.hoverZ;
    // each pose is placed so the middle of its sprite (not its grip point) sits on the slot
    const posts = SLOTS.map(([n, dx, dy]) => {
      const sp = getSprite(n), ox = (sp.ax - sp.w / 2) / 32, oz = (sp.ay - sp.h / 2) / 8;
      return world.spawn('post', { x: at.x + dx + ox, y: at.y + dy - ox, z: z - oz, sprite: sp, lut, grabbable: false });
    });
    const look = () => {
      camera.centerOn(at.x + MID[0], at.y + MID[1], z + 2.5);
      s.move(2, 2); // the pointer, and so the live hand, off in the corner
      tick();
      renderer.render();
      posts.forEach((e, i) => {
        const v = camera.worldToView(e.x, e.y, e.z), share = inView(e.sprite, v.sx, v.sy, lut);
        t.assert(share > 0.9, `${label} board: ${POSES[i]} drawn at its anchor (${(share * 100).toFixed(0)}%)`);
      });
    };
    look();
    await t.shot(`board-${label}`);
    const startScale = game.display.scale;
    while (game.display.scale < 6 && camera.zoomStep(1)) t.step(1 / 30);
    t.assert(game.display.scale === 6, `${label} board: zoomed in to scale 6 (${game.display.scale})`);
    look();
    await t.shot(`board-${label}-close`);
    while (game.display.scale > startScale && camera.zoomStep(-1)) t.step(1 / 30);
    t.assert(game.display.scale === startScale, `${label} board: zoomed back out (${game.display.scale})`);
    for (const e of posts) world.remove(e.id);
    renderer.lut = makeLut(0);
  };
  await board('grass', ground3);
  await board('water', water);
  await board('grass-evil', ground3, -1);

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

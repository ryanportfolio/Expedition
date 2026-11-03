// Node check for the hand system (no browser). Builds createGame() without a canvas on the real
// island, drives it only through input.synth, and checks grab / carry / release / flight / landing,
// lethal and gentle villager landings, a cancelled press (blur) that drops instead of throwing, the sea, buildings, thrown pedestal orbs casting on their
// landing point (and a landed entity already on its contact point), stroke reversal counting, slap, tether,
// the flight math against the closed form, the lethal threshold edge, that update() and the input
// handlers never touch the DOM or call Math.random, that every emitted event carries its spec
// fields, and that a painter registered before the hand loads keeps its sprite. Exits 1 and prints
// every failed check.
//
//   node scripts/check-hand.mjs
import { registerPainters, getSprite, listSprites, placeholderSprite } from '../src/art/registry.js';
import { createSprite } from '../src/art/sprite.js';
import { idx } from '../src/art/palette.js';
import * as testPattern from '../src/art/painters/test-pattern.js';
import { readFileSync, readdirSync } from 'node:fs';

registerPainters(testPattern);

// A painter registered before the hand system loads stands in for the real hand painter round: the
// hand's placeholder art must leave it alone. Everything that imports the hand is loaded after this.
const customShadow = createSprite(3, 1, 1, 0);
customShadow.data.fill(idx('shadow', 0));
registerPainters({ sprites: { 'shadow-l': () => customShadow } });

const { createGame } = await import('../src/game.js');
const { buildIsland } = await import('../src/world/island.js');
// Spots below are written as offsets from the player village's 64 x 64 centre (20, 40); OX, OY move
// them to where the village stands on the island now.
const { village: V0 } = buildIsland().sites;
const OX = V0.x - 20, OY = V0.y - 40;
const { HAND } = await import('../src/systems/hand.js');
const { stepBody, apexHeight, flatRange, predictLanding } = await import('../src/hand/flight.js');
const { createStrokeTracker } = await import('../src/hand/stroke.js');
const { VILLAGE, woodIn } = await import('../src/village/config.js');
const { releaseVelocity, groundToScreenVelocity, screenToGroundVelocity, isGrabbable } = await import('../src/hand/tunables.js');
const { drawTop } = await import('../src/hand/draw.js');
const { makeLut } = await import('../src/art/lut.js');

let failed = 0, passed = 0;
const ok = (cond, msg) => {
  if (cond) passed++;
  else { failed++; console.log(`FAIL ${msg}`); }
  return !!cond;
};
const section = (name, fn) => {
  try { fn(); } catch (err) { failed++; console.log(`FAIL [${name}] threw: ${err?.stack || err}`); }
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;

/** Every event any fixture saw, checked against the spec payloads at the end. */
const allEvents = [];

// ------------------------------------------------------------------ placeholder art
section('placeholder art', () => {
  const names = ['hand-open', 'hand-grab', 'hand-hold', 'hand-point', 'hand-stroke', 'hand-slap', 'shadow-s', 'shadow-m', 'shadow-l'];
  const have = new Set(listSprites());
  ok(names.every((n) => have.has(n)), `every hand and shadow name has a painter (missing: ${names.filter((n) => !have.has(n)).join(', ') || 'none'})`);
  ok(names.every((n) => getSprite(n) !== placeholderSprite()), 'no hand or shadow sprite falls back to the checker placeholder');
  ok(getSprite('shadow-l') === customShadow, 'a painter registered before the hand system loads keeps its sprite');
});

// ------------------------------------------------------------------ fixture
function setup() {
  const game = createGame({ seed: 3 });
  game.display.setDevice(1920, 1080, 1);
  game.world.loadMap(buildIsland());
  game.input.now = () => game.clock.time * 1000;
  const { world, camera, events } = game;
  const site = world.sites.village;
  camera.centerOn(site.x, site.y, world.heightAt(site.x, site.y));
  const log = [];
  for (const type of ['grab', 'release', 'landed', 'act', 'stroke', 'slap', 'tether']) {
    events.on(type, (e) => { const rec = { type, ...e }; log.push(rec); allEvents.push(rec); });
  }
  const s = game.input.synth;
  const step = (sec) => game.clock.run(Math.max(1, Math.round(sec / game.clock.step)), game.tick);
  const view = (e) => camera.worldToView(e.x, e.y, e.z);
  /** View pixel in the middle of an entity's sprite (or a little above its foot without one). */
  const middle = (e) => {
    const v = view(e);
    return { sx: v.sx, sy: v.sy - (e.sprite ? Math.floor(e.sprite.ay / 2) : e.kind === 'creature' ? 30 : 4) };
  };
  const moveTo = (q) => { s.move(q.sx, q.sy); step(1 / 30); };
  const sp = (kind, x, y, extra = {}) => world.spawn(kind, { x, y, ...extra });
  /** Press on e and hold for `hold` seconds. */
  const grab = (e, hold = 0.4) => { moveTo(middle(e)); s.down(0); step(hold); };
  /** Move the pointer so the release launches at `speed` tiles/s toward (dx, dy), then let go. */
  const flick = (dx, dy, speed, ticks = 4) => {
    const n = Math.hypot(dx, dy), k = speed / HAND.throwGain / n;
    const v = groundToScreenVelocity(dx * k, dy * k);
    const p = game.input.pointer;
    for (let i = 0; i < ticks; i++) { s.move(p.sx + v.vsx / 30, p.sy + v.vsy / 30); step(1 / 30); }
    s.up(0);
  };
  const since = (n) => log.slice(n);
  return { game, world, camera, events, log, s, step, view, middle, moveTo, sp, grab, flick, since, site };
}

const onTerrain = (world, e) => Math.abs(e.z - world.heightAt(e.x, e.y)) <= 0.05;

// ------------------------------------------------------------------ pure math
section('release velocity', () => {
  ok(near(screenToGroundVelocity(160, 0).vx, 5, 1e-9) && near(screenToGroundVelocity(160, 0).vy, -5, 1e-9), 'screen -> ground velocity: +160 px/s across = (+5, -5) tiles/s');
  const back = groundToScreenVelocity(3, -2), fwd = screenToGroundVelocity(back.vsx, back.vsy);
  ok(near(fwd.vx, 3, 1e-9) && near(fwd.vy, -2, 1e-9), 'ground <-> screen velocity round trip');
  const slow = releaseVelocity(10, 0);
  ok(!slow.thrown && slow.vx === 0 && slow.vz === 0, `slow pointer (10 px/s) drops: ${JSON.stringify(slow)}`);
  const fast = releaseVelocity(5000, 0);
  ok(fast.thrown && near(fast.speed, HAND.throwMax, 1e-9) && near(Math.hypot(fast.vx, fast.vy), HAND.throwMax, 1e-9), `fast pointer is capped at ${HAND.throwMax} tiles/s`);
  ok(near(fast.vz, HAND.throwMax * HAND.loft, 1e-9), 'vertical launch speed = speed * loft');
  const g = groundToScreenVelocity(8 / HAND.throwGain, 0), mid = releaseVelocity(g.vsx, g.vsy);
  ok(near(mid.vx, 8, 1e-9) && near(mid.vy, 0, 1e-9), `gain applied: pointer at ${8 / HAND.throwGain} tiles/s launches at 8 (${mid.vx})`);
});

section('flight math vs closed form', () => {
  const g = HAND.gravity, flat = () => 2;
  for (const [vx, vy, vz, z0] of [[8, 0, 10, 5], [3, 4, 16, 3.5], [0, 12, 4, 2.5], [5, -5, 0, 6]]) {
    const b = { x: 10, y: 10, z: z0, vx, vy, vz };
    let apex = z0, contact = null, t = 0;
    for (let i = 0; i < 600 && !contact; i++) {
      contact = stepBody(b, 1 / 30, flat, g, null);
      apex = Math.max(apex, b.z);
      t += 1 / 30;
    }
    // the sampled apex can only miss the true top between samples; the closed form is the bound
    const wantApex = apexHeight(z0, vz, g), wantRange = flatRange(z0, 2, Math.hypot(vx, vy), vz, g);
    const range = Math.hypot(b.x - 10, b.y - 10);
    ok(contact && Math.abs(apex - wantApex) <= 0.05 * wantApex, `apex ${apex.toFixed(3)} within 5% of closed form ${wantApex.toFixed(3)} (v ${vx},${vy},${vz} from z ${z0})`);
    ok(contact && (wantRange === 0 ? range < 1e-6 : Math.abs(range - wantRange) <= 0.05 * wantRange), `range ${range.toFixed(3)} within 5% of closed form ${wantRange.toFixed(3)}`);
    ok(contact && b.z === 2, 'contact point sits on the terrain');
    const pred = predictLanding(10, 10, z0, vx, vy, vz, flat, g, null);
    ok(pred && near(Math.hypot(pred.x - 10, pred.y - 10), range, 1e-9), 'predictLanding matches the stepped flight');
  }
  // step size does not change the arc (exact constant-gravity update)
  const a = { x: 0, y: 0, z: 9, vx: 6, vy: 0, vz: 7 }, b = { ...a };
  for (let i = 0; i < 12; i++) stepBody(a, 1 / 30, () => -100, 36, null);
  for (let i = 0; i < 3; i++) stepBody(b, 4 / 30, () => -100, 36, null);
  ok(near(a.z, b.z, 1e-9) && near(a.x, b.x, 1e-9), `same arc at dt 1/30 and 4/30 (${a.z.toFixed(6)} vs ${b.z.toFixed(6)})`);
});

section('stroke reversal counting (pure)', () => {
  const run = (segments) => {
    const tr = createStrokeTracker({ within: HAND.strokeWindow, need: HAND.strokeReversals, minTravel: HAND.strokeMinTravel, fullSpeed: HAND.strokeFullSpeed });
    let t = 0, fired = 0, strength = null;
    for (const dir of segments) for (let i = 0; i < 3; i++) {
      t += 1 / 30;
      const r = tr.move(4 * dir, 0, t, true);
      if (r) { fired++; strength = r.strength; }
    }
    return { fired, strength };
  };
  ok(run([1, -1, 1]).fired === 0, '2 reversals: no stroke');
  const three = run([1, -1, 1, -1]);
  ok(three.fired === 1 && three.strength >= 0.2 && three.strength <= 1, `3 reversals: one stroke (strength ${three.strength})`);
  ok(run([1, -1, 1, -1, 1]).fired === 1, '4 reversals: still one stroke');
  ok(run([1, -1, 1, -1, 1, -1, 1]).fired === 2, '6 reversals: two strokes');
  // tremor: 1 px back-and-forth never counts
  const tr = createStrokeTracker({ need: 3, minTravel: 3 });
  let any = false;
  for (let i = 0; i < 40; i++) any ||= !!tr.move(i % 2 ? 1 : -1, 0, i / 30, true);
  ok(!any && tr.reversals === 0, '1 px tremor counts no reversals');
  // reversals spread over more than the window do not add up
  const slow = createStrokeTracker({ within: 1.2, need: 3, minTravel: 3 });
  let fired = false, t = 0;
  for (const dir of [1, -1, 1, -1]) for (let i = 0; i < 20; i++) { t += 1 / 30; fired ||= !!slow.move(dir, 0, t, true); }
  ok(!fired, '3 reversals spread over 2 s do not stroke');
});

section('grabbable rules', () => {
  ok(['villager', 'tree', 'rock', 'wood', 'grain', 'orb'].every((kind) => isGrabbable({ kind })), 'default grabbable kinds');
  ok(!isGrabbable({ kind: 'creature', grabbable: true }) && !isGrabbable({ kind: 'building', grabbable: true }), 'creature and buildings never grabbable, even when flagged');
  ok(!isGrabbable({ kind: 'villager', grabbable: false }), 'owner flag false wins');
  ok(!isGrabbable({ kind: 'post' }), 'unknown kinds are not grabbable');
});

// ------------------------------------------------------------------ in game
section('grab, carry, drop a rock', () => {
  const f = setup();
  const { world, s, step, sp, grab, game } = f;
  const rock = sp('rock', OX + 20.5, OY + 40.5, { sprite: getSprite('test-sphere', { ramp: 'rock', r: 3 }) });
  const n = f.log.length;
  grab(rock, 0.1);
  const hand = game.systems.hand;
  ok(hand.state.heldId === rock.id && rock.held === true, 'left press on the rock holds it');
  const g = f.since(n).find((e) => e.type === 'grab');
  ok(g && g.entityId === rock.id && g.kind === 'rock', `grab event ${JSON.stringify(g)}`);
  // carry: move the pointer 2 tiles; the rock follows with lag and hovers above the terrain
  const target = f.camera.worldToView(OX + 22.5, OY + 40.5, world.heightAt(OX + 22.5, OY + 40.5));
  s.move(target.sx, target.sy);
  step(1 / 30);
  const lagging = Math.hypot(rock.x - (OX + 22.5), rock.y - (OY + 40.5));
  step(0.8);
  ok(lagging > 0.3 && Math.hypot(rock.x - (OX + 22.5), rock.y - (OY + 40.5)) < 0.1, `carried rock lags (${lagging.toFixed(2)} tiles after one tick) then catches up`);
  ok(near(rock.z - world.heightAt(rock.x, rock.y), HAND.carryZ, 0.05), `carried rock hovers ${HAND.carryZ} above the terrain (${(rock.z - world.heightAt(rock.x, rock.y)).toFixed(2)})`);
  ok(hand.state.pose === 'hand-hold', `pose while carrying: ${hand.state.pose}`);
  ok(hand.state.z > rock.z, 'hand sits above the carried rock');
  // drop: release while still
  s.up(0);
  const rel = f.since(n).find((e) => e.type === 'release');
  ok(rel && rel.entityId === rock.id && rel.kind === 'rock' && rel.vx === 0 && rel.vy === 0 && rel.vz === 0, `still release drops: ${JSON.stringify(rel)}`);
  ok(rel && ['x', 'y', 'z', 'vx', 'vy', 'vz'].every((k) => typeof rel[k] === 'number'), 'release carries x, y, z, vx, vy, vz');
  ok(f.since(n).some((e) => e.type === 'act' && e.verb === 'drop' && e.target === 'rock' && e.actor === 'player'), 'drop act emitted');
  step(1);
  const landed = f.since(n).filter((e) => e.type === 'landed');
  ok(landed.length === 1 && landed[0].entityId === rock.id && landed[0].speed > 0, `one landed event (${JSON.stringify(landed[0])})`);
  ok(onTerrain(world, rock) && !rock.held && !rock.airborne && Math.hypot(rock.x - (OX + 22.5), rock.y - (OY + 40.5)) < 0.15, `rock rests on the terrain under the drop point (${rock.x.toFixed(2)}, ${rock.y.toFixed(2)}, z ${rock.z.toFixed(3)})`);
});

section('throw a rock far, bounce and settle', () => {
  const f = setup();
  const { world, step, sp, grab, flick } = f;
  const rock = sp('rock', OX + 19.5, OY + 40.5, { sprite: getSprite('test-sphere', { ramp: 'rock', r: 3 }) });
  const n = f.log.length;
  grab(rock);
  flick(0.2, -1, 12); // north over the flat village plateau
  const rel = f.since(n).find((e) => e.type === 'release');
  ok(rel && near(Math.hypot(rel.vx, rel.vy), 12, 0.05), `release speed ~12 tiles/s (${rel && Math.hypot(rel.vx, rel.vy).toFixed(2)})`);
  ok(rel && near(rel.vz, 12 * HAND.loft, 0.06), 'release vz = speed * loft');
  let apex = rock.z, maxShadowGap = 0;
  for (let i = 0; i < 90 && rock.airborne; i++) { step(1 / 30); apex = Math.max(apex, rock.z); maxShadowGap = Math.max(maxShadowGap, rock.z - world.heightAt(rock.x, rock.y)); }
  const landed = f.since(n).find((e) => e.type === 'landed');
  const dist = landed && Math.hypot(landed.x - rel.x, landed.y - rel.y);
  ok(landed && dist > 6, `thrown rock travels ${dist?.toFixed(2)} tiles (> 6) before landing`);
  ok(landed && near(landed.z, world.heightAt(landed.x, landed.y), 0.05), 'lands on the terrain height');
  ok(apex > rel.z + 1, `flies in an arc (apex ${apex.toFixed(2)} vs release z ${rel.z.toFixed(2)})`);
  ok(f.since(n).filter((e) => e.type === 'landed').length === 1, 'bounces do not emit extra landed events');
  ok(!rock.airborne && onTerrain(world, rock), `rock settles on the terrain (z ${rock.z.toFixed(3)} vs ${world.heightAt(rock.x, rock.y).toFixed(3)})`);
  ok(Math.hypot(rock.x - landed.x, rock.y - landed.y) > 0.2, `rock bounced on past its first contact (landed ${JSON.stringify(landed)}, rests at ${rock.x.toFixed(2)}, ${rock.y.toFixed(2)})`);
  ok(f.since(n).some((e) => e.type === 'act' && e.verb === 'throw' && e.target === 'rock'), 'throw act emitted');
});

section('villagers: hard throw kills, gentle drop does not', () => {
  const f = setup();
  const { world, step, sp, grab, flick, s } = f;
  const fig = getSprite('test-figure');
  const v1 = sp('villager', OX + 20.5, OY + 39.5, { hp: 1, sprite: fig });
  let n = f.log.length;
  grab(v1);
  flick(1, 0.2, 14);
  step(2);
  const landed = f.since(n).find((e) => e.type === 'landed' && e.entityId === v1.id);
  ok(landed && landed.speed > HAND.lethalSpeed, `hard throw lands at ${landed?.speed.toFixed(2)} (> lethal ${HAND.lethalSpeed})`);
  ok(v1.hp === 0, `hard-thrown villager hp 0 (got ${v1.hp})`);
  const kill = f.since(n).find((e) => e.type === 'act' && e.weight === -0.6);
  ok(kill && kill.actor === 'player' && kill.verb === 'throw' && kill.target === 'villager' && typeof kill.x === 'number' && typeof kill.y === 'number', `kill act ${JSON.stringify(kill)}`);
  ok(world.get(v1.id) === v1, 'the hand leaves villager removal to the village');

  const v2 = sp('villager', OX + 21.5, OY + 41.5, { hp: 0.8, sprite: fig });
  n = f.log.length;
  grab(v2);
  s.up(0);
  step(1.5);
  const soft = f.since(n).find((e) => e.type === 'landed' && e.entityId === v2.id);
  ok(soft && soft.speed < HAND.lethalSpeed, `gentle drop lands at ${soft?.speed.toFixed(2)}`);
  ok(v2.hp === 0.8 && !f.since(n).some((e) => e.type === 'act' && e.weight === -0.6), 'gently dropped villager keeps its hp, no kill act');
  ok(onTerrain(world, v2) && !v2.airborne, 'dropped villager stands on the terrain');
});

// Round 46: a window blur, a lost capture or a cancelled pointer ends the press through
// input.cancel() (scripts/check-engine.mjs checks the DOM side). Before, it was an ordinary release
// with the speed of the last moves, so alt-tabbing out mid-throw threw the villager to its death.
section('a cancelled press mid-throw drops the villager, never throws it', () => {
  const f = setup();
  const { step, sp, grab, s, game } = f;
  const v = sp('villager', OX + 20.5, OY + 39.5, { hp: 1, sprite: getSprite('test-figure') });
  const n = f.log.length;
  grab(v);
  // the moves of the hard throw above (flick(1, 0.2, 14)), ended by a cancel instead of a release
  const k = 14 / HAND.throwGain / Math.hypot(1, 0.2), sv = groundToScreenVelocity(k, 0.2 * k), p = game.input.pointer;
  for (let i = 0; i < 4; i++) { s.move(p.sx + sv.vsx / 30, p.sy + sv.vsy / 30); step(1 / 30); }
  const would = releaseVelocity(p.vsx, p.vsy);
  s.cancel();
  step(2);
  const rel = f.since(n).find((e) => e.type === 'release' && e.entityId === v.id);
  const landed = f.since(n).find((e) => e.type === 'landed' && e.entityId === v.id);
  const act = f.since(n).find((e) => e.type === 'act' && e.target === 'villager');
  ok(would.thrown && rel && rel.vx === 0 && rel.vy === 0 && rel.vz === 0,
    `the cancel releases with no speed (a release here would throw at ${would.speed.toFixed(1)} tiles/s; released at ${rel ? Math.hypot(rel.vx, rel.vy).toFixed(1) : '-'})`);
  ok(landed && landed.speed < HAND.lethalSpeed && v.hp === 1 && act?.verb === 'drop',
    `the villager is dropped and lives (landed at ${landed?.speed.toFixed(2)}, hp ${v.hp}, act ${act?.verb})`);
});

section('lethal threshold edge', () => {
  const f = setup();
  const { world, game } = f;
  const g = HAND.gravity;
  for (const [factor, dies] of [[0.98, false], [1.02, true]]) {
    const v = world.spawn('villager', { x: OX + 21.5, y: OY + 40.5, hp: 1 });
    const ground = world.heightAt(v.x, v.y);
    const want = HAND.lethalSpeed * factor;
    world.move(v, v.x, v.y, ground + (want * want) / (2 * g)); // free fall reaches `want` at the ground
    const n = f.log.length;
    game.systems.hand.launch(v, 0, 0, 0);
    f.step(2);
    const l = f.since(n).find((e) => e.type === 'landed' && e.entityId === v.id);
    ok(l && near(l.speed, want, want * 0.005), `fall lands at ${l?.speed.toFixed(3)} ~ ${want.toFixed(3)}`);
    ok((v.hp === 0) === dies, `landing at ${factor} x lethal speed: ${dies ? 'dies' : 'survives'} (hp ${v.hp})`);
  }
});

section('throw a rock into the sea', () => {
  const f = setup();
  const { world, step, sp, grab, flick, game } = f;
  // the walkable tile nearest the village with open water 3 tiles off (the sea is far from the
  // village on the island now), with the camera on it
  const shore = (() => {
    const v = f.site, W = world.w;
    let best = null, bd = Infinity;
    for (let ty = 3; ty < world.h - 3; ty++) for (let tx = 3; tx < W - 3; tx++) {
      const g = world.ground[ty * W + tx];
      if (g < 2 || g > 4 || world.ground[ty * W + tx - 3] > HAND.waterGround) continue;
      const d = Math.hypot(tx - v.x, ty - v.y);
      if (d < bd) { bd = d; best = { x: tx + 0.5, y: ty + 0.5 }; }
    }
    return best;
  })();
  f.camera.centerOn(shore.x, shore.y, world.heightAt(shore.x, shore.y));
  const rock = sp('rock', shore.x, shore.y);
  grab(rock);
  // pick a direction whose landing is open water from anywhere along the flick
  const water = (p) => p && world.ground[Math.floor(p.y) * world.w + Math.floor(p.x)] <= HAND.waterGround;
  let dir = null;
  for (let k = 0; k < 32 && !dir; k++) {
    const a = Math.PI + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 16);
    const dx = Math.cos(a), dy = Math.sin(a);
    const okAll = [0, 1, 2, 3].every((d) => {
      const x = rock.x + dx * d, y = rock.y + dy * d, z = world.heightAt(x, y) + HAND.carryZ;
      return water(predictLanding(x, y, z, dx * HAND.throwMax, dy * HAND.throwMax, HAND.throwMax * HAND.loft, world.heightAt, HAND.gravity, world));
    });
    if (okAll) dir = [dx, dy];
  }
  ok(dir, 'found a throw direction that lands in the sea');
  if (!dir) return;
  const n = f.log.length, fx0 = game.fx.live.length;
  flick(dir[0], dir[1], HAND.throwMax);
  for (let i = 0; i < 90 && rock.airborne; i++) step(1 / 30);
  const landed = f.since(n).find((e) => e.type === 'landed');
  ok(landed && landed.water === true, `landed in water (${JSON.stringify(landed)})`);
  ok(rock.sinking && game.fx.live.length > fx0, 'rock sinks with a splash effect');
  step(HAND.sinkTime + 0.1);
  ok(!world.get(rock.id), 'rock removed after sinking');
});

section('creature and buildings are never grabbed', () => {
  const f = setup();
  const { world, s, step, sp, grab, game } = f;
  const c = sp('creature', OX + 24.5, OY + 42.5);
  const b = sp('building', OX + 18.5, OY + 37.5, { hp: 1, grabbable: true, sprite: getSprite('test-box', { ramp: 'stone', h: 12 }) });
  const n = f.log.length;
  grab(c, 0.2);
  ok(game.systems.hand.state.heldId === null && !c.held, 'left press on the creature holds nothing');
  s.up(0);
  grab(b, 0.2);
  ok(game.systems.hand.state.heldId === null && !b.held, 'left press on a building holds nothing');
  s.up(0);
  step(0.1);
  ok(!f.since(n).some((e) => e.type === 'grab'), 'no grab event');
});

section('rock thrown into a building damages it', () => {
  const f = setup();
  const { world, step, sp, game } = f;
  const b = sp('building', OX + 24.5, OY + 40.5, { hp: 1, r: 1 });
  const rock = sp('rock', OX + 20.5, OY + 40.5);
  world.move(rock, rock.x, rock.y, world.heightAt(rock.x, rock.y) + 1.5);
  game.systems.hand.launch(rock, 14, 0, 3);
  step(2);
  ok(b.hp < 1 && b.hp >= 0, `building hp after a fast rock: ${b.hp.toFixed(2)}`);
  const b2 = sp('building', OX + 30.5, OY + 44.5, { hp: 1, r: 1 });
  const pebble = sp('rock', OX + 30.5, OY + 43.2);
  world.move(pebble, pebble.x, pebble.y, world.heightAt(pebble.x, pebble.y) + 0.2);
  game.systems.hand.launch(pebble, 0, 0.5, 0);
  step(1);
  ok(b2.hp === 1, 'a slow rock does no damage');
});

section('trees uproot, orbs carry their miracle', () => {
  const f = setup();
  const { sp, grab, s, step, game, moveTo, middle } = f;
  const tree = sp('tree', OX + 22.5, OY + 38.5, { sprite: getSprite('test-tree') });
  // a press on a tree that moves pulls it up; one held still draws its wood (bulk section)
  const pull = (e) => { const q = middle(e); moveTo(q); s.down(0); s.move(q.sx + 4, q.sy); step(0.2); };
  let n = f.log.length;
  s.move(0, 0);
  moveTo(middle(tree)); s.down(0); step(HAND.treeDrawDelay / 2); s.up(0); step(1 / 30);
  ok(!tree.held && !tree.uprooted && f.since(n).length === 0, 'a short click on a tree does nothing');
  pull(tree);
  const up = f.since(n).find((e) => e.type === 'act' && e.verb === 'uproot');
  ok(up && up.target === 'tree' && up.actor === 'player' && typeof up.weight === 'number', `grabbing a tree uproots it: ${JSON.stringify(up)}`);
  ok(tree.uprooted === true, 'tree marked uprooted');
  s.up(0);
  step(1);
  pull(tree);
  ok(f.since(n).filter((e) => e.type === 'act' && e.verb === 'uproot').length === 1, 'a tree uproots once');
  s.up(0);
  step(1);
  const orb = sp('orb', OX + 19.5, OY + 41.5, { miracle: 'rain' });
  n = f.log.length;
  grab(orb, 0.2);
  s.up(0);
  const rel = f.since(n).find((e) => e.type === 'release');
  ok(rel && rel.kind === 'orb' && rel.miracle === 'rain', `orb release carries kind and miracle: ${JSON.stringify(rel)}`);
  ok(!f.since(n).some((e) => e.type === 'act'), 'orb release emits no act (miracles reports the cast)');
  step(1);
  ok(f.since(n).some((e) => e.type === 'landed' && e.entityId === orb.id), 'orb lands');
  ok(game.systems.hand.state.flights.size === 0, 'no flights left');
});

// The miracles testbed flies its orbs with a stand-in that moves the orb exactly onto the landing
// point, so it can't see where the real hand leaves the entity when `landed` fires. Here the real
// hand throws the real pedestal orbs (village set up, temple and orbs where the game puts them) and
// the cast must land on the reported landing point. Before round 44 the hand emitted `landed` with
// the entity still at its last tick position, up to 0.4 tiles short.
section('thrown pedestal orbs cast where they land', () => {
  const f = setup();
  const { game, world, camera, s, step, middle, moveTo, flick, since } = f;
  game.systems.village.setup();
  game.state.power = 1000;
  step(0.2);
  const ts = world.sites.temple;
  camera.centerOn(ts.x, ts.y, world.heightAt(ts.x, ts.y));
  step(1 / 30);
  const casts = [];
  game.events.on('miracle-cast', (e) => casts.push(e));
  // landed listeners read the entity (the orbs cast where the orb is; the village reads the landed
  // villager): it must already sit on the reported contact point. The orbs' own listener removes the
  // orb before a listener added here runs, so a thrown rock checks this.
  const seen = [];
  game.events.on('landed', (e) => { const o = world.get(e.entityId); if (o) seen.push({ ...e, ex: o.x, ey: o.y, ez: o.z }); });
  const rock = world.spawn('rock', { x: OX + 20.5, y: OY + 40.5 });
  world.move(rock, rock.x, rock.y, world.heightAt(rock.x, rock.y) + 1.5);
  game.systems.hand.launch(rock, 14, 0, 14);
  step(2);
  const at = seen.find((e) => e.entityId === rock.id);
  ok(at && at.ex === at.x && at.ey === at.y && at.ez === at.z,
    `a thrown rock sits on the landing point when landed fires (entity ${at && [at.ex.toFixed(3), at.ey.toFixed(3), at.ez.toFixed(3)]}, landed ${at && [at.x.toFixed(3), at.y.toFixed(3), at.z.toFixed(3)]})`);
  const dirs = { rain: [1, 0.3], heal: [0.3, 1], fire: [1, 1], lightning: [0.6, 1] };
  for (const [miracle, [dx, dy]] of Object.entries(dirs)) {
    const id = game.systems.miracles.orbs.orbOn(miracle);
    const orb = id !== null && world.get(id);
    if (!ok(orb, `${miracle}: a pedestal orb is waiting`)) continue;
    moveTo(middle(orb));
    s.down(0);
    step(0.3);
    if (!ok(game.systems.hand.state.heldId === id, `${miracle}: the hand grabs the pedestal orb`)) { s.up(0); step(1); continue; }
    const n = f.log.length, c0 = casts.length;
    flick(dx, dy, 12);
    const rel = since(n).find((e) => e.type === 'release' && e.entityId === id);
    ok(rel && Math.hypot(rel.vx, rel.vy) > 6, `${miracle}: thrown, not dropped (${rel && Math.hypot(rel.vx, rel.vy).toFixed(2)} tiles/s)`);
    step(2);
    const land = since(n).find((e) => e.type === 'landed' && e.entityId === id), cast = casts.slice(c0).find((e) => e.miracle === miracle);
    ok(land && cast && near(cast.x, land.x, 1e-9) && near(cast.y, land.y, 1e-9),
      `${miracle}: cast point equals the landing point (landed ${land && [land.x.toFixed(3), land.y.toFixed(3)]}, cast ${cast && [cast.x.toFixed(3), cast.y.toFixed(3)]})`);
    ok(!world.get(id), `${miracle}: the orb is gone after its cast`);
    step(5); // pedestal respawn
  }
});

section('catch a flying rock', () => {
  const f = setup();
  const { world, sp, game, moveTo, s, step, middle } = f;
  const rock = sp('rock', OX + 20.5, OY + 40.5, { sprite: getSprite('test-sphere', { ramp: 'rock', r: 3 }) });
  world.move(rock, rock.x, rock.y, world.heightAt(rock.x, rock.y) + 6);
  game.systems.hand.launch(rock, 0, 0, 0);
  step(1 / 30);
  moveTo(middle(rock));
  s.down(0);
  ok(game.systems.hand.state.heldId === rock.id && !rock.airborne && game.systems.hand.state.flights.size === 0, 'pressing on an airborne rock catches it');
  s.up(0);
  step(1);
});

section('stroke, slap, select and tether', () => {
  const f = setup();
  const { world, s, step, sp, moveTo, middle, game } = f;
  const c = sp('creature', OX + 24.5, OY + 42.5);
  const hand = game.systems.hand;
  const rub = (segments) => {
    const n = f.log.length;
    moveTo(middle(c));
    s.down(0);
    step(1 / 30);
    const p = game.input.pointer;
    for (const dir of segments) for (let i = 0; i < 3; i++) { s.move(p.sx + 4 * dir, p.sy); step(1 / 30); }
    const pose = hand.state.pose;
    s.up(0);
    step(0.6);
    return { strokes: f.since(n).filter((e) => e.type === 'stroke'), pose };
  };
  ok(rub([1, -1, 1]).strokes.length === 0, 'drag with 2 reversals over the creature: no stroke');
  const three = rub([1, -1, 1, -1]);
  ok(three.strokes.length === 1 && three.strokes[0].creatureId === c.id && three.strokes[0].strength >= 0.2 && three.strokes[0].strength <= 1, `3 reversals: one stroke ${JSON.stringify(three.strokes[0])}`);
  ok(three.pose === 'hand-stroke', `pose while stroking: ${three.pose}`);
  ok(rub([1, -1, 1, -1, 1]).strokes.length === 1, '4 reversals: one stroke');
  ok(game.state.selectedCreature === null, 'stroking does not select the creature');
  // a rub away from the creature strokes nothing
  const away = f.log.length;
  moveTo(f.camera.worldToView(OX + 18.5, OY + 38.5, world.heightAt(OX + 18.5, OY + 38.5)));
  s.down(0);
  const p = game.input.pointer;
  for (const dir of [1, -1, 1, -1, 1]) for (let i = 0; i < 3; i++) { s.move(p.sx + 4 * dir, p.sy); step(1 / 30); }
  s.up(0);
  ok(!f.since(away).some((e) => e.type === 'stroke'), 'rubbing empty ground strokes nothing');

  // slap
  let n = f.log.length;
  moveTo(middle(c));
  s.down(2); s.up(2);
  const slap = f.since(n).filter((e) => e.type === 'slap');
  ok(slap.length === 1 && slap[0].creatureId === c.id && slap[0].strength === 1, `right click on the creature slaps: ${JSON.stringify(slap[0])}`);
  step(1 / 30);
  ok(hand.state.pose === 'hand-slap', `slap pose: ${hand.state.pose}`);
  step(0.5);

  // right click on ground without a selection does nothing
  n = f.log.length;
  moveTo(f.camera.worldToView(OX + 20.5, OY + 44.5, world.heightAt(OX + 20.5, OY + 44.5)));
  s.down(2); s.up(2);
  ok(!f.since(n).some((e) => e.type === 'tether'), 'no tether without a selected creature');

  // select with a click, then right click the ground
  moveTo(middle(c));
  s.down(0); s.up(0);
  ok(game.state.selectedCreature === c.id, 'left click on the creature selects it');
  step(1 / 30);
  ok(hand.state.pose === 'hand-point', `pose while a creature is selected: ${hand.state.pose}`);
  const gx = OX + 19.5, gy = OY + 44.5;
  moveTo(f.camera.worldToView(gx, gy, world.heightAt(gx, gy)));
  n = f.log.length;
  s.down(2); s.up(2);
  const tether = f.since(n).filter((e) => e.type === 'tether');
  ok(tether.length === 1 && tether[0].creatureId === c.id && Math.hypot(tether[0].x - gx, tether[0].y - gy) < 0.5, `tether to the ground point: ${JSON.stringify(tether[0])}`);
  ok(game.state.selectedCreature === null, 'tether clears the selection');
  // right click on the creature while selected still slaps, and keeps the selection
  moveTo(middle(c));
  s.down(0); s.up(0);
  n = f.log.length;
  s.down(2); s.up(2);
  ok(f.since(n).some((e) => e.type === 'slap') && !f.since(n).some((e) => e.type === 'tether'), 'right click on the selected creature slaps, no tether');
  // a click on empty ground clears the selection
  moveTo(f.camera.worldToView(gx, gy, world.heightAt(gx, gy)));
  s.down(0); s.up(0);
  ok(game.state.selectedCreature === null, 'left click on the ground clears the selection');
});

section('front-most pick wins', () => {
  const f = setup();
  const { world, sp, moveTo, s, game } = f;
  const fig = getSprite('test-figure');
  const back = sp('villager', OX + 20.5, OY + 40.5, { sprite: fig });
  const front = sp('villager', OX + 20.9, OY + 40.9, { sprite: fig }); // larger x + y: drawn later, in front
  const v = f.camera.worldToView(front.x, front.y, front.z);
  moveTo({ sx: v.sx, sy: v.sy - 6 });
  s.down(0);
  ok(game.systems.hand.state.heldId === front.id, `overlapping villagers: the front one is grabbed (${game.systems.hand.state.heldId} vs front ${front.id}, back ${back.id})`);
  s.up(0);
});

section('game.state.uiCapture blocks new grabs, strokes, slaps and tethers, never a release', () => {
  const f = setup();
  const { s, step, sp, grab, moveTo, middle, game } = f;
  const hand = game.systems.hand;
  const rock = sp('rock', OX + 20.5, OY + 40.5, { sprite: getSprite('test-sphere', { ramp: 'rock', r: 3 }) });
  const c = sp('creature', OX + 24.5, OY + 42.5);
  const seen = (n, type) => f.since(n).filter((e) => e.type === type);
  // captured: press on the rock grabs nothing, a right click slaps nothing, a rub strokes nothing
  game.state.uiCapture = true;
  let n = f.log.length;
  grab(rock, 0.1);
  ok(hand.state.heldId === null && !rock.held && seen(n, 'grab').length === 0, `captured: left press on the rock grabs nothing (held ${hand.state.heldId})`);
  s.up(0);
  moveTo(middle(c));
  s.down(2); s.up(2);
  s.down(0);
  const p = game.input.pointer;
  for (const dir of [1, -1, 1, -1, 1]) for (let i = 0; i < 3; i++) { s.move(p.sx + 4 * dir, p.sy); step(1 / 30); }
  s.up(0);
  ok(seen(n, 'slap').length === 0 && seen(n, 'stroke').length === 0 && game.state.selectedCreature === null, 'captured: no slap, stroke or selection on the creature');
  // released: the same press grabs; capture switched on while holding still lets the rock go
  game.state.uiCapture = false;
  n = f.log.length;
  grab(rock, 0.1);
  ok(hand.state.heldId === rock.id && seen(n, 'grab').length === 1, 'capture off: the same press grabs the rock');
  game.state.uiCapture = true;
  s.up(0);
  ok(hand.state.heldId === null && !rock.held && seen(n, 'release').length === 1, 'captured while holding: the release still happens');
  game.state.uiCapture = false;
  // select, then capture: the right click on the ground sends no tether
  moveTo(middle(c));
  s.down(0); s.up(0);
  game.state.uiCapture = true;
  n = f.log.length;
  moveTo(f.camera.worldToView(OX + 19.5, OY + 44.5, f.world.heightAt(OX + 19.5, OY + 44.5)));
  s.down(2); s.up(2);
  ok(game.state.selectedCreature === c.id && seen(n, 'tether').length === 0, 'captured: a right click on the ground sends no tether');
  game.state.uiCapture = null; // hand it back to the ui system
});

// The hand in bulk on the real island with both villages set up: draw grain from a field and drop
// it on the storehouse; draw a standing tree's wood; take wood out of the woodpile, drop some on a
// blueprint and pour the rest in (god-building at godBuildFactor x the cost); multi pick-up of
// villagers (stowed, one out per click, the rest poured out) and of trees (dropped on the woodpile
// at once); never two rocks; shaking empties the hand.
section('the hand in bulk', () => {
  const f = setup();
  const { game, world, camera, s, step, sp, middle, moveTo } = f;
  const vs = game.systems.village;
  vs.setup();
  const hs = game.systems.hand, H = hs.state;
  const own = (type) => world.query({ kind: 'building' }).find((b) => b.owner === 'player' && b.type === type && b.stage === 'done');
  const at = (x, y) => { const v = camera.worldToView(x, y, world.heightAt(x, y)); return { sx: v.sx, sy: v.sy }; };
  const over = (b) => at(b.x, b.y);
  const field = own('field'), store = own('storehouse'), pile = own('woodpile');
  camera.centerOn(store.x, store.y, world.heightAt(store.x, store.y));
  step(1 / 30);
  const seen = { shake: [], pour: [] };
  game.events.on('shake', (e) => seen.shake.push(e));
  game.events.on('pour', (e) => seen.pour.push(e));

  // grain: hold on a ripe field, carry to the storehouse, let go
  field.growth = 1;
  // a click on the field takes nothing (drawing starts after drawDelay)
  moveTo(over(field)); s.down(0); s.up(0); step(1 / 30);
  ok(!H.held.length && field.growth === 1 && !world.query({ kind: 'grain' }).some((e) => e.madeBy === 'hand'), 'a click on a field draws nothing');
  s.down(0); step(HAND.drawDelay + 0.3);
  const early = H.load?.amount ?? 0;
  step(0.4);
  const grain = H.load;
  // the rate grows while the button is held: the second window draws faster than the first
  const r1 = early / 0.3, r2 = ((grain?.amount ?? 0) - early) / 0.4;
  ok(grain && grain.kind === 'grain' && early > 0 && r2 > 1.3 * r1, `holding on a field draws grain, faster the longer it is held (${r1.toFixed(0)}/s in the first 0.3 s, ${r2.toFixed(0)}/s in the next 0.4 s)`);
  // the field keeps growing while it is drawn from (by under 0.04 in 0.8 s, tended)
  ok(grain && field.growth >= 1 - grain.amount / VILLAGE.fieldYield && field.growth < 1 - grain.amount / VILLAGE.fieldYield + 0.04, `the field's crop falls by what was drawn (growth ${field.growth.toFixed(3)} after ${grain?.amount} drawn)`);
  const g0 = store.grain;
  moveTo(over(store)); step(0.2);
  ok(H.load?.amount === grain?.amount, 'passing over the storehouse with a field\'s grain takes none out of it');
  s.up(0); step(1 / 30);
  ok(store.grain === g0 + grain.amount && !H.held.length && !world.query({ kind: 'grain' }).some((e) => e.madeBy === 'hand'),
    `dropped on the storehouse, the grain goes into stock (${g0} -> ${store.grain})`);

  // a standing tree held still: its wood drains into the hand and the tree is gone when empty
  const tree = world.query({ kind: 'tree' }).filter((t) => !t.held).sort((a, b) => Math.hypot(a.x - store.x, a.y - store.y) - Math.hypot(b.x - store.x, b.y - store.y))[0];
  const want = woodIn(tree);
  let n = f.log.length;
  moveTo(middle(tree)); s.down(0);
  for (let i = 0; i < 200 && world.get(tree.id); i++) step(1 / 30);
  ok(!world.get(tree.id) && H.load?.kind === 'wood' && H.load.amount === want && !tree.held,
    `a press held still on a tree draws its ${want} wood and the tree is gone (hand ${H.load?.amount})`);
  ok(f.since(n).some((e) => e.type === 'act' && e.verb === 'uproot'), 'draining a tree uproots it (act)');
  const w0 = pile.wood;
  moveTo(over(pile)); step(0.2); s.up(0); step(1 / 30);
  ok(pile.wood === w0 + want && !H.held.length, `the wood dropped on the woodpile goes into stock (${w0} -> ${pile.wood})`);
  // a tree pulled up, set down, then drained: one uproot act in all (grab() counts it, the drain not again)
  // a tree with no other within 6 tiles, so the drag below sweeps up no second one
  const alone = (t) => !world.query({ kind: 'tree', x: t.x, y: t.y, r: 6 }).some((o) => o !== t);
  const lying = world.query({ kind: 'tree' }).filter((t) => !t.held && alone(t)).sort((a, b) => Math.hypot(a.x - store.x, a.y - store.y) - Math.hypot(b.x - store.x, b.y - store.y))[0];
  n = f.log.length;
  const lq = middle(lying);
  moveTo(lq); s.down(0); s.move(lq.sx + 4, lq.sy); step(0.2);
  const pulled = lying.held && lying.uprooted;
  for (let i = 0; i < 20; i++) { s.move(lq.sx + 4 + i, lq.sy + 30 + i * 2); step(1 / 30); }
  step(0.5); s.up(0); step(1.5);
  moveTo(middle(lying)); s.down(0);
  for (let i = 0; i < 200 && world.get(lying.id); i++) step(1 / 30);
  ok(pulled && !world.get(lying.id) && H.load?.kind === 'wood', `a tree pulled up and set down drains like a standing one (pulled ${pulled}, hand ${H.load?.amount})`);
  const ups = f.since(n).filter((e) => e.type === 'act' && e.verb === 'uproot').length;
  ok(ups === 1, `pulling a tree up and then draining it acts one uproot, not two (${ups})`);
  moveTo(over(pile)); step(0.2); s.up(0); step(1 / 30);

  // the woodpile: take wood out, drop part on a blueprint, pour the rest in
  pile.wood = 5000;
  const spot = (() => {
    for (let r = 3; r < 9; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const tx = Math.floor(store.x) + dx, ty = Math.floor(store.y) + dy;
      if (vs.validate('house', tx, ty).ok) return [tx, ty];
    }
    return null;
  })();
  const site = world.get(vs.placeBlueprint('house', spot[0], spot[1]));
  const cost = site.woodCost;
  moveTo(over(pile)); s.down(0);
  for (let i = 0; i < 300 && (H.load?.amount ?? 0) < 100; i++) step(1 / 30);
  const taken = H.load?.amount ?? 0;
  ok(taken >= 100 && pile.wood === 5000 - taken, `holding on the woodpile takes wood out (${taken}, pile ${pile.wood})`);
  moveTo(over(site)); step(HAND.pourDelay / 2); s.up(0); step(1 / 30);
  ok(site.woodHave === Math.min(cost, taken) && site.stage === 'blueprint' && site.progress === 0, `dropped on a blueprint, the wood pays in at cost (woodHave ${site.woodHave} of ${cost})`);
  const before = { have: site.woodHave, god: vs.stats().player.godWood };
  moveTo(over(pile)); s.down(0);
  for (let i = 0; i < 400 && (H.load?.amount ?? 0) < 2 * cost; i++) step(1 / 30);
  moveTo(over(site));
  step(HAND.pourDelay / 2);
  ok(site.woodHave === before.have && !seen.pour.length, 'passing over a site does not pour (the hand must stay over it)');
  const carried = H.load?.amount ?? 0;
  for (let i = 0; i < 300 && site.stage !== 'done'; i++) step(1 / 30);
  const god = vs.stats().player.godWood - before.god;
  const left = H.load?.amount ?? 0;
  ok(site.stage === 'done' && seen.pour.length > 0, `held over the blueprint, the wood pours in and god-builds it (${site.stage})`);
  const expect = (cost - before.have) + cost * (VILLAGE.godBuildFactor - 1);
  ok(Math.abs(god - expect) <= 1 && carried - left === god, `god-building used ${god} wood for the ${cost - before.have} the site still lacked (expected ${expect}: more than builders use); the hand kept ${left}`);
  s.up(0); step(1 / 30);
  if (H.held.length) hs.shake();

  // multi pick-up: villagers swept up, stowed, put out one per click, the rest poured out
  const fig = getSprite('test-figure');
  const vx = store.x + 3, vy = store.y + 3;
  const group = [0, 1, 2].map((i) => sp('villager', vx + i * 0.8, vy, { hp: 1, sprite: fig, grabbable: true, owner: 'player' }));
  step(1 / 30);
  for (const v of group) world.move(v, vx + group.indexOf(v) * 0.8, vy, world.heightAt(vx + group.indexOf(v) * 0.8, vy));
  moveTo(middle(group[0])); s.down(0); step(1 / 30);
  for (const v of group.slice(1)) { moveTo(middle(v)); step(1 / 30); }
  ok(H.held.length === 3 && group.every((v) => v.held), `sweeping across villagers holds all three (${H.held.length})`);
  step(0.2); // the hand comes to rest: a slow release
  s.up(0); step(1 / 30);
  ok(H.stowed && H.held.length === 3 && group.every((v) => v.held), 'a group stays in the hand when the button is let go slowly');
  moveTo(at(vx, vy + 2)); step(0.2); s.down(0); s.up(0); step(1 / 30);
  ok(H.held.length === 2 && group.filter((v) => !v.held).length === 1, `a click puts one out (${H.held.length} left)`);
  s.down(0);
  for (let i = 0; i < 30 && H.held.length; i++) step(1 / 30);
  s.up(0); step(1 / 30);
  ok(!H.held.length && !H.stowed && group.every((v) => !v.held), 'holding the button pours the rest out');
  step(1);
  // a flick throws a whole group; a press on two overlapping villagers takes only the front one
  for (const [i, v] of group.entries()) { v.path = null; v.work = null; v.wait = 5; world.move(v, vx + i * 0.8, vy, world.heightAt(vx + i * 0.8, vy)); }
  step(1 / 30);
  moveTo(middle(group[0])); s.down(0); step(1 / 30);
  for (const v of group.slice(1)) { moveTo(middle(v)); step(1 / 30); }
  const nGroup = H.held.length;
  f.flick(1, 0, 10);
  step(1 / 30);
  ok(nGroup === 3 && !H.held.length && group.every((v) => !v.held && v.airborne), `a flick throws the whole group (${nGroup} held, then ${H.held.length}; airborne ${group.filter((v) => v.airborne).length})`);
  step(2);
  // a fresh pair: whether the thrown group survives its landing depends on the ground it lands on
  const pair = [0, 1].map(() => sp('villager', vx, vy, { hp: 1, sprite: fig, grabbable: true, owner: 'player' }));
  step(1 / 30);
  for (const v of pair) { v.path = null; v.work = null; v.wait = 5; world.move(v, vx, vy, world.heightAt(vx, vy)); }
  moveTo(middle(pair[0])); s.down(0); step(0.2);
  ok(H.held.length === 1, `a press on two villagers standing on one spot holds one (${H.held.length})`);
  step(0.2); s.up(0); step(1);

  // multi pick-up of trees, let go over the woodpile: all their wood goes in at once
  const trees = [0, 1, 2].map((i) => sp('tree', store.x - 3 + i * 0.9, store.y - 3, { sprite: getSprite('test-tree'), species: 'broad', growth: 1, grabbable: true }));
  step(1 / 30);
  const woods = trees.reduce((a, t) => a + woodIn(t), 0);
  const p0 = pile.wood;
  const q0 = middle(trees[0]);
  moveTo(q0); s.down(0); s.move(q0.sx + 4, q0.sy); step(1 / 30);
  for (const t of trees.slice(1)) { moveTo(middle(t)); step(1 / 30); }
  ok(H.held.length === 3 && H.load?.amount === woods, `sweeping across trees holds three with ${woods} wood (${H.held.length}, ${H.load?.amount})`);
  moveTo(over(pile)); step(0.3); s.up(0); step(1 / 30);
  ok(pile.wood === p0 + woods && trees.every((t) => !world.get(t.id)) && !H.held.length, `trees let go over the woodpile go in together (${p0} -> ${pile.wood}, want +${woods}; left ${trees.filter((t) => world.get(t.id)).length}, held ${H.held.length})`);

  // never rocks: a second rock is not swept up. Villagers are made ungrabbable meanwhile, so one
  // walking past is not picked in front of a rock.
  const people = world.query({ kind: 'villager' });
  for (const v of people) v.grabbable = false;
  const rocks = [0, 1].map((i) => sp('rock', vx + i * 0.8, vy + 1.5, { sprite: getSprite('test-sphere', { ramp: 'rock', r: 3 }) }));
  moveTo(middle(rocks[0])); s.down(0); step(1 / 30);
  moveTo(middle(rocks[1])); step(1 / 30);
  ok(H.held.length === 1 && !rocks[1].held, `rocks are never swept up together (${H.held.length}: ${H.held.map((id) => world.get(id)?.kind)})`);
  s.up(0); step(1);

  // shake: fast side-to-side while holding empties the hand
  const v2 = rocks[1];
  moveTo(middle(v2)); s.down(0); step(1 / 30);
  ok(H.heldId === v2.id, `holding a rock before the shake (${H.held.map((id) => world.get(id)?.kind)})`);
  const p = game.input.pointer;
  for (let i = 0; i < 12 && H.held.length; i++) { s.move(p.sx + (i % 2 ? -40 : 40), p.sy); step(1 / 30); }
  ok(!H.held.length && seen.shake.length === 1 && !v2.held, `shaking empties the hand (${seen.shake.length} shake)`);
  s.up(0); step(1 / 30);
  ok(!H.held.length, 'letting go after a shake drops nothing more');
  // a slow back-and-forth keeps what is held
  moveTo(middle(rocks[0])); s.down(0); step(1 / 30);
  for (let i = 0; i < 30; i++) { s.move(p.sx + (i % 2 ? -14 : 14), p.sy); step(2 / 30); } // 14 px moves at 210 px/s
  ok(H.heldId === rocks[0].id && seen.shake.length === 1, `a slow wiggle does not shake (held ${H.held.length}, ${seen.shake.length} shake)`);
  s.up(0); step(1);
  // shaken mid-draw with the button still down: the hand stays empty
  field.growth = 1;
  for (const v of people) if (v.job === 'farmer') { v.path = null; v.work = null; v.wait = 5; world.move(v, store.x + 6, store.y + 6, world.heightAt(store.x + 6, store.y + 6)); }
  moveTo(over(field)); s.down(0); step(HAND.drawDelay + 0.4);
  const drew = H.load?.amount ?? 0;
  for (let i = 0; i < 12 && H.held.length; i++) { s.move(p.sx + (i % 2 ? -40 : 40), p.sy); step(1 / 30); }
  const g1 = f.log.length;
  step(1);
  ok(drew > 0 && !H.held.length && !f.since(g1).some((e) => e.type === 'grab'), `shaken mid-draw, the hand stays empty while the button is held (drew ${drew}, holds ${H.held.length})`);
  s.up(0); step(1 / 30);
  // Escape empties it too
  moveTo(middle(rocks[0])); s.down(0); step(1 / 30);
  s.keyDown('Escape'); s.keyUp('Escape'); step(1 / 30);
  ok(!H.held.length && seen.shake.length === 3, 'Escape empties the hand');
  s.up(0); step(1 / 30);
  // Esc with the hand full keeps a creature selected; with it empty clears the selection
  const c = sp('creature', store.x + 4, store.y - 4);
  step(1 / 30);
  game.state.selectedCreature = c.id;
  moveTo(middle(rocks[0])); s.down(0); step(1 / 30);
  s.keyDown('Escape'); s.keyUp('Escape'); step(1 / 30);
  ok(!H.held.length && game.state.selectedCreature === c.id, 'Esc while holding empties the hand and keeps the creature selected');
  s.up(0); step(1 / 30);
  s.keyDown('Escape'); s.keyUp('Escape'); step(1 / 30);
  ok(game.state.selectedCreature === null, 'Esc with the hand empty clears the selection');
  world.remove(c.id);
  // a pedestal orb shaken out is cancelled: no cast, no fizzle, gone, its pedestal refills
  const casts = [];
  for (const type of ['miracle-cast', 'miracle-fizzle']) game.events.on(type, (e) => casts.push(type));
  const orbId = game.systems.miracles.orbs.orbOn('rain');
  const orb = orbId !== null && world.get(orbId);
  if (ok(orb, 'a rain orb waits on its pedestal')) {
    camera.centerOn(orb.x, orb.y, orb.z);
    step(1 / 30);
    moveTo(middle(orb)); s.down(0); step(0.2);
    ok(H.heldId === orb.id, 'the hand holds the orb');
    s.keyDown('Escape'); s.keyUp('Escape'); step(1 / 30);
    s.up(0); step(1);
    ok(!world.get(orb.id) && !casts.length && !H.held.length, `the shaken-out orb is gone uncast (${casts.join(',') || 'no cast or fizzle'})`);
    step(5);
    ok(game.systems.miracles.orbs.orbOn('rain') !== null && !casts.length, 'its pedestal has a new orb a few seconds later');
  }
  for (const v of people) v.grabbable = true;
});

// The amount label stays on screen: drawn with and without a tag, the pixels that differ are the
// label's. Near the right edge of the view it moves to the hand's left, whole and clear of the hand.
section('the amount label stays in view', () => {
  const W = 160, H = 90, lut = makeLut(0);
  const hand = { x: 0, y: 0, z: 0, pose: 'hand-hold' }, tag = { text: '1234', icon: 'wood' };
  const sprite = getSprite(hand.pose);
  /** Columns of the label's pixels with the hand at view x vx. */
  const labelCols = (vx) => {
    const frame = (t) => {
      const ctx = { w: W, h: H, buf: new Uint32Array(W * H), lut, toView: () => ({ vx, vy: 45 }) };
      drawTop(ctx, hand, [], t);
      return ctx.buf;
    };
    const a = frame(null), b = frame(tag), cols = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) cols.push(i % W);
    return cols;
  };
  const mid = labelCols(60), edge = labelCols(W - 4);
  ok(mid.length > 0 && Math.min(...mid) > 60 - sprite.ax, `in the middle of the view the label is drawn right of the hand (${mid.length} px)`);
  ok(edge.length === mid.length, `at the right edge the whole label is drawn (${edge.length} of ${mid.length} px)`);
  ok(edge.length > 0 && Math.max(...edge) < W - 4 - sprite.ax, `at the right edge the label is left of the hand (rightmost column ${Math.max(...edge)}, hand from ${W - 4 - sprite.ax})`);
  // the flip point: the last hand position whose label still fits on the right keeps it there, whole
  const fit = W - 1 - (Math.max(...mid) - 60);
  const atFit = labelCols(fit), past = labelCols(fit + 1);
  ok(atFit.length === mid.length && Math.min(...atFit) > fit - sprite.ax && Math.max(...atFit) === W - 1, `a label that just fits stays right of the hand, whole (${atFit.length} of ${mid.length} px, rightmost column ${Math.max(...atFit)})`);
  ok(past.length === mid.length && Math.max(...past) < fit + 1 - sprite.ax, `one pixel further right it moves left of the hand, whole (${past.length} of ${mid.length} px)`);
});

section('update and input handlers never touch the DOM or Math.random', () => {
  const f = setup();
  const { sp, s, game } = f;
  const rock = sp('rock', OX + 20.5, OY + 40.5);
  const c = sp('creature', OX + 24.5, OY + 42.5);
  const touched = [];
  const names = ['window', 'document', 'requestAnimationFrame', 'HTMLCanvasElement', 'navigator', 'localStorage'];
  const saved = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    Object.defineProperty(globalThis, name, { configurable: true, get() { touched.push(name); return undefined; } });
  }
  const realRandom = Math.random;
  let randomCalls = 0;
  Math.random = () => { randomCalls++; return realRandom(); };
  // the traps must count planted accesses, or the zero counts below prove nothing
  void globalThis.window; void document; Math.random();
  ok(touched.length === 2 && randomCalls === 1, `traps count planted accesses (DOM ${touched.length} of 2, Math.random ${randomCalls} of 1)`);
  touched.length = 0; randomCalls = 0;
  let threw = null;
  try {
    f.grab(rock);
    f.flick(1, 0, 10);
    for (let i = 0; i < 60; i++) game.tick(game.clock.step);
    f.moveTo(f.middle(c));
    s.down(2); s.up(2);
    s.down(0); s.up(0);
    for (let i = 0; i < 10; i++) game.tick(game.clock.step);
  } catch (err) { threw = err; }
  Math.random = realRandom;
  for (const name of names) {
    const d = saved.get(name);
    if (d) Object.defineProperty(globalThis, name, d); else delete globalThis[name];
  }
  ok(!threw, `hand sim ran without throwing (${threw})`);
  ok(touched.length === 0, `no DOM globals read during update and input handling (${[...new Set(touched)].join(', ')})`);
  ok(randomCalls === 0, `no Math.random calls during update and input handling (${randomCalls})`);
  // source scan: no Math.random, no DOM names in the hand's code
  const files = ['src/systems/hand.js', ...readdirSync('src/hand').map((n) => `src/hand/${n}`)];
  for (const file of files) {
    const code = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    ok(!/Math\.random/.test(code), `${file}: no Math.random`);
    ok(!/\b(window|document|requestAnimationFrame|getContext)\b/.test(code), `${file}: no DOM access`);
  }
});

section('every emitted event carries its spec fields', () => {
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const id = (v) => v !== undefined && v !== null;
  const SPEC = {
    grab: (e) => id(e.entityId) && ['x', 'y', 'z', 'vx', 'vy', 'vz'].every((k) => num(e[k])),
    release: (e) => id(e.entityId) && ['x', 'y', 'z', 'vx', 'vy', 'vz'].every((k) => num(e[k])) && typeof e.kind === 'string' && 'miracle' in e,
    landed: (e) => id(e.entityId) && num(e.speed) && e.speed >= 0,
    stroke: (e) => id(e.creatureId) && num(e.strength) && e.strength >= 0.2 && e.strength <= 1,
    slap: (e) => id(e.creatureId) && e.strength === 1,
    tether: (e) => id(e.creatureId) && num(e.x) && num(e.y),
    // 'cast' acts come from the miracles system (the pedestal orb throws above), the rest from the hand
    act: (e) => e.actor === 'player' && (['throw', 'drop', 'uproot'].includes(e.verb) || (e.verb === 'cast' && ['rain', 'heal', 'fire', 'lightning'].includes(e.target))) && typeof e.target === 'string'
      && num(e.weight) && e.weight >= -1 && e.weight <= 1 && num(e.x) && num(e.y),
  };
  for (const [type, valid] of Object.entries(SPEC)) {
    const seen = allEvents.filter((e) => e.type === type);
    const bad = seen.filter((e) => !valid(e));
    ok(seen.length > 0, `at least one ${type} event was emitted`);
    ok(bad.length === 0, `${type}: all ${seen.length} payloads carry the spec fields${bad.length ? ` (first bad: ${JSON.stringify(bad[0])})` : ''}`);
  }
});

console.log(`${failed ? 'FAILED' : 'ok'}: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;

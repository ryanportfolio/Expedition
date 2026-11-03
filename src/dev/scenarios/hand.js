// Hand scenario: the real island with the engine's debug terrain pass, a few villagers, rocks, wood,
// an orb and a stand-in creature near the player village. Drives the hand only through synthetic
// pointer input and checks: grab and drop a rock, a long throw, a lethal and a gentle villager
// landing, a rock thrown into the sea, a stroke, a slap, and select-then-tether.
// Screenshots: carry (held rock with its shadow), flight (rock mid-air with its shadow), stroke
// (hand in the stroke pose over the creature), splash (rock sinking in the sea).
//
// Villager, rock, wood and orb sprites come from getSprite() under their own names once painters
// exist; until then the art kit's test-pattern sprites stand in. The creature stand-in is drawn here.
import { buildIsland, SCALE } from '../../world/island.js';
import { debugTerrainPass } from '../test-art.js';
import { lutFor } from '../../art/lut.js';
import { idx } from '../../art/palette.js';
import { getSprite, listSprites } from '../../art/registry.js';
import { createSprite, ellipse, rect, outline, sphereShade, line } from '../../art/sprite.js';
import { HAND } from '../../systems/hand.js';
import { groundToScreenVelocity } from '../../hand/tunables.js';
import { predictLanding } from '../../hand/flight.js';

// Spots below are written round the player village's 64 x 64 centre (20, 40); the island is drawn
// SCALE times larger now (src/world/island.js), which moves the village to (20, 40) x SCALE.
const OX = 20 * (SCALE - 1), OY = 40 * (SCALE - 1);

const named = (name, opts, fallback, fallbackOpts) => (listSprites().includes(name) ? getSprite(name, opts) : getSprite(fallback, fallbackOpts));

/** Stand-in creature: a tall, gaunt slate figure with a hooded head, about 70 px tall. */
function creatureStandIn() {
  const s = createSprite(30, 72, 15, 71);
  const slate = idx('rock', 3);
  rect(s, 11, 18, 9, 26, slate); // torso
  ellipse(s, 15, 11, 5, 6, slate); // hooded head
  rect(s, 6, 20, 4, 24, slate); // arms hang long
  rect(s, 21, 20, 4, 24, slate);
  rect(s, 11, 44, 3, 27, slate); // legs
  rect(s, 17, 44, 3, 27, slate);
  sphereShade(s, 'rock', { lo: 1, hi: 6, cx: 13, cy: 30, rx: 12, ry: 40 });
  rect(s, 13, 11, 5, 3, idx('ink', 0)); // the face stays in shadow
  line(s, 15, 26, 15, 30, idx('fire', 5)); // ember seam in the chest
  return outline(s, idx('ink', 0));
}

/** Stand-in wood: a short log lying across the ground. */
function logStandIn() {
  const s = createSprite(12, 5, 6, 4);
  rect(s, 1, 1, 10, 3, idx('bark', 4));
  line(s, 1, 1, 10, 1, idx('bark', 6));
  rect(s, 0, 1, 1, 3, idx('bark', 6));
  return outline(s, idx('bark', 0), { grow: false });
}

export default async function hand(t, game) {
  const { world, camera, renderer, events, input } = game;
  world.loadMap(buildIsland());
  renderer.lut = lutFor(0);
  renderer.addTerrainPass(debugTerrainPass);
  const site = world.sites.village;
  camera.centerOn(site.x + 2, site.y + 1, world.heightAt(site.x, site.y));

  const fig = named('villager', { pose: 'idle' }, 'test-figure');
  const rockSprite = named('rock', {}, 'test-sphere', { ramp: 'rock', r: 3 });
  const orbSprite = named('orb', { miracle: 'rain' }, 'test-sphere', { ramp: 'lightning', r: 3 });
  const wood = logStandIn();
  const sp = (kind, x, y, extra) => world.spawn(kind, { x, y, ...extra });
  const villagers = [sp('villager', OX + 19.5, OY + 39.5, { hp: 1, sprite: fig }), sp('villager', OX + 21.5, OY + 41.5, { hp: 1, sprite: fig }), sp('villager', OX + 18.5, OY + 41.5, { hp: 1, sprite: fig })];
  const rocks = [sp('rock', OX + 19.5, OY + 40.5, { sprite: rockSprite }), sp('rock', OX + 23.5, OY + 39.5, { sprite: rockSprite }), sp('rock', OX + 16.5, OY + 41.5, { sprite: rockSprite })];
  sp('wood', OX + 21.5, OY + 38.5, { sprite: wood });
  sp('wood', OX + 22.0, OY + 38.9, { sprite: wood });
  sp('orb', OX + 18.5, OY + 38.5, { miracle: 'rain', sprite: orbSprite });
  const creature = sp('creature', OX + 26.5, OY + 44.5, { sprite: creatureStandIn() });

  const log = [];
  for (const type of ['grab', 'release', 'landed', 'act', 'stroke', 'slap', 'tether']) events.on(type, (e) => log.push({ type, ...e }));
  const since = (n) => log.slice(n);
  const s = input.synth, p = input.pointer, handSys = game.systems.hand;
  const tick = () => t.step(game.clock.step);
  const middle = (e) => {
    const v = camera.worldToView(e.x, e.y, e.z);
    return { sx: v.sx, sy: v.sy - Math.floor((e.sprite?.ay ?? 8) / 2) };
  };
  const moveTo = (q) => { s.move(q.sx, q.sy); tick(); };
  const ground = (x, y) => camera.worldToView(x, y, world.heightAt(x, y));
  const grab = (e, hold = 0.4) => { moveTo(middle(e)); s.down(0); t.step(hold); };
  /** Moves the pointer so the release launches at `speed` tiles/s toward (dx, dy); `beforeUp` runs before letting go. */
  const flick = (dx, dy, speed, ticks = 4) => {
    const k = speed / HAND.throwGain / Math.hypot(dx, dy), v = groundToScreenVelocity(dx * k, dy * k);
    for (let i = 0; i < ticks; i++) { s.move(p.sx + v.vsx / 30, p.sy + v.vsy / 30); tick(); }
    s.up(0);
  };
  const onTerrain = (e) => Math.abs(e.z - world.heightAt(e.x, e.y)) <= 0.05;
  t.step(0.2);

  // ---- 1. grab, carry and drop a rock
  let n = log.length;
  const r0 = rocks[0];
  grab(r0, 0.1);
  t.assert(handSys.state.heldId === r0.id && since(n).some((e) => e.type === 'grab' && e.entityId === r0.id), 'left press grabs the rock (grab event)');
  moveTo(ground(OX + 21.5, OY + 42));
  t.step(0.5);
  t.assert(Math.abs(r0.z - world.heightAt(r0.x, r0.y) - HAND.carryZ) < 0.1, `carried rock hovers above the terrain (${(r0.z - world.heightAt(r0.x, r0.y)).toFixed(2)})`);
  await t.shot('carry');
  s.up(0);
  t.step(1);
  const drop = since(n);
  const rel0 = drop.find((e) => e.type === 'release');
  t.assert(rel0 && rel0.entityId === r0.id && rel0.kind === 'rock' && rel0.vx === 0 && rel0.vz === 0, `release event, still pointer drops: ${JSON.stringify(rel0)}`);
  t.assert(drop.some((e) => e.type === 'landed' && e.entityId === r0.id), 'landed event for the dropped rock');
  t.assert(onTerrain(r0) && !r0.airborne && Math.hypot(r0.x - (OX + 21.5), r0.y - (OY + 42)) < 0.2, `dropped rock rests on the terrain (${r0.x.toFixed(2)}, ${r0.y.toFixed(2)}, z ${r0.z.toFixed(2)} vs ${world.heightAt(r0.x, r0.y).toFixed(2)})`);

  // ---- 2. throw a rock far
  n = log.length;
  const r1 = rocks[1];
  grab(r1);
  flick(0.3, -1, 12);
  const rel1 = since(n).find((e) => e.type === 'release');
  t.step(0.25);
  const midAir = r1.z - world.heightAt(r1.x, r1.y);
  t.assert(r1.airborne && midAir > 1, `rock is mid-air ${midAir.toFixed(2)} height units over the terrain`);
  await t.shot('flight');
  for (let i = 0; i < 90 && r1.airborne; i++) tick();
  const land1 = since(n).find((e) => e.type === 'landed' && e.entityId === r1.id);
  const dist1 = land1 && Math.hypot(land1.x - rel1.x, land1.y - rel1.y);
  t.assert(land1 && dist1 > 6, `thrown rock travels ${dist1?.toFixed(2)} tiles (> 6)`);
  t.assert(land1 && Math.abs(land1.z - world.heightAt(land1.x, land1.y)) <= 0.05, 'thrown rock lands on the terrain height');
  t.assert(!r1.airborne && onTerrain(r1), 'thrown rock settles on the terrain');

  // ---- 3. throw a villager hard, drop one gently
  n = log.length;
  const v0 = villagers[0];
  grab(v0);
  flick(1, 0.4, 14);
  t.step(2);
  const killAct = since(n).find((e) => e.type === 'act' && e.weight === -0.6);
  t.assert(v0.hp === 0, `hard-thrown villager hp ${v0.hp} (want 0)`);
  t.assert(killAct && killAct.actor === 'player' && killAct.verb === 'throw' && killAct.target === 'villager', `act event for the kill: ${JSON.stringify(killAct)}`);
  n = log.length;
  const v1 = villagers[1];
  grab(v1);
  s.up(0);
  t.step(1.5);
  t.assert(v1.hp === 1 && !since(n).some((e) => e.type === 'act' && e.weight === -0.6), `gently dropped villager keeps hp ${v1.hp}`);
  t.assert(onTerrain(v1), 'dropped villager stands on the terrain');

  // ---- 4. throw a rock into the sea. The sea is far from the village on the island, so the rock
  // and the camera move to the walkable tile nearest the village with open water 3 tiles off.
  const r2 = rocks[2], home = { x: camera.x, y: camera.y };
  let shore = null;
  for (let ty = 3, bd = Infinity; ty < world.h - 3; ty++) for (let tx = 3; tx < world.w - 3; tx++) {
    const g = world.ground[ty * world.w + tx];
    if (g < 2 || g > 4 || world.ground[ty * world.w + tx - 3] > HAND.waterGround) continue;
    const d = Math.hypot(tx - site.x, ty - site.y);
    if (d < bd) { bd = d; shore = { x: tx + 0.5, y: ty + 0.5 }; }
  }
  world.move(r2, shore.x, shore.y, world.heightAt(shore.x, shore.y));
  camera.centerOn(shore.x, shore.y, world.heightAt(shore.x, shore.y));
  t.step(1 / 30);
  grab(r2);
  const water = (q) => q && world.ground[Math.floor(q.y) * world.w + Math.floor(q.x)] <= HAND.waterGround;
  let dir = null;
  for (let k = 0; k < 32 && !dir; k++) {
    const a = Math.PI * 0.75 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 16);
    const dx = Math.cos(a), dy = Math.sin(a);
    const all = [0, 1, 2, 3].every((d) => {
      const x = r2.x + dx * d, y = r2.y + dy * d;
      return water(predictLanding(x, y, world.heightAt(x, y) + HAND.carryZ, dx * HAND.throwMax, dy * HAND.throwMax, HAND.throwMax * HAND.loft, world.heightAt, HAND.gravity, world));
    });
    if (all) dir = [dx, dy];
  }
  t.assert(dir, 'found a throw direction toward the sea');
  if (dir) {
    n = log.length;
    const fx0 = game.fx.live.length;
    flick(dir[0], dir[1], HAND.throwMax);
    for (let i = 0; i < 90 && r2.airborne; i++) tick();
    const land2 = since(n).find((e) => e.type === 'landed' && e.entityId === r2.id);
    t.assert(land2 && land2.water === true, `rock lands in the sea: ${JSON.stringify(land2)}`);
    t.assert(r2.sinking && game.fx.live.length > fx0, 'splash effect spawned and the rock sinks');
    const keep = { x: camera.x, y: camera.y };
    camera.centerOn(r2.x + 2, r2.y - 2, world.heightAt(r2.x, r2.y));
    t.step(0.3);
    await t.shot('splash');
    camera.x = keep.x; camera.y = keep.y;
    t.step(HAND.sinkTime);
    t.assert(!world.get(r2.id), 'rock removed after sinking');
  }
  camera.x = home.x; camera.y = home.y;
  t.step(1 / 30);

  // ---- 5. stroke the creature
  n = log.length;
  moveTo(middle(creature));
  s.down(0);
  tick();
  let poseSeen = null;
  for (const d of [1, -1, 1, -1]) {
    for (let i = 0; i < 3; i++) { s.move(p.sx + 4 * d, p.sy); tick(); }
  }
  poseSeen = handSys.state.pose;
  await t.shot('stroke');
  s.up(0);
  t.step(0.5);
  const strokes = since(n).filter((e) => e.type === 'stroke');
  t.assert(strokes.length === 1 && strokes[0].creatureId === creature.id && strokes[0].strength >= 0.2 && strokes[0].strength <= 1, `one stroke event: ${JSON.stringify(strokes)}`);
  t.assert(poseSeen === 'hand-stroke', `stroke pose while rubbing (${poseSeen})`);

  // ---- 6. slap
  n = log.length;
  moveTo(middle(creature));
  s.down(2); s.up(2);
  const slaps = since(n).filter((e) => e.type === 'slap');
  t.assert(slaps.length === 1 && slaps[0].creatureId === creature.id && slaps[0].strength === 1, `right click slaps: ${JSON.stringify(slaps)}`);
  t.step(0.5);

  // ---- 7. select, then right click the ground
  moveTo(middle(creature));
  s.down(0); s.up(0);
  t.assert(game.state.selectedCreature === creature.id, 'left click selects the creature');
  tick();
  t.assert(handSys.state.pose === 'hand-point', `hand points while the creature is selected (${handSys.state.pose})`);
  const gx = OX + 17.5, gy = OY + 43.5;
  moveTo(ground(gx, gy));
  await t.shot('tether-aim');
  n = log.length;
  s.down(2); s.up(2);
  const teth = since(n).filter((e) => e.type === 'tether');
  t.assert(teth.length === 1 && teth[0].creatureId === creature.id && Math.hypot(teth[0].x - gx, teth[0].y - gy) < 0.5, `tether to the clicked ground point: ${JSON.stringify(teth)}`);
  t.assert(game.state.selectedCreature === null, 'tether clears the selection');
  t.log('events', log.length, 'flights left', handSys.state.flights.size);
}

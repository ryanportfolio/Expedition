// Hand system: the player's divine hand. It floats over the terrain under the pointer, picks up,
// carries and throws things, draws grain and wood out in bulk, strokes and slaps the creature, and
// points the creature somewhere.
//
// Input map (user decisions): left press on a grabbable thing grabs it; dragging carries it and
// letting go releases it with the pointer's speed (slow = drop, fast = throw). Left-drag back and
// forth over the creature strokes it. Left click (no drag) on the creature selects it; a right click
// on the ground then sends it there (tether). Right click on the creature slaps it. Wheel zoom and
// edge or middle-drag pan belong to the camera.
//
// The hand in bulk (gameplay spec step 1):
// - Drawing. Holding the left button on one of the player's fields draws its grain, on a storehouse
//   its grain, on a woodpile its wood; on a tree, a press held still for treeDrawDelay draws the
//   tree's wood (a tree drained empty is gone), while a press that moves pulls the tree up as
//   before. The amount grows faster the longer the button is held (HAND.draw) and rides in the hand
//   as one wood or grain pile. While the button stays down the hand keeps drawing from every source
//   of that resource it passes over (stores only when the press began on a store).
// - Dropping a pile or a tree slowly on a player storehouse (grain) or woodpile (wood, trees) puts it
//   in stock; on a blueprint short of wood it pays wood in, the rest is left beside it.
// - Pouring. Holding a wood pile over a player site for pourDelay pours it in and god-builds the site
//   (godBuild in src/village/sim.js: the whole job costs VILLAGE.godBuildFactor x the wood).
// - Multi pick-up (HAND.multiPickup). Sweeping across villagers or trees with the button down after
//   grabbing one of them adds every one of that kind the hand passes over. A group of two or more
//   stays in the hand when the button is let go (a tree group let go slowly over a woodpile or
//   blueprint goes in at once); then a click puts one out (thrown if the click flicks), and holding
//   the button puts them out one per pourInterval where the hand goes.
// - Shaking the hand (shakeReversals fast direction changes) or Escape empties it: everything held
//   drops where the hand is and an orb is cancelled (it vanishes uncast; its pedestal refills).
//
// Events (spec): grab / release { entityId, kind, miracle, x, y, z, vx, vy, vz }, landed { entityId,
// speed, kind, x, y, z, water }, stroke / slap { creatureId, strength }, tether { creatureId, x, y },
// act { actor: 'player', verb: 'throw'|'drop'|'uproot', target, weight, x, y }, shake { count, kind },
// pour { buildingId, amount }. A drawn pile is announced with grab when it first appears.
// Entity fields written: held (while carried), airborne (while flying), sinking, uprooted (trees),
// wood (trees drawn from), amount (piles), hp (villagers killed by a landing, buildings hit by
// rocks), x/y/z/vx/vy/vz.
// Shared state: game.state.selectedCreature (creature id or null).
//
// Pointer presses arrive as events between ticks and are handled at once, so a click (press and
// release with no tick between) works. update(dt) moves the hand, the carried objects and every
// flight; it never touches the DOM. draw(ctx) only reads.
import * as splash from 'pixelfx/fx/water/splash';
import { HAND, isGrabbable, releaseVelocity, bulkRate, PILE_KINDS } from '../hand/tunables.js';
import { stepBody } from '../hand/flight.js';
import { pickEntity } from '../hand/pick.js';
import { createStrokeTracker } from '../hand/stroke.js';
import { shadowFor, shadowItem, outlineItem, drawTop } from '../hand/draw.js';
import { getSprite, listSprites } from '../art/registry.js';
import { woodIn } from '../village/config.js';
import { removeTree } from '../village/sim.js';
import '../hand/placeholder-art.js';

export { HAND };

const STILL = Object.freeze({ vx: 0, vy: 0, vz: 0, speed: 0, thrown: false });

export function create(game) {
  const { world, events, input, camera } = game;
  const p = input.pointer;
  game.state ??= {};
  game.state.selectedCreature ??= null;

  const hand = {
    x: 0, y: 0, z: 0, ground: 0,
    pose: 'hand-open',
    heldId: null, // the first held entity (the one a single grab holds)
    held: [], // ids of everything in the hand, all of one kind
    stowed: false, // a group kept in the hand with the button up
    load: null, // { kind, count, amount } of what is held, for the label and checks
    pouring: null, // id of the site wood is being poured into this tick
    hoverId: null,
    time: 0,
    flights: new Map(), // id -> { x, y, z, vx, vy, vz, bounces, landed, thrown, hit, fromX, fromY }
    sinking: new Map(), // id -> { t }
  };
  let carry = null; // lagged anchor the held objects ride round
  let grabT = 0, slapT = 0, strokeT = 0;
  let gesture = null; // left press without a grab: { pressedId, creatureId, dragged, stroked, lastSx, lastSy }
  // left press with the hand at work: { mode: 'pending' (on a tree, undecided) | 'grab' | 'draw' |
  // 'put' (a stowed group) | 'shaken', t, ... }
  let press = null;
  let lastSx = 0, lastSy = 0;
  const tracker = createStrokeTracker({
    within: HAND.strokeWindow, need: HAND.strokeReversals, minTravel: HAND.strokeMinTravel, fullSpeed: HAND.strokeFullSpeed,
  });
  const shaker = createStrokeTracker({
    within: HAND.shakeWindow, need: HAND.shakeReversals, minTravel: HAND.shakeMinTravel, fullSpeed: HAND.shakeSpeed,
  });

  const near = () => (p.hit ? { x: p.x, y: p.y } : null);
  const canTouch = (e) => !e.sinking && !e.held && (e.kind === 'creature' || isGrabbable(e));
  const pickTouchable = () => pickEntity(world, camera, p.sx, p.sy, canTouch, near());
  const pickCreature = () => pickEntity(world, camera, p.sx, p.sy, (e) => e.kind === 'creature', near());
  const isWater = (x, y) => {
    const t = world.tile(Math.floor(x), Math.floor(y));
    return !t || t.ground <= HAND.waterGround;
  };
  const act = (verb, target, weight, x, y) => events.emit('act', { actor: 'player', verb, target, weight, x, y });
  /** The village sim once it is set up on this map, else null (the hand then only carries and throws). */
  const sim = () => (game.systems?.village?.ready ? game.systems.village.sim : null);
  /** The player building under the pointer that passes test(b): the one whose sprite is under it,
   * else the one whose footprint holds the hand's ground point (a house drawn over a field in front of
   * it does not hide the field). */
  function buildingUnder(test) {
    const s = sim();
    if (!s) return null;
    const b = pickEntity(world, camera, p.sx, p.sy, (e) => e.kind === 'building' && e.owner === 'player' && e.stage !== 'wrecked', near());
    if (b && test(b)) return b;
    const f = p.hit ? s.buildingAt(p.x, p.y) : null;
    return f && test(f) ? f : null;
  }

  // ---------------------------------------------------------------- pointer events
  events.on('pointer-down', ({ button }) => {
    if (game.state.uiCapture) return; // the interface has the pointer: no new grab, stroke, slap or tether
    if (button === 0) leftDown();
    else if (button === 2) rightDown();
    updatePose();
  });
  events.on('pointer-up', ({ button }) => {
    if (button === 0) leftUp();
    updatePose();
  });
  events.on('drag-start', ({ button }) => {
    if (button !== 0) return;
    if (gesture) gesture.dragged = true;
    // a press on a tree that moves before it is held still pulls the tree up
    if (press?.mode === 'pending') {
      const e = world.get(press.id);
      press = null;
      if (e && canTouch(e)) { grab(e); press = { mode: 'grab', t: 0 }; }
    }
  });
  events.on('key-down', ({ code }) => {
    if (code !== 'Escape') return;
    if (hand.held.length) shake();
    else game.state.selectedCreature = null;
  });

  function leftDown() {
    if (hand.held.length) {
      if (hand.stowed) press = { mode: 'put', t: 0, next: 0, put: false };
      return;
    }
    const e = pickTouchable();
    if (e?.kind === 'tree') { press = { mode: 'pending', id: e.id, t: 0 }; return; }
    if (e && e.kind !== 'creature') { grab(e); press = { mode: 'grab', t: 0 }; return; }
    if (!e) {
      const b = buildingUnder((o) => sim().handSource(o));
      const kind = b && sim().handSource(b);
      if (kind) { press = { mode: 'draw', t: 0, kind, trees: false, stores: b.type !== 'field' }; return; }
    }
    gesture = { pressedId: e ? e.id : null, creatureId: e ? e.id : null, dragged: false, stroked: false, lastSx: p.sx, lastSy: p.sy };
    tracker.reset();
  }

  function leftUp() {
    const pr = press;
    press = null;
    if (pr?.mode === 'shaken' || pr?.mode === 'pending') return; // a click on a tree does nothing
    if (pr?.mode === 'put') {
      // one click puts one out: dropped, or thrown when the click flicks
      if (!pr.put) { const e = heldList()[0]; if (e) releaseOne(e, releaseVelocity(p.vsx, p.vsy)); }
      return;
    }
    const list = heldList();
    if (list.length && !hand.stowed) {
      const v = releaseVelocity(p.vsx, p.vsy);
      if (list.length === 1) releaseOne(list[0], v);
      else if (list[0].kind === 'tree' && !v.thrown && sinkUnder('tree')) for (const e of list) releaseOne(e, STILL);
      else hand.stowed = true;
      return;
    }
    const g = gesture;
    gesture = null;
    if (!g || g.dragged || g.stroked) return;
    // a click: on the creature selects it, anywhere else clears the selection
    game.state.selectedCreature = g.pressedId;
  }

  function rightDown() {
    const c = pickCreature();
    if (c) {
      slapT = HAND.slapPose;
      events.emit('slap', { creatureId: c.id, strength: 1 });
      return;
    }
    const sel = game.state.selectedCreature;
    if (sel != null && world.get(sel) && p.hit) {
      events.emit('tether', { creatureId: sel, x: p.x, y: p.y });
      game.state.selectedCreature = null;
    }
  }

  function setHeld(ids) {
    hand.held = ids;
    hand.heldId = ids[0] ?? null;
    if (!ids.length) { carry = null; hand.stowed = false; }
  }

  /** Puts entity e in the hand (added to what it holds when `more`). */
  function grab(e, more = false) {
    if (!more) setHeld([]);
    setHeld([...hand.held, e.id]);
    hand.flights.delete(e.id);
    e.held = true;
    e.airborne = false;
    e.z ??= world.heightAt(e.x, e.y);
    e.vx = e.vy = e.vz = 0;
    carry ??= { x: e.x, y: e.y, z: e.z };
    grabT = HAND.grabPose;
    events.emit('grab', { entityId: e.id, kind: e.kind, miracle: e.miracle, x: e.x, y: e.y, z: e.z, vx: 0, vy: 0, vz: 0 });
    if (e.kind === 'tree' && !e.uprooted) {
      e.uprooted = true;
      act('uproot', 'tree', HAND.weights.uproot, e.x, e.y);
    }
  }

  /** Lets entity e out of the hand with launch velocity v ({ vx, vy, vz, thrown }). A slow drop of a
   * pile or tree over a player store or blueprint puts it in (unless shaken out). */
  function releaseOne(e, v, { shaken = false } = {}) {
    setHeld(hand.held.filter((id) => id !== e.id));
    e.held = false;
    launch(e, v.vx, v.vy, v.vz, v.thrown);
    events.emit('release', { entityId: e.id, kind: e.kind, miracle: e.miracle, x: e.x, y: e.y, z: e.z, vx: v.vx, vy: v.vy, vz: v.vz });
    // orbs report their own act when the miracle is cast
    if (e.kind !== 'orb') act(v.thrown ? 'throw' : 'drop', e.kind, v.thrown ? HAND.weights.throw : HAND.weights.drop, e.x, e.y);
    if (v.thrown || shaken || !world.get(e.id)) return;
    const b = sinkUnder(e.kind);
    if (b) sim().handPut(b, e);
  }

  /** The player building under the hand that takes a drop of `kind` ('grain', 'wood', 'tree'), or null. */
  function sinkUnder(kind) {
    const s = sim();
    if (!s || !(PILE_KINDS.has(kind) || kind === 'tree')) return null;
    return buildingUnder((b) => s.handSink(b, kind));
  }

  /** Empties the hand where it is: everything held falls, scattered a little; an orb is cancelled. */
  function shake() {
    const list = heldList();
    if (!list.length) return;
    events.emit('shake', { count: list.length, kind: list[0].kind });
    list.forEach((e, i) => {
      if (e.kind === 'orb') {
        // cancelled: the orb vanishes uncast; the orbs module drops it and its pedestal refills
        setHeld(hand.held.filter((id) => id !== e.id));
        world.remove(e.id);
        return;
      }
      const a = (i * 2.4) % (Math.PI * 2), k = list.length > 1 ? HAND.shakeScatter : 0;
      releaseOne(e, { vx: Math.cos(a) * k, vy: Math.sin(a) * k, vz: k, thrown: false }, { shaken: true });
    });
    setHeld([]);
    press = press ? { mode: 'shaken' } : null;
    gesture = null;
  }

  /** Puts entity e in flight from where it is with velocity (vx, vy, vz). Also used by checks. */
  function launch(e, vx, vy, vz, thrown = Math.hypot(vx, vy) > 0) {
    e.z ??= world.heightAt(e.x, e.y);
    hand.flights.set(e.id, { x: e.x, y: e.y, z: e.z, vx, vy, vz, bounces: 0, landed: false, thrown, hit: new Set(), fromX: e.x, fromY: e.y });
    e.airborne = true;
    e.vx = vx; e.vy = vy; e.vz = vz;
  }

  // ---------------------------------------------------------------- bulk
  /** One step of a press with the button down. */
  function work(dt) {
    hand.pouring = null;
    if (!press) return;
    press.t += dt;
    if (press.mode === 'pending' && press.t >= HAND.treeDrawDelay) press = { mode: 'draw', t: 0, kind: 'wood', trees: true, stores: false };
    if (press.mode === 'grab') sweep();
    if ((press.mode === 'grab' || press.mode === 'draw') && !pour(dt)) drawFrom(dt);
    if (press.mode === 'put') putOut(dt);
  }

  /** Multi pick-up: adds one more thing of the held kind under the pointer. */
  function sweep() {
    const list = heldList();
    if (!HAND.multiPickup || !list.length || list.length >= HAND.multiMax || !HAND.multiKinds.includes(list[0].kind)) return;
    const kind = list[0].kind;
    const e = pickEntity(world, camera, p.sx, p.sy, (o) => o.kind === kind && canTouch(o), near());
    if (e) grab(e, true);
  }

  /** Draws resource into the hand's pile from the source under the pointer. */
  function drawFrom(dt) {
    const list = heldList();
    let pile = null, kind, trees = false, stores = false;
    if (press.mode === 'draw') {
      ({ kind, trees, stores } = press);
      if (list.length) { if (list.length > 1 || list[0].kind !== kind) return; pile = list[0]; }
    } else {
      // a pile picked up off the ground keeps filling over fields
      if (list.length !== 1 || !PILE_KINDS.has(list[0].kind)) return;
      pile = list[0]; kind = pile.kind;
    }
    if (!p.hit) return;
    let take = null;
    if (trees) {
      const tr = pickEntity(world, camera, p.sx, p.sy, (o) => o.kind === 'tree' && canTouch(o) && !o.airborne && !(o.burning > 0), near());
      if (tr) take = (n) => drainTree(tr, n);
    } else {
      const s = sim(), b = s && buildingUnder((o) => s.handSource(o, { kind, stores }));
      if (b) take = (n) => s.handTake(b, kind, n);
    }
    if (!take) return;
    press.frac = (press.frac ?? 0) + bulkRate(HAND.draw, press.drawT ?? 0) * dt;
    press.drawT = (press.drawT ?? 0) + dt;
    const want = Math.floor(press.frac);
    if (want < 1) return;
    press.frac -= want;
    const got = take(want);
    if (got <= 0) return;
    if (pile) { pile.amount = (pile.amount ?? 0) + got; return; }
    const sprite = listSprites().includes(kind) ? getSprite(kind) : undefined;
    const z = hand.ground + HAND.carryZ;
    grab(world.spawn(kind, { x: hand.x, y: hand.y, z, vx: 0, vy: 0, vz: 0, amount: got, grabbable: true, carriedBy: null, madeBy: 'hand', sprite }));
  }

  /** Takes up to n wood out of a standing tree; a tree drawn empty is gone (uprooted). */
  function drainTree(tr, n) {
    const left = woodIn(tr), got = Math.min(n, left);
    tr.wood = left - got;
    if (tr.wood <= 0) {
      removeTree(world, tr);
      act('uproot', 'tree', HAND.weights.uproot, tr.x, tr.y);
    }
    return got;
  }

  /** God-building: a wood pile held over a player site pours into it after pourDelay. True while the
   * hand is over a site it can pour into (no drawing meanwhile). */
  function pour(dt) {
    const list = heldList();
    const s = sim();
    const b = list.length === 1 && list[0].kind === 'wood' && s ? buildingUnder((o) => s.canGodBuild(o)) : null;
    if (!b) { press.overId = null; return false; }
    if (press.overId !== b.id) Object.assign(press, { overId: b.id, overT: 0, pourT: 0, pourFrac: 0 });
    press.overT += dt;
    if (press.overT < HAND.pourDelay) return true;
    const pile = list[0];
    press.pourFrac += bulkRate(HAND.pour, press.pourT) * dt;
    press.pourT += dt;
    const n = Math.min(pile.amount ?? 1, Math.floor(press.pourFrac));
    if (n < 1) return true;
    press.pourFrac -= n;
    const used = s.godBuild(b, n);
    if (used <= 0) return true;
    hand.pouring = b.id;
    pile.amount = (pile.amount ?? 1) - used;
    events.emit('pour', { buildingId: b.id, amount: used });
    if (pile.amount <= 0) { setHeld([]); world.remove(pile.id); }
    return true;
  }

  /** A stowed group with the button held: one thing out every pourInterval, where the hand is. */
  function putOut(dt) {
    if (press.t < HAND.pourDelay) return;
    press.put = true;
    press.next -= dt;
    if (press.next > 0) return;
    press.next = HAND.pourInterval;
    const e = heldList()[0];
    if (e) releaseOne(e, STILL);
  }

  // ---------------------------------------------------------------- flight
  function settle(e, f) {
    hand.flights.delete(e.id);
    world.move(e, f.x, f.y, world.heightAt(f.x, f.y));
    e.vx = e.vy = e.vz = 0;
    e.airborne = false;
  }

  function sink(e, f) {
    hand.flights.delete(e.id);
    world.move(e, f.x, f.y, f.z);
    e.vx = e.vy = e.vz = 0;
    e.airborne = false;
    e.sinking = true;
    hand.sinking.set(e.id, { t: HAND.sinkTime });
    game.fx.spawn(splash, { x: f.x, y: f.y, z: f.z, seed: e.id, stone: false });
  }

  function onContact(e, f) {
    const speed = Math.hypot(f.vx, f.vy, f.vz);
    const water = isWater(f.x, f.y);
    if (!f.landed) {
      f.landed = true;
      const lethal = speed > HAND.lethalSpeed;
      const kills = e.kind === 'villager' && (e.hp ?? 1) > 0 && (lethal || water);
      if (kills) e.hp = 0;
      // Put the entity on the contact point before anyone hears of the landing: listeners read the
      // entity, not the payload (the orbs cast where the orb is, the village handles the landed
      // villager where it lies). The world otherwise still holds the last tick's position, up to
      // one tick of flight (0.4 tiles at throw speed) short of the contact.
      world.move(e, f.x, f.y, f.z);
      events.emit('landed', { entityId: e.id, speed, kind: e.kind, x: f.x, y: f.y, z: f.z, water });
      if (kills) act(lethal || f.thrown ? 'throw' : 'drop', 'villager', HAND.weights.kill, f.x, f.y);
      if (world.get(e.id) !== e) { hand.flights.delete(e.id); return; } // a listener removed it (an orb cast)
    }
    if (water) { sink(e, f); return; }
    const rest = HAND.bounce[e.kind];
    if (rest && -f.vz > HAND.bounceMin && f.bounces < HAND.maxBounces) {
      f.vz = -f.vz * rest;
      f.vx *= HAND.friction;
      f.vy *= HAND.friction;
      f.bounces++;
      f.z += 1e-4;
      return;
    }
    settle(e, f);
  }

  function hitBuildings(e, f) {
    if (!HAND.damageKinds.includes(e.kind)) return;
    const speed = Math.hypot(f.vx, f.vy, f.vz);
    if (speed < HAND.damageSpeed) return;
    for (const b of world.query({ kind: 'building', x: f.x, y: f.y, r: HAND.buildingRadius + 3 })) {
      if (f.hit.has(b.id)) continue;
      if (Math.hypot(b.x - f.x, b.y - f.y) > (b.r ?? HAND.buildingRadius)) continue;
      if (f.z > (b.z ?? world.heightAt(b.x, b.y)) + HAND.buildingHeight) continue;
      f.hit.add(b.id);
      const k = Math.min(1, Math.max(0.1, (speed - HAND.damageSpeed) / (HAND.fullDamageSpeed - HAND.damageSpeed)));
      b.hp = Math.max(0, (b.hp ?? 1) - HAND.rockDamage * k);
      f.vx *= -0.2;
      f.vy *= -0.2;
    }
  }

  function stepFlights(dt) {
    const bounds = { w: world.w, h: world.h };
    for (const [id, f] of hand.flights) {
      const e = world.get(id);
      if (!e || e.held) { hand.flights.delete(id); continue; }
      let left = dt;
      for (let guard = 0; guard < 8 && left > 1e-9 && hand.flights.has(id); guard++) {
        const c = stepBody(f, left, world.heightAt, HAND.gravity, bounds);
        hitBuildings(e, f);
        if (!c) break;
        left = c.left;
        onContact(e, f);
      }
      if (hand.flights.has(id)) {
        world.move(e, f.x, f.y, f.z);
        e.vx = f.vx; e.vy = f.vy; e.vz = f.vz;
      }
    }
    for (const [id, s] of hand.sinking) {
      const e = world.get(id);
      if (!e) { hand.sinking.delete(id); continue; }
      s.t -= dt;
      world.move(e, e.x, e.y, e.z - HAND.sinkRate * dt);
      if (s.t > 0) continue;
      hand.sinking.delete(id);
      // the village owns villager removal (hp is already 0); everything else the hand removes
      if (e.kind !== 'villager') world.remove(id);
    }
  }

  // ---------------------------------------------------------------- per tick
  /** Held entities still in the world (drops the ids of any removed meanwhile). */
  function heldList() {
    const list = [];
    for (const id of hand.held) { const e = world.get(id); if (e) list.push(e); }
    if (list.length !== hand.held.length) setHeld(list.map((e) => e.id));
    return list;
  }

  function updatePose() {
    hand.pose = slapT > 0 ? 'hand-slap'
      : strokeT > 0 ? 'hand-stroke'
        : grabT > 0 ? 'hand-grab'
          : hand.held.length ? 'hand-hold'
            : p.buttons & 1 ? 'hand-grab'
              : game.state.selectedCreature != null ? 'hand-point'
                : 'hand-open';
  }

  /** Moves the held things after the hand: the anchor lags behind it, each thing at its spread offset. */
  function carryHeld(list, dt) {
    const k = 1 - Math.exp(-HAND.followRate * dt);
    carry.x += (hand.x - carry.x) * k;
    carry.y += (hand.y - carry.y) * k;
    const floor = world.heightAt(carry.x, carry.y);
    carry.z += (floor + HAND.carryZ - carry.z) * k;
    if (carry.z < floor) carry.z = floor;
    list.forEach((e, i) => {
      const [ox, oy] = HAND.spread[i] ?? HAND.spread[0];
      const x = carry.x + ox, y = carry.y + oy;
      const z = Math.max(carry.z, world.heightAt(x, y));
      const x0 = e.x, y0 = e.y, z0 = e.z;
      world.move(e, x, y, z);
      e.vx = (x - x0) / dt; e.vy = (y - y0) / dt; e.vz = (z - z0) / dt;
    });
    const top = list[0].sprite ? (list[0].sprite.ay + 1) / 8 : 1.25;
    hand.z = hand.ground + HAND.carryZ + top + HAND.gripGap;
  }

  function update(dt) {
    hand.time += dt;
    grabT = Math.max(0, grabT - dt);
    slapT = Math.max(0, slapT - dt);
    strokeT = Math.max(0, strokeT - dt);
    const sel = game.state.selectedCreature;
    if (sel != null && !world.get(sel)) game.state.selectedCreature = null;

    if (p.hit) { hand.x = p.x; hand.y = p.y; }
    hand.ground = world.heightAt(hand.x, hand.y);

    if (p.buttons & 1) work(dt);
    else hand.pouring = null;

    let list = heldList();
    // shake: fast back-and-forth while holding anything empties the hand
    const dx = p.sx - lastSx, dy = p.sy - lastSy;
    lastSx = p.sx; lastSy = p.sy;
    if (!list.length) shaker.reset();
    else if (dx || dy) {
      const r = shaker.move(dx, dy, hand.time, true);
      if (r && r.strength >= 1) { shake(); list = heldList(); }
    }

    if (list.length) {
      carry ??= { x: list[0].x, y: list[0].y, z: list[0].z };
      carryHeld(list, dt);
    } else {
      hand.z = hand.ground + HAND.hoverZ;
    }
    hand.load = list.length ? { kind: list[0].kind, count: list.length, amount: list.reduce((a, e) => a + (PILE_KINDS.has(e.kind) ? e.amount ?? 1 : e.kind === 'tree' ? woodIn(e) : 0), 0) } : null;

    // stroke: left held, nothing in the hand
    if (gesture && p.buttons & 1 && !list.length && !game.state.uiCapture) {
      const gx = p.sx - gesture.lastSx, gy = p.sy - gesture.lastSy;
      gesture.lastSx = p.sx;
      gesture.lastSy = p.sy;
      if (gx || gy) {
        const c = pickCreature();
        if (c) { gesture.creatureId = c.id; strokeT = HAND.strokePose; }
        const r = tracker.move(gx, gy, hand.time, !!c);
        if (r && gesture.creatureId != null && world.get(gesture.creatureId)) {
          gesture.stroked = true;
          strokeT = HAND.strokePose;
          events.emit('stroke', { creatureId: gesture.creatureId, strength: r.strength });
        }
      }
    }

    stepFlights(dt);

    hand.hoverId = !list.length && p.inside ? pickTouchable()?.id ?? null : null;
    updatePose();
  }

  // ---------------------------------------------------------------- draw
  /** Text for the amount carried: a pile's amount, a group's count, or null for one thing. */
  function label(list) {
    if (!list.length) return null;
    if (PILE_KINDS.has(list[0].kind)) return { text: String(Math.floor(list[0].amount ?? 1)), icon: list[0].kind };
    return list.length > 1 ? { text: `x${list.length}`, icon: null } : null;
  }

  function draw(ctx) {
    const list = hand.held.map((id) => world.get(id)).filter(Boolean);
    const shown = list.slice(0, HAND.spread.length);
    for (const e of shown) ctx.list.push(shadowItem(world, e.x, e.y, shadowFor(e, e.z - world.heightAt(e.x, e.y)), 0));
    for (const id of hand.flights.keys()) {
      const e = world.get(id);
      if (e) ctx.list.push(shadowItem(world, e.x, e.y, shadowFor(e, e.z - world.heightAt(e.x, e.y)), 0));
    }
    const visible = p.inside || list.length;
    if (visible && !list.length) ctx.list.push(shadowItem(world, hand.x, hand.y, 'shadow-s', 0));
    const sel = game.state.selectedCreature != null ? world.get(game.state.selectedCreature) : null;
    if (sel) ctx.list.push(outlineItem(sel, 'lightning', 6));
    const hover = hand.hoverId != null ? world.get(hand.hoverId) : null;
    if (hover && hover !== sel) ctx.list.push(outlineItem(hover, 'hand-glow', 7));
    // the hand goes over everything: queue an overlay that queues itself again, so it lands after
    // the overlays systems later in the order (ui) registered this frame
    const tag = label(list);
    if (visible) ctx.overlay((c) => c.overlay((c2) => drawTop(c2, hand, shown, tag)));
  }

  return {
    update,
    draw,
    /** Live hand state (read-only for other systems): position, pose, heldId, held, stowed, load, hoverId, flights. */
    state: hand,
    launch,
    /** Empties the hand as a shake does. */
    shake,
    get held() { return heldList()[0] ?? null; },
  };
}

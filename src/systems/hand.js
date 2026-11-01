// Hand system: the player's divine hand. It floats over the terrain under the pointer, picks up,
// carries and throws things, strokes and slaps the creature, and points the creature somewhere.
//
// Input map (user decisions): left press on a grabbable thing grabs it; dragging carries it and
// letting go releases it with the pointer's speed (slow = drop, fast = throw). Left-drag back and
// forth over the creature strokes it. Left click (no drag) on the creature selects it; a right click
// on the ground then sends it there (tether). Right click on the creature slaps it. Wheel zoom and
// edge or middle-drag pan belong to the camera.
//
// Events (spec): grab / release { entityId, kind, miracle, x, y, z, vx, vy, vz }, landed { entityId,
// speed, kind, x, y, z, water }, stroke / slap { creatureId, strength }, tether { creatureId, x, y },
// act { actor: 'player', verb: 'throw'|'drop'|'uproot', target, weight, x, y }.
// Entity fields written: held (while carried), airborne (while flying), sinking, uprooted (trees),
// hp (villagers killed by a landing, buildings hit by rocks), x/y/z/vx/vy/vz.
// Shared state: game.state.selectedCreature (creature id or null).
//
// Pointer presses arrive as events between ticks and are handled at once, so a click (press and
// release with no tick between) works. update(dt) moves the hand, the carried object and every
// flight; it never touches the DOM. draw(ctx) only reads.
import * as splash from 'pixelfx/fx/water/splash';
import { HAND, isGrabbable, releaseVelocity } from '../hand/tunables.js';
import { stepBody } from '../hand/flight.js';
import { pickEntity } from '../hand/pick.js';
import { createStrokeTracker } from '../hand/stroke.js';
import { shadowFor, shadowItem, outlineItem, drawTop } from '../hand/draw.js';
import '../hand/placeholder-art.js';

export { HAND };

export function create(game) {
  const { world, events, input, camera } = game;
  const p = input.pointer;
  game.state ??= {};
  game.state.selectedCreature ??= null;

  const hand = {
    x: 0, y: 0, z: 0, ground: 0,
    pose: 'hand-open',
    heldId: null,
    hoverId: null,
    time: 0,
    flights: new Map(), // id -> { x, y, z, vx, vy, vz, bounces, landed, thrown, hit, fromX, fromY }
    sinking: new Map(), // id -> { t }
  };
  let carry = null; // lagged position of the held object
  let grabT = 0, slapT = 0, strokeT = 0;
  let gesture = null; // left press without a grab: { pressedId, creatureId, dragged, stroked, lastSx, lastSy }
  const tracker = createStrokeTracker({
    within: HAND.strokeWindow, need: HAND.strokeReversals, minTravel: HAND.strokeMinTravel, fullSpeed: HAND.strokeFullSpeed,
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
  events.on('drag-start', ({ button }) => { if (button === 0 && gesture) gesture.dragged = true; });
  events.on('key-down', ({ code }) => { if (code === 'Escape') game.state.selectedCreature = null; });

  function leftDown() {
    if (hand.heldId != null) return;
    const e = pickTouchable();
    if (e && e.kind !== 'creature') { grab(e); return; }
    gesture = { pressedId: e ? e.id : null, creatureId: e ? e.id : null, dragged: false, stroked: false, lastSx: p.sx, lastSy: p.sy };
    tracker.reset();
  }

  function leftUp() {
    if (hand.heldId != null) { release(); return; }
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

  function grab(e) {
    hand.heldId = e.id;
    hand.flights.delete(e.id);
    e.held = true;
    e.airborne = false;
    e.z ??= world.heightAt(e.x, e.y);
    e.vx = e.vy = e.vz = 0;
    carry = { x: e.x, y: e.y, z: e.z };
    grabT = HAND.grabPose;
    events.emit('grab', { entityId: e.id, kind: e.kind, miracle: e.miracle, x: e.x, y: e.y, z: e.z, vx: 0, vy: 0, vz: 0 });
    if (e.kind === 'tree' && !e.uprooted) {
      e.uprooted = true;
      act('uproot', 'tree', HAND.weights.uproot, e.x, e.y);
    }
  }

  function release() {
    const e = world.get(hand.heldId);
    hand.heldId = null;
    carry = null;
    if (!e) return;
    e.held = false;
    const v = releaseVelocity(p.vsx, p.vsy);
    launch(e, v.vx, v.vy, v.vz, v.thrown);
    events.emit('release', { entityId: e.id, kind: e.kind, miracle: e.miracle, x: e.x, y: e.y, z: e.z, vx: v.vx, vy: v.vy, vz: v.vz });
    // orbs report their own act when the miracle is cast
    if (e.kind !== 'orb') act(v.thrown ? 'throw' : 'drop', e.kind, v.thrown ? HAND.weights.throw : HAND.weights.drop, e.x, e.y);
  }

  /** Puts entity e in flight from where it is with velocity (vx, vy, vz). Also used by checks. */
  function launch(e, vx, vy, vz, thrown = Math.hypot(vx, vy) > 0) {
    e.z ??= world.heightAt(e.x, e.y);
    hand.flights.set(e.id, { x: e.x, y: e.y, z: e.z, vx, vy, vz, bounces: 0, landed: false, thrown, hit: new Set(), fromX: e.x, fromY: e.y });
    e.airborne = true;
    e.vx = vx; e.vy = vy; e.vz = vz;
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
  function heldEntity() {
    if (hand.heldId == null) return null;
    const e = world.get(hand.heldId);
    if (!e) { hand.heldId = null; carry = null; }
    return e ?? null;
  }

  function updatePose() {
    hand.pose = slapT > 0 ? 'hand-slap'
      : strokeT > 0 ? 'hand-stroke'
        : grabT > 0 ? 'hand-grab'
          : hand.heldId != null ? 'hand-hold'
            : p.buttons & 1 ? 'hand-grab'
              : game.state.selectedCreature != null ? 'hand-point'
                : 'hand-open';
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

    const held = heldEntity();
    if (held) {
      const k = 1 - Math.exp(-HAND.followRate * dt);
      const x0 = carry.x, y0 = carry.y, z0 = carry.z;
      carry.x += (hand.x - carry.x) * k;
      carry.y += (hand.y - carry.y) * k;
      const floor = world.heightAt(carry.x, carry.y);
      carry.z += (floor + HAND.carryZ - carry.z) * k;
      if (carry.z < floor) carry.z = floor;
      world.move(held, carry.x, carry.y, carry.z);
      held.vx = (carry.x - x0) / dt; held.vy = (carry.y - y0) / dt; held.vz = (carry.z - z0) / dt;
      const top = held.sprite ? (held.sprite.ay + 1) / 8 : 1.25;
      hand.z = hand.ground + HAND.carryZ + top + HAND.gripGap;
    } else {
      hand.z = hand.ground + HAND.hoverZ;
    }

    // stroke: left held, nothing in the hand
    if (gesture && p.buttons & 1 && !held && !game.state.uiCapture) {
      const dx = p.sx - gesture.lastSx, dy = p.sy - gesture.lastSy;
      gesture.lastSx = p.sx;
      gesture.lastSy = p.sy;
      if (dx || dy) {
        const c = pickCreature();
        if (c) { gesture.creatureId = c.id; strokeT = HAND.strokePose; }
        const r = tracker.move(dx, dy, hand.time, !!c);
        if (r && gesture.creatureId != null && world.get(gesture.creatureId)) {
          gesture.stroked = true;
          strokeT = HAND.strokePose;
          events.emit('stroke', { creatureId: gesture.creatureId, strength: r.strength });
        }
      }
    }

    stepFlights(dt);

    hand.hoverId = !held && p.inside ? pickTouchable()?.id ?? null : null;
    updatePose();
  }

  // ---------------------------------------------------------------- draw
  function draw(ctx) {
    const held = hand.heldId != null ? world.get(hand.heldId) : null;
    if (held) ctx.list.push(shadowItem(world, held.x, held.y, shadowFor(held, held.z - world.heightAt(held.x, held.y)), 0));
    for (const id of hand.flights.keys()) {
      const e = world.get(id);
      if (e) ctx.list.push(shadowItem(world, e.x, e.y, shadowFor(e, e.z - world.heightAt(e.x, e.y)), 0));
    }
    const visible = p.inside || held;
    if (visible && !held) ctx.list.push(shadowItem(world, hand.x, hand.y, 'shadow-s', 0));
    const sel = game.state.selectedCreature != null ? world.get(game.state.selectedCreature) : null;
    if (sel) ctx.list.push(outlineItem(sel, 'lightning', 6));
    const hover = hand.hoverId != null ? world.get(hand.hoverId) : null;
    if (hover && hover !== sel) ctx.list.push(outlineItem(hover, 'hand-glow', 7));
    // the hand goes over everything: queue an overlay that queues itself again, so it lands after
    // the overlays systems later in the order (ui) registered this frame
    if (visible) ctx.overlay((c) => c.overlay((c2) => drawTop(c2, hand, held)));
  }

  return {
    update,
    draw,
    /** Live hand state (read-only for other systems): position, pose, heldId, hoverId, flights. */
    state: hand,
    launch,
    get held() { return heldEntity(); },
  };
}

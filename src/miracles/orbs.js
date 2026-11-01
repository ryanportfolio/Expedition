// Miracle orbs: four pedestals round the player temple (map site `temple`), one orb on each.
//
// Life of an orb: it floats on its pedestal with a gentle bob and a glow in its miracle's color.
// The hand grabs it (`grab`): the pedestal starts its respawn countdown and the orb follows wherever
// the hand moves it (the hand owns `held` and the position while carried). On `release` a slow orb
// (dropped) resolves at once at the release point; a fast one (thrown) resolves on `landed`, or
// where it is after flightTimeout if no landing is reported. Resolving casts when there is power
// for it, else the orb fizzles; either way the orb entity is removed.
//
// Pedestals are built lazily from world.sites.temple, and rebuilt when the map changes. Orb glows live
// on a private depth-sorted layer (glow-layer.js), not game.fx, so a house in front of an orb hides
// its glow.
import { getSprite } from '../art/registry.js';
import { TUNING, MIRACLES } from './tuning.js';
import { FX } from './fx.js';
import { createGlowLayer } from './glow-layer.js';

export function createOrbs(game, { resolve }) {
  const O = TUNING.orbs;
  let pedestals = []; // { miracle, x, y, orbId, cooldown }
  let siteKey = null;
  const orbs = new Map(); // orb id -> { miracle, pedestal, state: 'pedestal'|'held'|'flying', flight, phase }
  const glows = createGlowLayer(); // keyed by orb id
  let time = 0;

  function spawnOrb(p) {
    const z = game.world.heightAt(p.x, p.y) + O.hover;
    const e = game.world.spawn('orb', {
      x: p.x, y: p.y, z, vx: 0, vy: 0, vz: 0,
      miracle: p.miracle, grabbable: true, sprite: getSprite('orb', { miracle: p.miracle }),
    });
    const [mod, opts] = FX.orb(p.miracle, game.rng.int(1e6));
    orbs.set(e.id, { miracle: p.miracle, pedestal: p, state: 'pedestal', flight: 0, phase: MIRACLES.indexOf(p.miracle) / 4 });
    glows.add(e.id, mod, opts);
    glows.place(e.id, e.x, e.y, e.z, e.id);
    p.orbId = e.id;
    p.cooldown = 0;
    return e;
  }

  function syncPedestals() {
    const t = game.world.sites?.temple;
    const key = t ? `${t.x},${t.y},${game.world.w},${game.world.h}` : null;
    if (key === siteKey) return;
    siteKey = key;
    for (const id of orbs.keys()) game.world.remove(id);
    orbs.clear();
    glows.clear();
    pedestals = [];
    if (!t) return;
    for (const miracle of MIRACLES) {
      const [dx, dy] = O.pedestals[miracle];
      pedestals.push({ miracle, x: t.x + 0.5 + dx, y: t.y + 0.5 + dy, orbId: null, cooldown: 0 });
    }
    pedestals.forEach(spawnOrb);
  }

  function take(id) {
    const o = orbs.get(id);
    if (!o) return null;
    if (o.pedestal && o.pedestal.orbId === id) {
      o.pedestal.orbId = null;
      o.pedestal.cooldown = O.respawn;
    }
    o.pedestal = null;
    return o;
  }

  function finish(id, x, y) {
    const o = orbs.get(id);
    const e = game.world.get(id);
    if (!o) return;
    orbs.delete(id);
    glows.remove(id);
    const px = Number.isFinite(x) ? x : e?.x, py = Number.isFinite(y) ? y : e?.y;
    const pz = e ? e.z : game.world.heightAt(px, py);
    if (e) game.world.remove(id);
    resolve(o.miracle, px, py, pz);
  }

  game.events.on('grab', ({ entityId } = {}) => {
    const o = take(entityId);
    if (o) { o.state = 'held'; o.flight = 0; }
  });
  game.events.on('release', ({ entityId, x, y, vx = 0, vy = 0, vz = 0 } = {}) => {
    const o = orbs.get(entityId);
    if (!o) return;
    take(entityId); // a release without a grab still frees the pedestal
    const speed = Math.hypot(vx, vy, vz);
    if (speed <= O.castSpeed) finish(entityId, x, y);
    else { o.state = 'flying'; o.flight = 0; }
  });
  game.events.on('landed', ({ entityId } = {}) => {
    const o = orbs.get(entityId);
    if (o && o.state !== 'pedestal' && o.state !== 'held') finish(entityId);
  });

  function update(dt) {
    time += dt;
    syncPedestals();
    for (const [id, o] of orbs) {
      const e = game.world.get(id);
      if (!e) { // removed by someone else (or the map reloaded): a pedestal orb comes back at once
        const p = o.state === 'pedestal' ? o.pedestal : null;
        take(id);
        if (p) p.cooldown = 0;
        glows.remove(id);
        orbs.delete(id);
        continue;
      }
      if (o.state === 'pedestal' && e.held) { take(id); o.state = 'held'; }
      if (o.state === 'pedestal') {
        const bob = O.bobAmp * Math.sin(((time / O.bobPeriod) + o.phase) * Math.PI * 2);
        game.world.move(e, e.x, e.y, game.world.heightAt(e.x, e.y) + O.hover + bob);
      } else if (o.state === 'flying') {
        o.flight += dt;
        if (o.flight >= O.flightTimeout) { finish(id); continue; }
      }
      glows.place(id, e.x, e.y, e.z, e.id);
    }
    glows.update(dt);
    for (const p of pedestals) {
      if (p.orbId !== null && !orbs.has(p.orbId)) { p.orbId = null; p.cooldown = O.respawn; }
      if (p.orbId === null) {
        p.cooldown -= dt;
        if (p.cooldown <= 0) spawnOrb(p);
      }
    }
  }

  return {
    update,
    /** Push the orb glows into the draw list (render path only). */
    draw(ctx) { glows.draw(ctx); },
    glows: glows.items,
    /** Live pedestal records (read-only for callers). */
    get pedestals() { return pedestals; },
    orbs,
    orbOn(miracle) { return pedestals.find((p) => p.miracle === miracle)?.orbId ?? null; },
  };
}

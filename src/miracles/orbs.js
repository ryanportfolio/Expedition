// Miracle orbs: four pedestals round the player temple building, one orb on each.
//
// Life of an orb: it floats on its pedestal with a gentle bob and a glow in its miracle's color.
// The hand grabs it (`grab`): the pedestal starts its respawn countdown and the orb follows wherever
// the hand moves it (the hand owns `held` and the position while carried). On `release` a slow orb
// (dropped) resolves at once at the release point; a fast one (thrown) resolves on `landed`, or
// where it is after flightTimeout if no landing is reported. Resolving casts when there is power
// for it, else the orb fizzles; either way the orb entity is removed.
//
// Where the pedestals stand: round the centre of the player's temple *building*, at the offsets the
// temple painter draws its pedestal stones (TUNING.orbs.pedestals, read by src/art/painters/buildings.js).
// Not round world.sites.temple: the village builds the temple on the nearest valid tile when the site
// is blocked or too steep (the real island puts it one tile west of the site), and orbs placed round
// the site then float off the painted stones; the heal orb landed inside the temple and sorted behind
// it, invisible. With several player temples (a converted rival temple) the one nearest the site
// counts; with none (a map without the village, the miracles testbed) the site tile's centre does.
// Height too: the painted stones stand on the temple's base (the building's z, its centre's ground),
// so an orb on a temple pedestal floats O.hover above that, not above the terrain under it. The
// temple may sit on a slope (the island's is 1.5 height units above the ground at the heal stone):
// floating over the lower ground put the far orbs 12 px down the screen, under the temple's own base,
// which draws over them. With the site fallback there is no stone and the orb floats over the ground.
// The pedestals are built lazily, rebuilt from scratch when the map changes, and moved (with any orb
// waiting on them) when the anchor moves, e.g. when the village places the temple after the orbs
// first appeared round the site. Orb glows live on a private depth-sorted layer (glow-layer.js), not
// game.fx, so a house in front of an orb hides its glow.
import { getSprite } from '../art/registry.js';
import { TUNING, MIRACLES } from './tuning.js';
import { FX } from './fx.js';
import { createGlowLayer } from './glow-layer.js';

export function createOrbs(game, { resolve }) {
  const O = TUNING.orbs;
  let pedestals = []; // { miracle, x, y, z, orbId, cooldown }
  let siteKey = null;
  let anchor = null; // { x, y, z } the pedestals stand round (z null: each over its own ground)
  let templeId = null; // the player temple building the pedestals follow, or null (site fallback)
  // A conversion hands the rival temple to the player: look again for the one nearest the site.
  game.events.on('village-converted', () => { templeId = null; });
  const orbs = new Map(); // orb id -> { miracle, pedestal, state: 'pedestal'|'held'|'flying', flight, phase }
  const glows = createGlowLayer(); // keyed by orb id
  let time = 0;

  function spawnOrb(p) {
    const z = p.z + O.hover;
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

  const isPlayerTemple = (b) => b?.kind === 'building' && b.type === 'temple' && b.owner === 'player';

  /** Centre the pedestals stand round (see the header): the player temple building nearest the
   * site, else the site tile's centre. The temple found is kept by id and only looked up again once
   * it is gone or no longer the player's, so the per-tick cost is one map lookup. */
  function findAnchor(site) {
    let b = templeId !== null ? game.world.get(templeId) : null;
    if (!isPlayerTemple(b)) {
      b = null;
      let best = Infinity;
      for (const c of game.world.query({ kind: 'building' })) {
        if (!isPlayerTemple(c)) continue;
        const d = Math.hypot(c.x - (site.x + 0.5), c.y - (site.y + 0.5));
        if (d < best) { best = d; b = c; }
      }
      templeId = b ? b.id : null;
    }
    return b ? { x: b.x, y: b.y, z: b.z ?? game.world.heightAt(b.x, b.y) } : { x: site.x + 0.5, y: site.y + 0.5, z: null };
  }

  function placePedestals(a) {
    anchor = a;
    for (const p of pedestals) {
      const [dx, dy] = O.pedestals[p.miracle];
      p.x = a.x + dx;
      p.y = a.y + dy;
      p.z = a.z ?? game.world.heightAt(p.x, p.y); // ground the orb floats over: the stone's foot
      const o = p.orbId !== null ? orbs.get(p.orbId) : null, e = o && game.world.get(p.orbId);
      // only an orb still waiting on its pedestal moves; a held or flying one is the hand's
      if (e && o.state === 'pedestal' && !e.held) game.world.move(e, p.x, p.y, p.z + O.hover);
    }
  }

  function syncPedestals() {
    const t = game.world.sites?.temple;
    const key = t ? `${t.x},${t.y},${game.world.w},${game.world.h}` : null;
    if (key !== siteKey) {
      siteKey = key;
      for (const id of orbs.keys()) game.world.remove(id);
      orbs.clear();
      glows.clear();
      pedestals = [];
      anchor = null;
      templeId = null;
      if (!t) return;
      pedestals = MIRACLES.map((miracle) => ({ miracle, x: 0, y: 0, z: 0, orbId: null, cooldown: 0 }));
      placePedestals(findAnchor(t));
      pedestals.forEach(spawnOrb);
      return;
    }
    if (!t) return;
    const a = findAnchor(t);
    if (a.x !== anchor.x || a.y !== anchor.y || a.z !== anchor.z) placePedestals(a);
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
        game.world.move(e, e.x, e.y, o.pedestal.z + O.hover + bob);
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

// Perf scenario: the worst-case scene for frame timing (scripts/perf-check.mjs), on the real island,
// terrain, art and HUD. Boots like play (the play bootstrap, screen 'play', both villages and the
// creature), then builds a full town round each village (buildTown in src/dev/town.js: TOWN.player villagers in
// the player's, TOWN.rival in the rival's; ?town=<n>&rival=<n> change them), lets the sim settle
// for SETTLE sim seconds, centres the camera between the player temple, the village and the
// creature, then casts all four miracles for free near the village and keeps them alive while the
// village stays full:
// - fire on trees in view near the view centre, never where it can reach a building. A fire cast
//   lights everything within the fire radius as one blaze, and a blaze catches at most spreadBudget
//   more entities, each jump at most spreadReach edge to edge (src/miracles/fire.js); so a building
//   can only catch from a fire lit within spreadReach * spreadBudget of its footprint, and the scene
//   casts only where everything the ring lights is farther than that from every building. Each cast
//   aims at a ring that lights 3 to 5 trees, so the forest in view lasts the whole window and the
//   number of fires stays steady (about ten burning at once). Burning trees carry the same flame
//   effect as burning buildings (FX.burnLarge), so the drawing load per fire is the same.
// - rain on the player building farthest from the first fire (rain puts fires out).
// - heal over the village centre.
// - lightning beside the village: the spot nearest the village centre that keeps the bolt off buildings (it takes
//   half a building's hp), sets alight only fire-safe trees, and stands far enough from every
//   villager that none can walk into the kill radius before the bolt lands.
// A tick hook re-casts each miracle on its own sim-time period, so all four stay alive for as long as
// the scene runs, and keeps OPEN_SITES house blueprints open in the player town, so its builders
// keep hauling from the woodpiles to sites (a finished site is replaced at the next free spot). Last, it hands the game to the real-time rAF loop (game.start(), the same loop
// main.js runs) and sets window.__perf.ready.
//
// The page-side profiler (window.__perf) wraps the game's own entry points (game.frame, game.tick,
// renderer.render, each system's draw, fx.draw, the draw list's draw, display.present) without
// changing what they do, and records per frame: sim ticks, and render split into terrain (clear and
// terrain passes), systems draw, collect (entity sprites into the draw list), fx back, sort+blit,
// fx front, overlays and present. The harness resets it after warm-up and reads it after the window.
// For the end-of-window check it also exposes village() (player houses and buildings standing,
// player villagers alive) and, since reset(): the fewest houses and villagers on any tick, for each
// miracle the performance.now() stamps of the ticks on which its effect was not alive, the entities
// burning per tick and how many entities each fire cast set alight.
//
// Under scripts/browser-check.mjs the scenario asserts the scene is complete, takes one screenshot
// while the sim is paused (the pixel check needs a still buffer), then starts the loop and returns.
import { TUNING } from '../../miracles/tuning.js';
import { FX } from '../../miracles/fx.js';
import { VILLAGE } from '../../village/config.js';
import { TOWN, OPEN_PER, buildTown } from '../town.js';

export const CAST = {
  rain: 8, // s between rain casts (a cloud lives 10 s, so two overlap for 2 s of every 8)
  fire: 3.5, // fire ring effect lasts 3.9 s; a burning tree falls after about 8 s
  heal: 2.5, // heal ring lasts 2.9 s
  lightning: 2.5, // strike effect lasts 3 s
};
const SETTLE = 30; // sim seconds between building the towns and opening the scene
const F = TUNING.fire, L = TUNING.lightning;
/** Edge-to-edge distance from a fire to a building beyond which its blaze can't reach it. */
const FIRE_SAFE = F.spreadReach * F.spreadBudget + 0.25;
/** Entities one fire cast should set alight: enough for a blaze, few enough that the forest in view
 * outlasts the window. */
const FIRE_N = [3, 5];
/** A villager this far from a lightning spot can't reach its kill radius before the first stroke. */
const BOLT_SAFE = L.killRadius + VILLAGE.walkSpeed * VILLAGE.fleeSpeed * L.strokes[0] + 0.5;
// the final creature painter when it exists in this tree, else the placeholder (src/systems/creature.js)
const PAINTER = Object.values(import.meta.glob('../../art/painters/creature.js', { eager: true }))[0];
export const CREATURE_ART = typeof PAINTER?.sprites?.creature === 'function' ? 'final' : 'placeholder';

/** Footprint rectangle of an entity in tiles; a point for entities without one (as in fire.js). */
function rect(e) {
  if (e.tx === undefined || !(e.fw > 0)) return { x0: e.x, y0: e.y, x1: e.x, y1: e.y };
  return { x0: e.tx, y0: e.ty, x1: e.tx + e.fw, y1: e.ty + (e.fh ?? e.fw) };
}
/** Edge-to-edge distance between two footprints (fire.js measures spread the same way). */
function gap(a, b) {
  const p = rect(a), q = rect(b);
  return Math.hypot(Math.max(0, p.x0 - q.x1, q.x0 - p.x1), Math.max(0, p.y0 - q.y1, q.y0 - p.y1));
}

/** Per-frame phase timings on window.__perf. Wraps entry points in place; behavior is unchanged. */
export function installProfiler(game) {
  const now = () => performance.now();
  const PHASES = ['terrain', 'systems', 'collect', 'fxBack', 'sortBlit', 'fxFront', 'overlays', 'present'];
  const perf = { ready: false, recording: false, frames: [], phases: PHASES };
  let cur = null, mark = 0, fxCall = 0;
  const wrap = (obj, name, before, after) => {
    const fn = obj[name];
    obj[name] = function (...args) { before(); const r = fn.apply(this, args); after(); return r; };
  };
  let frameT = 0, tickT = 0, renderT = 0, sysT = 0, fxT = 0, listT = 0, presT = 0;
  // frame = due ticks, then one render
  wrap(game, 'frame', () => { frameT = now(); cur = { frame: 0, ticks: 0, tickCount: 0, render: 0 }; }, () => {
    cur.frame = now() - frameT;
    if (perf.recording) perf.frames.push(cur);
    cur = null;
  });
  wrap(game, 'tick', () => { tickT = now(); }, () => { if (cur) { cur.ticks += now() - tickT; cur.tickCount++; } });
  const r = game.renderer;
  wrap(r, 'render', () => {
    renderT = mark = now();
    fxCall = 0;
    if (cur) for (const p of PHASES) cur[p] = 0;
  }, () => { if (cur) cur.render = now() - renderT; });
  game.systemOrder.forEach((name, i) => {
    wrap(game.systems[name], 'draw', () => {
      sysT = now();
      if (i === 0 && cur) cur.terrain = sysT - mark; // clear + terrain passes
    }, () => { const t = now(); if (cur) cur.systems += t - sysT; mark = t; });
  });
  // fx.draw runs twice per render: 'back' after collect, 'front' after sort+blit
  wrap(game.fx, 'draw', () => {
    fxT = now();
    if (cur && fxCall === 0) cur.collect = fxT - mark;
  }, () => {
    const t = now();
    if (cur) cur[fxCall === 0 ? 'fxBack' : 'fxFront'] = t - fxT;
    fxCall++;
    mark = t;
  });
  wrap(r.list, 'draw', () => { listT = now(); }, () => { const t = now(); if (cur) cur.sortBlit = t - listT; mark = t; });
  wrap(game.display, 'present', () => { presT = now(); if (cur) cur.overlays = presT - mark; }, () => { if (cur) cur.present = now() - presT; });
  perf.reset = () => { perf.frames = []; perf.recording = true; perf.onReset?.(); };
  perf.stop = () => { perf.recording = false; return perf.frames; };
  if (typeof window !== 'undefined') window.__perf = perf;
  return perf;
}

export default async function perf(t, game) {
  const { world, events, camera } = game;
  const st = (game.state ??= {});
  const M = game.systems.miracles, vs = game.systems.village, cs = game.systems.creature;

  // ---- boot as play does
  const boot = game.debug.installPlayBootstrap;
  t.assert(typeof boot === 'function', 'main.js exposes the play bootstrap to scenarios');
  if (typeof boot !== 'function') return;
  boot();
  st.screen = 'play';
  events.emit('game-start', {});
  t.input.leave(); // no edge panning while the loop runs
  t.assert(vs.ready && cs.entity, 'both villages and the creature are set up');

  // ---- the towns. A park is kept free of buildings round the densest wood near where the camera
  // will look, so fires there stay farther than FIRE_SAFE from every building and the lightning
  // has open ground to strike.
  const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  const size = (k) => (q.has(k) && Number.isInteger(Number(q.get(k))) && Number(q.get(k)) >= 0 ? Number(q.get(k)) : null);
  const pop = { player: size('town') ?? TOWN.player, rival: size('rival') ?? TOWN.rival };
  const t0 = world.sites.temple, v0 = world.sites.village, c0 = cs.entity;
  const look = { x: (t0.x + v0.x + 0.5 + c0.x) / 3, y: (t0.y + v0.y + 0.5 + c0.y) / 3 };
  const woods = world.query({ kind: 'tree', x: look.x, y: look.y, r: 16 });
  const WOOD_R = 6; // the park's wood: trees this far from its middle stay farther than FIRE_SAFE from every building
  const density = (tr) => woods.filter((o) => Math.hypot(o.x - tr.x, o.y - tr.y) <= WOOD_R).length;
  const park = woods.map((tr) => ({ x: tr.x, y: tr.y, n: density(tr) })).sort((a, b) => b.n - a.n || a.y - b.y || a.x - b.x)[0] ?? look;
  const PARK_R = WOOD_R + FIRE_SAFE + 2.5; // wood radius + fire reach + half a building
  const keepOut = (x, y) => Math.hypot(x - park.x, y - park.y) < PARK_R;
  const town = buildTown(game, 'player', pop.player, keepOut);
  buildTown(game, 'rival', pop.rival, () => false);
  const OPEN_SITES = Math.ceil(pop.player / OPEN_PER);
  /** Keeps OPEN_SITES player house blueprints open, at the town's next free spots. */
  const keepSites = () => {
    let open = world.query({ kind: 'building' }).filter((b) => b.owner === 'player' && (b.stage === 'blueprint' || b.stage === 'building') && b.hp > 0).length;
    for (; open < OPEN_SITES && town.next < town.spots.length; town.next++) {
      const { tx, ty } = town.spots[town.next];
      if (keepOut(tx + 0.5, ty + 0.5) || !vs.sim.validate('house', tx, ty, 'player', { margin: 1 }).ok) continue;
      if (vs.placeBlueprint('house', tx, ty, 'player') !== null) open++;
    }
  };
  keepSites();
  t.log('towns', JSON.stringify({ pop, want: town.want, have: town.have, park: { x: +park.x.toFixed(1), y: +park.y.toFixed(1), trees: park.n }, openSites: OPEN_SITES, entities: world.entities.size }));

  // ---- let the towns settle (jobs dealt, builders and farmers under way)
  for (let s = 0; s < SETTLE; s += 5) { t.step(5); keepSites(); }
  const player = (kind) => world.query({ kind }).filter((e) => e.owner === 'player');
  const standing = (b) => b.stage === 'done' && b.hp > 0;
  const village = () => {
    const b = player('building');
    return {
      houses: b.filter((x) => x.type === 'house' && standing(x)).length,
      buildings: b.filter(standing).length,
      villagers: player('villager').filter((v) => v.hp > 0).length,
      burningBuildings: b.filter((x) => x.burning > 0).length,
    };
  };
  const temple = world.sites.temple;
  const home = world.sites.village;
  const stats = vs.stats();
  t.log('after fast-forward', JSON.stringify({ time: +game.clock.time.toFixed(1), pop: stats.player?.population, ...village(), creature: [+cs.entity.x.toFixed(1), +cs.entity.y.toFixed(1)], creatureArt: CREATURE_ART }));

  // ---- where the miracles land
  const centre = { x: (temple.x + home.x) / 2 + 0.5, y: (temple.y + home.y) / 2 + 0.5 };
  const c = cs.entity;
  const view = { x: (temple.x + centre.x * 2 + c.x) / 4, y: (temple.y + centre.y * 2 + c.y) / 4 };
  const inView = (p, pad = 0) => p.sx >= pad && p.sx < game.display.w - pad && p.sy >= pad && p.sy < game.display.h - pad;
  const byDist = (p) => (a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y) || a.id - b.id;
  const buildingGap = (e, B) => {
    let g = Infinity;
    for (const b of B) g = Math.min(g, gap(e, b));
    return g;
  };
  const canLight = (e) => M.fire.canBurn(e) && !(e.burning > 0) && !M.isRaining(e.x, e.y);
  /** How many entities a fire lit within r of (x, y) sets alight; -1 when one of them could carry
   * the fire to a building. */
  const fireLoad = (x, y, r, B) => {
    let n = 0;
    for (const e of world.query({ x, y, r })) {
      if (!canLight(e)) continue;
      if (e.kind === 'building' || buildingGap(e, B) < FIRE_SAFE) return -1;
      n++;
    }
    return n;
  };
  /** True when nothing a fire lit within r of (x, y) can carry it to a building. */
  const fireSafe = (x, y, r, B) => fireLoad(x, y, r, B) >= 0;
  /** The tree in view nearest the view centre whose fire is safe and lights FIRE_N entities; else
   * the safe one whose count comes closest. */
  const fireTarget = () => {
    const B = world.query({ kind: 'building' });
    let best = null, bestMiss = Infinity;
    for (const tr of world.query({ kind: 'tree' }).filter(canLight).sort(byDist(view))) {
      if (!inView(camera.worldToView(tr.x, tr.y, world.heightAt(tr.x, tr.y)), 24)) continue;
      const n = fireLoad(tr.x, tr.y, F.radius, B);
      if (n < 1) continue;
      const miss = Math.max(FIRE_N[0] - n, n - FIRE_N[1], 0);
      if (miss === 0) return { x: tr.x, y: tr.y, n };
      if (miss < bestMiss) { best = { x: tr.x, y: tr.y, n }; bestMiss = miss; }
    }
    return best;
  };
  camera.centerOn(view.x, view.y, world.heightAt(view.x, view.y));
  const firstFire = fireTarget() ?? view;
  const far = player('building').filter((b) => b.type !== 'temple').sort(byDist(firstFire)).at(-1) ?? temple;
  const spots = { rain: { x: far.x, y: far.y }, heal: { x: centre.x, y: centre.y } };
  // lightning: spots on a 1-tile grid round the village centre, nearest first
  const boltGrid = [];
  for (let dy = -14; dy <= 14; dy++) for (let dx = -14; dx <= 14; dx++) boltGrid.push({ x: centre.x + dx + 0.5, y: centre.y + dy + 0.5 });
  boltGrid.sort(byDist(centre));
  const boltTarget = () => {
    let best = null, bestD = -1;
    const villagers = world.query({ kind: 'villager' }), B = world.query({ kind: 'building' });
    for (const p of boltGrid) {
      if (!inView(camera.worldToView(p.x, p.y, world.heightAt(p.x, p.y)), 40)) continue;
      if (B.some((b) => gap(p, b) <= L.damageRadius + 0.5)) continue;
      if (!fireSafe(p.x, p.y, L.igniteRadius, B)) continue;
      let d = Infinity;
      for (const v of villagers) d = Math.min(d, Math.hypot(v.x - p.x, v.y - p.y));
      if (d >= BOLT_SAFE) return p; // nearest the centre with no villager in reach
      if (d > bestD) { best = p; bestD = d; }
    }
    return best;
  };
  const counts = { rain: 0, fire: 0, heal: 0, lightning: 0 };
  const castNow = (m) => {
    const p = m === 'fire' ? fireTarget() : m === 'lightning' ? boltTarget() : spots[m];
    if (!(p && M.cast(m, p.x, p.y, { free: true }))) return;
    counts[m]++;
    if (watch.recording && m === 'fire') watch.fireCasts.push(p.n);
  };

  // ---- which miracle effects are alive: rain falling, something burning, a heal ring, a strike
  const HEAL = FX.heal(1, 1)[0].meta, BOLT = FX.lightning(1)[0].meta;
  const alive = (meta) => game.fx.live.some((h) => h.fx.meta === meta && !h.done());
  const active = () => ({ rain: M.effects.rains.length > 0, fire: M.fire.states.size > 0, heal: alive(HEAL), lightning: alive(BOLT) });
  // since reset(): ticks with an effect not alive, fewest houses and villagers, entities burning per
  // tick, and how many entities each fire cast set alight
  const watch = { inactive: { rain: [], fire: [], heal: [], lightning: [] }, minHouses: Infinity, minVillagers: Infinity, burning: { min: Infinity, max: 0, sum: 0, ticks: 0 }, fireCasts: [] };

  // ---- keep all four going: a tick hook casts each miracle on its own period of sim time
  const next = {};
  let simT = 0;
  const tick = game.tick;
  let siteT = 0;
  game.tick = (dt) => {
    tick(dt);
    simT += dt;
    if (simT >= siteT) { keepSites(); siteT = simT + 1; }
    for (const m of Object.keys(CAST)) {
      if (simT + 1e-9 >= (next[m] ?? 0)) { castNow(m); next[m] = simT + CAST[m]; }
    }
    if (!watch.recording) return;
    const a = active(), at = performance.now();
    for (const m of Object.keys(a)) if (!a[m] && watch.inactive[m].length < 5000) watch.inactive[m].push(at);
    const v = village();
    watch.minHouses = Math.min(watch.minHouses, v.houses);
    watch.minVillagers = Math.min(watch.minVillagers, v.villagers);
    const b = M.fire.states.size, w = watch.burning;
    w.min = Math.min(w.min, b); w.max = Math.max(w.max, b); w.sum += b; w.ticks++;
  };
  // installed after the hook, so cast time counts as sim time
  const prof = installProfiler(game);
  prof.creatureArt = CREATURE_ART;
  prof.village = village;
  prof.active = active;
  prof.watch = watch;
  prof.onReset = () => {
    watch.recording = true;
    for (const m of Object.keys(watch.inactive)) watch.inactive[m] = [];
    watch.minHouses = watch.minVillagers = Infinity;
    watch.burning = { min: Infinity, max: 0, sum: 0, ticks: 0 };
    watch.fireCasts = [];
  };

  // ---- the scene is framed on temple, village and creature (above); let the miracles take hold
  t.step(2); // the fires take hold, the clouds and rings are up
  const burning = world.query({}).filter((e) => e.burning > 0);
  const v = village();
  t.log('scene', JSON.stringify({ counts, burning: burning.map((e) => `${e.kind}:${e.type ?? e.species ?? ''}`), fx: game.fx.live.length, rains: M.effects.rains.length, spots, firstFire: { x: firstFire.x, y: firstFire.y }, ...v, active: active() }));
  t.assert(v.villagers >= 0.9 * pop.player, `the player town is populated (${v.villagers} villagers, want ${pop.player})`);
  t.assert(v.houses >= 3, `the player village has its houses (${v.houses} standing)`);
  t.assert(burning.length >= 3, `several fires burn (${burning.length} entities burning)`);
  t.assert(v.burningBuildings === 0, `no player building is burning (${v.burningBuildings})`);
  t.assert(M.effects.rains.length >= 1, 'rain is falling');
  t.assert(counts.heal >= 1 && counts.lightning >= 1 && counts.fire >= 1 && counts.rain >= 1, `all four miracles cast (${JSON.stringify(counts)})`);
  t.assert(Object.values(active()).every(Boolean), `all four miracle effects alive (${JSON.stringify(active())})`);
  const tv = camera.worldToView(temple.x, temple.y, world.heightAt(temple.x, temple.y));
  const cv = camera.worldToView(c.x, c.y, c.z);
  t.assert(inView(tv) && inView(cv), `temple and creature in view (temple ${tv.sx},${tv.sy}; creature ${cv.sx},${cv.sy})`);
  await t.shot('scene');

  // ---- hand over to the real-time loop
  prof.counts = counts;
  game.start();
  prof.ready = true;
}

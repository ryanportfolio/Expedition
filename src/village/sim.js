// Village simulation for both villages: setup from the map's sites, villager jobs, hauling,
// blueprints and construction, fields and food, the store and the mine, births, worship power,
// death, wrecks and fear, and the forests that regrow. Inert until setup() is called after
// world.loadMap(), so scenarios that load a map for other systems are not filled with villages. Sim
// randomness only from game.rng; no DOM.
//
// Economy (step 3 of docs/gameplay-spec.md): one store kind holds grain, wood and ore, up to
// storeCap of each; carriers take a load to the nearest usable store with room for it. A prebuilt
// mine near each village holds a finite amount of ore that miners carry to the store. Foresters
// plant a sapling where they fell a tree, saplings grow over treeGrowTime (rain speeds them, see
// src/miracles/effects.js), grown trees seed saplings at forest edges while the island holds fewer
// trees than it started with, and rain seeds saplings on free grass under the cloud.
//
// Recovery (both villages): every building of ours that is wrecked (fire, lightning, anything that
// takes hp to 0; never the temple or the mine) goes on the village's `lost` list. Foresters clear wrecks that
// still hold timber before they fell trees, and builders clear them when they have no wood to haul;
// clearing takes clearTime and salvages salvageShare of the timber (and of a store's grain and ore).
// Once a lost building's wreck is gone, the village re-places its blueprint on the old footprint, or
// on the nearest free spot within rebuildRadius (one validate() accepts: no rock, tree, water or
// building in it); a wreck still standing after wreckWait seconds no longer holds it up and it goes
// up beside the wreck. A lost store (oneOf) goes up beside its wreck at once
// when the village has none, and is not rebuilt while it has one. At most rebuildSites re-placed
// blueprints at a time, rebuildOrder first; the player's own blueprints are never refused for their
// number. These blueprints are marked `auto`. A blueprint the village or the player places on a lost
// building's wreck or within rebuildRadius of its old spot takes the place of one lost building of
// its type, so nothing is rebuilt twice, and the player may place over a re-placed
// blueprint that has no wood in it yet (it goes back on the list). Builders and foresters work one
// focus site at a time (focus()). With no usable store, no one is sent to farm, carried grain
// is set down and ripe crops wait in the fields. Temples and mines never fall: every hp write on one stops at
// templeMinHp (stoneHp), so worship resumes once a fire on it is out. An empty blueprint can't burn,
// and one knocked to hp 0 leaves no wreck: it goes on the lost list and its plot is removed at once. While a village with a temple has
// fewer than settlerMinPop villagers, a settler arrives at the temple every settlerInterval seconds;
// births then take over as houses and grain return.
import { VILLAGE as T, KINDS, PLACEABLE, START_LAYOUT, RIVAL_PLAN, STOCK_KINDS, woodIn, oreIn } from './config.js';
import { createPaths } from './path.js';
import { liveRocks } from '../systems/terrain.js';

const OWNERS = ['player', 'rival'];
/** Prebuilt stone buildings: never wrecked (stoneHp), never lost or rebuilt. */
const STONE = new Set(['temple', 'mine']);

/** True for a thing resting on the ground that a villager may take: not in the hand, not in flight
 * (the hand and the creature set `airborne` while their flight physics moves it) and not sinking in
 * the sea (the hand sets `sinking` until it removes it). Before round 39 the village tested a
 * `flying` field that nothing sets, so villagers took thrown wood and grain mid-air and felled
 * trees in flight. Used by item and tree selection and again at the moment of pickup or felling,
 * since a thing can be thrown between choosing it and reaching it. */
export const grounded = (e) => !e.held && !e.airborne && !e.sinking;

/** Puts wood item `it` into blueprint `site`, no more than the site still needs (woodCost -
 * woodHave): the item keeps the rest and is removed from the world only once empty, so a big load
 * is never sunk into a nearly full site. A site with all its wood in moves on to 'building'. Returns
 * the wood put in. Shared by the village's builders (unload) and the creature's haul, so both
 * deliver by the same rule (round 39: the creature added its whole load and lost the surplus). */
export function putWood(world, site, it) {
  const amount = it.amount ?? 1;
  const n = Math.min(amount, Math.max(0, site.woodCost - site.woodHave));
  site.woodHave += n;
  it.amount = amount - n;
  if (it.amount <= 0) world.remove(it.id);
  if (site.woodHave >= site.woodCost) site.stage = 'building';
  return n;
}

/** Removes tree t from the world and from the map's tree list (so a reloaded view does not bring it
 * back). Shared by foresters, the creature's haul and the hand drawing a tree's wood out. */
export function removeTree(world, t) {
  world.remove(t.id);
  const i = t.src ? world.trees.indexOf(t.src) : -1;
  if (i >= 0) world.trees.splice(i, 1);
}

/** Room left in store b for `kind` (grain, wood or ore) under VILLAGE.storeCap. */
export const storeRoom = (b, kind) => Math.max(0, T.storeCap - (b[kind] ?? 0));

/** Position of a building type in rebuildOrder (types not listed come last). */
const rank = (t) => { const i = T.rebuildOrder.indexOf(t); return i < 0 ? T.rebuildOrder.length : i; };

export function createVillageSim(game) {
  const { world, events } = game;
  const paths = createPaths(world);
  let mapRef = null; // world.height of the map we were set up on; null = inert
  let time = 0;
  let villages = {};
  const air = new Map(); // villager id -> seconds left to wait for `landed`
  const keepJob = new Set(); // villager ids whose last release (a throw, a shake, the creature's drop) sets no job on landing
  const badUntil = new Map(); // "villager:target" -> time before which that villager skips the target as unreachable
  const bad = (v, id) => badUntil.get(`${v.id}:${id}`) > time;
  let strikes = [];
  // Forests: saplings and other trees still growing (ids), the tree count the island may grow back
  // to (its count at setup), and the timers of the spread and of rain sprouting.
  const growing = new Set();
  let treeCap = 0, spreadT = 0, sproutAcc = 0;

  const tileOf = (e) => Math.floor(e.y) * world.w + Math.floor(e.x);
  const tileAt = (tx, ty) => ty * world.w + tx;
  const live = (e) => e && world.get(e.id) === e;
  const usable = (b) => live(b) && b.stage === 'done' && b.hp > 0 && !(b.burning > 0);
  const isSite = (b) => (b.stage === 'blueprint' || b.stage === 'building') && b.hp > 0;
  const own = (owner, type) => world.query({ kind: 'building' }).filter((b) => b.owner === owner && (!type || b.type === type));
  const d2 = (a, x, y) => (a.x - x) ** 2 + (a.y - y) ** 2;
  /** Distance from a point to a building's footprint rectangle (0 inside). */
  function rectDist(b, x, y) {
    if (b.tx === undefined) return Math.max(0, Math.hypot(b.x - x, b.y - y) - 0.5);
    const dx = Math.max(b.tx - x, 0, x - (b.tx + b.fw)), dy = Math.max(b.ty - y, 0, y - (b.ty + b.fh));
    return Math.hypot(dx, dy);
  }
  function nearest(list, x, y) {
    let best = null, bd = Infinity;
    for (const e of list) { const d = d2(e, x, y); if (d < bd) { bd = d; best = e; } }
    return best;
  }

  // ---- placement -------------------------------------------------------------------------------

  /** A wreck of ours that builders clear and a new blueprint may replace. Never the temple, the worship
   * site, or the mine (stoneHp keeps both from wrecking at all). */
  const isWreck = (b) => b.stage === 'wrecked' && b.madeBy === 'village' && !STONE.has(b.type);
  /** A re-placed blueprint `owner` may build over: placed by recovery, no wood delivered yet, not alight. */
  const isOpenAuto = (b, owner) => b.auto === true && b.owner === owner && b.stage === 'blueprint' && b.hp > 0 &&
    !(b.woodHave > 0) && !(b.burning > 0);
  /** What a blueprint placed by `owner` (not by recovery) may replace. */
  const clearable = (b, owner) => isWreck(b) || isOpenAuto(b, owner);

  /** Footprint origin for a building centred on tile (tx, ty); even sizes extend toward +x/+y. */
  const origin = (k, tx, ty) => ({ ox: tx - ((k.fw - 1) >> 1), oy: ty - ((k.fh - 1) >> 1) });

  /** True when (x, y) is inside `owner`'s village influence: within influenceR of its temple or
   * buildingInfluenceR of a finished building of its own. Only finished buildings extend it. Round 43:
   * any building not wrecked counted, so unbuilt blueprints placed one from the next chained across
   * the island (6 woodpile blueprints reached 2.8 tiles from the rival centre) without anything being
   * built. The mine, placed by setup about 10 tiles out, does not extend it either. */
  function inRange(owner, x, y) {
    const temple = villages[owner]?.temple;
    if (temple && temple.hp > 0 && Math.hypot(temple.x - x, temple.y - y) <= T.influenceR) return true;
    return own(owner).some((b) => b.stage === 'done' && b.type !== 'mine' && Math.hypot(b.x - x, b.y - y) <= T.buildingInfluenceR);
  }
  /** True when (x, y) is inside either village's influence: town land, kept free of new trees. */
  const inTown = (x, y) => OWNERS.some((o) => inRange(o, x, y));

  /** { ok, reason } for a building of `type` centred on tile (tx, ty). `auto` (recovery re-placing a
   * lost building near its old spot): no influence check, and wrecks and blueprints all block. */
  function validate(type, tx, ty, owner = 'player', { setup = false, margin = 0, auto = false } = {}) {
    const k = KINDS[type];
    if (!k) return { ok: false, reason: `unknown building kind "${type}"` };
    if (!setup && !PLACEABLE.includes(type)) return { ok: false, reason: `"${type}" cannot be placed (prebuilt only)` };
    if (!Number.isInteger(tx) || !Number.isInteger(ty)) return { ok: false, reason: 'tile coordinates must be integers' };
    const { ox, oy } = origin(k, tx, ty);
    let lo = Infinity, hi = -Infinity;
    for (let y = oy; y < oy + k.fh; y++)
      for (let x = ox; x < ox + k.fw; x++) {
        if (!world.inBounds(x, y)) return { ok: false, reason: 'outside the map' };
        const g = world.ground[tileAt(x, y)], h = world.height[tileAt(x, y)];
        if (g <= 1) return { ok: false, reason: 'water' };
        if (g === 5) return { ok: false, reason: 'bare rock' };
        if (g > 5) return { ok: false, reason: 'not buildable ground' };
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
    if (hi - lo > 1) return { ok: false, reason: 'too steep (height varies by more than 1)' };
    const cx = ox + k.fw / 2, cy = oy + k.fh / 2;
    if (!setup && !auto && !inRange(owner, cx, cy)) return { ok: false, reason: 'out of range (outside the village influence)' };
    for (const b of world.query({ kind: 'building' })) {
      if (!auto && clearable(b, owner)) continue; // placeBlueprint clears it
      const bx = b.tx ?? Math.floor(b.x), by = b.ty ?? Math.floor(b.y), bw = b.fw ?? 1, bh = b.fh ?? 1;
      if (ox < bx + bw + margin && bx < ox + k.fw + margin && oy < by + bh + margin && by < oy + k.fh + margin)
        return { ok: false, reason: 'overlaps a building' };
    }
    const inside = (p) => p.x >= ox && p.x < ox + k.fw && p.y >= oy && p.y < oy + k.fh;
    // liveRocks: the map's rock records only until the terrain system has made them entities, then
    // the entities alone, so a rock the hand carried off frees its old tile (src/systems/terrain.js).
    if (liveRocks(world).some(inside)) return { ok: false, reason: 'a rock is in the way' };
    if (!setup && world.query({ kind: 'tree' }).some((t) => !t.held && inside(t))) return { ok: false, reason: 'trees are in the way' };
    return { ok: true, reason: null, ox, oy };
  }

  function spawnBuilding(type, ox, oy, owner, stage) {
    const k = KINDS[type];
    const x = ox + k.fw / 2, y = oy + k.fh / 2;
    const done = stage === 'done';
    const b = world.spawn('building', {
      x, y, z: world.heightAt(x, y), vx: 0, vy: 0, vz: 0,
      type, owner, stage, tx: ox, ty: oy, fw: k.fw, fh: k.fh,
      hp: 1, flammable: stage !== 'blueprint' && type !== 'mine', grabbable: false, burning: 0, // an empty blueprint has nothing to burn
      woodCost: k.cost, woodHave: done ? k.cost : 0, progress: done ? k.buildTime : 0,
      wood: 0, grain: 0, ore: 0, madeBy: 'village',
    });
    if (type === 'field') { b.growth = 0; b.rainBoost = 0; b.tendAt = -1; }
    if (type === 'mine') b.ore = T.mineOre; // the seam: finite, never refilled
    if (STONE.has(type)) stoneHp(b);
    return b;
  }

  /** Temples are stone: every hp write on a temple stops at templeMinHp, whoever makes it (fire,
   * lightning, a thrown object, the creature's smash, a test), so a temple is chipped and scorched
   * but never reaches hp 0 and is never wrecked. Round 43: before, only thrown-object hits were
   * floored here (the creature floored its own smash); fire and lightning took a temple to 0, the
   * update below wrecked it, and nothing repairs a temple, so worship (which needs a usable temple)
   * ended for good after one lightning bolt, or one fire on a temple a creature smash had chipped
   * to 0.5. Flooring in this one setter covers every writer, present and future; a floored temple
   * is usable again once its fire is out (fire.js lets a fire on an entity above hp 0 burn out after
   * burnTime). */
  function stoneHp(b) {
    let hp = b.hp;
    Object.defineProperty(b, 'hp', {
      enumerable: true,
      configurable: true,
      get: () => hp,
      set: (v) => { hp = Math.max(v, T.templeMinHp); },
    });
  }

  function clearTrees(ox, oy, fw, fh) {
    for (const t of world.query({ kind: 'tree' })) {
      if (t.x >= ox && t.x < ox + fw && t.y >= oy && t.y < oy + fh) removeTree(world, t);
    }
  }

  /** Best centre tile for `type` near the village centre at about `pref` tiles out, or null. */
  function findSpot(type, owner, pref, opts) {
    const v = villages[owner];
    const R = Math.ceil(pref + 6), cx = Math.floor(v.cx), cy = Math.floor(v.cy);
    const cands = [];
    for (let ty = cy - R; ty <= cy + R; ty++)
      for (let tx = cx - R; tx <= cx + R; tx++) {
        const d = Math.hypot(tx + 0.5 - v.cx, ty + 0.5 - v.cy);
        if (d > R) continue;
        const tie = (((tx * 7 + ty * 13 + v.phase) % 17) + 17) % 17;
        cands.push({ tx, ty, s: Math.abs(d - pref) + tie * 0.004 });
      }
    cands.sort((a, b) => a.s - b.s || a.ty - b.ty || a.tx - b.tx);
    for (const c of cands) if (validate(type, c.tx, c.ty, owner, opts).ok) return c;
    return null;
  }

  function placeBlueprint(type, tx, ty, owner = 'player') {
    const r = validate(type, tx, ty, owner);
    if (!r.ok) { api.lastReason = r.reason; return null; }
    const k = KINDS[type];
    const cleared = [];
    for (const w of world.query({ kind: 'building' }))
      if (clearable(w, owner) && w.tx < r.ox + k.fw && r.ox < w.tx + w.fw && w.ty < r.oy + k.fh && r.oy < w.ty + w.fh) {
        if (w.stage === 'wrecked') salvageStock(w, true); // what clearing it would have saved is set down
        world.remove(w.id);
        cleared.push(w.id);
        if (w.stage !== 'wrecked') lose(w); // a re-placed blueprint built over: its building is still lost
      }
    const b = spawnBuilding(type, r.ox, r.oy, owner, KINDS[type].cost > 0 ? 'blueprint' : 'building');
    claim(owner, type, b, cleared);
    api.lastReason = null;
    events.emit('building-placed', { buildingId: b.id, kind: type, owner });
    return b.id;
  }

  // ---- recovery: lost buildings come back -------------------------------------------------------
  //
  // Round 26: why the economy did not recover from chaos, and what changed.
  // What failed: in the chaos check (scripts/check-village.mjs section 11, one act every 2 s for 10
  // minutes) the player village ended with 0-1 re-placed buildings finished, 13-36 blueprints open
  // and wood 0, grain 0 in 26 of 30 seed pairs. Rocks were not the cause (round 23's bisect: the
  // result is the same without them).
  // Why: (1) Sprawl. Nothing capped open sites: the chaos places a blueprint every ~17 s, a placed
  // blueprint of a lost type claimed the lost entry, and builders took "re-placed first, else the
  // oldest", so wood was spread over 20+ sites and few finished. (2) Wood. At 0 stock builders stood
  // idle (they only hauled from the woodpile, one log a trip); assignment filled worshippers,
  // builders and farmers before foresters, so a 3-villager village could have no forester at
  // all; a wreck's timber was salvaged only by an idle builder; and a load delivered to a site was
  // sunk whole even past its cost. (3) Food. A lost storehouse waited behind the woodpile and for its
  // wreck to be cleared (or 120 s), so grain stayed at 0, villagers walked at hungrySpeed for half
  // the run and still went to pray. (4) A dead end: a builder holding wood or salvage with nowhere
  // to take it held it for ever and never built again.
  // What changed: jobs dealt in tiers, shortages first (farmers at 0 grain, foresters before
  // builders at 0 wood, no worship while starving); builders and foresters share one focus site
  // (focus(): a building the village has none of first, in rebuildOrder storehouse, woodpile, field,
  // house; then sites that need only labour; then re-placed lost buildings), builders keep a site until it is done and
  // fetch their own wood (salvage, else a tree) when the pile is empty; foresters clear timbered
  // wrecks before felling trees; salvage includes stacked wood and stored grain; a lost store is
  // re-placed at once when the village has none; a load with nowhere to go is set down; farmers are
  // re-dealt the tick a field or storehouse finishes. Tunables then (in logs, before the step-1 retune): treeYield 2, salvageShare 0.75,
  // haulLoad 3, rebuildSites 2 re-placed sites at once.
  //
  // Round 28: the stress rate, and the last two changes.
  // Rounds 23 and 26 still failed because the chaos check burnt the village faster than the game
  // lets a player burn it. Its fire and lightning were free: about 45 ignitions and 24 strikes in 10
  // minutes, roughly 1600 power of casts, and the player village lost 17-31 buildings (about 2 a
  // minute). Worship pays 0.08 power/s per worshipper with a quarter of adults praying (2 of the
  // starting 9, ~10 power a minute; 4-5 once the village grows to 13-21, ~20-24 a minute) and fire
  // costs 20, lightning 30 (src/miracles/tuning.js): a real player affords one fire every 1-2
  // minutes. The check now casts through miracles.cast with its real cost (see runChaos in
  // scripts/check-village.mjs), so the stress is what the game permits: 1-8 paid fires a run, 5 on
  // average, against 32-58 free ones.
  // A/B split (game seeds 1-50, chaos seeds 5001-5050, measured at the end of the chaos minutes;
  // pass = 2+ re-placed buildings finished during the run and 2+ standing at the end, wood or grain
  // in a standing store or woodpile, 3+ villagers): main's village code with free casts 0/50; main
  // with paid casts 7/50; this code with free casts 4/50; this code with paid casts 50/50. Each fix
  // alone falls short. Free casts defeat this code by burning what it rebuilds: of its 46 misses, 44
  // still finished 2+ re-placed buildings, but 41 had fewer than 2 left standing at the end, 28 had
  // empty stores and 22 fewer than 3 villagers. Under paid casts main misses on structure, faults
  // (1)-(4) above: 41 of its 43 misses finished fewer than 2 re-placed buildings (sprawl, wood),
  // 5 had empty stores (food), none fell below 3 villagers. With paid casts the structural fixes
  // carry the recovery, and two round-26 additions were dropped or changed:
  // (1) Round 26's siteCap (4 open sites per village, validate refused the player's 5th blueprint)
  // is gone: it blocked the player's own building. Only re-placed sites have a cap (rebuildSites).
  // (2) claim(): a player blueprint of a lost type anywhere in the village cancelled the rebuild, so
  // the chaos's random blueprints silently ate most rebuilds; now only one placed on the wreck or
  // within rebuildRadius of the old spot stands in for it. wreckWait 120 -> 30 s: with the player's
  // sites uncapped, builders rarely clear a wreck within 2 minutes, and a lost building waited that
  // long before going up beside it.
  // Measured (300 seed pairs, the paid chaos procedure, measured at the end of the 10 chaos minutes,
  // no calm period): 2-8 fire casts and 0-1 lightning per run; 295 of 300 end with 2+ re-placed lost
  // buildings finished and standing, wood or grain in the storehouses or woodpiles and 3+ villagers
  // (the 5 misses: a cast in the last minutes burnt re-placed buildings, or so little was lost that
  // fewer than 2 needed re-placing). wreckWait 120 instead: 290 of 300.

  /** Puts a wrecked (or built-over) building of ours on its village's lost list. */
  function lose(b) {
    const vill = villages[b.owner];
    if (!vill || b.madeBy !== 'village' || STONE.has(b.type) || !KINDS[b.type]) return;
    const k = KINDS[b.type];
    vill.lost.push({
      type: b.type, x: b.x, y: b.y, cx: b.tx + ((k.fw - 1) >> 1), cy: b.ty + ((k.fh - 1) >> 1),
      wreckId: b.stage === 'wrecked' ? b.id : null, retryAt: 0, seq: vill.lostSeq++, at: time,
    });
  }

  /** A blueprint placed on purpose stands in for one lost building of its type that it rebuilds: the
   * one whose wreck it was placed on, else the nearest whose old centre is within rebuildRadius (as
   * near as recovery itself would put it back). A blueprint of that type placed anywhere else is a
   * new building, and the lost one is still re-placed. */
  function claim(owner, type, b, cleared) {
    const vill = villages[owner];
    if (!vill) return;
    const list = vill.lost.filter((r) => r.type === type);
    const pick = list.find((r) => cleared.includes(r.wreckId)) ??
      nearest(list.filter((r) => Math.hypot(r.x - b.x, r.y - b.y) <= T.rebuildRadius), b.x, b.y);
    if (pick) vill.lost.splice(vill.lost.indexOf(pick), 1);
  }

  /** Blueprint for lost building `r` on its old footprint, else the nearest free spot within
   * rebuildRadius (a free tile round it first, as the villages lay out their own buildings). */
  function rePlace(vill, r) {
    let at = validate(r.type, r.cx, r.cy, vill.owner, { auto: true }).ok ? { tx: r.cx, ty: r.cy } : null;
    for (const margin of [1, 0]) {
      if (at) break;
      const R = T.rebuildRadius, cands = [];
      for (let ty = r.cy - R; ty <= r.cy + R; ty++)
        for (let tx = r.cx - R; tx <= r.cx + R; tx++) {
          const d = Math.hypot(tx - r.cx, ty - r.cy);
          if (d > 0 && d <= R) cands.push({ tx, ty, d });
        }
      cands.sort((a, b) => a.d - b.d || a.ty - b.ty || a.tx - b.tx);
      at = cands.find((c) => validate(r.type, c.tx, c.ty, vill.owner, { auto: true, margin }).ok) ?? null;
    }
    if (!at) return null;
    const v = validate(r.type, at.tx, at.ty, vill.owner, { auto: true });
    const b = spawnBuilding(r.type, v.ox, v.oy, vill.owner, KINDS[r.type].cost > 0 ? 'blueprint' : 'building');
    b.auto = true;
    events.emit('building-placed', { buildingId: b.id, kind: r.type, owner: vill.owner });
    return b;
  }

  /** Re-places lost buildings whose wrecks are cleared, rebuildOrder first, a few at a time. */
  function rebuild(vill) {
    if (!vill.lost.length || !holdsTemple(vill)) return;
    let open = own(vill.owner).filter((b) => b.auto && isSite(b)).length;
    const queue = [...vill.lost].sort((a, b) => rank(a.type) - rank(b.type) || a.seq - b.seq);
    for (const r of queue) {
      if (open >= T.rebuildSites) return;
      if (r.retryAt > time) continue;
      const w = r.wreckId !== null && world.get(r.wreckId);
      // Builders clear the wreck first, so the building comes back on its old footprint; a wreck still
      // standing after wreckWait seconds (builders busy elsewhere) no longer holds it up, and it is
      // re-placed on the nearest free spot beside the wreck.
      const store = T.oneOf.includes(r.type);
      const missing = !own(vill.owner, r.type).some((b) => usable(b) || isSite(b));
      if (store && !missing) { vill.lost.splice(vill.lost.indexOf(r), 1); continue; } // one stands or is going up: no second one
      if (w && w.kind === 'building' && w.stage === 'wrecked' && time - r.at < T.wreckWait && !(store && missing)) continue;
      if (!rePlace(vill, r)) { r.retryAt = time + T.rebuildRetry; continue; }
      vill.lost.splice(vill.lost.indexOf(r), 1);
      open++;
    }
  }

  /** Nearest wreck of v's village that can be cleared now (only ones holding salvage when `salvage`). */
  function chooseWreck(v, salvage = false) {
    const list = own(v.owner).filter((b) => isWreck(b) && !(b.burning > 0) && !bad(v, b.id) && (!salvage || salvageOf(b) > 0));
    return nearest(list, v.x, v.y);
  }
  /** Wood left in a wreck: salvageShare (rounded down) of the timber built into it and of any wood stacked on it. */
  const salvageOf = (b) => Math.floor(((b.woodHave ?? 0) + (b.wood ?? 0)) * T.salvageShare);
  /** Sets down salvageShare of wreck w's stored grain and ore as piles on its spot (and of its timber
   * too when `wood`), for the villagers to take to a store. Shared by clearing a wreck and by a
   * blueprint placed over one. */
  function salvageStock(w, wood = false) {
    const pile = (kind, amount) => world.spawn(kind, { x: w.x, y: w.y, z: world.heightAt(w.x, w.y), vx: 0, vy: 0, vz: 0, amount, grabbable: true, carriedBy: null, madeBy: 'village' });
    for (const kind of ['grain', 'ore']) { const n = Math.floor((w[kind] ?? 0) * T.salvageShare); if (n > 0) pile(kind, n); }
    if (wood && salvageOf(w) > 0) pile('wood', salvageOf(w));
  }
  function clearWreck(v, w) {
    v.target = w.id;
    if (goto(v, bTile(w), w.id)) v.work = { t: T.buildStep, pose: 'work', clear: w };
  }

  /** False once the village's temple has passed to another owner (the rival converted): its
   * recovery stops, so no rival settlers or blueprints appear in the player's converted village. */
  const holdsTemple = (vill) => !vill.temple || vill.temple.owner === vill.owner;

  /** While the village is very small and has a temple, a settler arrives there every settlerInterval. */
  function settlers(vill, pop, dt) {
    const t = vill.temple;
    if (pop >= T.settlerMinPop || !live(t) || !holdsTemple(vill)) { vill.settleT = 0; return; }
    vill.settleT += dt;
    if (vill.settleT < T.settlerInterval) return;
    vill.settleT = 0;
    const spots = praySpots(vill);
    if (!spots.length) return;
    const i = spots[game.rng.int(spots.length)];
    spawnVillager(vill.owner, (i % world.w) + 0.5, ((i / world.w) | 0) + 0.5);
  }

  // ---- setup -----------------------------------------------------------------------------------

  function setup() {
    if (!world.sites?.temple || !world.sites?.village || !world.sites?.rival || !world.sites?.rivalTemple)
      throw new Error('village.setup: map needs sites.temple, village, rival and rivalTemple');
    mapRef = world.height;
    time = 0;
    air.clear(); keepJob.clear(); badUntil.clear(); strikes = []; growing.clear(); spreadT = 0; sproutAcc = 0;
    game.state ??= {};
    game.state.power ??= 0;
    // Trees become entities (foresters fell them) unless another system already made them.
    if (!world.query({ kind: 'tree' }).length) {
      for (const t of world.trees) {
        world.spawn('tree', {
          x: t.x, y: t.y, vx: 0, vy: 0, vz: 0, species: t.kind, growth: 1, hp: 1,
          flammable: true, grabbable: true, burning: 0, src: t, madeBy: 'village',
        });
      }
    }
    for (const owner of OWNERS) {
      const site = owner === 'player' ? world.sites.village : world.sites.rival;
      const ts = owner === 'player' ? world.sites.temple : world.sites.rivalTemple;
      const v = villages[owner] = {
        owner, cx: site.x + 0.5, cy: site.y + 0.5, temple: null, phase: game.rng.int(17),
        assignT: 0, birthT: 0, planT: 0, planI: 0, woodDelivered: 0, woodSpent: 0, grainHarvested: 0, oreMined: 0, godWood: 0, spots: null,
        lost: [], lostSeq: 0, rebuildT: 0, settleT: 0,
      };
      const place = (type, tx, ty) => {
        const r = validate(type, tx, ty, owner, { setup: true, margin: 1 });
        if (!r.ok) return null;
        const k = KINDS[type];
        clearTrees(r.ox, r.oy, k.fw, k.fh);
        return spawnBuilding(type, r.ox, r.oy, owner, 'done');
      };
      v.temple = place('temple', ts.x, ts.y);
      if (!v.temple) {
        // Temple site blocked: nearest valid tile to it.
        const save = { cx: v.cx, cy: v.cy };
        v.cx = ts.x + 0.5; v.cy = ts.y + 0.5;
        const c = findSpot('temple', owner, 0, { setup: true, margin: 1 });
        Object.assign(v, save);
        if (c) v.temple = place('temple', c.tx, c.ty);
      }
      for (const [type, pref] of START_LAYOUT[owner]) {
        const c = findSpot(type, owner, pref, { setup: true, margin: 1 }) ?? findSpot(type, owner, pref, { setup: true });
        if (c) place(type, c.tx, c.ty);
      }
      const st = own(owner, 'store')[0];
      if (st) { st.wood = T.startWood[owner]; st.grain = T.startGrain[owner]; st.ore = T.startOre[owner]; }
      // Villagers on free walkable tiles nearest the centre.
      const tiles = [];
      for (let ty = Math.floor(v.cy) - 4; ty <= Math.floor(v.cy) + 4; ty++)
        for (let tx = Math.floor(v.cx) - 4; tx <= Math.floor(v.cx) + 4; tx++)
          if (paths.walkable(tx, ty) && !own(owner).some((b) => b !== v.temple && rectDist(b, tx + 0.5, ty + 0.5) === 0))
            tiles.push({ tx, ty, d: Math.hypot(tx + 0.5 - v.cx, ty + 0.5 - v.cy) });
      tiles.sort((a, b) => a.d - b.d || a.ty - b.ty || a.tx - b.tx);
      for (let i = 0; i < T.startPop[owner] && tiles.length; i++) {
        const t = tiles.splice(game.rng.int(Math.min(tiles.length, 6)), 1)[0];
        spawnVillager(owner, t.tx + 0.5, t.ty + 0.5);
      }
    }
    for (const owner of OWNERS) assign(villages[owner]);
    // Forests grow back to the size they start at (after the villages cleared their footprints), and
    // any tree still growing (another system may have spawned saplings) is tracked.
    const trees = world.query({ kind: 'tree' });
    treeCap = trees.length;
    for (const t of trees) if ((t.growth ?? 1) < 1) growing.add(t.id);
    return api.stats();
  }

  function spawnVillager(owner, x, y) {
    const v = world.spawn('villager', { x, y, vx: 0, vy: 0, vz: 0, owner, hp: 1, flammable: false, grabbable: true, burning: 0 });
    adopt(v, owner);
    return v;
  }
  function adopt(v, owner) {
    Object.assign(v, {
      owner: v.owner ?? owner ?? nearestOwner(v), job: 'idle', pose: 'idle', frame: 0, facing: 'se',
      hunger: game.rng.next() * 0.5, byHand: false, path: null, pi: 0, work: null, carry: null,
      target: null, wait: 0, flee: 0, fleeFrom: null, fleeTo: -1, anim: 0, dying: 0, landedAt: -99,
    });
    v.hp ??= 1; v.grabbable ??= true; v.flammable ??= false;
  }
  function nearestOwner(e) {
    let best = 'player', bd = Infinity;
    for (const o of OWNERS) { const t = villages[o]?.temple; if (t && d2(t, e.x, e.y) < bd) { bd = d2(t, e.x, e.y); best = o; } }
    return best;
  }

  // ---- items -----------------------------------------------------------------------------------

  function spawnItem(kind, v, amount = 1) {
    const it = world.spawn(kind, { x: v.x, y: v.y, z: v.z + 1.2, vx: 0, vy: 0, vz: 0, amount, grabbable: true, carriedBy: v.id, madeBy: 'village' });
    v.carry = it.id;
    return it;
  }
  function dropCarry(v) {
    const it = v.carry && world.get(v.carry);
    if (it) { it.carriedBy = null; if (!it.held) world.move(it, v.x, v.y, world.heightAt(v.x, v.y)); }
    v.carry = null;
  }
  function carried(v) {
    const it = v.carry && world.get(v.carry);
    if (!it || it.held || it.carriedBy !== v.id) { v.carry = null; return null; }
    return it;
  }
  function looseNear(v, kind) {
    const list = world.query({ kind, x: v.x, y: v.y, r: T.looseItemRadius })
      .filter((it) => grounded(it) && !it.carriedBy && !bad(v, it.id) && paths.walkable(Math.floor(it.x), Math.floor(it.y)));
    return nearest(list, v.x, v.y);
  }
  function pickUp(v, it) {
    if (!live(it) || !grounded(it) || it.carriedBy) return; // thrown since it was chosen: leave it
    it.carriedBy = v.id;
    v.carry = it.id;
  }

  // ---- movement --------------------------------------------------------------------------------

  /** Path to a goal tile. True when already standing on it. */
  function goto(v, goal, targetId) {
    const s = tileOf(v);
    if (s === goal) return true;
    const sx = s % world.w, sy = (s / world.w) | 0;
    if (!paths.walkable(sx, sy)) {
      // Thrown onto rock or similar: walk straight to the nearest walkable neighbour first.
      for (const [dx, dy] of paths.D8) if (paths.walkable(sx + dx, sy + dy)) { v.path = [tileAt(sx + dx, sy + dy)]; v.pi = 0; return false; }
      v.wait = 2; return false;
    }
    const p = paths.find(s, goal);
    if (!p) {
      if (targetId) badUntil.set(`${v.id}:${targetId}`, time + 30);
      v.target = null; v.wait = 1.5; return false;
    }
    v.path = p; v.pi = 0;
    return false;
  }
  function setFacing(v, dx, dy) {
    const sx = dx - dy, sy = dx + dy;
    if (Math.abs(sx) + Math.abs(sy) > 1e-6) v.facing = (sy >= 0 ? 's' : 'n') + (sx >= 0 ? 'e' : 'w');
  }
  function moveToward(v, x, y, dist) {
    const dx = x - v.x, dy = y - v.y, d = Math.hypot(dx, dy);
    setFacing(v, dx, dy);
    if (d <= dist) { world.move(v, x, y, world.heightAt(x, y)); return true; }
    const nx = v.x + (dx / d) * dist, ny = v.y + (dy / d) * dist;
    world.move(v, nx, ny, world.heightAt(nx, ny));
    return false;
  }
  function speed(v) { return T.walkSpeed * (v.hunger >= 1 ? T.hungrySpeed : 1); }
  /** Advance along the path. False once arrived. */
  function walk(v, dt) {
    const i = v.path[v.pi];
    if (moveToward(v, (i % world.w) + 0.5, ((i / world.w) | 0) + 0.5, speed(v) * dt)) {
      v.pi++;
      if (v.pi >= v.path.length) { v.path = null; return false; }
    }
    v.pose = v.carry ? 'carry' : 'walk';
    return true;
  }
  // Fleeing. Two faults lived here (round 26). (1) The next tile was cached in fleeTo and walked to
  // in a straight line without checking it was still beside the villager: a villager thrown or
  // dropped mid-flee walked from where it landed straight back to the old tile, across rock and
  // water. (2) Each tile was the neighbour farthest from the threat, even when every neighbour was
  // nearer than the villager already was: in a rock corner it stepped out toward the threat and
  // straight back, forever. Now the cached tile is dropped unless it is the villager's own tile or
  // one valid step (paths.canStep) from it, and the next tile is the first step of the shortest
  // valid route to the tile farthest from the threat within fleeReach steps; a villager with no
  // tile farther than its own stays put.
  function fleeStep(v, dt) {
    v.pose = 'flee';
    const s = tileOf(v), sx = s % world.w, sy = (s / world.w) | 0;
    if (v.fleeTo >= 0 && v.fleeTo !== s) {
      const dx = (v.fleeTo % world.w) - sx, dy = ((v.fleeTo / world.w) | 0) - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1 || !paths.canStep(sx, sy, dx, dy)) v.fleeTo = -1;
    }
    if (v.fleeTo < 0) v.fleeTo = fleeTile(v, sx, sy);
    if (v.fleeTo < 0) return;
    const i = v.fleeTo;
    if (moveToward(v, (i % world.w) + 0.5, ((i / world.w) | 0) + 0.5, speed(v) * T.fleeSpeed * dt)) v.fleeTo = -1;
  }
  /** First tile of the way from tile (sx, sy) to the tile farthest from v's threat within fleeReach
   * valid steps (breadth-first over paths.canStep; ties: fewer steps, then lower index), or -1 when
   * no reachable tile is farther than (sx, sy). Off walkable ground (thrown onto rock), the walkable
   * neighbour farthest from the threat. */
  function fleeTile(v, sx, sy) {
    const far = (i) => ((i % world.w) + 0.5 - v.fleeFrom.x) ** 2 + (((i / world.w) | 0) + 0.5 - v.fleeFrom.y) ** 2;
    const s = tileAt(sx, sy);
    if (!paths.walkable(sx, sy)) {
      let best = -1;
      for (const [dx, dy] of paths.D8) {
        const j = tileAt(sx + dx, sy + dy);
        if (paths.walkable(sx + dx, sy + dy) && (best < 0 || far(j) > far(best))) best = j;
      }
      return best;
    }
    const from = new Map([[s, -1]]);
    let ring = [s], best = s, bestD = far(s);
    for (let step = 1; step <= T.fleeReach && ring.length; step++) {
      const next = [];
      for (const c of ring) {
        const cx = c % world.w, cy = (c / world.w) | 0;
        for (const [dx, dy] of paths.D8) {
          if (!paths.canStep(cx, cy, dx, dy)) continue;
          const j = tileAt(cx + dx, cy + dy);
          if (from.has(j)) continue;
          from.set(j, c);
          next.push(j);
        }
      }
      next.sort((a, b) => a - b);
      for (const j of next) { const d = far(j); if (d > bestD + 1e-9) { bestD = d; best = j; } }
      ring = next;
    }
    if (best === s) return -1;
    while (from.get(best) !== s) best = from.get(best);
    return best;
  }
  function scare(v, x, y) {
    if (v.dying || v.held) return;
    v.flee = T.fleeTime; v.fleeFrom = { x, y }; v.fleeTo = -1;
    v.path = null; v.work = null;
  }

  // ---- jobs ------------------------------------------------------------------------------------

  /** Gives v a job. `byHand`: the hand set it, and it stays until v dies, the job's place is gone
   * (placeGone) or a shake clears it; automatic assignment never moves v meanwhile. */
  function setJob(v, job, target = null, byHand = false) {
    v.job = job; v.target = target; v.path = null; v.work = null; v.wait = 0;
    if (byHand) v.byHand = true;
  }
  const bTile = (b) => tileOf(b);

  /** The site to work on next among `list` (all of one village): a building the village has none of
   * standing comes first, in rebuildOrder (no store: the store, whoever placed it); then a
   * site with all its wood in (it needs only labour); then re-placed lost buildings in rebuildOrder;
   * then the one closest to having its wood; then the oldest. Builders and foresters share it, so
   * wood and work go to one site at a time instead of being spread thin over every open blueprint.
   * Null for an empty list. */
  function focus(list) {
    if (!list.length) return null;
    const lacking = new Set(T.rebuildOrder.filter((t) => !own(list[0].owner, t).some(usable)));
    let best = null;
    for (const b of list) if (!best || focusBefore(b, best, lacking)) best = b;
    return best;
  }
  function focusBefore(a, b, lacking) {
    const na = lacking.has(a.type) ? rank(a.type) : 99, nb = lacking.has(b.type) ? rank(b.type) : 99;
    if (na !== nb) return na < nb;
    const ra = a.stage === 'building' ? 0 : 1, rb = b.stage === 'building' ? 0 : 1;
    if (ra !== rb) return ra < rb;
    if (!!a.auto !== !!b.auto) return !!a.auto;
    if (a.auto && rank(a.type) !== rank(b.type)) return rank(a.type) < rank(b.type);
    const fa = a.woodHave / (a.woodCost || 1), fb = b.woodHave / (b.woodCost || 1);
    if (fa !== fb) return fa > fb;
    return a.id < b.id;
  }

  /** Puts carried wood into blueprint `site`, no more than it still needs (the rest stays carried, so
   * a big salvage load is never sunk into a small site). Returns the wood put in. */
  function unload(v, it, site) {
    const n = putWood(world, site, it);
    if (!live(it)) v.carry = null;
    return n;
  }

  /** Ore lying loose that a villager of village `vill` may take: within workRadius of its centre (by
   * the mine, which stands outside the influence) or anywhere inside its influence (a store wreck's
   * salvage at the edge of a grown town). */
  const looseOre = (vill) => world.query({ kind: 'ore' })
    .filter((it) => grounded(it) && !it.carriedBy && paths.walkable(Math.floor(it.x), Math.floor(it.y)) &&
      (d2(it, vill.cx, vill.cy) <= T.workRadius ** 2 || inRange(vill.owner, it.x, it.y)));

  /** Usable stores of `owner` with room for `kind`. */
  const storesFor = (owner, kind) => own(owner, 'store').filter((b) => usable(b) && storeRoom(b, kind) >= 1);

  /** Take a carried item to the nearest store with room for it. */
  function deliver(v, it) {
    const depot = nearest(storesFor(v.owner, it.kind).filter((b) => !bad(v, b.id)), v.x, v.y);
    const vill = villages[v.owner];
    if (it.kind === 'wood') {
      // Wood goes to the store, where builders fetch it haulLoad wood at a time, so stock builds up
      // between sites. With no store to take it it goes straight to the village's focus blueprint, a
      // store blueprint first, so a lost store comes back. (Sending it straight to sites even with a
      // store standing kept the stock at 0 whenever any site was open.)
      const sites = depot ? [] : own(v.owner).filter((b) => b.stage === 'blueprint' && b.hp > 0 && !(b.burning > 0) && b.woodHave < b.woodCost && !bad(v, b.id));
      const site = focus(sites.filter((b) => b.type === 'store')) ?? focus(sites);
      if (site) {
        if (!goto(v, bTile(site), site.id)) return;
        const n = unload(v, it, site);
        vill.woodDelivered += n; vill.woodSpent += n;
        return;
      }
    }
    if (!depot) {
      // No store to take it: grain and ore are set down (fetched once a store has room) so the carrier
      // gets on with other work. Wood is held until a store or blueprint can take it.
      if (it.kind !== 'wood') { dropCarry(v); v.wait = 1; } else v.wait = 3;
      v.pose = 'idle';
      return;
    }
    if (!goto(v, bTile(depot), depot.id)) return;
    // A store filled by someone else on the way takes what it has room for; the rest stays carried.
    const n = Math.min(it.amount ?? 1, storeRoom(depot, it.kind));
    depot[it.kind] += n;
    if (it.kind === 'wood') vill.woodDelivered += n;
    it.amount = (it.amount ?? 1) - n;
    if (it.amount <= 0) { world.remove(it.id); v.carry = null; }
  }

  function chooseTree(v) {
    const vill = villages[v.owner];
    const taken = new Set();
    for (const o of world.query({ kind: 'villager' })) if (o !== v && o.job === 'forester' && o.target) taken.add(o.target);
    const list = world.query({ kind: 'tree', x: vill.cx, y: vill.cy, r: T.workRadius })
      .filter((t) => grounded(t) && !taken.has(t.id) && !(t.burning > 0) && (t.growth ?? 1) >= 0.5 && !bad(v, t.id));
    return nearest(list, v.x, v.y);
  }

  /** True when `owner` has somewhere to take an item of `kind` now: a usable store with room for it,
   * or for wood also a blueprint still short of wood. */
  function canTake(owner, kind) {
    if (storesFor(owner, kind).length) return true;
    return kind === 'wood' && own(owner).some((b) => b.stage === 'blueprint' && b.hp > 0 && !(b.burning > 0) && b.woodHave < b.woodCost);
  }

  function think(v) {
    let it = carried(v);
    // A load with nowhere to go is set down (it is fetched once a store or site wants it) instead of
    // being held: a builder holding salvage it could not deliver never built again (round 26).
    if (it && !canTake(v.owner, it.kind)) { dropCarry(v); it = null; }
    const vill = villages[v.owner];
    switch (v.job) {
      case 'forester': {
        if (it) return deliver(v, it);
        const loose = canTake(v.owner, 'wood') && looseNear(v, 'wood');
        if (loose) { if (goto(v, tileOf(loose), loose.id)) pickUp(v, loose); return; }
        let tree = v.target && world.get(v.target);
        if (tree?.kind === 'building') {
          if (isWreck(tree) && !(tree.burning > 0)) return clearWreck(v, tree);
          tree = null;
        }
        if (!tree || tree.kind !== 'tree' || !grounded(tree)) {
          // A wreck of ours with timber left in it beats a tree: clearing it yields a load of
          // salvage and frees the lost building's footprint for its rebuild.
          const wreck = chooseWreck(v, true);
          if (wreck) return clearWreck(v, wreck);
          tree = chooseTree(v);
        }
        if (!tree) { v.target = null; v.wait = 3; v.pose = 'idle'; return; }
        v.target = tree.id;
        if (goto(v, tileOf(tree), tree.id)) v.work = { t: T.chopTime, pose: 'work', done: () => chop(v, tree) };
        return;
      }
      case 'farmer': {
        if (it) return deliver(v, it);
        const store = canTake(v.owner, 'grain');
        const loose = store && looseNear(v, 'grain');
        if (loose) { if (goto(v, tileOf(loose), loose.id)) pickUp(v, loose); return; }
        let field = v.target && world.get(v.target);
        if (!field || field.type !== 'field' || field.owner !== v.owner || !usable(field)) {
          const fields = own(v.owner, 'field').filter((f) => usable(f) && !bad(v, f.id));
          const load = (f) => world.query({ kind: 'villager' }).filter((o) => o !== v && o.job === 'farmer' && o.target === f.id).length;
          field = fields.map((f) => ({ f, n: load(f) })).sort((a, b) => a.n - b.n || b.f.growth - a.f.growth || a.f.id - b.f.id)[0]?.f;
        }
        if (!field) { v.target = null; v.wait = 3; v.pose = 'idle'; return; }
        v.target = field.id;
        if (!goto(v, bTile(field), field.id)) return;
        if (field.growth >= 1 && !store) { v.wait = 3; v.pose = 'idle'; return; } // the crop waits in the field for a store with room
        if (field.growth >= 1) v.work = { t: T.harvestTime, pose: 'work', done: () => harvest(v, field) };
        else v.work = { t: T.tendTime, pose: 'work', tend: field };
        return;
      }
      case 'builder': {
        let site = v.target && world.get(v.target);
        const valid = site && site.kind === 'building' && site.owner === v.owner && isSite(site) && !(site.burning > 0);
        // A builder keeps its site until it is done; a free one joins the village's focus site. The
        // one exception: a builder still waiting for wood on its site leaves it for a building the
        // village has none of (a lost store), so the essentials never queue behind a house.
        if (!valid || site.stage === 'blueprint') {
          const f = focus(own(v.owner).filter((b) => isSite(b) && !(b.burning > 0) && !bad(v, b.id)));
          if (!valid || (f && f.type !== site.type && T.rebuildOrder.includes(f.type) && !own(v.owner, f.type).some(usable))) site = f;
        }
        if (!site) {
          const wreck = chooseWreck(v);
          if (it) return deliver(v, it);
          if (wreck) return clearWreck(v, wreck);
          v.target = null; v.wait = 2; v.pose = 'idle'; return;
        }
        v.target = site.id;
        if (site.stage === 'blueprint') {
          if (it && it.kind === 'wood') {
            if (goto(v, bTile(site), site.id)) unload(v, it, site);
            return;
          }
          if (it) return deliver(v, it);
          const loose = looseNear(v, 'wood');
          if (loose) { if (goto(v, tileOf(loose), loose.id)) pickUp(v, loose); return; }
          const wp = nearest(own(v.owner, 'store').filter((b) => usable(b) && b.wood > 0), v.x, v.y);
          if (!wp) {
            // No wood in stock: the builder fetches it for its site itself, salvage from a wreck
            // first, else a tree it fells, instead of standing idle until a forester comes by.
            const wreck = chooseWreck(v);
            if (wreck) return clearWreck(v, wreck);
            const tree = chooseTree(v);
            if (!tree) { v.wait = 2; v.pose = 'idle'; return; }
            if (goto(v, tileOf(tree), tree.id)) v.work = { t: T.chopTime, pose: 'work', done: () => chop(v, tree) };
            return;
          }
          if (goto(v, bTile(wp), wp.id)) {
            const n = Math.min(T.haulLoad, wp.wood, site.woodCost - site.woodHave);
            wp.wood -= n; vill.woodSpent += n; spawnItem('wood', v, n);
          }
          return;
        }
        if (it) return deliver(v, it);
        if (goto(v, bTile(site), site.id)) v.work = { t: T.buildStep, pose: 'work', build: site };
        return;
      }
      case 'miner': {
        if (it) return deliver(v, it);
        let mine = v.target && world.get(v.target);
        if (!mine || mine.type !== 'mine' || mine.owner !== v.owner || !usable(mine) || !(mine.ore >= 1)) {
          mine = nearest(own(v.owner, 'mine').filter((b) => usable(b) && b.ore >= 1 && !bad(v, b.id)), v.x, v.y);
        }
        if (!canTake(v.owner, 'ore')) { v.target = null; v.wait = 3; v.pose = 'idle'; return; }
        // Loose ore (salvage from a store wreck, a pile the hand left) is fetched before digging: the
        // nearest one in reach, else any in the village (miners are dealt for it even once the mine is
        // worked out).
        const loose = looseNear(v, 'ore') ?? nearest(looseOre(vill).filter((it) => !bad(v, it.id)), v.x, v.y);
        if (loose) { if (goto(v, tileOf(loose), loose.id)) pickUp(v, loose); return; }
        if (!mine) { v.target = null; v.wait = 3; v.pose = 'idle'; return; }
        v.target = mine.id;
        if (goto(v, bTile(mine), mine.id)) v.work = { t: T.mineTime, pose: 'work', done: () => dig(v, mine) };
        return;
      }
      case 'worshipper': {
        if (it) return deliver(v, it);
        const temple = vill.temple;
        if (!usable(temple)) { v.wait = 2; v.pose = 'idle'; return; }
        const spots = praySpots(vill);
        if (!spots.length) { v.wait = 2; return; }
        if (goto(v, spots[v.id % spots.length], temple.id)) v.work = { t: 2, pose: 'pray' };
        return;
      }
      case 'breeder': {
        // A breeder waits beside its house (the one it was dropped on, else the nearest): each one makes
        // births come sooner (breedInterval), while the houses have room.
        if (it) return deliver(v, it);
        let house = v.target && world.get(v.target);
        if (!house || house.type !== 'house' || house.owner !== v.owner || !usable(house))
          house = nearest(own(v.owner, 'house').filter((b) => usable(b) && !bad(v, b.id)), v.x, v.y);
        if (!house) { v.target = null; v.wait = 3; v.pose = 'idle'; return; }
        v.target = house.id;
        const door = doorstep(house, v);
        if (door < 0) { v.wait = 3; v.pose = 'idle'; return; }
        if (goto(v, door, house.id)) { v.wait = 4; v.pose = 'idle'; }
        return;
      }
      default: {
        if (it) return deliver(v, it);
        v.pose = 'idle';
        if (game.rng.next() < 0.4) {
          const tx = Math.floor(vill.cx) + game.rng.int(7) - 3, ty = Math.floor(vill.cy) + game.rng.int(7) - 3;
          if (paths.walkable(tx, ty)) { goto(v, tileAt(tx, ty)); return; }
        }
        v.wait = 2 + game.rng.next() * 2;
      }
    }
  }

  /** The walkable tile in the ring one tile outside building b's footprint nearest to v (ties: lower
   * index), or -1: where a breeder waits at its house, beside it instead of drawn over it. */
  function doorstep(b, v) {
    let best = -1, bd = Infinity;
    for (let y = b.ty - 1; y <= b.ty + b.fh; y++)
      for (let x = b.tx - 1; x <= b.tx + b.fw; x++) {
        const ring = x === b.tx - 1 || y === b.ty - 1 || x === b.tx + b.fw || y === b.ty + b.fh;
        if (!ring || !paths.walkable(x, y)) continue;
        const d = (x + 0.5 - v.x) ** 2 + (y + 0.5 - v.y) ** 2;
        if (d < bd) { bd = d; best = tileAt(x, y); }
      }
    return best;
  }

  /** Walkable tiles in a ring one tile outside the temple footprint (cached per village). */
  function praySpots(vill) {
    const t = vill.temple;
    if (vill.spots && vill.spots.temple === t) return vill.spots.list;
    const list = [];
    for (let y = t.ty - 1; y <= t.ty + t.fh; y++)
      for (let x = t.tx - 1; x <= t.tx + t.fw; x++) {
        const ring = x === t.tx - 1 || y === t.ty - 1 || x === t.tx + t.fw || y === t.ty + t.fh;
        if (ring && paths.walkable(x, y) && Number.isFinite(paths.distance(tileAt(x, y), bTile(t)))) list.push(tileAt(x, y));
      }
    vill.spots = { temple: t, list };
    return list;
  }

  function chop(v, tree) {
    if (!live(tree) || !grounded(tree)) return; // thrown while the axe was swinging: nothing felled
    const wood = woodIn(tree);
    removeTree(world, tree);
    // The feller replants: a sapling of the same kind where the tree stood (spec: foresters cut and
    // replant). Only villagers do; the creature and the hand leave the ground bare. Not on town land
    // (inTown), which foresters clear for building as before, and not a tree the hand or the
    // creature moved, which has no roots where it lies; the island's tree count regrows at forest
    // edges instead (spread).
    if (!tree.uprooted && !inTown(tree.x, tree.y)) plantSapling(tree.x, tree.y, tree.species);
    spawnItem('wood', v, wood);
    v.target = null;
  }
  /** One load of ore out of mine m (no more than it holds). */
  function dig(v, m) {
    if (!usable(m) || !(m.ore >= 1)) return;
    const n = Math.min(T.oreLoad, Math.floor(m.ore));
    m.ore -= n;
    villages[v.owner].oreMined += n;
    spawnItem('ore', v, n);
    if (m.ore < 1) events.emit('mine-empty', { buildingId: m.id, owner: m.owner });
  }
  function harvest(v, field) {
    if (!usable(field) || field.growth < 1) return;
    field.growth = 0;
    spawnItem('grain', v, T.fieldYield);
    villages[v.owner].grainHarvested += T.fieldYield;
  }
  // ---- forests ---------------------------------------------------------------------------------

  /** A sapling (growth 0) of `species` at (x, y); it grows to a full tree over treeGrowTime. */
  function plantSapling(x, y, species = 'broad') {
    const t = world.spawn('tree', {
      x, y, vx: 0, vy: 0, vz: 0, species, growth: 0, hp: 1,
      flammable: true, grabbable: true, burning: 0, madeBy: 'village',
    });
    growing.add(t.id);
    return t;
  }

  /** True when a sapling may take root at (x, y): grass outside both villages' influence (town land
   * stays clear for building), no tree or rock on the tile, no building within spreadClear, at most
   * spreadCrowd trees within 1.6 tiles (a forest edge or open ground, not the thick of a wood). */
  function seedable(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (!world.inBounds(tx, ty) || world.ground[tileAt(tx, ty)] !== 3 || inTown(x, y)) return false;
    const onTile = (e) => Math.floor(e.x) === tx && Math.floor(e.y) === ty;
    const trees = world.query({ kind: 'tree', x, y, r: 1.6 });
    if (trees.length > T.spreadCrowd || trees.some(onTile)) return false;
    // From the tile's centre: a rock anywhere on the tile is within 0.71 of it (from the point itself,
    // a rock in the opposite corner can be 1.4 away).
    if (world.query({ kind: 'rock', x: tx + 0.5, y: ty + 0.5, r: 0.75 }).some(onTile)) return false;
    for (const b of world.query({ kind: 'building', x, y, r: T.spreadClear + 3 })) if (rectDist(b, x, y) <= T.spreadClear) return false;
    return true;
  }

  /** Saplings and other young trees grow, except while held or flying. */
  function grow(dt) {
    for (const id of growing) {
      const t = world.get(id);
      if (!t || t.kind !== 'tree' || !((t.growth ?? 1) < 1)) { growing.delete(id); continue; }
      if (t.held || t.airborne) continue;
      t.growth = Math.min(1, t.growth + dt / T.treeGrowTime);
    }
  }

  /** Every spreadInterval, up to spreadTries grown trees each try to seed a sapling 1-2 tiles off,
   * while the island holds fewer trees than at setup. */
  function spread(dt) {
    spreadT += dt;
    if (spreadT < T.spreadInterval) return;
    spreadT = 0;
    const trees = world.query({ kind: 'tree' });
    let count = trees.length;
    if (!count || count >= treeCap) return;
    for (let k = 0; k < T.spreadTries && count < treeCap; k++) {
      const t = trees[game.rng.int(trees.length)];
      const dx = game.rng.int(5) - 2, dy = game.rng.int(5) - 2, jx = game.rng.next(), jy = game.rng.next();
      if ((!dx && !dy) || (t.growth ?? 1) < 1 || !grounded(t) || t.uprooted || t.burning > 0) continue;
      const x = Math.floor(t.x) + dx + 0.3 + jx * 0.4, y = Math.floor(t.y) + dy + 0.3 + jy * 0.4;
      if (seedable(x, y)) { plantSapling(x, y, t.species); count++; }
    }
  }

  function complete(b) {
    b.stage = 'done';
    // Jobs are re-dealt on the next tick, not at the next assignInterval: a finished field or
    // store gets its farmers back at once.
    if (villages[b.owner]) villages[b.owner].assignT = T.assignInterval;
    events.emit('building-complete', { buildingId: b.id, kind: b.type, owner: b.owner });
  }

  // ---- hand drop -------------------------------------------------------------------------------

  /** A villager dropped near a temple, site, field, mine, house or tree takes that job (worshipper,
   * builder, farmer, miner, breeder, forester); with none of those in reach, next to another adult of
   * its village standing on the ground, breeder. For the player's villagers the job is set by hand and
   * stays; a rival villager takes it under the rival's automatic assignment, which may move it again.
   * Only a slow drop from the hand calls this: a throw, a shake or the creature's drop leaves the job. */
  function dropAssign(v, x, y) {
    if (!v || v.kind !== 'villager' || v.dying || v.job === undefined) return;
    const R = T.dropRadius;
    let best = null;
    const consider = (d, job, target) => { if (d <= R && (!best || d < best.d)) best = { d, job, target }; };
    for (const b of own(v.owner)) {
      if (b.hp <= 0) continue;
      if (b === villages[v.owner]?.temple) consider(rectDist(b, x, y), 'worshipper', null);
      else if (isSite(b)) consider(rectDist(b, x, y), 'builder', b.id);
      else if (b.type === 'field' && b.stage === 'done') consider(rectDist(b, x, y), 'farmer', b.id);
      else if (b.type === 'mine' && b.ore >= 1) consider(rectDist(b, x, y), 'miner', b.id);
      else if (b.type === 'house' && b.stage === 'done') consider(rectDist(b, x, y), 'breeder', b.id);
    }
    // Trees stand everywhere, so a tree wins only when it is a tile closer than any building target.
    for (const t of world.query({ kind: 'tree', x, y, r: R })) if (!t.held) consider(Math.min(R, Math.hypot(t.x - x, t.y - y) + 1), 'forester', t.id);
    // Villagers stand by every workplace, and a group put out of the hand lands side by side, so an
    // adult counts only where no workplace is in reach, and only one standing on the ground.
    if (!best) for (const o of world.query({ kind: 'villager', x, y, r: R }))
      if (o !== v && o.owner === v.owner && o.job !== undefined && !o.dying && !o.held && !o.airborne && !air.has(o.id)) consider(Math.hypot(o.x - x, o.y - y), 'breeder', null);
    if (best) setJob(v, best.job, best.target, v.owner === 'player');
  }

  /** True when the place of v's hand-set job is gone, so v goes back to automatic assignment: the
   * village has no field (farmer), no mine with ore (miner), no house (breeder), no temple of its own
   * (worshipper), or no tree within workRadius (forester).
   * `has` caches the village-wide answers for one assign() pass. */
  function placeGone(v, vill, has) {
    const any = (key, test) => (has[key] ??= test());
    // Finished and not wrecked: a fire on the place does not end the job (it burns out or wrecks it).
    const standing = (b) => live(b) && b.stage === 'done' && b.hp > 0;
    switch (v.job) {
      case 'farmer': return !any('field', () => own(vill.owner, 'field').some(standing));
      case 'miner': return !any('mine', () => own(vill.owner, 'mine').some((b) => standing(b) && b.ore >= 1));
      case 'breeder': return !any('house', () => own(vill.owner, 'house').some(standing));
      case 'worshipper': return !any('temple', () => live(vill.temple) && holdsTemple(vill));
      case 'forester': return !any('tree', () => world.query({ kind: 'tree', x: vill.cx, y: vill.cy, r: T.workRadius }).some((t) => !t.held));
      default: return false; // a builder keeps its job between sites
    }
  }

  // ---- auto-assignment, births, rival growth ---------------------------------------------------

  function assign(vill) {
    const list = world.query({ kind: 'villager' }).filter((v) => v.owner === vill.owner && v.job !== undefined && !v.dying);
    const n = list.length;
    const open = own(vill.owner).filter((b) => isSite(b) && !(b.burning > 0));
    const wrecks = own(vill.owner).filter((b) => isWreck(b) && !(b.burning > 0)).length; // wrecks to clear count as building work
    const sites = open.length + wrecks;
    const waiting = open.filter((b) => b.stage === 'blueprint' && b.woodHave < b.woodCost).length; // sites short of wood
    const fields = own(vill.owner, 'field').filter(usable).length;
    const wood = own(vill.owner, 'store').reduce((s, b) => s + (usable(b) ? b.wood : 0), 0);
    const grain = grainOf(vill.owner);
    const store = canTake(vill.owner, 'grain');
    // Miners dig only while a mine still holds ore, a store has room for it and the stock is under
    // oreTarget: nothing spends ore yet (step 8), so they never take hands from food or wood beyond
    // a small share. Loose ore lying in the village (a store wreck's salvage, a pile the hand left)
    // gets one miner to bring it in, mine or no mine.
    const mines = own(vill.owner, 'mine').filter((b) => usable(b) && b.ore >= 1).length;
    const oreRoom = canTake(vill.owner, 'ore');
    const miners = !oreRoom ? 0 : mines && stockOf(vill.owner, 'ore') < T.oreTarget
      ? Math.min(mines * T.minersPerMine, Math.max(1, Math.round(n * T.mineShare))) : looseOre(vill).length ? 1 : 0;
    const share = vill.owner === 'player' ? T.worshipShare : T.rivalWorshipShare;
    // With nowhere to put wood (no store with room, no blueprint short of it) cutting is wasted:
    // everyone free builds, so the sites that hold their wood (a store among them) get finished.
    const woodRoom = canTake(vill.owner, 'wood');
    const builders = !sites ? 0 : woodRoom ? Math.min(sites * 2, Math.max(1, Math.floor(n * T.builderShare))) : Math.min(sites * 2, n);
    const farmers = store ? Math.min(fields, n) : 0; // no store for grain: the crop waits, hands go to wood
    // Jobs are filled in tier order until every adult has one. Shortages come first: with no grain
    // in store, farmers; with no wood in stock while sites wait for it, foresters before builders
    // (builders then only work sites whose wood is in and clear wrecks, which yields salvage wood).
    // Then the usual shares: worship, building, farming, mining, and woodcutting takes everyone left.
    const tiers = [];
    // Starving: less grain in store than one meal (the rest cannot be eaten).
    const starving = grain < T.mealGrain;
    if (starving && farmers) tiers.push(['farmer', Math.min(farmers, Math.max(1, Math.round(n * T.foodShare)))]);
    if (wood === 0 && waiting) {
      tiers.push(['forester', Math.max(1, Math.round(n * T.gatherShare))]);
      tiers.push(['builder', Math.min(builders, (open.length - waiting) * 2 + (wrecks ? 1 : 0))]);
    }
    // A starving village sends no one to pray.
    tiers.push(['worshipper', usable(vill.temple) && !starving ? Math.round(n * share) : 0], ['builder', builders], ['farmer', farmers],
      ['miner', miners], ['forester', !woodRoom ? 0 : wood < T.woodTarget ? n : 1]);
    const want = { worshipper: 0, builder: 0, farmer: 0, miner: 0, forester: 0 };
    const order = [];
    let left = n;
    for (const [job, k] of tiers) {
      if (!order.includes(job)) order.push(job);
      const give = Math.min(Math.max(0, k - want[job]), left);
      want[job] += give; left -= give;
    }
    const have = { worshipper: 0, builder: 0, farmer: 0, miner: 0, forester: 0, breeder: 0, idle: 0 };
    const free = [];
    const has = {};
    for (const v of list) {
      // A hand-set job whose place is gone goes back to automatic assignment (a breeder keeps no job
      // the tiers deal, so it is dealt a new one below).
      if (v.byHand && placeGone(v, vill, has)) v.byHand = false;
      if (v.byHand) have[v.job] = (have[v.job] ?? 0) + 1;
      else free.push(v);
    }
    const pending = [];
    for (const v of free) {
      if (order.includes(v.job) && have[v.job] < want[v.job]) have[v.job]++;
      else pending.push(v);
    }
    for (const v of pending) {
      const job = order.find((j) => have[j] < want[j]) ?? 'idle';
      have[job]++;
      if (job !== v.job) setJob(v, job);
    }
    // Woodcutting takes everyone left over, so it never frees anyone above: when builders are still
    // short (a fire left wrecks and blueprints while every hand was cutting wood), unlocked
    // foresters become builders, the ones already carrying wood first (they bring it along).
    if (have.builder < want.builder) {
      const cutters = free.filter((v) => v.job === 'forester').sort((a, b) => (b.carry ? 1 : 0) - (a.carry ? 1 : 0) || a.id - b.id);
      for (const v of cutters) {
        if (have.builder >= want.builder || have.forester <= 1) break;
        setJob(v, 'builder');
        have.builder++; have.forester--;
      }
    }
  }

  /** Takes n grain out of the village's usable stores, fullest first, when together they hold
   * that much (the hand drops piles of any size, so a meal may be split over two stores). */
  function takeGrain(owner, n) {
    const list = own(owner, 'store').filter(usable).sort((a, b) => b.grain - a.grain || a.id - b.id);
    if (list.reduce((s, b) => s + b.grain, 0) < n) return false;
    for (const st of list) { const k = Math.min(st.grain, n); st.grain -= k; n -= k; if (n <= 0) break; }
    return true;
  }
  /** `kind` held in `owner`'s finished stores still standing. */
  const stockOf = (owner, kind) => own(owner, 'store').reduce((s, b) => s + (b.stage === 'done' && b.hp > 0 ? b[kind] : 0), 0);
  const grainOf = (owner) => stockOf(owner, 'grain');

  /** Seconds between births for `owner` with n breeders: birthInterval, shortened by breederBoost a
   * breeder, up to breederMax of them. Births still need room in the houses and grain. */
  const breedInterval = (owner, n) => T.birthInterval[owner] / (1 + T.breederBoost * Math.min(n, T.breederMax));

  function births(vill, pop) {
    const houses = own(vill.owner, 'house').filter(usable);
    const cap = houses.length * KINDS.house.cap;
    if (pop >= cap || grainOf(vill.owner) < T.birthReserve + T.birthCost) return;
    if (!takeGrain(vill.owner, T.birthCost)) return;
    const h = houses[game.rng.int(houses.length)];
    spawnVillager(vill.owner, Math.floor(h.x) + 0.5, Math.floor(h.y) + 0.5);
  }

  function rivalPlan(vill) {
    if (own('rival').some(isSite)) return;
    const type = RIVAL_PLAN[vill.planI % RIVAL_PLAN.length];
    const ring = 4 + own('rival').length * 0.3;
    const c = findSpot(type, 'rival', ring, { margin: 1 });
    if (!c) return;
    if (placeBlueprint(type, c.tx, c.ty, 'rival') !== null) vill.planI++;
  }

  // ---- tick ------------------------------------------------------------------------------------

  function deathCause(v) {
    if (strikes.some((s) => time - s.t < 1 && Math.hypot(s.x - v.x, s.y - v.y) <= (s.r ?? 1) + 1)) return 'lightning';
    if (v.burning > 0) return 'fire';
    if (time - v.landedAt < 1) return 'throw';
    return 'injury';
  }

  function update(dt) {
    if (!mapRef) return;
    if (world.height !== mapRef) { mapRef = null; return; } // a new map was loaded: inert until setup()
    time += dt;
    strikes = strikes.filter((s) => time - s.t < 2);

    const buildings = world.query({ kind: 'building' });
    const burning = [];
    for (const b of buildings) {
      if (b.madeBy === 'village' && b.stage === 'blueprint') {
        if (b.hp <= 0 && !(b.woodHave > 0)) {
          // A staked-out plot with no timber on it yet: nothing is left to wreck or clear. It is lost
          // like any building (the village re-places it in turn) and the plot goes at once.
          events.emit('building-destroyed', { buildingId: b.id, kind: b.type ?? 'building' });
          lose(b);
          world.remove(b.id);
          continue;
        }
        b.flammable = b.woodHave > 0; // an empty plot has nothing to burn; delivered timber does
      } else if (b.madeBy === 'village' && b.stage === 'building') b.flammable = true;
      if (b.hp <= 0 && b.stage !== 'wrecked') {
        b.stage = 'wrecked';
        events.emit('building-destroyed', { buildingId: b.id, kind: b.type ?? 'building' });
        lose(b);
      }
      if (b.burning > 0) burning.push(b);
      if (b.type === 'field') {
        b.rainBoost = Math.max(0, b.rainBoost - dt);
        if (usable(b) && b.growth < 1) {
          const rate = (time - b.tendAt < 0.2 ? T.tendFactor : 1) * (b.rainBoost > 0 ? T.rainFactor : 1);
          b.growth = Math.min(1, b.growth + (dt / T.fieldGrowTime) * rate);
        }
      }
    }

    const pop = { player: 0, rival: 0 }, breeders = { player: 0, rival: 0 };
    let praying = 0;
    for (const v of world.query({ kind: 'villager' })) {
      if (v.job === undefined) adopt(v);
      if (v.dying > 0) {
        v.pose = 'dead';
        if (!v.held) { v.dying -= dt; if (v.dying <= 0) { world.remove(v.id); keepJob.delete(v.id); } }
        continue;
      }
      if (v.hp <= 0) {
        v.dying = T.dyingTime; v.pose = 'dead'; v.grabbable = false;
        dropCarry(v); v.path = null; v.work = null; v.target = null;
        events.emit('villager-died', { id: v.id, cause: deathCause(v) });
        continue;
      }
      if (pop[v.owner] !== undefined) { pop[v.owner]++; if (v.job === 'breeder' && !v.held) breeders[v.owner]++; } // a breeder in the hand is not at home
      v.hunger = Math.min(1, v.hunger + dt / T.eatInterval);
      if (v.hunger >= 1 && takeGrain(v.owner, T.mealGrain)) v.hunger = 0;
      if (v.held || air.has(v.id)) {
        if (v.held) { dropCarry(v); v.path = null; v.work = null; v.pose = 'idle'; }
        else { const left = air.get(v.id) - dt; if (left <= 0) { air.delete(v.id); if (!keepJob.has(v.id)) dropAssign(v, v.x, v.y); } else air.set(v.id, left); }
        continue;
      }
      v.anim += dt;
      if (!(v.flee > 0)) for (const b of burning) if (rectDist(b, v.x, v.y) <= T.fireFearR) { scare(v, b.x, b.y); break; }
      act(v, dt);
      if (v.work?.pose === 'pray' && v.owner === 'player' && usable(villages.player.temple)) praying++;
      const it = carried(v);
      if (it) world.move(it, v.x, v.y, v.z + 1.2);
      v.frame = Math.floor(v.anim * 6) % 4;
    }

    if (praying) game.state.power = Math.min(T.powerCap, (game.state.power ?? 0) + praying * T.worshipPower * dt);
    grow(dt);
    spread(dt);

    for (const owner of OWNERS) {
      const vill = villages[owner];
      vill.assignT += dt;
      if (vill.assignT >= T.assignInterval) { vill.assignT = 0; assign(vill); }
      vill.birthT += dt;
      if (vill.birthT >= breedInterval(owner, breeders[owner])) { vill.birthT = 0; births(vill, pop[owner]); }
      settlers(vill, pop[owner], dt);
      vill.rebuildT += dt;
      if (vill.rebuildT >= T.rebuildInterval) { vill.rebuildT = 0; rebuild(vill); }
      if (owner === 'rival') {
        vill.planT += dt;
        if (vill.planT >= T.rivalPlanInterval) { vill.planT = 0; rivalPlan(vill); }
      }
    }
  }

  function act(v, dt) {
    if (v.flee > 0) {
      v.flee -= dt;
      fleeStep(v, dt);
      if (v.flee <= 0) { v.fleeTo = -1; v.path = null; }
      return;
    }
    if (v.path && walk(v, dt)) return;
    if (v.work) {
      const w = v.work;
      v.pose = w.pose;
      if (w.tend) { if (usable(w.tend)) w.tend.tendAt = time; else v.work = null; }
      if (w.build) {
        const b = w.build;
        if (!live(b) || b.stage !== 'building' || b.hp <= 0 || b.burning > 0) { v.work = null; return; }
        b.progress += dt;
        if (b.progress >= KINDS[b.type].buildTime) { complete(b); v.work = null; return; }
      }
      if (w.clear) {
        const b = w.clear;
        if (!live(b) || b.stage !== 'wrecked' || b.burning > 0) { v.work = null; return; }
        b.clearLeft = (b.clearLeft ?? T.clearTime) - dt;
        if (b.clearLeft <= 0) {
          // Sound timber is salvaged from the wreck: the builder carries it off (or leaves it there).
          const salvage = salvageOf(b);
          // Grain and ore pulled from a store wreck are set down for the farmers and miners to take to a store.
          salvageStock(b);
          world.remove(b.id); v.work = null; v.target = null;
          if (salvage > 0) {
            if (!carried(v)) spawnItem('wood', v, salvage);
            else world.spawn('wood', { x: v.x, y: v.y, z: world.heightAt(v.x, v.y), vx: 0, vy: 0, vz: 0, amount: salvage, grabbable: true, carriedBy: null, madeBy: 'village' });
          }
          return;
        }
      }
      w.t -= dt;
      if (w.t <= 0 && v.work === w) { v.work = null; w.done?.(); }
      return;
    }
    if (v.wait > 0) { v.wait -= dt; if (v.pose !== 'idle') v.pose = 'idle'; return; }
    think(v);
  }

  // ---- events ----------------------------------------------------------------------------------

  events.on('grab', (p) => {
    if (!mapRef) return;
    const e = world.get(p?.entityId);
    if (e?.kind === 'villager' && e.job !== undefined) { dropCarry(e); e.path = null; e.work = null; }
    // An item the hand takes out of a villager's arms is no longer carried. Round 43: carriedBy kept
    // naming the old carrier, and villagers (looseNear, pickUp) and the creature skip any item with
    // carriedBy set, so wood or grain grabbed from a carrier was never picked up again.
    const by = e?.carriedBy != null ? world.get(e.carriedBy) : null;
    if (by?.kind === 'villager') { if (by.carry === e.id) dropCarry(by); e.carriedBy = null; }
  });
  // Jobs by hand (step 4 of docs/gameplay-spec.md): a slow drop from the hand sets the job of the
  // place it lands by, for good (dropAssign); a shake clears a hand-set job and hands the villager
  // back to automatic assignment. A throw or the creature's drop changes nothing. Dropping at the
  // town centre is the spec's other way to clear one: the temple stands in for the town centre today
  // and a drop there makes a worshipper, so it waits for the town centre building (step 7).
  events.on('release', (p) => {
    if (!mapRef) return;
    const e = world.get(p?.entityId);
    if (e?.kind !== 'villager') return;
    air.set(e.id, 6);
    if (p.shaken && e.job !== undefined) e.byHand = false;
    if (p.thrown || p.shaken || p.by === 'creature') { keepJob.add(e.id); return; }
    keepJob.delete(e.id);
    dropAssign(e, p.x ?? e.x, p.y ?? e.y);
  });
  events.on('landed', (p) => {
    if (!mapRef) return;
    const e = world.get(p?.entityId);
    if (e?.kind !== 'villager') return;
    air.delete(e.id);
    e.landedAt = time;
    e.path = null;
    if (!keepJob.has(e.id)) dropAssign(e, e.x, e.y);
  });
  events.on('rain', (p) => {
    if (!mapRef || !p) return;
    const r = p.r ?? 4;
    for (const f of world.query({ kind: 'building', x: p.x, y: p.y, r: r + 1.5 }))
      if (f.type === 'field') f.rainBoost = T.rainBoostTime;
    // Rain seeds saplings on free grass under the cloud (rainSprout per second of rain), while the
    // island holds fewer trees than at setup. Rain's growthRate (src/miracles/effects.js) then grows them.
    sproutAcc += (p.dt ?? 0) * T.rainSprout;
    while (sproutAcc >= 1) {
      sproutAcc -= 1;
      const x = p.x + (game.rng.next() * 2 - 1) * r, y = p.y + (game.rng.next() * 2 - 1) * r;
      if ((x - p.x) ** 2 + (y - p.y) ** 2 > r * r || world.query({ kind: 'tree' }).length >= treeCap) continue;
      if (seedable(x, y)) plantSapling(x, y, game.rng.next() < 0.3 ? 'pine' : 'broad');
    }
  });
  events.on('strike', (p) => {
    if (!mapRef || !p) return;
    strikes.push({ x: p.x, y: p.y, r: p.r ?? 1, t: time });
    for (const v of world.query({ kind: 'villager', x: p.x, y: p.y, r: (p.r ?? 1) + T.strikeFearPad }))
      if (v.job !== undefined && v.hp > 0) scare(v, p.x, p.y);
  });

  // ---- the hand in bulk ------------------------------------------------------------------------
  //
  // The hand (src/systems/hand.js) draws grain out of the player's fields and grain, wood or ore out
  // of their stores, puts piles, trees and ore rocks into stores and wood into blueprints, and pours
  // wood into a site to god-build it. Only the player's own buildings take part. The hand owns the
  // pointer and the piles it carries; these functions own the village's stock and sites.

  /** Building of ours whose footprint holds the ground point (x, y), or null. */
  function buildingAt(x, y) {
    if (!mapRef) return null;
    for (const b of world.query({ kind: 'building', x, y, r: 3 })) if (b.owner === 'player' && b.stage !== 'wrecked' && rectDist(b, x, y) === 0) return b;
    return null;
  }

  /** 'grain', 'wood' or 'ore' when the hand can draw that from building b now, else null. A field
   * gives grain; a store gives `kind` when it holds some, or with no `kind` the first of grain, wood
   * and ore it holds. `stores` false leaves out stores (fields only). */
  function handSource(b, { kind = null, stores = true } = {}) {
    if (!mapRef || b?.kind !== 'building' || b.owner !== 'player' || !usable(b)) return null;
    if (b.type === 'field') return b.growth * T.fieldYield >= 1 && (!kind || kind === 'grain') ? 'grain' : null;
    if (!stores || b.type !== 'store') return null;
    if (kind) return STOCK_KINDS.includes(kind) && b[kind] >= 1 ? kind : null;
    return STOCK_KINDS.find((k) => b[k] >= 1) ?? null;
  }

  /** Takes up to `max` whole units of `kind` out of building b for the hand. Returns the units taken.
   * A field gives its crop as it stands (growth falls back by the share taken). */
  function handTake(b, kind, max) {
    if (handSource(b, { kind }) !== kind) return 0;
    const vill = villages[b.owner];
    if (b.type === 'field') {
      const n = Math.floor(Math.min(max, b.growth * T.fieldYield + 1e-9));
      b.growth = Math.max(0, b.growth - n / T.fieldYield);
      vill.grainHarvested += n;
      return n;
    }
    const n = Math.floor(Math.min(max, b[kind]));
    b[kind] -= n;
    return n;
  }

  /** The store resource a hand drop of entity kind `kind` adds to (a tree is wood, a rock its ore). */
  const stockKind = (kind) => (kind === 'tree' ? 'wood' : kind === 'rock' ? 'ore' : kind);

  /** How building b takes a hand drop of `kind` ('grain', 'wood', 'ore', 'tree' or 'rock'; `e` the
   * dropped thing, for a rock's ore): 'store' (a usable store with room for it; a rock only when it
   * holds ore), 'site' (wood or a tree on a blueprint still short of wood), or null. */
  function handSink(b, kind, e = null) {
    if (!mapRef || b?.kind !== 'building' || b.owner !== 'player' || !(b.hp > 0) || b.burning > 0) return null;
    if (kind === 'rock' && !(e && oreIn(e) >= 1)) return null;
    const k = stockKind(kind);
    if (!STOCK_KINDS.includes(k)) return null;
    if (b.type === 'store' && usable(b)) return storeRoom(b, k) >= 1 ? 'store' : null;
    return k === 'wood' && isSite(b) && b.woodHave < b.woodCost ? 'site' : null;
  }

  /** Puts pile, tree or ore rock e (dropped by the hand) into building b: as much as the store has
   * room for, no more than the site still needs into a site. A pile keeps what is left over and a
   * rock the ore left in it; a tree is used up, and wood the building could not take is left as a pile
   * on it. A rock emptied of ore is gone. Returns the units put in (0 when b takes none). */
  function handPut(b, e) {
    const how = handSink(b, e?.kind, e);
    if (!how || !live(e)) return 0;
    const tree = e.kind === 'tree', rock = e.kind === 'rock';
    const amount = tree ? woodIn(e) : rock ? oreIn(e) : e.amount ?? 1;
    // The village's wood stats (woodDelivered, woodSpent) count villagers' hauling only: the hand
    // can move the same wood in and out of a store any number of times.
    let put;
    if (how === 'store') {
      const k = stockKind(e.kind);
      put = Math.min(amount, storeRoom(b, k));
      b[k] += put;
    } else {
      put = Math.min(amount, b.woodCost - b.woodHave);
      b.woodHave += put;
      if (b.woodHave >= b.woodCost && b.stage === 'blueprint') b.stage = 'building';
    }
    const left = amount - put;
    if (tree) {
      removeTree(world, e);
      if (left > 0) world.spawn('wood', { x: b.x, y: b.y, z: world.heightAt(b.x, b.y), vx: 0, vy: 0, vz: 0, amount: left, grabbable: true, carriedBy: null, madeBy: 'village' });
    } else if (rock) {
      if (left > 0) e.oreLeft = left;
      else world.remove(e.id);
    } else if (left > 0) e.amount = left;
    else world.remove(e.id);
    return put;
  }

  /** True when the hand can god-build site b: a site of ours that is not alight. */
  const canGodBuild = (b) => !!mapRef && b?.kind === 'building' && b.owner === 'player' && isSite(b) && !(b.burning > 0);

  /** God-building: pours up to `max` whole units of wood from the hand into site b. The whole job
   * costs godBuildFactor x woodCost: woodCost of it is the timber (woodHave), the rest stands in for
   * the builders' labour (progress). Each unit goes to the two parts in proportion to what each still
   * needs, so the building rises as the wood goes in, and it finishes when both are full. Returns the
   * units used (no more than the job still needs). */
  function godBuild(b, max) {
    if (!canGodBuild(b) || !(max >= 1)) return 0;
    const k = KINDS[b.type];
    const labour = b.woodCost * (T.godBuildFactor - 1);
    const woodNeed = Math.max(0, b.woodCost - b.woodHave);
    const labourNeed = labour > 0 ? Math.max(0, 1 - b.progress / k.buildTime) * labour : 0;
    const total = woodNeed + labourNeed;
    const used = Math.min(Math.floor(max), Math.ceil(total - 1e-9));
    if (used > 0) {
      const w = Math.min(woodNeed, Math.round((used * woodNeed) / total));
      b.woodHave += w;
      if (labour > 0) b.progress = Math.min(k.buildTime, b.progress + (k.buildTime * (used - w)) / labour);
      villages[b.owner].godWood += used;
    }
    if (b.woodHave >= b.woodCost && b.stage === 'blueprint') b.stage = 'building';
    if (b.stage === 'building' && (labour <= 0 || b.progress >= k.buildTime - 1e-6)) { b.progress = k.buildTime; complete(b); }
    return used;
  }

  // ---- public ----------------------------------------------------------------------------------

  function stats() {
    const out = { power: game.state?.power ?? 0, time, trees: world.query({ kind: 'tree' }).length, treeCap, growing: growing.size };
    for (const owner of OWNERS) {
      const jobs = { farmer: 0, forester: 0, miner: 0, builder: 0, worshipper: 0, breeder: 0, idle: 0 };
      let population = 0, byHand = 0;
      for (const v of world.query({ kind: 'villager' })) if (v.owner === owner && v.job !== undefined && !v.dying) { population++; jobs[v.job]++; if (v.byHand) byHand++; }
      const bs = own(owner);
      const vill = villages[owner] ?? {};
      out[owner] = {
        population, jobs, byHand,
        grain: grainOf(owner), wood: stockOf(owner, 'wood'), ore: stockOf(owner, 'ore'),
        mineOre: bs.reduce((s, b) => s + (b.type === 'mine' ? b.ore : 0), 0),
        woodDelivered: vill.woodDelivered ?? 0, woodSpent: vill.woodSpent ?? 0, grainHarvested: vill.grainHarvested ?? 0,
        oreMined: vill.oreMined ?? 0,
        godWood: vill.godWood ?? 0,
        buildings: bs.filter((b) => b.stage === 'done').length,
        sites: bs.filter(isSite).length,
        wrecked: bs.filter((b) => b.stage === 'wrecked').length,
        cap: bs.filter((b) => b.type === 'house' && usable(b)).length * KINDS.house.cap,
      };
    }
    return out;
  }

  const api = {
    setup, update, placeBlueprint, validate, stats, lastReason: null,
    buildingAt, handSource, handTake, handSink, handPut, canGodBuild, godBuild,
    /** True when a sapling could take root at (x, y) now (the spread's and rain's test). */
    seedable: (x, y) => !!mapRef && seedable(x, y),
    /** True when (x, y) is town land (either village's influence): no replanting or seeding there. */
    inTown: (x, y) => !!mapRef && inTown(x, y),
    get ready() { return mapRef !== null && mapRef === world.height; },
    get time() { return time; },
    village(owner) { return villages[owner]; },
    paths,
  };
  return api;
}

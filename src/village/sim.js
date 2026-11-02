// Village simulation for both villages: setup from the map's sites, villager jobs, hauling,
// blueprints and construction, fields and food, births, worship power, death, wrecks and fear.
// Inert until setup() is called after world.loadMap(), so scenarios that load a map for other
// systems are not filled with villages. Sim randomness only from game.rng; no DOM.
//
// Recovery (both villages): every building of ours that is wrecked (fire, lightning, anything that
// takes hp to 0; never the temple) goes on the village's `lost` list. Woodcutters clear wrecks that
// still hold timber before they fell trees, and builders clear them when they have no wood to haul;
// clearing takes clearTime and salvages salvageShare of the timber (and of a storehouse's grain).
// Once a lost building's wreck is gone, the village re-places its blueprint on the old footprint, or
// on the nearest free spot within rebuildRadius (one validate() accepts: no rock, tree, water or
// building in it); a wreck still standing after wreckWait seconds no longer holds it up and it goes
// up beside the wreck. A lost store (oneOf: storehouse, woodpile) goes up beside its wreck at once
// when the village has none, and is not rebuilt while it has one. At most rebuildSites re-placed
// blueprints at a time, rebuildOrder first; the player's own blueprints are never refused for their
// number. These blueprints are marked `auto`. A blueprint the village or the player places on a lost
// building's wreck or within rebuildRadius of its old spot takes the place of one lost building of
// its type, so nothing is rebuilt twice, and the player may place over a re-placed
// blueprint that has no wood in it yet (it goes back on the list). Builders and woodcutters work one
// focus site at a time (focus()). With no usable storehouse, no one is sent to farm, carried grain
// is set down and ripe crops wait in the fields. Temples never fall: every hp write on one stops at
// templeMinHp (stoneHp), so worship resumes once a fire on it is out. An empty blueprint can't burn,
// and one knocked to hp 0 leaves no wreck: it goes on the lost list and its plot is removed at once. While a village with a temple has
// fewer than settlerMinPop villagers, a settler arrives at the temple every settlerInterval seconds;
// births then take over as houses and grain return.
import { VILLAGE as T, KINDS, PLACEABLE, START_LAYOUT, RIVAL_PLAN } from './config.js';
import { createPaths } from './path.js';
import { liveRocks } from '../systems/terrain.js';

const OWNERS = ['player', 'rival'];

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
 * the logs put in. Shared by the village's builders (unload) and the creature's haul, so both
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

/** Position of a building type in rebuildOrder (types not listed come last). */
const rank = (t) => { const i = T.rebuildOrder.indexOf(t); return i < 0 ? T.rebuildOrder.length : i; };

export function createVillageSim(game) {
  const { world, events } = game;
  const paths = createPaths(world);
  let mapRef = null; // world.height of the map we were set up on; null = inert
  let time = 0;
  let villages = {};
  const air = new Map(); // villager id -> seconds left to wait for `landed`
  const badUntil = new Map(); // "villager:target" -> time before which that villager skips the target as unreachable
  const bad = (v, id) => badUntil.get(`${v.id}:${id}`) > time;
  let strikes = [];

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
   * site (since round 43 stoneHp keeps it from wrecking at all). */
  const isWreck = (b) => b.stage === 'wrecked' && b.madeBy === 'village' && b.type !== 'temple';
  /** A re-placed blueprint `owner` may build over: placed by recovery, no wood delivered yet, not alight. */
  const isOpenAuto = (b, owner) => b.auto === true && b.owner === owner && b.stage === 'blueprint' && b.hp > 0 &&
    !(b.woodHave > 0) && !(b.burning > 0);
  /** What a blueprint placed by `owner` (not by recovery) may replace. */
  const clearable = (b, owner) => isWreck(b) || isOpenAuto(b, owner);

  /** Footprint origin for a building centred on tile (tx, ty); even sizes extend toward +x/+y. */
  const origin = (k, tx, ty) => ({ ox: tx - ((k.fw - 1) >> 1), oy: ty - ((k.fh - 1) >> 1) });

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
    if (!setup && !auto) {
      const v = villages[owner];
      const temple = v?.temple;
      const inTemple = temple && temple.hp > 0 && Math.hypot(temple.x - cx, temple.y - cy) <= T.influenceR;
      // Only finished buildings extend the influence. Round 43: any building not wrecked counted, so
      // unbuilt blueprints placed one from the next chained across the island (6 woodpile blueprints
      // reached 2.8 tiles from the rival centre) without anything being built.
      const nearB = own(owner).some((b) => b.stage === 'done' && Math.hypot(b.x - cx, b.y - cy) <= T.buildingInfluenceR);
      if (!inTemple && !nearB) return { ok: false, reason: 'out of range (outside the village influence)' };
    }
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
      hp: 1, flammable: stage !== 'blueprint', grabbable: false, burning: 0, // an empty blueprint has nothing to burn
      woodCost: k.cost, woodHave: done ? k.cost : 0, progress: done ? k.buildTime : 0,
      wood: 0, grain: 0, madeBy: 'village',
    });
    if (type === 'field') { b.growth = 0; b.rainBoost = 0; b.tendAt = -1; }
    if (type === 'temple') stoneHp(b);
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
      if (t.x >= ox && t.x < ox + fw && t.y >= oy && t.y < oy + fh) removeTree(t);
    }
  }
  function removeTree(t) {
    world.remove(t.id);
    const i = t.src ? world.trees.indexOf(t.src) : -1;
    if (i >= 0) world.trees.splice(i, 1);
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
  // builders and farmers before woodcutters, so a 3-villager village could have no woodcutter at
  // all; a wreck's timber was salvaged only by an idle builder; and a load delivered to a site was
  // sunk whole even past its cost. (3) Food. A lost storehouse waited behind the woodpile and for its
  // wreck to be cleared (or 120 s), so grain stayed at 0, villagers walked at hungrySpeed for half
  // the run and still went to pray. (4) A dead end: a builder holding wood or salvage with nowhere
  // to take it held it for ever and never built again.
  // What changed: jobs dealt in tiers, shortages first (farmers at 0 grain, woodcutters before
  // builders at 0 wood, no worship while starving); builders and woodcutters share one focus site
  // (focus(): a building the village has none of first, in rebuildOrder storehouse, woodpile, field,
  // house; then sites that need only labour; then re-placed lost buildings), builders keep a site until it is done and
  // fetch their own wood (salvage, else a tree) when the pile is empty; woodcutters clear timbered
  // wrecks before felling trees; salvage includes stacked wood and stored grain; a lost store is
  // re-placed at once when the village has none; a load with nowhere to go is set down; farmers are
  // re-dealt the tick a field or storehouse finishes. Tunables: treeYield 2, salvageShare 0.75,
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
    if (!vill || b.madeBy !== 'village' || b.type === 'temple' || !KINDS[b.type]) return;
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
  /** Logs left in a wreck: salvageShare (rounded down) of the timber built into it and of any wood stacked on it. */
  const salvageOf = (b) => Math.floor(((b.woodHave ?? 0) + (b.wood ?? 0)) * T.salvageShare);
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
    air.clear(); badUntil.clear(); strikes = [];
    game.state ??= {};
    game.state.power ??= 0;
    // Trees become entities (woodcutters fell them) unless another system already made them.
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
        assignT: 0, birthT: 0, planT: 0, planI: 0, woodDelivered: 0, woodSpent: 0, grainHarvested: 0, spots: null,
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
      const wp = own(owner, 'woodpile')[0], st = own(owner, 'storehouse')[0];
      if (wp) wp.wood = T.startWood[owner];
      if (st) st.grain = T.startGrain[owner];
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
      hunger: game.rng.next() * 0.5, lockUntil: 0, path: null, pi: 0, work: null, carry: null,
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

  function setJob(v, job, target = null, lock = 0) {
    v.job = job; v.target = target; v.path = null; v.work = null; v.wait = 0;
    if (lock) v.lockUntil = time + lock;
  }
  const bTile = (b) => tileOf(b);

  /** The site to work on next among `list` (all of one village): a building the village has none of
   * standing comes first, in rebuildOrder (no storehouse: the storehouse, whoever placed it); then a
   * site with all its wood in (it needs only labour); then re-placed lost buildings in rebuildOrder;
   * then the one closest to having its wood; then the oldest. Builders and woodcutters share it, so
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
   * a big salvage load is never sunk into a small site). Returns the logs put in. */
  function unload(v, it, site) {
    const n = putWood(world, site, it);
    if (!live(it)) v.carry = null;
    return n;
  }

  /** Take a carried item to its depot. */
  function deliver(v, it) {
    const depotType = it.kind === 'wood' ? 'woodpile' : 'storehouse';
    const depot = nearest(own(v.owner, depotType).filter((b) => usable(b) && !bad(v, b.id)), v.x, v.y);
    const vill = villages[v.owner];
    if (it.kind === 'wood') {
      // Wood goes to the woodpile, where builders fetch it haulLoad logs at a time, so stock builds
      // up between sites. With no usable woodpile it goes straight to the village's focus blueprint,
      // a woodpile blueprint first, so a lost woodpile comes back. (Sending it straight to sites even
      // with a woodpile standing kept the stock at 0 whenever any site was open.)
      const sites = depot ? [] : own(v.owner).filter((b) => b.stage === 'blueprint' && b.hp > 0 && !(b.burning > 0) && b.woodHave < b.woodCost && !bad(v, b.id));
      const site = focus(sites.filter((b) => b.type === 'woodpile')) ?? focus(sites);
      if (site) {
        if (!goto(v, bTile(site), site.id)) return;
        const n = unload(v, it, site);
        vill.woodDelivered += n; vill.woodSpent += n;
        return;
      }
    }
    if (!depot) {
      // No storehouse: grain is set down (farmers fetch it once one stands) so the carrier gets on with
      // other work. Wood is held until a woodpile or blueprint can take it.
      if (it.kind === 'grain') { dropCarry(v); v.wait = 1; } else v.wait = 3;
      v.pose = 'idle';
      return;
    }
    if (!goto(v, bTile(depot), depot.id)) return;
    if (it.kind === 'wood') { depot.wood += it.amount; vill.woodDelivered += it.amount; } else depot.grain += it.amount;
    world.remove(it.id);
    v.carry = null;
  }

  function chooseTree(v) {
    const vill = villages[v.owner];
    const taken = new Set();
    for (const o of world.query({ kind: 'villager' })) if (o !== v && o.job === 'woodcutter' && o.target) taken.add(o.target);
    const list = world.query({ kind: 'tree', x: vill.cx, y: vill.cy, r: T.workRadius })
      .filter((t) => grounded(t) && !taken.has(t.id) && !(t.burning > 0) && (t.growth ?? 1) >= 0.5 && !bad(v, t.id));
    return nearest(list, v.x, v.y);
  }

  /** True when `owner` has somewhere to take an item of `kind` now: a usable storehouse for grain; a
   * usable woodpile or a blueprint still short of wood for wood. */
  function canTake(owner, kind) {
    if (kind === 'grain') return own(owner, 'storehouse').some(usable);
    return own(owner).some((b) => (b.type === 'woodpile' && usable(b)) ||
      (b.stage === 'blueprint' && b.hp > 0 && !(b.burning > 0) && b.woodHave < b.woodCost));
  }

  function think(v) {
    let it = carried(v);
    // A load with nowhere to go is set down (it is fetched once a store or site wants it) instead of
    // being held: a builder holding salvage it could not deliver never built again (round 26).
    if (it && !canTake(v.owner, it.kind)) { dropCarry(v); it = null; }
    const vill = villages[v.owner];
    switch (v.job) {
      case 'woodcutter': {
        if (it) return deliver(v, it);
        const loose = canTake(v.owner, 'wood') && looseNear(v, 'wood');
        if (loose) { if (goto(v, tileOf(loose), loose.id)) pickUp(v, loose); return; }
        let tree = v.target && world.get(v.target);
        if (tree?.kind === 'building') {
          if (isWreck(tree) && !(tree.burning > 0)) return clearWreck(v, tree);
          tree = null;
        }
        if (!tree || tree.kind !== 'tree' || !grounded(tree)) {
          // A wreck of ours with timber left in it beats a tree: clearing it yields several logs of
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
        const store = own(v.owner, 'storehouse').some(usable);
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
        if (field.growth >= 1 && !store) { v.wait = 3; v.pose = 'idle'; return; } // the crop waits in the field for a storehouse
        if (field.growth >= 1) v.work = { t: T.harvestTime, pose: 'work', done: () => harvest(v, field) };
        else v.work = { t: T.tendTime, pose: 'work', tend: field };
        return;
      }
      case 'builder': {
        let site = v.target && world.get(v.target);
        const valid = site && site.kind === 'building' && site.owner === v.owner && isSite(site) && !(site.burning > 0);
        // A builder keeps its site until it is done; a free one joins the village's focus site. The
        // one exception: a builder still waiting for wood on its site leaves it for a building the
        // village has none of (a lost storehouse), so the essentials never queue behind a house.
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
          const wp = nearest(own(v.owner, 'woodpile').filter((b) => usable(b) && b.wood > 0), v.x, v.y);
          if (!wp) {
            // No wood in stock: the builder fetches it for its site itself, salvage from a wreck
            // first, else a tree it fells, instead of standing idle until a woodcutter comes by.
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
      case 'worshipper': {
        if (it) return deliver(v, it);
        const temple = vill.temple;
        if (!usable(temple)) { v.wait = 2; v.pose = 'idle'; return; }
        const spots = praySpots(vill);
        if (!spots.length) { v.wait = 2; return; }
        if (goto(v, spots[v.id % spots.length], temple.id)) v.work = { t: 2, pose: 'pray' };
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
    removeTree(tree);
    spawnItem('wood', v, T.treeYield);
    v.target = null;
  }
  function harvest(v, field) {
    if (!usable(field) || field.growth < 1) return;
    field.growth = 0;
    spawnItem('grain', v, T.fieldYield);
    villages[v.owner].grainHarvested += T.fieldYield;
  }
  function complete(b) {
    b.stage = 'done';
    // Jobs are re-dealt on the next tick, not at the next assignInterval: a finished field or
    // storehouse gets its farmers back at once.
    if (villages[b.owner]) villages[b.owner].assignT = T.assignInterval;
    events.emit('building-complete', { buildingId: b.id, kind: b.type, owner: b.owner });
  }

  // ---- hand drop -------------------------------------------------------------------------------

  /** A villager dropped near a temple, site, field or tree takes that job for a while. */
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
    }
    // Trees stand everywhere, so a tree wins only when it is a tile closer than any building target.
    for (const t of world.query({ kind: 'tree', x, y, r: R })) if (!t.held) consider(Math.min(R, Math.hypot(t.x - x, t.y - y) + 1), 'woodcutter', t.id);
    if (best) setJob(v, best.job, best.target, T.dropLockTime);
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
    const wood = own(vill.owner, 'woodpile').reduce((s, b) => s + (usable(b) ? b.wood : 0), 0);
    const grain = grainOf(vill.owner);
    const store = own(vill.owner, 'storehouse').some(usable);
    const share = vill.owner === 'player' ? T.worshipShare : T.rivalWorshipShare;
    // With nowhere to put wood (no woodpile, no blueprint short of it) cutting is wasted: everyone
    // free builds, so the sites that hold their wood (a woodpile among them) get finished.
    const woodRoom = canTake(vill.owner, 'wood');
    const builders = !sites ? 0 : woodRoom ? Math.min(sites * 2, Math.max(1, Math.floor(n * T.builderShare))) : Math.min(sites * 2, n);
    const farmers = store ? Math.min(fields, n) : 0; // no storehouse: the crop waits, hands go to wood
    // Jobs are filled in tier order until every adult has one. Shortages come first: with no grain
    // in store, farmers; with no wood in stock while sites wait for it, woodcutters before builders
    // (builders then only work sites whose wood is in and clear wrecks, which yields salvage wood).
    // Then the usual shares: worship, building, farming, and woodcutting takes everyone left.
    const tiers = [];
    if (grain === 0 && farmers) tiers.push(['farmer', Math.min(farmers, Math.max(1, Math.round(n * T.foodShare)))]);
    if (wood === 0 && waiting) {
      tiers.push(['woodcutter', Math.max(1, Math.round(n * T.gatherShare))]);
      tiers.push(['builder', Math.min(builders, (open.length - waiting) * 2 + (wrecks ? 1 : 0))]);
    }
    // A starving village (no grain in store) sends no one to pray.
    tiers.push(['worshipper', usable(vill.temple) && grain > 0 ? Math.round(n * share) : 0], ['builder', builders], ['farmer', farmers],
      ['woodcutter', !woodRoom ? 0 : wood < T.woodTarget ? n : 1]);
    const want = { worshipper: 0, builder: 0, farmer: 0, woodcutter: 0 };
    const order = [];
    let left = n;
    for (const [job, k] of tiers) {
      if (!order.includes(job)) order.push(job);
      const give = Math.min(Math.max(0, k - want[job]), left);
      want[job] += give; left -= give;
    }
    const have = { worshipper: 0, builder: 0, farmer: 0, woodcutter: 0, idle: 0 };
    const free = [];
    for (const v of list) {
      if (v.lockUntil > time) have[v.job] = (have[v.job] ?? 0) + 1;
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
    // woodcutters become builders, the ones already carrying wood first (they bring it along).
    if (have.builder < want.builder) {
      const cutters = free.filter((v) => v.job === 'woodcutter').sort((a, b) => (b.carry ? 1 : 0) - (a.carry ? 1 : 0) || a.id - b.id);
      for (const v of cutters) {
        if (have.builder >= want.builder || have.woodcutter <= 1) break;
        setJob(v, 'builder');
        have.builder++; have.woodcutter--;
      }
    }
  }

  function takeGrain(owner, n) {
    const st = own(owner, 'storehouse').filter(usable).sort((a, b) => b.grain - a.grain || a.id - b.id)[0];
    if (!st || st.grain < n) return false;
    st.grain -= n;
    return true;
  }
  const grainOf = (owner) => own(owner, 'storehouse').reduce((s, b) => s + (b.stage === 'done' && b.hp > 0 ? b.grain : 0), 0);
  const woodOf = (owner) => own(owner, 'woodpile').reduce((s, b) => s + (b.stage === 'done' && b.hp > 0 ? b.wood : 0), 0);

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

    const pop = { player: 0, rival: 0 };
    let praying = 0;
    for (const v of world.query({ kind: 'villager' })) {
      if (v.job === undefined) adopt(v);
      if (v.dying > 0) {
        v.pose = 'dead';
        if (!v.held) { v.dying -= dt; if (v.dying <= 0) world.remove(v.id); }
        continue;
      }
      if (v.hp <= 0) {
        v.dying = T.dyingTime; v.pose = 'dead'; v.grabbable = false;
        dropCarry(v); v.path = null; v.work = null; v.target = null;
        events.emit('villager-died', { id: v.id, cause: deathCause(v) });
        continue;
      }
      if (pop[v.owner] !== undefined) pop[v.owner]++;
      v.hunger = Math.min(1, v.hunger + dt / T.eatInterval);
      if (v.hunger >= 1 && takeGrain(v.owner, 1)) v.hunger = 0;
      if (v.held || air.has(v.id)) {
        if (v.held) { dropCarry(v); v.path = null; v.work = null; v.pose = 'idle'; }
        else { const left = air.get(v.id) - dt; if (left <= 0) { air.delete(v.id); dropAssign(v, v.x, v.y); } else air.set(v.id, left); }
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

    for (const owner of OWNERS) {
      const vill = villages[owner];
      vill.assignT += dt;
      if (vill.assignT >= T.assignInterval) { vill.assignT = 0; assign(vill); }
      vill.birthT += dt;
      if (vill.birthT >= T.birthInterval[owner]) { vill.birthT = 0; births(vill, pop[owner]); }
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
          const salvage = salvageOf(b), sacks = Math.floor((b.grain ?? 0) * T.salvageShare);
          world.remove(b.id); v.work = null; v.target = null;
          // Grain sacks pulled from a storehouse wreck are set down for the farmers to take to a store.
          if (sacks > 0) world.spawn('grain', { x: b.x, y: b.y, z: world.heightAt(b.x, b.y), vx: 0, vy: 0, vz: 0, amount: sacks, grabbable: true, carriedBy: null, madeBy: 'village' });
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
  events.on('release', (p) => {
    if (!mapRef) return;
    const e = world.get(p?.entityId);
    if (e?.kind !== 'villager') return;
    air.set(e.id, 6);
    dropAssign(e, p.x ?? e.x, p.y ?? e.y);
  });
  events.on('landed', (p) => {
    if (!mapRef) return;
    const e = world.get(p?.entityId);
    if (e?.kind !== 'villager') return;
    air.delete(e.id);
    e.landedAt = time;
    e.path = null;
    dropAssign(e, e.x, e.y);
  });
  events.on('rain', (p) => {
    if (!mapRef || !p) return;
    for (const f of world.query({ kind: 'building', x: p.x, y: p.y, r: (p.r ?? 4) + 1.5 }))
      if (f.type === 'field') f.rainBoost = T.rainBoostTime;
  });
  events.on('strike', (p) => {
    if (!mapRef || !p) return;
    strikes.push({ x: p.x, y: p.y, r: p.r ?? 1, t: time });
    for (const v of world.query({ kind: 'villager', x: p.x, y: p.y, r: (p.r ?? 1) + T.strikeFearPad }))
      if (v.job !== undefined && v.hp > 0) scare(v, p.x, p.y);
  });

  // ---- public ----------------------------------------------------------------------------------

  function stats() {
    const out = { power: game.state?.power ?? 0, time };
    for (const owner of OWNERS) {
      const jobs = { farmer: 0, woodcutter: 0, builder: 0, worshipper: 0, idle: 0 };
      let population = 0;
      for (const v of world.query({ kind: 'villager' })) if (v.owner === owner && v.job !== undefined && !v.dying) { population++; jobs[v.job]++; }
      const bs = own(owner);
      const vill = villages[owner] ?? {};
      out[owner] = {
        population, jobs,
        grain: grainOf(owner), wood: woodOf(owner),
        woodDelivered: vill.woodDelivered ?? 0, woodSpent: vill.woodSpent ?? 0, grainHarvested: vill.grainHarvested ?? 0,
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
    get ready() { return mapRef !== null && mapRef === world.height; },
    get time() { return time; },
    village(owner) { return villages[owner]; },
    paths,
  };
  return api;
}

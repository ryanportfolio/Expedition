// Shared creature trial for the browser scenario (src/dev/scenarios/creature.js) and the node check
// (scripts/check-creature.mjs). Needs a game with the island loaded, the village and the creature set
// up. Drives the sim through h.step(seconds) and reports through h.assert / h.log; h.shot(name) is
// optional (browser only). A per-tick sampler wraps game.tick for the run and restores it after.
// Test hooks used: game.systems.creature.debug.candidateFilter (offer only some actions) and
// .holdHunger (pin hunger). Stroke, slap and tether arrive as the hand's events.
import { CREATURE } from './tunables.js';
import { getSprite } from '../art/registry.js';
import { makeLut } from '../art/lut.js';
import { VILLAGE } from '../village/config.js';

/**
 * Movement sampler: feed it the creature's position each tick (sample(x, y)); it counts a stand on
 * anything but walkable ground (sand, grass, dirt: ground 2..4), a tile change of more than
 * CREATURE.maxStep height, and a tile change to a non-adjacent tile. bad = { water, step, jump,
 * first }. The node check plants a cliff jump and a water tile to show it catches both.
 */
export function moveSampler(world) {
  const bad = { water: 0, step: 0, jump: 0, first: '' };
  let last = -1, steps = 0;
  return {
    bad,
    get steps() { return steps; },
    reset() { last = -1; },
    sample(x, y) {
      const t = Math.floor(y) * world.w + Math.floor(x);
      const g = world.ground[t];
      if (!(g >= 2 && g <= 4)) { bad.water++; bad.first ||= `on ground ${g} at ${x.toFixed(2)},${y.toFixed(2)}`; }
      if (last >= 0 && last !== t) {
        steps++;
        const dh = Math.abs(world.height[t] - world.height[last]);
        const adj = Math.max(Math.abs((t % world.w) - (last % world.w)), Math.abs(((t / world.w) | 0) - ((last / world.w) | 0))) <= 1;
        if (dh > CREATURE.maxStep) { bad.step++; bad.first ||= `step dh ${dh} into ${t}`; }
        if (!adj) { bad.jump++; bad.first ||= `jumped ${last} -> ${t}`; }
      }
      last = t;
    },
  };
}

export async function creatureTrial(game, h) {
  const { world, events } = game;
  const cs = game.systems.creature;
  const brain = cs.brain;
  const e0 = cs.entity;
  const shot = h.shot ?? (async () => {});
  const out = { completed: new Set(), acts: [], trace: [] };

  // ---- per-tick sampler: water, step heights, speed, liveness, pending feedback
  const moves = moveSampler(world);
  const bad = moves.bad;
  bad.dead = 0;
  const speed = { normal: 0, weak: 0, weakTicks: 0 };
  let last = null;
  let onTickOnce = [];
  let perTick = null; // optional per-tick probe (dt)
  let weakSeen = false;
  const orig = game.tick;
  game.tick = (dt) => {
    orig(dt);
    const e = cs.entity;
    if (!e || world.get(e.id) !== e || e.hp !== 1) { bad.dead++; return; }
    moves.sample(e.x, e.y);
    if (last) {
      const d = Math.hypot(e.x - last.x, e.y - last.y);
      const v = d / dt;
      if (brain.weak) { speed.weak = Math.max(speed.weak, v); if (v > 0) speed.weakTicks++; } else speed.normal = Math.max(speed.normal, v);
    }
    if (brain.weak) weakSeen = true;
    last = { x: e.x, y: e.y };
    out.trace.push(Math.round(e.x * 1000), Math.round(e.y * 1000));
    if (perTick) perTick(dt);
    const run = onTickOnce;
    onTickOnce = [];
    for (const fn of run) fn();
  };
  const offAct = events.on('act', (a) => { if (a.actor === 'creature') { out.acts.push(a); out.completed.add(`${a.verb}:${a.target}`); } });
  const actsOf = (key) => out.acts.filter((a) => `${a.verb}:${a.target}` === key).length;

  /** Steps in 0.2 s chunks until cond() or maxSec. Returns seconds waited (Infinity on timeout). */
  function waitFor(cond, maxSec) {
    for (let s = 0; s <= maxSec; s += 0.2) {
      if (cond()) return s;
      h.step(0.2);
    }
    return cond() ? maxSec : Infinity;
  }
  /** Offers only `key`, waits for its act event. Returns { waited, effect } where effect is the
   * system's record of the world value the action changed ({ id, field, before, after }). */
  function force(key, maxSec = 90) {
    cs.debug.candidateFilter = (c) => c.key === key;
    const before = actsOf(key);
    const waited = waitFor(() => actsOf(key) > before, maxSec);
    cs.debug.candidateFilter = null;
    const rec = [...cs.history].reverse().find((r) => r.key === key && r.phase === 'complete');
    return { waited, effect: waited < Infinity ? rec?.effect ?? null : null };
  }
  const B = (id) => world.get(id);

  try {
    // ---- spawn
    const site = world.sites.creatureStart;
    h.assert(e0 && e0.kind === 'creature' && e0.hp === 1 && e0.grabbable === false, `one creature entity spawned (kind ${e0?.kind}, hp ${e0?.hp}, grabbable ${e0?.grabbable})`);
    h.assert(Math.floor(e0.x) === Math.floor(site.x) && Math.floor(e0.y) === Math.floor(site.y), `spawned at sites.creatureStart (${e0.x}, ${e0.y})`);
    h.assert(world.query({ kind: 'creature' }).length === 1, 'exactly one creature');

    // ---- two sim minutes on its own
    let midShot = false, walkShot = false;
    const vc = world.sites.village;
    for (let s = 0; s < 120; s += 0.5) {
      h.step(0.5);
      const st = cs.state();
      const inVillage = Math.hypot(st.x - vc.x, st.y - vc.y) <= vc.r;
      if (!walkShot && st.action?.phase === 'walk' && inVillage) { walkShot = true; h.log('walking', st.action.key, st.pose, st.x.toFixed(1), st.y.toFixed(1)); await shot('walking'); }
      if (!midShot && st.action?.phase === 'do' && !['idle:none', 'wander:none', 'sleep:none'].includes(st.action.key)) {
        midShot = true; h.log('mid-action', st.action.key, st.pose, JSON.stringify(st.thought)); await shot('mid-action');
      }
    }
    if (!walkShot) { h.log('no walk inside the village circle in 2 minutes; shot where it is', JSON.stringify(cs.state().action)); await shot('walking'); }
    h.log('after 2 minutes, completed:', [...out.completed].join(' '));
    h.assert(out.completed.size >= 4, `chose and completed at least 4 distinct actions in 2 sim minutes (${out.completed.size}: ${[...out.completed].join(', ')})`);

    // ---- world effects of forced actions
    {
      const { effect: x } = force('eat:grain', 90);
      const b = x && B(x.id);
      const ok = x && b?.kind === 'building' && ((b.type === 'store' && x.field === 'grain') || (b.type === 'field' && x.field === 'growth' && x.before >= 1)) && x.after < x.before;
      h.assert(ok, `eat:grain lowers store grain or a ripe field's growth (${b?.type} ${JSON.stringify(x)})`);
    }
    {
      const strokeAt = { before: null, after: null };
      const agg = () => brain.table().aggregates.find((x) => x.key === 'water:field')?.score ?? 0;
      const before = actsOf('water:field');
      const off = events.on('act', (a) => {
        if (a.actor === 'creature' && a.verb === 'water' && actsOf('water:field') === before + 1) {
          onTickOnce.push(() => { strokeAt.before = agg(); events.emit('stroke', { creatureId: cs.entity.id, strength: 1 }); strokeAt.after = agg(); });
        }
      });
      const { effect: x } = force('water:field', 90);
      off();
      h.step(1 / 30);
      h.assert(x && B(x.id)?.type === 'field' && x.field === 'growth' && x.after >= Math.min(1, x.before + CREATURE.waterGrowth) - 1e-9, `water:field raises the field's growth (${JSON.stringify(x)})`);
      h.assert(strokeAt.after > strokeAt.before, `stroke right after water:field raises that key (aggregate ${strokeAt.before} -> ${strokeAt.after})`);
      const th = game.state.creatureThought;
      h.log('thought after stroke', JSON.stringify(th));
      h.assert(th && th.judged === 'water:field' && th.feedback === 'stroke' && th.until > cs.time && 'key' in th, `thought shows the judged action (${JSON.stringify(th)})`);
      h.assert(cs.state().pose === 'happy', `happy pose after the stroke (${cs.state().pose})`);
    }
    {
      // older dung may be used up meanwhile, so look for a new id rather than a count
      const dungBefore = new Set(world.query({ kind: 'dung' }).map((d) => d.id));
      const r = force('poop:none', 60);
      const fresh = world.query({ kind: 'dung' }).filter((d) => !dungBefore.has(d.id));
      h.assert(r.waited < Infinity && fresh.length === 1 && r.effect?.id === fresh[0].id, `poop spawns a dung item (new ${fresh.map((d) => d.id)}, effect ${JSON.stringify(r.effect)})`);
      // dung fertilizes: a field's per-tick growth for 6 s with the heap on it, then 6 s with the
      // heap gone, the creature idling meanwhile. The village alone grows a field at one of
      // {1, tend, rain, tend*rain} / fieldGrowTime per second (a farmer tends some ticks and not
      // others), so each tick is matched against those rates and those rates + dungGrowth: every
      // tick with the heap must match a dung rate, every tick without it a village rate. The heap is
      // moved onto the field so the measurement does not depend on where the creature pooped.
      const heap = fresh[0];
      const field = world.query({ kind: 'building' }).find((b) => b.type === 'field' && b.stage === 'done' && b.hp > 0);
      if (heap && field) {
        const V = VILLAGE, base = [1, V.tendFactor, V.rainFactor, V.tendFactor * V.rainFactor].map((k) => k / V.fieldGrowTime);
        const near = (r, list) => list.some((v) => Math.abs(r - v) < 1e-6);
        const tally = (withDung) => {
          const n = { dung: 0, village: 0, other: 0 };
          let g = field.growth;
          perTick = (dt) => {
            const inc = field.growth - g;
            g = field.growth;
            if (inc <= 0 || field.growth >= 1) return; // harvested or full: not a growth tick
            const r = inc / dt;
            if (near(r, base.map((v) => v + CREATURE.dungGrowth))) n.dung++;
            else if (near(r, base)) n.village++;
            else n.other++;
          };
          h.step(6);
          perTick = null;
          return n;
        };
        cs.debug.candidateFilter = (c) => c.key === 'idle:none';
        // older heaps still fertilizing this field would add their rate too: only the fresh one stays
        for (const d of world.query({ kind: 'dung' })) if (d !== heap) world.remove(d.id);
        world.move(heap, field.x, field.y, world.heightAt(field.x, field.y));
        field.growth = 0;
        const withDung = tally(true);
        world.remove(heap.id);
        field.growth = 0;
        const alone = tally(false);
        cs.debug.candidateFilter = null;
        h.assert(withDung.dung > 100 && withDung.village + withDung.other === 0 && alone.village > 100 && alone.dung + alone.other === 0,
          `dung fertilizes: field growth ticks with the heap ${JSON.stringify(withDung)}, without ${JSON.stringify(alone)} (dung adds ${CREATURE.dungGrowth.toFixed(4)}/s to the village rate)`);
      } else h.assert(false, `dung fertilize test needs a heap and a player field (${!!heap}, ${!!field})`);
    }
    {
      const { effect: x } = force('smash:building', 60);
      h.assert(x && B(x.id)?.kind === 'building' && x.field === 'hp' && Math.abs(x.after - Math.max(0, x.before - CREATURE.smashDamage)) < 1e-9, `smash lowers a building's hp by ${CREATURE.smashDamage} (${JSON.stringify(x)})`);
    }
    {
      // a house blueprint by the village so there is somewhere to haul wood to
      const vs = game.systems.village;
      let id = null;
      for (let r = 2; r <= 8 && id === null; r++)
        for (let dy = -r; dy <= r && id === null; dy++)
          for (let dx = -r; dx <= r && id === null; dx++)
            if (Math.max(Math.abs(dx), Math.abs(dy)) === r && vs.validate('house', vc.x + dx, vc.y + dy).ok) id = vs.placeBlueprint('house', vc.x + dx, vc.y + dy);
      const wp = world.query({ kind: 'building' }).find((b) => b.type === 'store' && b.owner === 'player');
      if (wp) wp.wood = Math.max(wp.wood, 250);
      // The village's builders haul to the same blueprint; a well-stocked village can fill it before
      // the creature arrives, so its cost is held out of reach for this case and put back after.
      const bp = id !== null ? world.get(id) : null;
      const cost = bp?.woodCost;
      if (bp) bp.woodCost = 1e6;
      const { effect: x } = force('haul:wood', 90);
      if (bp) bp.woodCost = cost;
      h.assert(id !== null && x && x.id === id && x.field === 'woodHave' && x.after > x.before, `haul:wood carries wood to the blueprint (${JSON.stringify(x)}, blueprint ${id})`);
    }
    {
      let landed = 0;
      // a loose rock beside it, so a rock is in range wherever the earlier steps left it
      const e = cs.entity;
      world.spawn('rock', { x: e.x + 0.4, y: e.y + 0.4, vx: 0, vy: 0, vz: 0, size: 1, grabbable: true });
      const off = events.on('landed', (p) => { if (p.by === 'creature' && p.kind === 'rock') landed++; });
      const r = force('throw:rock', 90);
      waitFor(() => landed > 0, 5);
      off();
      h.assert(r.waited < Infinity && landed > 0, `throw:rock throws a rock that lands (${landed})`);
    }

    // ---- slap right after eating a villager: never again, even starving; weak; recovers on grain
    let slapped = null;
    {
      const before = actsOf('eat:villager');
      const off = events.on('act', (a) => {
        if (a.actor === 'creature' && a.verb === 'eat' && a.target === 'villager' && actsOf('eat:villager') === before + 1) {
          onTickOnce.push(() => { events.emit('slap', { creatureId: cs.entity.id, strength: 1 }); slapped = cs.time; });
        }
      });
      const r = force('eat:villager', 90);
      off();
      h.step(1 / 30);
      h.assert(r.waited < Infinity && slapped !== null, `ate a villager (forced) and was slapped right after (${r.waited} s)`);
      h.assert(brain.isForbidden('eat:villager'), `one slap forbids eat:villager (${JSON.stringify(brain.table().aggregates.find((x) => x.key === 'eat:villager'))})`);
      h.assert(['hurt'].includes(cs.state().pose), `hurt pose after the slap (${cs.state().pose})`);
      h.assert(game.state.creatureThought.judged === 'eat:villager', `thought judges eat:villager (${JSON.stringify(game.state.creatureThought)})`);
      if (!h.shot) h.log('table after slap', JSON.stringify(brain.table().aggregates));
      await shot('hurt-after-slap');
    }
    {
      const eatsBefore = actsOf('eat:villager'), throwsBefore = out.acts.filter((a) => a.verb === 'throw').length;
      let offeredThrowWhileWeak = 0, offeredVillager = 0, weakThrows = 0;
      const offThrow = events.on('act', (a) => { if (a.actor === 'creature' && a.verb === 'throw' && brain.weak) weakThrows++; });
      cs.debug.holdHunger = 1;
      cs.debug.candidateFilter = (c) => {
        if (c.key === 'eat:villager') offeredVillager++;
        if (brain.weak && c.key.startsWith('throw:')) offeredThrowWhileWeak++;
        return c.key !== 'eat:grain';
      };
      const villagersBefore = world.query({ kind: 'villager' }).filter((v) => v.hp > 0).length;
      weakSeen = false;
      speed.weak = 0; speed.weakTicks = 0;
      // 180 s in 0.5 s chunks (the same ticks as one 180 s step) so the weak walk can be shot
      let weakShot = false;
      for (let s = 0; s < 180; s += 0.5) {
        h.step(0.5);
        if (!weakShot && brain.weak && cs.state().pose === 'weak') { weakShot = true; h.log('weak walk', JSON.stringify(cs.state().action)); await shot('weak'); }
      }
      offThrow();
      h.log('starving 3 minutes', JSON.stringify({ offeredVillager, offeredThrowWhileWeak, weakThrows, speed, villagersBefore }));
      h.assert(offeredVillager > 0, `villagers stayed on offer while starving (${offeredVillager} offers)`);
      h.assert(actsOf('eat:villager') === eatsBefore, `never ate a villager again over 3 sim minutes at hunger 1 (${actsOf('eat:villager') - eatsBefore})`);
      h.assert(weakSeen && brain.weak, `went weak (weak ${brain.weak}, speedMult ${brain.speedMult}, canThrow ${brain.canThrow})`);
      h.assert(offeredThrowWhileWeak === 0 && weakThrows === 0, `weak blocks throws (offered ${offeredThrowWhileWeak}, thrown ${weakThrows}, throws total ${out.acts.filter((a) => a.verb === 'throw').length - throwsBefore})`);
      h.assert(speed.weakTicks > 0 && speed.weak <= CREATURE.walkSpeed * brain.params.weakSpeedMult + 1e-6 && speed.normal > speed.weak, `weak is slower (max ${speed.weak.toFixed(2)} vs ${speed.normal.toFixed(2)} tiles/s)`);
      const st = cs.state();
      h.log('weak state', JSON.stringify({ pose: st.pose, action: st.action, weak: st.weak }));
      cs.debug.holdHunger = null;
      cs.debug.candidateFilter = null;
      for (const b of world.query({ kind: 'building' })) if (b.type === 'store' && b.owner === 'player' && b.hp > 0) b.grain = Math.max(b.grain, 240);
      const grainBefore = actsOf('eat:grain');
      const waited = waitFor(() => !brain.weak, 120);
      h.assert(waited < Infinity && actsOf('eat:grain') > grainBefore && brain.canThrow, `recovered after eating grain in ${waited.toFixed(1)} s (weak ${brain.weak}, hunger ${brain.needs.hunger.toFixed(2)})`);
    }

    // ---- tether
    {
      const e = cs.entity;
      const f = cs.paths.field(Math.floor(e.y) * world.w + Math.floor(e.x));
      let goal = -1;
      for (let i = 0; i < f.dist.length && goal < 0; i++) {
        const x = (i % world.w) + 0.5, y = ((i / world.w) | 0) + 0.5;
        if (f.dist[i] >= 13 && f.dist[i] <= 18 && Math.hypot(x - e.x, y - e.y) >= 12) goal = i;
      }
      const tx = (goal % world.w) + 0.5, ty = ((goal / world.w) | 0) + 0.5;
      const from = Math.hypot(tx - e.x, ty - e.y);
      events.emit('tether', { creatureId: e.id, x: tx, y: ty });
      const dist = () => Math.hypot(cs.entity.x - tx, cs.entity.y - ty);
      const took = waitFor(() => dist() <= 1.5, 30);
      h.assert(goal >= 0 && took <= 30, `tethered ${from.toFixed(1)} tiles away: arrived in ${took} s`);
      let near = 0, n = 0, far = 0;
      for (let s = 0; s < 20; s += 0.5) { h.step(0.5); n++; if (dist() <= 3.5) near++; far = Math.max(far, dist()); }
      h.log('tether stay', JSON.stringify({ near, n, far, state: cs.state().tether }));
      h.assert(near / n >= 0.8 && far <= 5, `stayed near the tether point for 20 s (${near}/${n} samples within 3.5, max ${far.toFixed(2)})`);
      if (h.shot) { game.camera.centerOn(cs.entity.x, cs.entity.y, cs.entity.z); h.step(1 / 30); await shot('tethered'); }
    }

    // ---- its lean after this training, drawn through its own LUT and the sprite's lean step
    {
      cs.draw();
      const lean = brain.alignmentLean(), st = cs.state();
      const step = lean >= 0.33 ? 1 : lean <= -0.33 ? -1 : 0;
      h.assert(cs.entity.lut === makeLut(lean) && st.leanStep === step && cs.entity.sprite === getSprite('creature', { pose: st.pose, frame: st.frame, facing: st.facing, lean: step }),
        `drawn with getSprite('creature', { pose, frame, facing, lean ${step} }) and makeLut(${lean.toFixed(3)})`);
      h.log('lean', lean.toFixed(3), JSON.stringify(brain.table().aggregates));
      await shot('lean');
    }

    // ---- invariants over the whole run
    const okActs = out.acts.every((a) => a.actor === 'creature' && Number.isFinite(a.x) && Number.isFinite(a.y) && a.weight === brain.moralOf(`${a.verb}:${a.target}`));
    h.assert(okActs && out.acts.length > 0, `act events carry actor creature and the brain's moral weight (${out.acts.length} acts)`);
    h.assert(bad.water === 0 && bad.step === 0 && bad.jump === 0, `never stepped into water or over more than ${CREATURE.maxStep} height (${JSON.stringify(bad)})`);
    h.assert(bad.dead === 0, 'never removed, never below hp 1');
    h.log('thought', JSON.stringify(game.state.creatureThought), 'lean', brain.alignmentLean().toFixed(3));
    out.summary = { completed: [...out.completed].sort(), acts: out.acts.length, lean: brain.alignmentLean(), table: brain.table().aggregates };
  } finally {
    game.tick = orig;
    offAct();
    cs.debug.candidateFilter = null;
    cs.debug.holdHunger = null;
  }
  return out;
}

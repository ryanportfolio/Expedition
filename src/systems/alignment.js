// Alignment system: the player's good/evil alignment, the world LUT it drives, and the rival
// village's belief meter that wins the game. Internals in src/alignment/ (numbers in tuning.js,
// pure math in model.js, ring and belief bar drawing in ring.js).
//
// Alignment (game.state.alignment, -1 evil .. +1 good): every `act` with actor 'player' adds
// weight * scale to a running sum, and alignment is that sum clamped to [-1, 1]. The sum may bank up
// to tuning.headroom past +-1: 0 (default) saturates it at the clamp, Infinity makes it a plain
// unbounded sum. Creature acts never move it. With no acts the sum drifts toward 0 exponentially
// (half-life tuning.driftHalfLife, 4 minutes), so the world's look reflects the last several minutes
// of play. A value written to game.state.alignment by a scenario or debug panel is taken up as the
// new running total (any banked surplus is dropped).
//
// LUT: draw() sets game.renderer.lut (and the frame's ctx.lut) to makeLut(displayed alignment),
// but only while it owns the LUT: when game.renderer.lut is still the renderer's initial LUT (the
// one it held when this system was created, which the terrain system sets to the neutral LUT) or
// the LUT this system set last. Anything else that assigns a different LUT object (a scenario, a
// debug view) keeps it until it puts the initial LUT back; the displayed alignment keeps walking
// meanwhile, so the world shows the current step as soon as the alignment owns the LUT again.
// The displayed alignment walks toward the real one by one 0.125 step at most every
// tuning.lutStepTime seconds of sim time and at most one step per frame, so the land, hand, temple
// and everything else drawn through the shared LUT shifts smoothly instead of flickering. Terrain
// passes run before systems draw, so they show the previous frame's step: at most one step behind.
//
// Rival influence: acts (player or creature) whose x, y fall inside the ring of tuning.ringRadius
// tiles around the rival village center (sites.rival tile center; on a map where that circle would
// cross the map edge the radius shrinks to the distance from the center to the nearest edge) add
// |weight| * beliefGain to game.state.belief (0..1), good acts as `impress`, evil acts as `scare` (game.state.beliefMix
// totals). Miracles count through the `act` they emit. Belief fades slowly once nothing has added
// to it for tuning.beliefGrace seconds. When it reaches 1 the village converts, once: every rival
// villager and building becomes the player's, game.state.won = true, game.state.wonHow is the
// larger total ('impress' on a tie), and `village-converted { village: 'rival', how }` is emitted.
// A building the village sim places as 'rival' after that is handed to the player as it is placed.
// Nothing resets afterwards: belief stays 1 and later acts no longer change it. There is no lose
// condition anywhere in this system.
//
// API: game.systems.alignment.state() -> { alignment, displayAlignment, belief, mix, won, wonHow,
// ring }, .ring() -> { x, y, r } or null, .bar() -> the belief bar's last drawn rect in view px
// ({ x, y, w, h }) or null, .tuning (this game's copy of the numbers).
// update(dt) touches only game state; draw(ctx) writes the LUT and paints the ring and belief bar.
// Ring per map: ring() reads the loaded map's sites on every call and the drawn ring is rebuilt
// whenever the map or its center or radius changes; a map without sites.rival has no ring, no bar
// and no influence. The belief bar sits above the rival temple's sprite top (else above the ring
// center) and is lifted further over any building sprite it would overlap, so it clears roofs.
import { TUNING } from '../alignment/tuning.js';
import { clamp, readNumber, actWeight, addAct, bankSum, drift, stepToward, insideRing, decayBelief } from '../alignment/model.js';
import { buildRing, drawRing, drawBeliefBar, BAR_SIZE } from '../alignment/ring.js';
import { makeLut, alignmentStep } from '../art/lut.js';

const LUT_STEPS = 8; // lut.js quantizes alignment to steps of 1/8

/**
 * Creates the alignment system.
 *
 * LUT ownership (spec "Sprite contracts"): every draw writes game.renderer.lut from the displayed
 * alignment only while the renderer's LUT is its initial one (as found at create) or the one this
 * system set last; an LUT object assigned by anyone else is left alone until the initial LUT is
 * put back.
 */
export function create(game) {
  game.state ??= {};
  const st = game.state;
  const tuning = { ...TUNING };
  const { world, events } = game;

  if (!Number.isFinite(st.alignment)) st.alignment = 0;
  if (!Number.isFinite(st.belief)) st.belief = 0;
  if (!st.beliefMix || typeof st.beliefMix !== 'object') st.beliefMix = { impress: 0, scare: 0 };
  if (typeof st.won !== 'boolean') st.won = false;
  st.wonHow ??= null;

  let display = alignmentStep(st.alignment); // displayed LUT step, -8..8
  let lutTimer = tuning.lutStepTime; // sim time since the last displayed step (capped)
  let idle = 0; // sim time since an act last added belief
  let converted = false;
  let sweepT = 0;
  let ringCache = null; // { key, height, samples }
  let barRect = null; // last drawn belief bar, view px
  const initialLut = game.renderer?.lut ?? null; // renderer LUT at create (terrain's neutral LUT)
  let ownLut = null; // the LUT this system set last

  const alignment = () => readNumber(st.alignment, -1, 1);
  let bank = alignment(); // running sum in alignment units; st.alignment = clamp(bank, -1, 1)
  /** Takes up a value written to game.state.alignment from outside as the new running total. */
  const syncBank = () => { if (alignment() !== clamp(bank, -1, 1)) bank = alignment(); };
  const setBank = (v) => { bank = v; st.alignment = clamp(v, -1, 1); };
  const belief = () => readNumber(st.belief, 0, 1);
  const mix = () => {
    if (!st.beliefMix || typeof st.beliefMix !== 'object') st.beliefMix = { impress: 0, scare: 0 };
    const m = st.beliefMix;
    if (!Number.isFinite(m.impress) || m.impress < 0) m.impress = 0;
    if (!Number.isFinite(m.scare) || m.scare < 0) m.scare = 0;
    return m;
  };

  /** The influence ring, from the current map's sites.rival; null when the map has none. */
  function ring() {
    const s = world.sites?.rival;
    if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.y)) return null;
    const x = s.x + 0.5, y = s.y + 0.5;
    const edge = Math.min(x, y, world.w - x, world.h - y); // keeps the ring on the map
    const r = Number.isFinite(tuning.ringRadius) && tuning.ringRadius > 0 ? Math.min(tuning.ringRadius, edge) : 0;
    return r > 0 ? { x, y, r } : null;
  }

  function claimRival() {
    let n = 0;
    for (const e of world.entities.values()) {
      if ((e.kind === 'villager' || e.kind === 'building') && e.owner === 'rival') { e.owner = 'player'; n++; }
    }
    return n;
  }

  // The village sim keeps planning rival blueprints and births on its rival record; with no rival
  // owners left it would place a rival blueprint that nobody builds. Stop both timers for good.
  // Workaround from outside the village's write scope: the village should do this itself on
  // `village-converted`. Harmless when the village system or its record is absent; the
  // `building-placed` listener below hands over any rival placement this does not stop.
  function quietRival() {
    const vill = game.systems?.village?.sim?.village?.('rival');
    if (vill && typeof vill === 'object') { vill.planT = -Infinity; vill.birthT = -Infinity; }
  }

  function convert() {
    if (converted) return;
    converted = true;
    const m = mix();
    st.belief = 1;
    st.won = true;
    st.wonHow = m.scare > m.impress ? 'scare' : 'impress';
    claimRival();
    quietRival();
    events.emit('village-converted', { village: 'rival', how: st.wonHow });
  }

  function influence(p, weight) {
    if (converted) return;
    if (!insideRing(ring(), p.x, p.y)) return;
    const add = Math.abs(weight) * tuning.beliefGain;
    if (!(add > 0) || !Number.isFinite(add)) return;
    const m = mix();
    if (weight > 0) m.impress += add; else m.scare += add;
    st.belief = Math.min(1, belief() + add);
    idle = 0;
    if (st.belief >= 1) convert();
  }

  events.on('act', (p) => {
    if (!p || typeof p !== 'object') return;
    const weight = actWeight(p);
    if (weight === null) return;
    if (p.actor === 'player') { syncBank(); setBank(addAct(bank, weight, tuning.scale, tuning.headroom)); }
    if (p.actor === 'player' || p.actor === 'creature') influence(p, weight);
  });

  // After the conversion a building placed as 'rival' (a village sim without the record above, or a
  // direct placeBlueprint call) belongs to the player from the moment it is placed.
  events.on('building-placed', (p) => {
    if (!converted || !p || typeof p !== 'object') return;
    const b = world.get(p.buildingId);
    if (b && b.owner === 'rival') b.owner = 'player';
  });

  function state() {
    const m = mix();
    return {
      alignment: alignment(),
      displayAlignment: display / LUT_STEPS,
      belief: belief(),
      mix: { impress: m.impress, scare: m.scare },
      won: st.won === true,
      wonHow: st.wonHow ?? null,
      ring: ring(),
    };
  }

  return {
    tuning,
    state,
    ring,
    bar: () => (barRect ? { ...barRect } : null),
    get converted() { return converted; },

    update(dt) {
      if (!(dt > 0) || !Number.isFinite(dt)) return;
      syncBank();
      setBank(bankSum(drift(bank, dt, tuning.driftHalfLife), tuning.headroom));
      lutTimer = Math.min(lutTimer + dt, tuning.lutStepTime);

      if (converted) {
        st.belief = 1;
        sweepT += dt;
        if (sweepT >= tuning.sweepInterval) { sweepT = 0; claimRival(); }
        return;
      }
      const b = belief(), m = mix(); // mix() also repairs a corrupt beliefMix
      if (b >= 1 && ring()) { convert(); return; } // belief written to state directly
      const next = decayBelief(b, dt, idle, tuning);
      if (next !== b) {
        const k = b > 0 ? next / b : 0;
        m.impress *= k;
        m.scare *= k;
      }
      st.belief = next;
      idle += dt;
    },

    draw(ctx) {
      // 1. LUT: one step toward the target at most, rate-limited in sim time.
      const target = alignmentStep(alignment());
      if (display !== target && lutTimer >= tuning.lutStepTime - 1e-9) {
        display = stepToward(display, target);
        lutTimer = 0;
      }
      // Written only while this system owns the LUT (see the header): a LUT someone else assigned stays.
      const cur = game.renderer.lut;
      if (cur === initialLut || cur === ownLut) {
        ownLut = makeLut(display / LUT_STEPS);
        game.renderer.lut = ownLut;
        ctx.lut = ownLut;
      }

      // 2. Ring on the ground (after terrain, before entities) and the belief bar.
      barRect = null;
      const r = ring();
      if (!r || !world.height?.length) return;
      const key = `${r.x},${r.y},${r.r}`;
      if (!ringCache || ringCache.key !== key || ringCache.height !== world.height) {
        ringCache = { key, height: world.height, samples: buildRing(world, r) };
      }
      const b = converted ? 1 : belief();
      drawRing(ctx, ringCache.samples, b, converted);
      const temple = rivalTemple(r);
      ctx.overlay((c) => {
        const p = c.toView(temple.x, temple.y, temple.z);
        const top = clearOfBuildings(c, p.vx, p.vy - temple.top - BAR_SIZE.h - 2, temple);
        barRect = drawBeliefBar(c, p.vx, top, b, mix(), converted);
      });
    },
  };

  /** Where the belief bar sits: the temple nearest the rival temple site (any owner, so it stays
   * after the conversion), else the ring center (a map with no temple standing there). */
  function rivalTemple(r) {
    const site = world.sites?.rivalTemple;
    const sx = Number.isFinite(site?.x) ? site.x + 0.5 : r.x, sy = Number.isFinite(site?.y) ? site.y + 0.5 : r.y;
    let best = null, bd = 16; // within 4 tiles
    for (const e of world.query({ kind: 'building', x: sx, y: sy, r: 4 })) {
      if (e.type !== 'temple') continue;
      const d = (e.x - sx) ** 2 + (e.y - sy) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    if (best) return { x: best.x, y: best.y, z: Number.isFinite(best.z) ? best.z : world.heightAt(best.x, best.y), top: best.sprite ? best.sprite.ay : 24 };
    return { x: r.x, y: r.y, z: world.heightAt(r.x, r.y), top: 8 };
  }

  /** Lifts the bar's top (view px) above every building sprite near the temple that its rect would
   * overlap, so the bar never sits on a roof. Sprite rects cover both facings (flipX mirrors about
   * the anchor column). */
  function clearOfBuildings(c, cx, top, at) {
    const x0 = Math.round(cx - (BAR_SIZE.w >> 1)), x1 = x0 + BAR_SIZE.w;
    const rects = [];
    for (const e of world.query({ kind: 'building', x: at.x, y: at.y, r: 6 })) {
      const s = e.sprite;
      if (!s || !Number.isFinite(s.w)) continue;
      const p = c.toView(e.x, e.y, Number.isFinite(e.z) ? e.z : world.heightAt(e.x, e.y));
      const half = Math.max(s.ax, s.w - 1 - s.ax);
      if (p.vx + half + 1 <= x0 || p.vx - half >= x1) continue;
      rects.push({ y0: p.vy - s.ay, y1: p.vy - s.ay + s.h });
    }
    let y = Math.round(top);
    for (let moved = true, n = 0; moved && n < 16; n++) {
      moved = false;
      for (const rc of rects) {
        if (y < rc.y1 && y + BAR_SIZE.h > rc.y0) { y = rc.y0 - BAR_SIZE.h - 2; moved = true; }
      }
    }
    return y;
  }
}

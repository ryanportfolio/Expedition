// Alignment check: node only, no browser. Checks the player alignment (running sum of player act
// weights times the scale, clamped; creature acts ignored; drift toward 0 and its rate), the LUT
// transition (one step per frame at most, rate-limited in sim time), the rival influence ring
// (acts outside leave belief alone, good and evil acts inside both add, impress/scare totals, slow
// decay), the conversion (fires exactly once, flips every rival villager and building, sets won and
// wonHow, nothing resets, the village keeps running), that update() touches no DOM and never calls
// Math.random, robustness against bad payloads and maps without a rival, LUT ownership (a LUT
// assigned from outside survives draws; the alignment's own LUT keeps updating), the ring and belief
// bar per map (recomputed on map change, kept on the map, acts judged against the recomputed ring,
// none without sites.rival or with it off the map), the bar clearing roofs (real building sprites,
// counted in opaque pixels as blit draws them, mirrored ones too), and determinism.
// Exits 1 and prints each failing check.
//
//   node scripts/check-alignment.mjs
import fs from 'node:fs';
import { createGame } from '../src/game.js';
import { buildIsland } from '../src/world/island.js';
import { makeLut, alignmentStep } from '../src/art/lut.js';
import { idx } from '../src/art/palette.js';
import { pickTile, worldToScreen } from '../src/world/iso.js';
import { TUNING } from '../src/alignment/tuning.js';
import { addAct, bankSum } from '../src/alignment/model.js';
import { buildRing, tileSurface, BAR_SIZE } from '../src/alignment/ring.js';
import { registerPainters } from '../src/art/registry.js';

// Node has no import.meta.glob, so the registry starts empty and every sprite is the 8x8
// placeholder. Register the real painter modules so the roof checks measure real building sprites.
{
  const dir = new URL('../src/art/painters/', import.meta.url);
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js')).sort()) registerPainters(await import(new URL(f, dir)));
}

const fails = [];
let passes = 0;
function check(cond, msg) {
  if (cond) passes++;
  else { fails.push(msg); console.log(`FAIL ${msg}`); }
  return !!cond;
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const DT = 1 / 30;

function newGame(seed = 1, { map = true } = {}) {
  const game = createGame({ seed });
  game.display.setDevice(1920, 1080, 1);
  if (map) {
    game.world.loadMap(buildIsland());
    game.systems.village.setup();
  }
  return game;
}
const run = (game, seconds) => { const n = Math.round(seconds / DT); for (let i = 0; i < n; i++) { game.clock.ticks++; game.tick(DT); } };
const act = (game, actor, weight, x = -100, y = -100, verb = 'test') => game.events.emit('act', { actor, verb, target: 'none', weight, x, y });
const rivalOwned = (game) => game.world.query({}).filter((e) => (e.kind === 'villager' || e.kind === 'building') && e.owner === 'rival');

// ---------------------------------------------------------------- 1. running sum and clamp
{
  const game = newGame(1, { map: false });
  const st = game.state, al = game.systems.alignment, k = al.tuning.scale;
  check(st.alignment === 0 && st.belief === 0 && st.won === false && st.beliefMix.impress === 0, 'fresh state: alignment 0, belief 0, mix 0, not won');
  for (let i = 0; i < 5; i++) act(game, 'player', 0.3);
  check(near(st.alignment, 1.5 * k), `five +0.3 player acts give 1.5 x scale = ${(1.5 * k).toFixed(3)} (got ${st.alignment})`);
  check(st.alignment > 0, '+0.3 x 5 raises alignment above 0');
  act(game, 'player', -0.6);
  check(near(st.alignment, 0.9 * k), `then -0.6 lowers it to 0.9 x scale (got ${st.alignment})`);
  for (let i = 0; i < 100; i++) act(game, 'player', 1);
  check(st.alignment === 1, `100 full good acts clamp at 1 (got ${st.alignment})`);
  act(game, 'player', -0.5);
  check(near(st.alignment, 1 - 0.5 * k), 'an evil act after saturation lowers alignment at once (sum saturates at the clamp)');
  for (let i = 0; i < 100; i++) act(game, 'player', -1);
  check(st.alignment === -1, `100 full evil acts clamp at -1 (got ${st.alignment})`);
  const g2 = newGame(1, { map: false });
  act(g2, 'player', 5);
  check(near(g2.state.alignment, k), 'a weight above 1 counts as 1');
  for (const bad of [NaN, Infinity, '0.5', null, undefined]) act(g2, 'player', bad);
  g2.events.emit('act', null);
  g2.events.emit('act', undefined);
  g2.events.emit('act', { actor: 'player' });
  check(near(g2.state.alignment, k), 'NaN, Infinity, string, missing weights and null payloads change nothing');
  act(g2, 'villager', 1);
  act(g2, undefined, 1);
  check(near(g2.state.alignment, k), 'acts from other actors do not move player alignment');
  let lo = Infinity, hi = -Infinity;
  const g3 = newGame(2, { map: false });
  for (let i = 0; i < 400; i++) { act(g3, 'player', g3.rng.range(-1, 1) * 3); lo = Math.min(lo, g3.state.alignment); hi = Math.max(hi, g3.state.alignment); }
  check(lo >= -1 && hi <= 1, `alignment stays in [-1, 1] under 400 random acts (${lo.toFixed(3)}..${hi.toFixed(3)})`);
}

// ---------------------------------------------------------------- 1b. headroom on the running sum
{
  check(TUNING.headroom === 0, `default headroom is 0: the sum saturates at the clamp (${TUNING.headroom})`);
  check(addAct(0.9, 1, 0.15) === 1 && near(addAct(0.9, 1, 0.15, Infinity), 1.05) && near(addAct(0.9, 1, 0.15, 0.1), 1.0 + 0.05) && addAct(0.9, 1, 1, 0.1) === 1.1, 'model: addAct holds the sum within 1 + headroom');
  check(bankSum(5, -1) === 1 && bankSum(5, NaN) === 1 && bankSum(-5, Infinity) === -5, 'model: negative or NaN headroom counts as 0');

  // Infinity: a plain unbounded running sum.
  const g = newGame(11, { map: false });
  const st = g.state, al = g.systems.alignment, k = al.tuning.scale;
  al.tuning.headroom = Infinity;
  for (let i = 0; i < 20; i++) act(g, 'player', 1); // sum 3.0
  check(st.alignment === 1, `unbounded: 20 full good acts show as 1 (${st.alignment})`);
  for (let i = 0; i < 10; i++) act(g, 'player', -1); // sum 1.5
  check(st.alignment === 1, `unbounded: 10 evil acts only pay off the banked surplus, alignment still 1 (${st.alignment})`);
  for (let i = 0; i < 10; i++) act(g, 'player', -1); // sum 0
  check(Math.abs(st.alignment) < 1e-9, `unbounded: 10 more evil acts bring it to 0 (${st.alignment})`);
  for (let i = 0; i < 1000; i++) act(g, 'player', 1); // sum 150
  for (let i = 0; i < 990; i++) act(g, 'player', -1); // sum 1.5
  check(st.alignment === 1, `unbounded: 1000 good acts need more than 990 evil ones to show (${st.alignment})`);
  for (let i = 0; i < 20; i++) act(g, 'player', -1); // sum -1.5
  check(st.alignment === -1, `unbounded: then 20 more evil acts reach -1 (${st.alignment})`);
  st.alignment = 0.2; // a debug panel writes the value: the banked surplus is dropped
  act(g, 'player', 1);
  check(near(st.alignment, 0.2 + k), `unbounded: a value written to game.state.alignment becomes the running total (${st.alignment})`);

  // Saturating (0) against a finite headroom on the same act sequence.
  const run2 = (h) => {
    const gg = newGame(12, { map: false });
    gg.systems.alignment.tuning.headroom = h;
    for (let i = 0; i < 100; i++) act(gg, 'player', 1);
    const out = [];
    for (let i = 0; i < 4; i++) { act(gg, 'player', -1); out.push(gg.state.alignment); }
    return out;
  };
  const sat = run2(0), cap = run2(0.5); // with 0.5: sum 1.5 -> 1.35 -> 1.2 -> 1.05 -> 0.9
  check(near(sat[0], 1 - k) && near(sat[3], 1 - 4 * k), `headroom 0: the first evil act after saturation shows at once (${sat.map((v) => v.toFixed(3)).join(', ')})`);
  check(cap[0] === 1 && cap[1] === 1 && cap[2] === 1 && near(cap[3], 0.9), `headroom 0.5: three evil acts pay off the capped surplus, the fourth shows (${cap.map((v) => v.toFixed(3)).join(', ')})`);

  // Drift shrinks the banked sum too.
  const g3 = newGame(13, { map: false });
  g3.systems.alignment.tuning.headroom = Infinity;
  const H = g3.systems.alignment.tuning.driftHalfLife;
  for (let i = 0; i < 20; i++) act(g3, 'player', 1); // sum 3.0
  run(g3, H); // sum 1.5
  check(g3.state.alignment === 1, `unbounded: one half-life of drift leaves a banked 1.5, alignment still 1 (${g3.state.alignment})`);
  run(g3, H); // sum 0.75
  check(near(g3.state.alignment, 0.75, 1e-4), `unbounded: a second half-life brings it to 0.75 (${g3.state.alignment.toFixed(5)})`);
}

// ---------------------------------------------------------------- 2. creature acts
{
  const game = newGame(3);
  const st = game.state, ring = game.systems.alignment.ring();
  act(game, 'player', 0.4);
  const a = st.alignment;
  for (let i = 0; i < 20; i++) act(game, 'creature', i % 2 ? 1 : -1);
  act(game, 'creature', -1, ring.x, ring.y);
  check(st.alignment === a, `creature acts (outside and inside the ring) leave player alignment at ${a} (got ${st.alignment})`);
  check(near(st.belief, game.systems.alignment.tuning.beliefGain), 'a creature act inside the ring does add belief');
}

// ---------------------------------------------------------------- 3. drift
{
  const game = newGame(4, { map: false });
  const st = game.state, H = game.systems.alignment.tuning.driftHalfLife;
  for (let i = 0; i < 4; i++) act(game, 'player', 1); // 0.6 at scale 0.15
  const a0 = st.alignment;
  run(game, 120);
  const expect = a0 * Math.pow(0.5, 120 / H);
  check(near(st.alignment, expect, 1e-6), `2 sim minutes of drift: ${a0.toFixed(3)} -> ${st.alignment.toFixed(4)} (expected ${expect.toFixed(4)}, half-life ${H} s)`);
  check(st.alignment > 0 && st.alignment < a0, 'drift moves alignment toward 0 without crossing it');
  check(st.alignment > a0 * 0.6, `drift is slow: over 2 minutes it keeps ${((st.alignment / a0) * 100).toFixed(0)}% (> 60%)`);
  run(game, 30 * 60);
  check(st.alignment >= 0 && st.alignment < 0.01, `30 minutes later alignment is near 0 (${st.alignment.toFixed(5)})`);
  const g2 = newGame(4, { map: false });
  for (let i = 0; i < 4; i++) act(g2, 'player', -1);
  const b0 = g2.state.alignment;
  run(g2, 60);
  check(g2.state.alignment < 0 && g2.state.alignment > b0 && near(g2.state.alignment, b0 * Math.pow(0.5, 60 / H), 1e-6), 'negative alignment drifts up toward 0 at the same rate');
  g2.state.alignment = 0.4; // a debug panel or scenario writes the value
  run(g2, 1);
  check(near(g2.state.alignment, 0.4 * Math.pow(0.5, 1 / H), 1e-6), 'a value written to game.state.alignment is taken up as the running total');
  const g3 = newGame(4, { map: false });
  g3.systems.alignment.tuning.driftHalfLife = 60;
  for (let i = 0; i < 4; i++) act(g3, 'player', 1);
  run(g3, 60);
  check(near(g3.state.alignment, 0.3, 1e-6), 'the drift half-life is tunable per game');
}

// ---------------------------------------------------------------- 4. LUT transition
{
  const game = newGame(5, { map: false });
  const st = game.state, al = game.systems.alignment, T = al.tuning.lutStepTime;
  game.renderer.render();
  check(game.renderer.lut === makeLut(0), 'after the first draw the renderer LUT is the cached alignment-0 LUT');
  for (let i = 0; i < 100; i++) act(game, 'player', -1);
  let n = 0;
  while (al.state().displayAlignment !== -1 && n < 1000) { game.clock.ticks++; game.tick(DT); game.renderer.render(); n++; }
  check(al.state().displayAlignment === -1 && game.renderer.lut === makeLut(-1), `displayed alignment reaches -1 (${n} frames)`);
  for (let i = 0; i < 200; i++) act(game, 'player', 1);
  let frames = 0, maxJump = 0, last = -1, lastChange = game.clock.time, minGap = Infinity, lutOk = true;
  while (al.state().displayAlignment !== 1 && frames < 2000) {
    game.clock.ticks++; game.tick(DT);
    const ctx = game.renderer.render();
    const d = al.state().displayAlignment;
    if (d !== last) { minGap = Math.min(minGap, game.clock.time - lastChange); lastChange = game.clock.time; }
    maxJump = Math.max(maxJump, Math.abs(d - last));
    if (game.renderer.lut !== makeLut(d) || ctx.lut !== game.renderer.lut) lutOk = false;
    last = d;
    frames++;
  }
  check(al.state().displayAlignment === 1, `-1 to +1 swing completes (${frames} frames)`);
  check(maxJump <= 0.125 + 1e-12, `no frame moves the displayed alignment more than one LUT step (max ${maxJump})`);
  check(frames >= 16 && frames * DT >= 15 * T - 1e-9, `-1 to +1 takes ${frames} frames, ${(frames * DT).toFixed(2)} s (>= 16 steps, ~${16 * T} s)`);
  check(minGap >= T - 1e-9, `steps are at least ${T} s apart in sim time (min ${minGap.toFixed(3)} s)`);
  check(lutOk, 'every frame: renderer.lut and the frame ctx.lut are makeLut(displayed alignment)');
  // Many ticks between two frames still move only one step; renders without sim time move nothing.
  for (let i = 0; i < 200; i++) act(game, 'player', -1);
  run(game, 5);
  game.renderer.render();
  check(al.state().displayAlignment === 0.875, `after 5 s of ticks with no frame, one frame moves one step (${al.state().displayAlignment})`);
  for (let i = 0; i < 10; i++) game.renderer.render();
  check(al.state().displayAlignment === 0.875, 'renders with no sim time in between do not step the LUT');
  check(Math.abs(st.alignment - al.state().displayAlignment) > 1, 'target and displayed alignment can differ while the LUT catches up');
  // Real-time loop: frames at 60 Hz with a tick every other frame.
  const g2 = newGame(5, { map: false });
  g2.renderer.render();
  for (let i = 0; i < 100; i++) act(g2, 'player', 1);
  let f = 0;
  while (g2.systems.alignment.state().displayAlignment !== 1 && f < 2000) { g2.frame(1 / 60); f++; }
  check(f >= 7 * T * 60, `real-time 60 Hz loop: 0 -> +1 (8 steps) spreads over ${f} frames (${(f / 60).toFixed(2)} s)`);
}

// ---------------------------------------------------------------- 4b. LUT ownership
{
  const game = newGame(6, { map: false });
  const { renderer } = game;
  const st = game.state, al = game.systems.alignment, T = al.tuning.lutStepTime;
  const frame = () => { game.clock.ticks++; game.tick(DT); return renderer.render(); };
  renderer.render();
  check(renderer.lut === makeLut(0), 'LUT ownership: the alignment takes the initial LUT over');
  const foreign = Uint32Array.from(makeLut(-1)); // a LUT object the alignment never set
  renderer.lut = foreign;
  let ctx = null;
  for (let i = 0; i < 5; i++) ctx = frame();
  check(renderer.lut === foreign && ctx.lut === foreign, 'an externally assigned LUT survives draws (renderer.lut and the frame ctx.lut)');
  renderer.lut = makeLut(1); // a cached LUT the alignment is not showing (it shows step 0)
  frame();
  check(renderer.lut === makeLut(1), 'an externally assigned cached LUT for another step also survives a draw');
  for (let i = 0; i < 100; i++) act(game, 'player', 1);
  for (let i = 0; i < Math.ceil((4 * T) / DT); i++) frame();
  check(renderer.lut === makeLut(1) && al.state().displayAlignment > 0, `the displayed alignment keeps walking while the LUT is not its own (${al.state().displayAlignment})`);
  renderer.lut = makeLut(0); // the initial LUT: ownership returns
  ctx = frame();
  const d1 = al.state().displayAlignment;
  check(renderer.lut === makeLut(d1) && ctx.lut === renderer.lut && d1 > 0, `putting the initial LUT back hands the LUT to the alignment again (step ${d1})`);
  let n = 0;
  while (al.state().displayAlignment !== 1 && n < 1000) { frame(); n++; }
  check(al.state().displayAlignment === 1 && renderer.lut === makeLut(1) && st.alignment > 0.9375, `the alignment's own LUT keeps updating to +1 (${n} more frames, alignment ${st.alignment.toFixed(3)})`);
  for (let i = 0; i < 200; i++) act(game, 'player', -1);
  for (let i = 0; i < Math.ceil((2 * T) / DT); i++) frame();
  const d2 = al.state().displayAlignment;
  check(d2 < 1 && renderer.lut === makeLut(d2), `its own LUT steps back toward evil after it reached +1 (step ${d2})`);
}

// ---------------------------------------------------------------- 5. ring and belief
{
  const game = newGame(6);
  const st = game.state, al = game.systems.alignment, tun = al.tuning, ring = al.ring();
  const site = game.world.sites.rival;
  check(ring && ring.x === site.x + 0.5 && ring.y === site.y + 0.5 && ring.r === 10 && TUNING.ringRadius === 10, `ring centered on sites.rival (${ring?.x}, ${ring?.y}), default radius 10`);
  act(game, 'player', 0.8, ring.x + ring.r + 0.01, ring.y);
  act(game, 'player', -0.8, ring.x, ring.y - ring.r - 0.5);
  act(game, 'player', 1, game.world.sites.village.x, game.world.sites.village.y);
  act(game, 'player', 1); // no position
  game.events.emit('act', { actor: 'player', verb: 'x', weight: 1, x: NaN, y: ring.y });
  check(st.belief === 0 && st.beliefMix.impress === 0 && st.beliefMix.scare === 0, 'acts outside the ring (or with no position) leave belief and mix at 0');
  act(game, 'player', 0.4, ring.x + 3, ring.y - 2);
  check(near(st.belief, 0.4 * tun.beliefGain) && near(st.beliefMix.impress, 0.4 * tun.beliefGain), 'a good act inside adds |w| x gain, counted as impress');
  act(game, 'player', -0.6, ring.x - 9.9, ring.y);
  check(near(st.belief, 1.0 * tun.beliefGain) && near(st.beliefMix.scare, 0.6 * tun.beliefGain), 'an evil act inside also adds |w| x gain, counted as scare');
  act(game, 'creature', 0.5, ring.x, ring.y + 9.99);
  check(near(st.belief, 1.5 * tun.beliefGain) && near(st.beliefMix.impress, 0.9 * tun.beliefGain), 'creature acts inside count too');
  act(game, 'player', 0, ring.x, ring.y);
  check(near(st.belief, 1.5 * tun.beliefGain), 'a zero-weight act adds nothing');
  const s = al.state();
  check(near(s.belief, st.belief) && near(s.mix.impress, st.beliefMix.impress) && near(s.mix.scare, st.beliefMix.scare) && s.won === false && near(s.alignment, st.alignment), 'state() returns alignment, belief, mix and won');
  // Miracles count through their act events.
  const b0 = st.belief;
  game.systems.miracles.cast('heal', ring.x, ring.y, { free: true });
  check(near(st.belief, b0 + 0.4 * tun.beliefGain), 'a heal cast inside the ring adds belief through its act event');
  // Decay: nothing for the grace period, then linear.
  const b1 = st.belief, ratio = st.beliefMix.impress / st.beliefMix.scare;
  run(game, tun.beliefGrace - 0.5);
  check(near(st.belief, b1, 1e-12), `no decay during the ${tun.beliefGrace} s grace period`);
  run(game, 50.5);
  check(near(st.belief, b1 - tun.beliefDecay * 50, 1e-6), `then linear decay at ${tun.beliefDecay}/s (${b1.toFixed(4)} -> ${st.belief.toFixed(4)})`);
  check(near(st.beliefMix.impress / st.beliefMix.scare, ratio, 1e-9), 'decay keeps the impress:scare ratio');
  check(near(st.beliefMix.impress + st.beliefMix.scare, st.belief, 1e-9), 'decay shrinks the impress and scare totals with belief (they still add up to it)');
  check(1 / tun.beliefDecay >= 240, `decay is slow: a full meter takes ${(1 / tun.beliefDecay / 60).toFixed(1)} minutes to empty`);
  run(game, 600);
  check(st.belief === 0 && st.won === false, 'belief decays to 0 and stops there; no conversion, no lose state');
  act(game, 'player', 0.5, ring.x, ring.y);
  check(near(st.belief, 0.5 * tun.beliefGain), 'belief rises again after decaying to 0');
}

// ---------------------------------------------------------------- 6. conversion
function fillRing(game, impressFirst = true) {
  const ring = game.systems.alignment.ring();
  let n = 0;
  while (!game.state.won && n < 200) {
    const good = impressFirst ? n % 3 !== 2 : n % 3 === 2;
    act(game, 'player', good ? 0.4 : -0.6, ring.x + (n % 5) - 2, ring.y + (n % 3) - 1);
    if (n % 4 === 3) run(game, 1);
    n++;
  }
  return n;
}
/** Places a rival house blueprint near the ring center through the village API; its id or null. */
function placeRival(game) {
  const vg = game.systems.village, rc = game.systems.alignment.ring();
  for (let dy = -9; dy <= 9; dy++)
    for (let dx = -9; dx <= 9; dx++) {
      const tx = Math.floor(rc.x) + dx, ty = Math.floor(rc.y) + dy;
      if (vg.validate('house', tx, ty, 'rival').ok) return vg.placeBlueprint('house', tx, ty, 'rival');
    }
  return null;
}
{
  const g0 = newGame(10);
  const id0 = placeRival(g0);
  check(id0 !== null && g0.world.get(id0)?.owner === 'rival', `before the conversion a rival placement stays the rival's (${id0 === null ? 'no spot found' : g0.world.get(id0)?.owner})`);
}
{
  const game = newGame(7);
  const st = game.state, al = game.systems.alignment;
  const events = [];
  game.events.on('village-converted', (p) => events.push(p));
  const rivals = rivalOwned(game);
  check(rivals.length >= 10 && rivals.some((e) => e.kind === 'villager') && rivals.some((e) => e.kind === 'building'), `rival village has villagers and buildings (${rivals.length})`);
  run(game, 30);
  const before = new Set(rivalOwned(game).map((e) => e.id));
  const acts = fillRing(game, true);
  check(events.length === 1 && events[0].village === 'rival', `village-converted fired exactly once with village 'rival' after ${acts} acts`);
  check(st.won === true && al.state().won === true && st.belief === 1, 'won is true and belief is 1');
  const expectHow = st.beliefMix.scare > st.beliefMix.impress ? 'scare' : 'impress';
  check(st.wonHow === expectHow && expectHow === 'impress', `wonHow = ${st.wonHow} (impress ${st.beliefMix.impress.toFixed(3)}, scare ${st.beliefMix.scare.toFixed(3)})`);
  check(rivalOwned(game).length === 0, 'no rival-owned villager or building is left');
  const placed = placeRival(game);
  check(placed !== null && game.world.get(placed)?.owner === 'player', `a 'rival' blueprint placed after the conversion is the player's at once (${placed === null ? 'no spot found' : game.world.get(placed)?.owner})`);
  check([...before].every((id) => !game.world.get(id) || game.world.get(id).owner === 'player'), `all ${before.size} rival villagers and buildings now belong to the player`);
  const mix = { ...st.beliefMix };
  for (let i = 0; i < 30; i++) act(game, 'player', i % 2 ? 1 : -1, al.ring().x, al.ring().y);
  let threw = null;
  try { run(game, 120); } catch (e) { threw = e; }
  check(!threw, `village and every system keep running for 2 minutes after the conversion${threw ? `: ${threw.stack}` : ''}`);
  check(events.length === 1, `still one conversion after 30 more acts and 2 minutes (${events.length})`);
  check(st.won === true && st.belief === 1 && st.wonHow === 'impress' && st.beliefMix.impress === mix.impress && st.beliefMix.scare === mix.scare, 'nothing resets: won, belief 1, wonHow and mix unchanged');
  check(rivalOwned(game).length === 0, `no rival owners appear after the conversion (${rivalOwned(game).length})`);
  check(!Object.keys(st).some((k) => /lost|lose|defeat|gameover/i.test(k)), `no lose state in game.state (${Object.keys(st).join(', ')})`);

  const g2 = newGame(7);
  fillRing(g2, false);
  check(g2.state.won && g2.state.wonHow === 'scare', `mostly evil acts win by scaring (${g2.state.wonHow})`);

  // Belief written straight to the state converts on the next tick, once.
  const g3 = newGame(8);
  const ev3 = [];
  g3.events.on('village-converted', (p) => ev3.push(p));
  g3.state.belief = 1;
  run(g3, 1);
  check(ev3.length === 1 && g3.state.won && rivalOwned(g3).length === 0 && g3.state.wonHow === 'impress', 'belief set to 1 directly converts once on the next tick (tie -> impress)');

  // Event order: listeners see won and the flipped owners when the event arrives.
  const g4 = newGame(9);
  let seen = null;
  g4.events.on('village-converted', () => { seen = { won: g4.state.won, rivals: rivalOwned(g4).length }; });
  fillRing(g4, true);
  check(seen && seen.won === true && seen.rivals === 0, 'village-converted listeners already see won = true and no rival owners');
}

// ---------------------------------------------------------------- 7. no DOM, no Math.random in update
{
  const game = newGame(10);
  const al = game.systems.alignment;
  const touched = [];
  const names = ['window', 'document', 'requestAnimationFrame', 'navigator', 'localStorage'];
  const saved = names.map((n) => [n, Object.getOwnPropertyDescriptor(globalThis, n)]);
  for (const n of names) Object.defineProperty(globalThis, n, { configurable: true, get() { touched.push(n); return undefined; } });
  const realRandom = Math.random;
  let randoms = 0;
  Math.random = () => { randoms++; return realRandom(); };
  try {
    const ring = al.ring();
    for (let i = 0; i < 300; i++) {
      if (i % 10 === 0) act(game, i % 20 ? 'player' : 'creature', i % 3 ? 0.5 : -0.5, ring.x + (i % 7) - 3, ring.y);
      al.update(DT);
    }
    for (let i = 0; i < 400 && !game.state.won; i++) { act(game, 'player', 1, ring.x, ring.y); al.update(DT); }
    al.update(0); al.update(-1); al.update(NaN);
  } finally {
    Math.random = realRandom;
    for (const [n, d] of saved) { if (d) Object.defineProperty(globalThis, n, d); else delete globalThis[n]; }
  }
  check(touched.length === 0, `alignment update and act handling touch no DOM globals (${[...new Set(touched)].join(', ') || 'none'})`);
  check(randoms === 0, `alignment update never calls Math.random (${randoms} calls)`);
  check(game.state.won === true, 'conversion also happens with update-only ticks');
  const files = ['src/systems/alignment.js', 'src/alignment/tuning.js', 'src/alignment/model.js', 'src/alignment/ring.js', 'src/dev/scenarios/alignment.js'];
  const code = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const f of files) check(!/Math\.random/.test(code(f)), `${f} has no Math.random`);
  for (const f of files.slice(0, 3)) check(!/\b(window|document|requestAnimationFrame|canvas)\b/.test(code(f)), `${f} names no DOM globals`);
}

// ---------------------------------------------------------------- 8. maps without a rival, bad input
{
  // createGame() loads the island (terrain system), so load an explicit small map without sites.
  const game = newGame(11, { map: false });
  const al = game.systems.alignment;
  const n8 = 12 * 12;
  game.world.loadMap({ w: 12, h: 12, seaLevel: 0, height: new Uint8Array(n8).fill(2), ground: new Uint8Array(n8).fill(3) });
  check(Object.keys(game.world.sites).length === 0, 'the small test map has no sites');
  check(al.ring() === null && al.state().ring === null, 'no sites.rival -> no ring');
  act(game, 'player', 1, 10, 10);
  check(game.state.belief === 0, 'acts change no belief without a ring');
  let threw = null;
  try { game.renderer.render(); run(game, 2); game.renderer.render(); } catch (e) { threw = e; }
  check(!threw, `render and update run with no map and no ring${threw ? `: ${threw.message}` : ''}`);
  check(al.bar() === null, 'no belief bar is drawn on a map without sites.rival');
  game.state.beliefMix = 'garbage';
  game.state.belief = NaN;
  game.state.alignment = 'x';
  try { run(game, 1); game.renderer.render(); act(game, 'player', 1); } catch (e) { threw = e; }
  if (threw) console.log(threw);
  check(!threw && Number.isFinite(game.state.alignment) && game.state.belief === 0 && typeof game.state.beliefMix === 'object', 'corrupt state values are repaired, not thrown on');
  // Loading another map moves the ring with sites.rival.
  const g2 = newGame(11);
  g2.renderer.render();
  g2.world.loadMap({ ...buildIsland(), sites: { ...buildIsland().sites, rival: { x: 30, y: 30, r: 5 } } });
  check(g2.systems.alignment.ring().x === 30.5, 'the ring follows sites.rival after a new map loads');
  try { g2.renderer.render(); } catch (e) { threw = e; }
  check(!threw, 'render after a map change rebuilds the ring');
}
{
  // Ring per map: recomputed on every map change, kept on the map, gone without sites.rival.
  const game = newGame(15);
  const { world, renderer, camera } = game;
  const al = game.systems.alignment;
  const accent = () => new Set([3, 4, 5, 6, 7].map((s) => renderer.lut[idx('creature-accent', s)]));
  const ringPx = () => { const c = accent(); let n = 0; for (const p of renderer.view.data) if (c.has(p)) n++; return n; };
  const r0 = al.ring();
  camera.centerOn(r0.x, r0.y, world.heightAt(r0.x, r0.y));
  renderer.render();
  check(r0.r === al.tuning.ringRadius && ringPx() > 50 && al.bar() !== null, `island: ring r=${r0.r} and the belief bar are drawn`);
  // A small map with the rival site near its edge: the ring moves there and shrinks to fit.
  const W = 18, n = W * W;
  const height = new Uint8Array(n).fill(2), ground = new Uint8Array(n).fill(3);
  world.loadMap({ w: W, h: W, seaLevel: 1, height, ground, sites: { rival: { x: 14, y: 4, r: 3 }, rivalTemple: { x: 14, y: 3 } } });
  const r1 = al.ring();
  check(r1 && r1.x === 14.5 && r1.y === 4.5 && near(r1.r, 3.5), `new map: ring recomputed at its sites.rival, radius fits the map (${JSON.stringify(r1)})`);
  const samples = buildRing(world, r1);
  const smallSurf = tileSurface(world);
  let outside = 0;
  for (let i = 0; i < samples.n; i++) {
    const hit = pickTile(samples.px[i], samples.py[i], smallSurf, { w: W, h: W });
    if (samples.vis[i] && !hit) outside++;
  }
  check(samples.n > 50 && outside === 0, `every visible ring point of the small map lies on the map (${samples.n} samples, ${outside} off)`);
  camera.centerOn(r1.x, r1.y, 2);
  renderer.render();
  check(ringPx() > 20 && al.bar() !== null, 'new map: the ring and bar are drawn at the new site');
  // Acts are judged against the recomputed ring: just outside the small radius (still well inside
  // the island-size radius) adds nothing, inside adds belief.
  const b0 = game.state.belief;
  act(game, 'player', 0.5, 14.5, 4.5 + 3.75); // expected radius 3.5 (distance to the top edge)
  check(game.state.belief === b0, 'an act just outside the recomputed ring (3.75 tiles out, r=3.5) adds no belief');
  act(game, 'player', 0.5, 14.5, 4.5 + 3.25);
  check(game.state.belief > b0, 'an act just inside the recomputed ring adds belief');
  // sites.rival off the map: no ring, no bar.
  world.loadMap({ w: W, h: W, seaLevel: 1, height, ground, sites: { rival: { x: 40, y: 40, r: 3 } } });
  renderer.render();
  check(al.ring() === null && al.bar() === null && ringPx() === 0, `sites.rival off the map: no ring and no bar drawn (${ringPx()} ring px)`);
  // A map without sites: no ring, no bar, no ring pixels.
  world.loadMap({ w: W, h: W, seaLevel: 1, height, ground });
  renderer.render();
  check(al.ring() === null && al.bar() === null && ringPx() === 0, `map without sites.rival: no ring and no bar drawn (${ringPx()} ring px)`);
  // Back to the island: the ring returns at the island's site and radius.
  world.loadMap(buildIsland());
  const r2 = al.ring();
  camera.centerOn(r2.x, r2.y, world.heightAt(r2.x, r2.y));
  renderer.render();
  check(r2.x === r0.x && r2.y === r0.y && r2.r === r0.r && ringPx() > 50, 'reloading the island brings its ring back');
  // Water samples sit on the sea surface, not the sea bed.
  const surf = tileSurface(world);
  let wet = null;
  for (let y = 0; y < world.h && !wet; y++) for (let x = 0; x < world.w; x++) { const i = y * world.w + x; if (world.ground[i] <= 1 && world.height[i] < world.seaLevel) { wet = { x, y }; break; } }
  check(wet && surf(wet.x + 0.5, wet.y + 0.5) === world.seaLevel, 'ring points over water sit at sea level');
}
{
  // The belief bar clears every building sprite near the rival temple, before and after conversion.
  const game = newGame(16);
  const { world, renderer, camera } = game;
  const al = game.systems.alignment, ring = al.ring();
  camera.centerOn(ring.x, ring.y, world.heightAt(ring.x, ring.y));
  const overlaps = () => {
    const b = al.bar();
    if (!b) return ['no bar'];
    const out = [];
    for (const e of world.query({ kind: 'building' })) {
      const s = e.sprite;
      if (!s) continue;
      const p = toViewPx(game, e);
      const half = Math.max(s.ax, s.w - 1 - s.ax);
      if (p.vx + half + 1 > b.x && p.vx - half < b.x + b.w && p.vy - s.ay < b.y + b.h && p.vy - s.ay + s.h > b.y) out.push(`${e.type}#${e.id}`);
    }
    return out;
  };
  renderer.render();
  const before = overlaps();
  for (let i = 0; i < 400 && !game.state.won; i++) act(game, 'player', 1, ring.x, ring.y);
  run(game, 3);
  renderer.render();
  const after = overlaps();
  check(before.length === 0, `belief bar overlaps no building sprite (${before.join(', ') || 'none'})`);
  check(game.state.won && after.length === 0, `after the conversion the bar still clears every roof (${after.join(', ') || 'none'})`);
}
{
  // Real sprites, counted in pixels: plant a house roof over the spot where the bar sat before it
  // learned to clear roofs (just above the temple sprite top), prove the roof covers that spot, then
  // count opaque building pixels under the drawn bar, unmirrored and mirrored (flipX).
  const game = newGame(7);
  const { world, renderer, camera } = game;
  const al = game.systems.alignment, ring = al.ring();
  const site = world.sites.rivalTemple;
  camera.centerOn(site.x, site.y, world.heightAt(site.x, site.y));
  for (let i = 0; i < 400 && !game.state.won; i++) act(game, 'player', 1, ring.x, ring.y);
  run(game, 3);
  renderer.render(); // the village system sets building sprites while drawing
  const T = world.query({ kind: 'building', x: site.x + 0.5, y: site.y + 0.5, r: 4 }).find((e) => e.type === 'temple');
  const H = world.query({ kind: 'building' }).find((e) => e.type === 'house' && e.sprite);
  /** Opaque building-sprite pixels inside rect { x, y, w, h } (view px), placed as the draw list blits them. */
  const coveredIn = (rect) => {
    let n = 0;
    for (const e of world.query({ kind: 'building' })) {
      const s = e.sprite;
      if (!s?.data) continue;
      const p = worldToScreen(e.x, e.y, e.z ?? 0);
      const vx = Math.round(p.sx - Math.round(camera.x)), vy = Math.round(p.sy - Math.round(camera.y)), dir = e.flipX ? -1 : 1;
      for (let r = 0; r < s.h; r++) for (let c = 0; c < s.w; c++) {
        if (!s.data[r * s.w + c]) continue;
        const X = vx + dir * (c - s.ax), Y = vy - s.ay + r;
        if (X >= rect.x && X < rect.x + rect.w && Y >= rect.y && Y < rect.y + rect.h) n++;
      }
    }
    return n;
  };
  check(T?.sprite && H?.sprite && T.sprite.w > 8 && H.sprite.w > 8, `real painters registered: temple ${T?.sprite?.w}x${T?.sprite?.h}, house ${H?.sprite?.w}x${H?.sprite?.h} (not the 8x8 placeholder)`);
  const tp = toViewPx(game, T);
  const oldRect = { x: tp.vx - (BAR_SIZE.w >> 1), y: tp.vy - T.sprite.ay - BAR_SIZE.h - 2, w: BAR_SIZE.w, h: BAR_SIZE.h };
  const planted = world.spawn('building', { type: 'house', owner: 'player', x: T.x - 1.5, y: T.y - 0.6, z: T.z + 1, sprite: H.sprite });
  const before = coveredIn(oldRect);
  check(before > 0, `test setup: the planted roof covers ${before} px of the bar's unlifted spot above the temple`);
  renderer.render();
  const bar = al.bar();
  const covered = bar ? coveredIn(bar) : -1;
  check(game.state.won && bar && covered === 0 && bar.y < oldRect.y, `converted: the bar covers no building pixel (${covered} covered, top ${bar?.y}, unlifted ${oldRect.y})`);
  planted.flipX = true;
  renderer.render();
  const barF = al.bar();
  const coveredF = barF ? coveredIn(barF) : -1;
  check(barF && coveredF === 0, `mirrored roof (flipX): the bar covers no building pixel (${coveredF} covered, top ${barF?.y})`);
}
function toViewPx(game, e) {
  const p = worldToScreen(e.x, e.y, Number.isFinite(e.z) ? e.z : game.world.heightAt(e.x, e.y));
  return { vx: Math.round(p.sx - Math.round(game.camera.x)), vy: Math.round(p.sy - Math.round(game.camera.y)) };
}

// ---------------------------------------------------------------- 9. ring drawing
{
  const game = newGame(12);
  const { world, camera, renderer } = game;
  const al = game.systems.alignment, ring = al.ring();
  const samples = buildRing(world, ring);
  const surface = tileSurface(world);
  let off = 0, vis = 0;
  for (let i = 0; i < samples.n; i++) {
    if (!samples.vis[i]) continue;
    vis++;
    const hit = pickTile(samples.px[i], samples.py[i], surface, { w: world.w, h: world.h });
    if (!hit || Math.abs(Math.hypot(hit.x - ring.x, hit.y - ring.y) - ring.r) > 0.5) off++;
  }
  check(samples.n > 500 && vis > samples.n * 0.5, `ring has ${samples.n} samples, ${vis} visible on the ground`);
  check(off === 0, `every visible ring pixel picks back to the circle on the ground (${off} off)`);
  camera.centerOn(ring.x, ring.y, world.heightAt(ring.x, ring.y));
  const count = (shade) => { const c = renderer.lut[idx('creature-accent', shade)]; let n = 0; for (const p of renderer.view.data) if (p === c) n++; return n; };
  renderer.render();
  const low = count(3);
  game.state.belief = 0.9;
  renderer.render();
  const high = count(6);
  check(low > 50 && high > low * 1.5, `ring is drawn and grows brighter and denser with belief (${low} px at 0, ${high} px at 0.9)`);
  // Through the LUT: good and evil alignment give different ring colors.
  const good = makeLut(1)[idx('creature-accent', 6)], evil = makeLut(-1)[idx('creature-accent', 6)];
  check(good !== evil, 'ring ramp shifts between good (amber) and evil (ember)');
  check(alignmentStep(0.0624) === 0 && alignmentStep(0.0625) === 1, 'lut.js quantizes to 1/8 steps (sanity)');
}

// ---------------------------------------------------------------- 10. determinism
function session(seed) {
  const game = newGame(seed);
  const trace = [];
  game.events.on('village-converted', (p) => trace.push(['converted', game.clock.ticks, p.how]));
  const ring = game.systems.alignment.ring();
  const mir = game.systems.miracles;
  for (let s = 0; s < 150 && !game.state.won; s++) {
    const r = game.rng.next();
    if (r < 0.3) mir.cast('heal', ring.x + game.rng.range(-4, 4), ring.y + game.rng.range(-4, 4), { free: true });
    else if (r < 0.4) mir.cast('rain', 20, 40, { free: true });
    else if (r < 0.5) act(game, 'creature', -0.5, ring.x + game.rng.range(-9, 9), ring.y);
    run(game, 1);
    game.renderer.render();
    const st = game.state;
    trace.push([s, st.alignment.toFixed(12), st.belief.toFixed(12), st.beliefMix.impress.toFixed(12), st.beliefMix.scare.toFixed(12), game.systems.alignment.state().displayAlignment]);
  }
  trace.push(game.world.query({}).filter((e) => e.owner).map((e) => `${e.id}:${e.owner}`).join(','));
  return JSON.stringify(trace);
}
{
  const a = session(13), b = session(13), c = session(14);
  check(a === b, 'same seed and acts give the same alignment, belief, LUT steps and conversion');
  check(a !== c, 'a different seed gives a different run (the trace is not trivially constant)');
  check(a.includes('converted'), 'the determinism session reaches the conversion');
}

console.log(`check-alignment: ${passes} passed, ${fails.length} failed`);
if (fails.length) process.exitCode = 1;

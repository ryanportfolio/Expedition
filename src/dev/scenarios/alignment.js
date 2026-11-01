// Alignment scenario: the island on the engine's debug terrain pass, both villages set up, then
//   1. good player acts (heal and rain casts through game.systems.miracles.cast, or synthetic `act`
//      events when the miracles system is absent) at the player village: screenshot `good`;
//   2. evil acts (lightning and fire) on bare ground away from both villages: screenshot
//      `evil-fading` the frame the displayed LUT passes neutral on its way down, with the strikes and
//      fires still on the fx layer, then `evil` once the fade has settled;
//   3. acts inside the rival influence ring (heals on the village, lightning on bare ground in the
//      ring, a creature act) until belief fills: screenshots `ring-low`, `ring-high`, `converted`.
// Asserts: alignment moves with player acts only, the LUT follows one step at a time, acts outside the
// ring leave belief alone, both good and evil acts inside fill it, `village-converted` fires exactly
// once, every rival villager and building turns to the player, `won` and `wonHow` are set, and
// nothing resets afterwards.
//
// The engine's debug terrain pass uses fixed colors and is drawn over any terrain system's own pass
// (it is registered later), so a second scenario pass repaints the same stepped tiles in palette
// ramps through the frame's LUT: the screenshots then show the land's good and evil colors with or
// without the terrain round's art.
import { buildIsland } from '../../world/island.js';
import { debugTerrainPass } from '../test-art.js';
import { worldToScreen } from '../../world/iso.js';
import { makeLut, alignmentStep } from '../../art/lut.js';
import { idx } from '../../art/palette.js';

// ground code -> [ramp, top shade, left shade, right shade]
const GROUND = [['water', 2, 1, 1], ['water', 4, 2, 3], ['sand', 5, 3, 4], ['grass', 4, 2, 3], ['dirt', 4, 2, 3], ['rock', 4, 2, 3]];

function lutGroundPass(ctx) {
  const { world, buf, w: W, h: H, camX, camY, lut } = ctx;
  for (let s = 0; s < world.w + world.h - 1; s++)
    for (let tx = Math.max(0, s - world.h + 1); tx <= Math.min(s, world.w - 1); tx++) {
      const ty = s - tx, i = ty * world.w + tx;
      const hh = world.height[i], g = GROUND[world.ground[i]] ?? GROUND[5];
      const vary = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
      const top = lut[idx(g[0], g[1] + ((vary & 3) === 0 ? -1 : (vary & 3) === 3 ? 1 : 0))];
      const left = lut[idx(g[0], g[2])], right = lut[idx(g[0], g[3])];
      const p = worldToScreen(tx, ty, hh);
      const x0 = Math.round(p.sx - camX) - 16, y0 = Math.round(p.sy - camY);
      if (x0 > W || x0 + 32 < 0 || y0 > H || y0 + 16 + hh * 8 < 0) continue;
      for (let c = 0; c < 32; c++) {
        const x = x0 + c;
        if (x < 0 || x >= W) continue;
        const half = c < 16 ? c >> 1 : (31 - c) >> 1;
        const ya = y0 + 7 - half, yb = y0 + 8 + half, yc = yb + hh * 8;
        const side = c < 16 ? left : right;
        for (let y = Math.max(0, ya); y <= Math.min(H - 1, yc); y++) buf[y * W + x] = y <= yb ? top : side;
      }
    }
}

const WEIGHTS = { rain: 0.3, heal: 0.4, fire: -0.4, lightning: -0.6 }; // fallback when miracles is absent

export default async function alignment(t, game) {
  const { world, renderer, camera, events, systems } = game;
  world.loadMap(buildIsland());
  renderer.addTerrainPass(debugTerrainPass);
  renderer.addTerrainPass(lutGroundPass);
  systems.village.setup();
  const al = systems.alignment, st = game.state, tun = al.tuning;
  const conversions = [];
  events.on('village-converted', (p) => conversions.push({ ...p, t: game.clock.time }));

  const mir = systems.miracles;
  const useCast = typeof mir?.cast === 'function';
  t.log('acts through', useCast ? 'miracles.cast' : 'synthetic act events');
  const cast = (m, x, y) => {
    if (useCast) return mir.cast(m, x, y, { free: true });
    events.emit('act', { actor: 'player', verb: 'cast', target: m, weight: WEIGHTS[m], x, y });
    return true;
  };

  // LUT bookkeeping: every rendered frame may move the displayed step by at most one.
  let lastDisplay = al.state().displayAlignment, maxJump = 0, frames = 0;
  const step = (sec) => {
    t.step(sec);
    const d = al.state().displayAlignment;
    maxJump = Math.max(maxJump, Math.abs(d - lastDisplay));
    lastDisplay = d;
    frames++;
  };
  const settleLut = () => {
    let n = 0;
    while (al.state().displayAlignment !== alignmentStep(st.alignment) / 8 && n < 40) { step(tun.lutStepTime); n++; }
    return n;
  };
  const lutMatches = () => renderer.lut === makeLut(al.state().displayAlignment) && al.state().displayAlignment === alignmentStep(st.alignment) / 8;

  const vSite = world.sites.village, ring = al.ring();
  t.assert(ring && ring.r === tun.ringRadius && ring.x === world.sites.rival.x + 0.5, `ring centered on sites.rival, radius ${ring?.r}`);
  const viewVillage = () => camera.centerOn(vSite.x - 1, vSite.y - 2, world.heightAt(vSite.x, vSite.y));
  const outside = (x, y) => Math.hypot(x - ring.x, y - ring.y) > ring.r;

  /** First land tile (sand, grass or rock ground) with no entity within `clear` tiles, matching `ok`. */
  const bareSpot = (ok, clear = 3) => {
    for (let y = 2; y < world.h - 2; y++)
      for (let x = 2; x < world.w - 2; x++) {
        const g = world.ground[y * world.w + x], cx = x + 0.5, cy = y + 0.5;
        if ((g === 3 || g === 2 || g === 5) && ok(cx, cy) && world.query({ x: cx, y: cy, r: clear }).length === 0) return { x: cx, y: cy };
      }
    return null;
  };

  viewVillage();
  step(1);
  t.assert(st.alignment === 0 && st.belief === 0 && st.won === false, 'starts neutral: alignment 0, belief 0, not won');
  await t.shot('neutral');

  // ---- 1. good acts at the player village (outside the ring)
  t.assert(outside(vSite.x, vSite.y), 'player village lies outside the rival ring');
  let casts = 0;
  for (let i = 0; i < 60 && st.alignment < 0.95; i++) {
    const m = i % 2 ? 'rain' : 'heal';
    const dx = ((i * 7) % 5) - 2, dy = ((i * 3) % 5) - 2;
    if (cast(m, vSite.x + 0.5 + dx, vSite.y + 0.5 + dy)) casts++;
    step(0.5);
  }
  t.log('good casts', casts, 'alignment', st.alignment.toFixed(3));
  t.assert(st.alignment >= 0.95, `good acts raise alignment to ${st.alignment.toFixed(3)} (>= 0.95) after ${casts} casts`);
  t.assert(st.belief === 0, `acts outside the ring leave belief at 0 (${st.belief})`);
  step(11); // let the rain clouds pass
  const goodSteps = settleLut();
  t.assert(lutMatches(), `LUT follows the displayed alignment ${al.state().displayAlignment} (settled in ${goodSteps} more frames)`);
  viewVillage();
  step(1 / 30);
  await t.shot('good');
  const goodFrame = renderer.view.data.slice();

  // ---- 2. evil acts on bare ground away from both villages and the ring
  const barren = bareSpot((x, y) => outside(x, y) && Math.hypot(x - ring.x, y - ring.y) > ring.r + 3 && Math.hypot(x - vSite.x, y - vSite.y) > 12, 4);
  t.assert(barren, `found bare ground for evil casts at ${barren?.x},${barren?.y}`);
  const from = st.alignment;
  let flip = null; // frames from the first evil act until the LUT is fully evil
  const flipStart = frames;
  casts = 0;
  const fadeFrom = al.state().displayAlignment;
  let fading = null; // the frame the displayed LUT passes neutral, mid-swing, with miracle effects live
  for (let i = 0; i < 60 && st.alignment > -0.95; i++) {
    if (cast(i % 2 ? 'fire' : 'lightning', barren.x, barren.y)) casts++;
    step(0.5);
    const d = al.state().displayAlignment;
    if (!fading && d <= 0) {
      fading = { display: d, target: alignmentStep(st.alignment) / 8, fx: game.fx.live.length, lutOk: renderer.lut === makeLut(d) };
      camera.centerOn(barren.x, barren.y, world.heightAt(barren.x, barren.y));
      await t.shot('evil-fading');
      const after = al.state().displayAlignment; // the screenshot render must not skip a LUT step
      maxJump = Math.max(maxJump, Math.abs(after - lastDisplay));
      lastDisplay = after;
    }
  }
  t.log('evil fading', fading);
  t.assert(fading && fading.display < fadeFrom && fading.display > -1 && fading.display >= fading.target, `evil-fading shot taken mid-swing: displayed ${fading?.display} between the good ${fadeFrom} and fully evil (target ${fading?.target})`);
  t.assert(fading && fading.lutOk, 'mid-swing frame drawn through makeLut(displayed alignment)');
  t.assert(fading && fading.fx > 0, `miracle effects live on the fx layer during the fade (${fading?.fx})`);
  t.log('evil casts', casts, 'alignment', st.alignment.toFixed(3));
  t.assert(st.alignment <= -0.95 && st.alignment < from, `evil acts lower alignment to ${st.alignment.toFixed(3)} (<= -0.95)`);
  t.assert(st.belief === 0, `evil acts outside the ring leave belief at 0 (${st.belief})`);
  step(4); // fire and flash die down
  settleLut();
  flip = frames - flipStart;
  t.assert(lutMatches() && al.state().displayAlignment === -1, `LUT reaches fully evil (${al.state().displayAlignment})`);
  t.assert(maxJump <= 0.125 + 1e-9, `no frame moved the displayed alignment more than one step (max ${maxJump})`);
  t.assert(flip >= 16, `good-to-evil LUT swing spread over ${flip} frames (>= 16 steps)`);
  viewVillage();
  step(1 / 30);
  await t.shot('evil');
  const evilFrame = renderer.view.data;
  let diff = 0;
  for (let i = 0; i < evilFrame.length; i++) if (evilFrame[i] !== goodFrame[i]) diff++;
  const share = diff / evilFrame.length;
  t.log('good vs evil pixels differing', share.toFixed(3));
  t.assert(share > 0.3, `village view differs between good and evil alignment (${(share * 100).toFixed(1)}% of pixels)`);

  // ---- 3. rival ring: acts inside fill belief
  const rSite = world.sites.rival;
  camera.centerOn(ring.x - 1, ring.y + 1, world.heightAt(ring.x, ring.y));
  step(1 / 30);
  const edgeAct = { actor: 'player', verb: 'drop', target: 'rock', weight: -0.5, x: ring.x + ring.r + 0.6, y: ring.y };
  events.emit('act', edgeAct);
  t.assert(st.belief === 0, 'an act just outside the ring edge leaves belief at 0');
  const ringBare = bareSpot((x, y) => { const d = Math.hypot(x - ring.x, y - ring.y); return d > 7.5 && d < ring.r - 0.8; }, 2.5);
  t.assert(ringBare, `found bare ground inside the ring at ${ringBare?.x},${ringBare?.y}`);
  const ringPixels = () => {
    const lit = new Set([3, 4, 5, 6].map((s) => renderer.lut[idx('creature-accent', s)]));
    let n = 0;
    for (const c of renderer.view.data) if (lit.has(c)) n++;
    return n;
  };
  const before = st.alignment;
  const bA = st.belief;
  events.emit('act', { actor: 'creature', verb: 'smash', target: 'rock', weight: -0.5, x: ringBare.x, y: ringBare.y });
  t.assert(st.alignment === before, 'a creature act inside the ring does not move player alignment');
  t.assert(Math.abs(st.belief - (bA + 0.5 * tun.beliefGain)) < 1e-9, `a creature act inside the ring adds belief (${st.belief.toFixed(3)})`);
  const rivalIds = new Set(world.query({}).filter((e) => (e.kind === 'villager' || e.kind === 'building') && e.owner === 'rival').map((e) => e.id));
  t.assert(rivalIds.size >= 10, `rival village has villagers and buildings (${rivalIds.size})`);

  let i = 0, lowShot = false, highShot = false, lowCount = 0, highCount = 0;
  while (!st.won && i < 80) {
    const good = i % 3 !== 2; // two heals for every lightning strike
    const b0 = st.belief, m0 = { ...st.beliefMix };
    if (good) cast('heal', rSite.x + 0.5 + ((i % 3) - 1), rSite.y + 0.5 + ((i % 2) * 2 - 1));
    else cast('lightning', ringBare.x, ringBare.y);
    if (!st.won) {
      const w = good ? WEIGHTS.heal : WEIGHTS.lightning;
      const grew = st.belief > b0 && (good ? st.beliefMix.impress > m0.impress : st.beliefMix.scare > m0.scare);
      if (!grew || Math.abs(st.belief - Math.min(1, b0 + Math.abs(w) * tun.beliefGain)) > 1e-9) t.assert(false, `act ${i} (${good ? 'heal' : 'lightning'}) added |weight| x gain to belief and to ${good ? 'impress' : 'scare'}`);
    }
    i++;
    step(good ? 0.5 : 2);
    if (!lowShot && st.belief >= 0.25) {
      lowShot = true;
      step(1);
      lowCount = ringPixels();
      t.log('ring low', { belief: st.belief.toFixed(3), mix: st.beliefMix, ringPixels: lowCount });
      await t.shot('ring-low');
    }
    if (!highShot && st.belief >= 0.85 && !st.won) {
      highShot = true;
      step(1);
      highCount = ringPixels();
      t.log('ring high', { belief: st.belief.toFixed(3), mix: st.beliefMix, ringPixels: highCount });
      await t.shot('ring-high');
    }
  }
  t.assert(lowShot && highShot, 'took ring screenshots at low and high belief');
  t.assert(highCount > lowCount * 1.3, `ring brighter and denser at high belief (${highCount} vs ${lowCount} lit pixels)`);

  // ---- 4. conversion
  const s = al.state();
  t.log('converted', { conversions, state: s, acts: i });
  t.assert(conversions.length === 1 && conversions[0].village === 'rival', `village-converted fired once for the rival (${conversions.length})`);
  t.assert(st.won === true && s.won === true, 'game.state.won is true');
  const bigger = st.beliefMix.scare > st.beliefMix.impress ? 'scare' : 'impress';
  t.assert(st.wonHow === bigger && s.wonHow === bigger, `wonHow is the larger total: ${st.wonHow} (impress ${st.beliefMix.impress.toFixed(3)}, scare ${st.beliefMix.scare.toFixed(3)})`);
  const stillRival = () => world.query({}).filter((e) => (e.kind === 'villager' || e.kind === 'building') && e.owner === 'rival');
  t.assert(stillRival().length === 0, 'no rival-owned villager or building is left');
  const flipped = [...rivalIds].filter((id) => world.get(id)).every((id) => world.get(id).owner === 'player');
  t.assert(flipped, 'every rival villager and building now belongs to the player');
  step(2);
  await t.shot('converted');

  // ---- 5. nothing resets afterwards
  for (let k = 0; k < 4; k++) { cast('heal', rSite.x + 0.5, rSite.y + 0.5); events.emit('act', { actor: 'player', verb: 'cast', target: 'lightning', weight: -0.6, x: ringBare.x, y: ringBare.y }); step(1); }
  step(60);
  const after = al.state();
  t.log('a minute after conversion', after);
  t.assert(conversions.length === 1, `still exactly one conversion after more acts and a minute (${conversions.length})`);
  t.assert(after.won && after.belief === 1 && st.wonHow === bigger, 'won, belief and wonHow unchanged a minute later');
  t.assert(stillRival().length === 0, `no rival owners appear after the conversion (${stillRival().length})`);
  t.assert(!('lost' in st) && !('lose' in st), 'no lose state exists');
}

// Audio scenario. Part 1 renders every sound through an OfflineAudioContext (nothing reaches the
// speakers) and measures the samples: non-silent (RMS over the stated duration above a floor), no
// clipping (peak under 1.0), silent after the stated duration, and identical on a second render.
// Part 2 drives the real system: each event through game.events must queue the expected sound id,
// a 20-event `landed` burst in one tick must be cut to one thud, far sounds are skipped, KeyM mutes,
// and no AudioContext exists without a user gesture. Screenshot: a waveform sheet of every sound.
import { SOUNDS, SOUND_IDS } from '../../audio/sounds.js';
import { buildIsland } from '../../world/island.js';
import { rgba } from '../../render/buffer.js';

const RATE = 48000;
const TAIL = 0.3; // s rendered past the stated duration
const RMS_FLOOR = 0.005;
const AUDIBLE_PEAK = 0.05;
const CLIP = 1.0;
const TAIL_SILENT = 1e-4;
const ONSET = 0.15; // s until the first sample over 0.01 (swells start soft)
/** Sounds whose synthesis changes with intensity: rendered at both ends. */
const SCALED = new Set(['release', 'landed', 'splash', 'stroke', 'slap']);

async function renderSound(id, intensity) {
  const dur = SOUNDS[id].duration(intensity);
  const ctx = new OfflineAudioContext(1, Math.ceil((dur + TAIL) * RATE), RATE);
  SOUNDS[id].play(ctx, ctx.destination, { intensity });
  const buf = await ctx.startRendering();
  return { dur, data: buf.getChannelData(0) };
}

function measure({ dur, data }) {
  const cut = Math.min(data.length, Math.round(dur * RATE));
  let sum = 0, peak = 0, tail = 0, onset = -1;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (!Number.isFinite(data[i])) return { rms: NaN, peak: NaN, tail: NaN, onset: -1 };
    if (i < cut) { sum += data[i] * data[i]; if (onset < 0 && a > 0.01) onset = i / RATE; }
    else tail = Math.max(tail, a);
    peak = Math.max(peak, a);
  }
  return { rms: Math.sqrt(sum / Math.max(cut, 1)), peak, tail, onset };
}

export default async function audio(t, game) {
  const sys = game.systems.audio;
  t.assert(typeof OfflineAudioContext === 'function', 'OfflineAudioContext available in this Chrome');

  // ---- part 1: offline renders
  const renders = [];
  for (const id of SOUND_IDS) {
    const levels = SCALED.has(id) ? [0, 1] : [1];
    for (const k of levels) {
      const r = await renderSound(id, k);
      const m = measure(r);
      renders.push({ id, k, ...r, m });
      const tag = `${id} @${k}`;
      t.log(`${tag}: dur ${r.dur.toFixed(2)}s rms ${m.rms.toFixed(4)} peak ${m.peak.toFixed(3)} tail ${m.tail.toExponential(1)} onset ${m.onset.toFixed(3)}s`);
      t.assert(m.rms > RMS_FLOOR, `${tag}: not silent (rms ${m.rms.toFixed(4)} > ${RMS_FLOOR})`);
      t.assert(m.peak > AUDIBLE_PEAK, `${tag}: audible peak (${m.peak.toFixed(3)} > ${AUDIBLE_PEAK})`);
      t.assert(m.peak < CLIP, `${tag}: no clipping (peak ${m.peak.toFixed(3)} < ${CLIP})`);
      t.assert(m.tail < TAIL_SILENT, `${tag}: silent after its stated ${r.dur.toFixed(2)}s (tail peak ${m.tail.toExponential(1)})`);
      t.assert(m.onset >= 0 && m.onset < ONSET, `${tag}: starts promptly (onset ${m.onset.toFixed(3)}s)`);
    }
  }
  // intensity changes the sound where the map scales it
  const by = (id, k) => renders.find((r) => r.id === id && r.k === k).m;
  t.assert(by('release', 1).rms > by('release', 0).rms, 'faster whoosh is louder');
  t.assert(by('landed', 1).rms > by('landed', 0).rms, 'harder thud is heavier');
  // seeded noise: a second render repeats the first. Chrome's oscillators and filters differ by a few
  // float LSBs between renders (measured up to ~8e-7), so compare within 1e-5 (-100 dBFS)
  for (const id of SOUND_IDS) {
    const first = renders.find((r) => r.id === id && r.k === 1), again = await renderSound(id, 1);
    let md = first.data.length === again.data.length ? 0 : Infinity;
    for (let i = 0; md < Infinity && i < again.data.length; i++) md = Math.max(md, Math.abs(first.data[i] - again.data[i]));
    t.assert(md < 1e-5, `${id}: a second render matches (max diff ${md.toExponential(1)})`);
  }

  // ---- part 2: the live system
  game.world.loadMap(buildIsland());
  const home = game.world.sites.village;
  const hz = game.world.heightAt(home.x, home.y);
  game.camera.centerOn(home.x, home.y, hz);
  t.step(1);
  t.assert(sys.player !== null, 'draw armed the player');
  t.assert(sys.player.ctx === null, 'no AudioContext before a user gesture');

  const W = game.world;
  const rock = W.spawn('rock', { x: home.x + 1.5, y: home.y + 0.5 });
  const wet = W.spawn('rock', { x: 1.5, y: 1.5 });
  t.assert(W.tile(1, 1).height <= W.seaLevel, 'tile (1, 1) is sea');
  const giant = W.spawn('creature', { x: home.x - 1, y: home.y + 1 });
  const hut = W.spawn('building', { x: home.x + 2, y: home.y - 2 });
  const villager = W.spawn('villager', { x: home.x, y: home.y + 2 });
  const at = { x: home.x, y: home.y, z: hz };
  const cases = [
    ['grab', { entityId: rock.id, ...at, vx: 0, vy: 0, vz: 0 }, ['grab']],
    ['release', { entityId: rock.id, ...at, vx: 9, vy: -3, vz: 4 }, ['release']],
    ['landed', { entityId: rock.id, speed: 8 }, ['landed']],
    ['landed', { entityId: wet.id, speed: 8, x: home.x, y: home.y, water: true }, ['splash']],
    ['stroke', { creatureId: giant.id, strength: 0.8 }, ['stroke']],
    ['slap', { creatureId: giant.id, strength: 1 }, ['slap']],
    ['miracle-cast', { miracle: 'rain', ...at }, ['miracle-rain']],
    ['miracle-cast', { miracle: 'fire', ...at }, ['miracle-fire']],
    ['miracle-cast', { miracle: 'heal', ...at }, ['miracle-heal']],
    ['miracle-cast', { miracle: 'lightning', ...at }, ['miracle-lightning']],
    ['building-placed', { buildingId: hut.id, kind: 'hut' }, ['building-placed']],
    ['building-complete', { buildingId: hut.id, kind: 'hut' }, ['building-complete']],
    ['villager-died', { id: villager.id, cause: 'thrown' }, ['villager-died']],
    ['village-converted', { village: 'rival' }, ['village-converted']],
  ];
  for (const [type, payload, want] of cases) {
    const n0 = sys.history.length;
    game.events.emit(type, payload);
    t.step(1);
    const got = sys.history.slice(n0).map((r) => r.sound);
    t.assert(JSON.stringify(got) === JSON.stringify(want), `${type} queues ${want.join(', ')} (got ${got.join(', ') || 'nothing'})`);
  }
  t.assert(sys.queue.queue.length === 0, 'frames drain the queue');

  // a landing on the sea (no water hint) splashes, judged from the terrain under the entity
  {
    game.camera.centerOn(wet.x, wet.y, wet.z);
    t.step(1);
    const n0 = sys.history.length;
    game.events.emit('landed', { entityId: wet.id, speed: 8 });
    t.step(1);
    const got = sys.history.slice(n0).map((r) => r.sound);
    t.assert(got.length === 1 && got[0] === 'splash', `landing at sea splashes (got ${got.join(', ') || 'nothing'})`);
    game.camera.centerOn(home.x, home.y, hz);
    t.step(1);
  }

  // burst: 20 landings in one tick -> one thud, and the strongest one
  {
    const n0 = sys.history.length, r0 = sys.stats.requested, i0 = sys.stats.interval;
    for (let i = 0; i < 20; i++) game.events.emit('landed', { entityId: rock.id, speed: i === 7 ? 11 : 3 + (i % 4) });
    t.step(game.clock.step);
    const got = sys.history.slice(n0);
    t.assert(got.length === 1 && got[0].sound === 'landed', `20 landed in one tick -> 1 thud (got ${got.length})`);
    t.assert(sys.stats.requested - r0 === 20 && sys.stats.interval - i0 === 19, `19 of 20 dropped by the min interval (${sys.stats.interval - i0})`);
    t.assert(got[0] && got[0].intensity > 0.9, `the strongest landing plays (intensity ${got[0]?.intensity.toFixed(2)})`);
    t.step(1);
  }

  // distance: same event on screen vs far off-screen
  {
    const view = sys.view();
    t.assert(view && view.halfW === game.display.w / 2, 'audio view follows the display');
    const d0 = sys.stats.distance;
    game.events.emit('miracle-cast', { miracle: 'heal', x: 60, y: 2, z: 0 }); // far corner of the map
    t.step(1);
    t.assert(sys.stats.distance === d0 + 1, 'far off-screen miracle skipped');
  }

  // mute toggle on KeyM reaches the player at frame time
  t.input.key('KeyM', 0.1);
  t.assert(sys.muted && sys.player.muted, 'KeyM mutes');
  t.input.key('KeyM', 0.1);
  t.assert(!sys.muted && !sys.player.muted, 'KeyM again unmutes');
  t.assert(sys.player.ctx === null, 'still no AudioContext: synthetic input is not a user gesture');
  t.log(`stats ${JSON.stringify(sys.stats)}`);

  // ---- screenshot: waveform sheet (one strip per sound at intensity 1, shared 3 s time axis)
  const sheet = renders.filter((r) => r.k === 1);
  const colors = ['#c8b48a', '#8fa9c4', '#9c7b52', '#6fa0b8', '#b0905c', '#d0603a', '#7e9c5a', '#e08a3c',
    '#e6d27a', '#b7c8ff', '#a8743c', '#c2b070', '#7a6f66', '#e0c060'].map(rgba);
  const ink = rgba('#2a3448'), mark = rgba('#f0d070'), bg = rgba('#121a26');
  game.renderer.addTerrainPass((ctx) => {
    const { buf, w, h } = ctx;
    buf.fill(bg);
    const left = 8, right = w - 8, rows = sheet.length;
    const rowH = Math.floor((h - 8) / rows);
    const span = 3; // seconds across the sheet
    for (let r = 0; r < rows; r++) {
      const s = sheet[r], top = 4 + r * rowH, mid = top + (rowH >> 1), amp = (rowH - 2) / 2;
      for (let x = left; x < right; x++) buf[mid * w + x] = ink;
      const durX = left + Math.round((s.dur / span) * (right - left));
      for (let y = top; y < top + rowH - 1; y++) if (durX < w) buf[y * w + durX] = mark;
      for (let x = left; x < right; x++) {
        const i0 = Math.floor(((x - left) / (right - left)) * span * RATE);
        const i1 = Math.floor(((x + 1 - left) / (right - left)) * span * RATE);
        if (i0 >= s.data.length) break;
        let lo = 0, hi = 0;
        for (let i = i0; i < Math.min(i1, s.data.length); i++) { lo = Math.min(lo, s.data[i]); hi = Math.max(hi, s.data[i]); }
        const y0 = Math.round(mid - hi * amp), y1 = Math.round(mid - lo * amp);
        for (let y = y0; y <= y1; y++) buf[y * w + x] = colors[r % colors.length];
      }
    }
  });
  await t.shot('sound-sheet');
}

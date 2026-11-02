// Sound request queue. Pure data, DOM-free, runs on sim ticks (node checks drive it directly).
//
// Event listeners push candidates (src/audio/map.js) into `pending`. Each update(dt):
//   1. advances sim time,
//   2. frees voices whose sound has finished,
//   3. groups the pending candidates by sound (first-seen order) and, loudest first, accepts each
//      one that passes distance attenuation, the sound's minimum interval, the sound's voice cap
//      and the total voice cap,
//   4. appends accepted requests to `queue` (played and cleared at frame time) and `history`.
// Every drop is counted in `stats` under its reason.
import { worldToScreen } from '../world/iso.js';
import { AUDIO, LIMITS } from './config.js';
import { SOUNDS } from './sounds.js';

/**
 * Distance attenuation and pan for a candidate, given the view in world pixels:
 * view = { cx, cy, halfW, halfH } (center and half size), or null when there is no view
 * (node, before the first resize): then everything plays at full volume, centered.
 */
export function attenuate(c, view, cfg = AUDIO) {
  if (!c.positional || !view || !(view.halfW > 0) || !(view.halfH > 0)) return { factor: 1, pan: 0, r: 0 };
  const p = worldToScreen(c.x, c.y, c.z);
  const nx = (p.sx - view.cx) / view.halfW, ny = (p.sy - view.cy) / view.halfH;
  const r = Math.max(Math.abs(nx), Math.abs(ny));
  const factor = r <= cfg.inner ? 1 : r >= cfg.outer ? 0 : 1 - (r - cfg.inner) / (cfg.outer - cfg.inner);
  const pan = Math.min(Math.max(nx, -1), 1) * cfg.panWidth;
  return { factor, pan, r };
}

export function createSoundQueue({ limits = LIMITS, cfg = AUDIO } = {}) {
  const voices = new Map(); // sound -> [end times]
  const last = new Map(); // sound -> time of last accepted play
  let total = 0;
  const q = {
    time: 0,
    ticks: 0,
    pending: [],
    queue: [],
    history: [],
    stats: { requested: 0, accepted: 0, distance: 0, interval: 0, voices: 0, totalVoices: 0 },
    limits,
    cfg,
    push(c) { if (c) q.pending.push(c); },
    /** Live voices of one sound, or of all sounds when `sound` is omitted. */
    voiceCount(sound) {
      if (sound === undefined) return total;
      return voices.get(sound)?.length ?? 0;
    },
    update(dt, view) {
      q.time += dt;
      q.ticks++;
      const now = q.time;
      total = 0;
      for (const [s, ends] of voices) {
        const live = ends.filter((e) => e > now);
        voices.set(s, live);
        total += live.length;
      }
      if (!q.pending.length) return;
      const groups = new Map();
      for (const c of q.pending) {
        if (!groups.has(c.sound)) groups.set(c.sound, []);
        groups.get(c.sound).push(c);
      }
      q.pending.length = 0;
      for (const [sound, list] of groups) {
        const lim = limits[sound] ?? { minInterval: 0.1, maxVoices: 2 };
        const scored = list.map((c, i) => {
          const a = attenuate(c, view, cfg);
          return { c, a, g: c.gain * a.factor, i };
        });
        scored.sort((u, v) => v.g - u.g || u.i - v.i);
        for (const { c, a, g } of scored) {
          q.stats.requested++;
          if (g < cfg.minGain) { q.stats.distance++; continue; }
          const prev = last.get(sound);
          if (prev !== undefined && now - prev < lim.minInterval - 1e-9) { q.stats.interval++; continue; }
          const ends = voices.get(sound) ?? [];
          if (ends.length >= lim.maxVoices) { q.stats.voices++; continue; }
          if (total >= cfg.maxVoicesTotal) { q.stats.totalVoices++; continue; }
          const dur = SOUNDS[sound].duration(c.intensity);
          ends.push(now + dur);
          voices.set(sound, ends);
          total++;
          last.set(sound, now);
          q.stats.accepted++;
          const r = {
            sound, gain: g, pan: a.pan, intensity: c.intensity, time: now, tick: q.ticks, duration: dur,
            event: c.event, x: c.x, y: c.y, z: c.z, positional: c.positional,
          };
          q.queue.push(r);
          if (q.queue.length > cfg.maxQueue) q.queue.shift();
          q.history.push(r);
          if (q.history.length > cfg.maxHistory) q.history.shift();
        }
      }
    },
    /** Take every queued request (frame time). */
    drain() {
      const out = q.queue;
      q.queue = [];
      return out;
    },
  };
  return q;
}

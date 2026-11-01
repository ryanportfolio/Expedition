// Audio system: synthesized sound effects for game events. No audio files, no music.
//
// Sim side (DOM-free, runs in node): listeners on game.events map each event to a sound candidate
// (src/audio/map.js); update(dt) rate-limits, voice-caps and distance-attenuates them into
// `queue` (src/audio/queue.js). Key `KeyM` toggles mute.
// Frame side (browser only): draw() reads `?mute=1` once, arms the first-gesture unlock that creates
// the AudioContext (src/audio/player.js), and plays or drops whatever the sim queued.
import { mapEvent, AUDIO_EVENTS } from '../audio/map.js';
import { createSoundQueue } from '../audio/queue.js';
import { createPlayer, muteFlag } from '../audio/player.js';
import { AUDIO } from '../audio/config.js';

export function create(game) {
  const q = createSoundQueue();
  let player = null;
  let failed = false;

  const sys = {
    muted: false,
    queue: q,
    /** Accepted requests, newest last (bounded); for scenarios and debugging. */
    get history() { return q.history; },
    get stats() { return q.stats; },
    get player() { return player; },
    setMuted(m) { sys.muted = !!m; },
    toggleMute() { sys.muted = !sys.muted; },

    /** View center and half size in world px, or null without a view. */
    view() {
      const d = game.display, c = game.camera;
      if (!d || !(d.w > 0) || !(d.h > 0)) return null;
      return { cx: c.x + d.w / 2, cy: c.y + d.h / 2, halfW: d.w / 2, halfH: d.h / 2 };
    },

    update(dt) {
      q.update(dt, sys.view());
    },

    draw() {
      const reqs = q.drain();
      if (failed || typeof window === 'undefined') return;
      try {
        if (!player) {
          player = createPlayer();
          if (muteFlag(window.location?.search)) sys.muted = true;
          player.attach(window);
        }
        if (player.muted !== sys.muted) player.setMuted(sys.muted);
        if (sys.muted || !player.ready) return;
        for (const r of reqs) if (q.time - r.time <= AUDIO.staleAfter) player.play(r);
      } catch (err) {
        failed = true;
        console.warn(`[audio] disabled: ${err?.message || err}`);
      }
    },
  };

  for (const type of AUDIO_EVENTS) {
    game.events.on(type, (payload) => q.push(mapEvent(type, payload, game.world)));
  }
  game.events.on('key-down', (e) => { if (e?.code === 'KeyM') sys.toggleMute(); });

  return sys;
}

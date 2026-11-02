// Playback, frame time only. Browsers block audio until the user interacts, so the one AudioContext
// is created inside the first pointer-down or key-down DOM event. Chain:
//   voice gain (request gain) -> stereo pan -> master gain (volume, mute) -> limiter -> speakers.
// Nothing here throws: missing Web Audio, a blocked context or a failing node leaves the game silent.
import { AUDIO } from './config.js';
import { SOUNDS } from './sounds.js';

/** `?mute=1` (also `?mute`, `?mute=true`) in a URL query string. */
export function muteFlag(search) {
  try {
    const v = new URLSearchParams(search || '').get('mute');
    return v !== null && v !== '0' && v !== 'false';
  } catch {
    return false;
  }
}

export function createPlayer({ cfg = AUDIO } = {}) {
  let win = null;
  let master = null;
  let warned = false;
  const warn = (msg, err) => {
    if (warned) return;
    warned = true;
    console.warn(`[audio] ${msg}${err ? `: ${err?.message || err}` : ''}`);
  };

  const player = {
    /** The AudioContext, or null before the first gesture (or without Web Audio). */
    ctx: null,
    attached: false,
    unavailable: false,
    muted: false,
    played: 0,

    /** Listen for the first gesture on `w` (window). Idempotent. */
    attach(w) {
      if (player.attached || !w?.addEventListener) return;
      player.attached = true;
      win = w;
      w.addEventListener('pointerdown', unlock, true);
      w.addEventListener('keydown', unlock, true);
    },

    setMuted(m) {
      player.muted = !!m;
      if (master && player.ctx) {
        try {
          master.gain.setTargetAtTime(player.muted ? 0 : cfg.master, player.ctx.currentTime, 0.015);
        } catch (err) { warn('mute failed', err); }
      }
    },

    /** True when a context exists and is running. */
    get ready() { return !!player.ctx && player.ctx.state === 'running'; },

    /** Play one queued request. Returns true when nodes were built. */
    play(r) {
      const ac = player.ctx;
      if (!ac || player.muted || ac.state !== 'running') return false;
      const def = SOUNDS[r.sound];
      if (!def) return false;
      try {
        const voice = ac.createGain();
        voice.gain.value = r.gain;
        if (typeof ac.createStereoPanner === 'function') {
          const pan = ac.createStereoPanner();
          pan.pan.value = r.pan || 0;
          voice.connect(pan);
          pan.connect(master);
        } else {
          voice.connect(master);
        }
        def.play(ac, voice, { intensity: r.intensity });
        player.played++;
        return true;
      } catch (err) {
        warn(`could not play ${r.sound}`, err);
        return false;
      }
    },
  };

  function unlock() {
    try {
      if (!player.ctx) {
        const AC = win.AudioContext || win.webkitAudioContext;
        if (!AC) {
          player.unavailable = true;
          detach();
          return;
        }
        const ac = new AC();
        master = ac.createGain();
        master.gain.value = player.muted ? 0 : cfg.master;
        const limiter = ac.createDynamicsCompressor();
        limiter.threshold.value = -6;
        limiter.knee.value = 6;
        limiter.ratio.value = 12;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.15;
        master.connect(limiter);
        limiter.connect(ac.destination);
        player.ctx = ac;
      }
      if (player.ctx.state === 'suspended') {
        player.ctx.resume().then(() => { if (player.ctx.state === 'running') detach(); }, () => {});
      } else if (player.ctx.state === 'running') {
        detach();
      }
    } catch (err) {
      player.unavailable = true;
      detach();
      warn('Web Audio unavailable', err);
    }
  }

  function detach() {
    if (!win) return;
    win.removeEventListener('pointerdown', unlock, true);
    win.removeEventListener('keydown', unlock, true);
  }

  return player;
}

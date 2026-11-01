// Sound effects, synthesized from oscillators, seeded noise, filters and envelopes. No audio files.
// Mood (art direction v2): grounded and weighty. Wood knocks, stone thuds, low rumbles, airy
// whooshes; saturation (bright tones) only for magic.
//
// SOUNDS[id] = { duration(intensity) -> s, play(ctx, dest, { intensity }) }. `play` builds nodes
// starting at ctx.currentTime, connects them into `dest` and stops every source by
// currentTime + duration(intensity). intensity is in [0, 1] (throw speed, stroke strength).
// Loudness comes from the caller's voice gain; at gain 1 every sound peaks under 1.0.
import { env, swell, osc, noise, filter, gain } from './synth.js';

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

/** One wood knock at t: low pitched body, short filtered noise tick, a hollow overtone. */
function knock(ctx, dest, t, f, level) {
  osc(ctx, env(ctx, dest, t, { attack: 0.002, peak: 0.42 * level, end: 0.14 }), t, 0.14, 'sine', f, [[f * 0.82, 0.1]]);
  noise(ctx, filter(ctx, env(ctx, dest, t, { attack: 0.001, peak: 0.5 * level, end: 0.05 }), t, 'bandpass', 950, 4), t, 0.05, 'white', f / 100);
  osc(ctx, env(ctx, dest, t, { attack: 0.001, peak: 0.08 * level, end: 0.06 }), t, 0.06, 'triangle', f * 2.7);
}

export const SOUNDS = {
  /** Soft airy lift: band-passed breath rising, faint low swell under it. */
  grab: {
    duration: () => 0.5,
    play(ctx, dest) {
      const t = ctx.currentTime;
      const air = filter(ctx, env(ctx, dest, t, { attack: 0.1, peak: 0.8, end: 0.48 }), t, 'bandpass', 450, 1.4, [[1400, 0.4]]);
      noise(ctx, air, t, 0.5, 'white', 0.3);
      osc(ctx, env(ctx, dest, t, { attack: 0.12, peak: 0.1, end: 0.45 }), t, 0.5, 'sine', 170, [[240, 0.4]]);
    },
  },

  /** Whoosh: band-passed noise sweeping down; faster throws are longer, brighter and louder. */
  release: {
    duration: (k) => 0.25 + 0.45 * clamp01(k),
    play(ctx, dest, { intensity = 0.5 } = {}) {
      const k = clamp01(intensity), t = ctx.currentTime, d = 0.25 + 0.45 * k;
      const top = 1400 + 1600 * k;
      const e = env(ctx, dest, t, { attack: d * 0.35, peak: 0.45 + 0.35 * k, end: d });
      noise(ctx, filter(ctx, e, t, 'bandpass', top, 0.9, [[320, d]]), t, d, 'white', 0.7);
      noise(ctx, filter(ctx, env(ctx, dest, t, { attack: d * 0.4, peak: 0.25 * k, end: d }), t, 'lowpass', 400), t, d, 'brown', 0.2);
    },
  },

  /** Ground thud: falling sine body plus a dull earthy impact; harder landings drop deeper. */
  landed: {
    duration: () => 0.6,
    play(ctx, dest, { intensity = 0.5 } = {}) {
      const k = clamp01(intensity), t = ctx.currentTime;
      const f = 70 + 50 * k;
      osc(ctx, env(ctx, dest, t, { attack: 0.004, peak: 0.6, end: 0.42 + 0.15 * k }), t, 0.6, 'sine', f, [[38, 0.25]]);
      noise(ctx, filter(ctx, env(ctx, dest, t, { attack: 0.002, peak: 0.45, end: 0.12 + 0.06 * k }), t, 'lowpass', 280 + 520 * k, 1), t, 0.2, 'brown', 0.9);
      noise(ctx, filter(ctx, env(ctx, dest, t, { attack: 0.001, peak: 0.12 * k, end: 0.05 }), t, 'bandpass', 1800, 1.5), t, 0.05, 'white', 1.1);
    },
  },

  /** Water landing: plop, broad wash of spray, a few bubble chirps. */
  splash: {
    duration: () => 0.9,
    play(ctx, dest, { intensity = 0.5 } = {}) {
      const k = clamp01(intensity), t = ctx.currentTime;
      osc(ctx, env(ctx, dest, t, { attack: 0.003, peak: 0.3, end: 0.16 }), t, 0.16, 'sine', 170, [[60, 0.14]]);
      const spray = env(ctx, dest, t, { attack: 0.012, peak: 0.35 + 0.15 * k, end: 0.55 + 0.3 * k });
      noise(ctx, filter(ctx, spray, t, 'bandpass', 2400, 0.7, [[1300, 0.6]]), t, 0.9, 'white', 1.5);
      for (const [at, f] of [[0.09, 520], [0.18, 700], [0.3, 460]]) {
        osc(ctx, env(ctx, dest, t + at, { attack: 0.004, peak: 0.08, end: 0.06 }), t + at, 0.06, 'sine', f, [[f * 2.1, 0.05]]);
      }
    },
  },

  /** Warm low hum: a root and fifth with slow vibrato under a low-pass, soft in and out. */
  stroke: {
    duration: () => 1.0,
    play(ctx, dest, { intensity = 0.5 } = {}) {
      const k = clamp01(intensity), t = ctx.currentTime;
      const body = filter(ctx, env(ctx, dest, t, { attack: 0.25, peak: 0.22 + 0.1 * k, hold: 0.25, end: 1.0 }), t, 'lowpass', 600 + 300 * k, 0.8);
      const lfo = osc(ctx, null, t, 1.0, 'sine', 4.5);
      for (const [f, level] of [[98, 1], [147, 0.6], [196.6, 0.25]]) {
        const o = osc(ctx, gain(ctx, body, level), t, 1.0, 'triangle', f);
        lfo.connect(gain(ctx, o.frequency, f * 0.015));
      }
    },
  },

  /** Sharp crack: very short high noise snap over a quick low body hit. */
  slap: {
    duration: () => 0.35,
    play(ctx, dest, { intensity = 0.5 } = {}) {
      const k = clamp01(intensity), t = ctx.currentTime;
      noise(ctx, filter(ctx, env(ctx, dest, t, { attack: 0.001, peak: 0.4 + 0.2 * k, end: 0.08 }), t, 'highpass', 1800, 0.9), t, 0.08, 'white', 0.05);
      noise(ctx, filter(ctx, env(ctx, dest, t + 0.004, { attack: 0.001, peak: 0.2, end: 0.05 }), t, 'bandpass', 3600, 2), t, 0.06, 'white', 0.4);
      osc(ctx, env(ctx, dest, t, { attack: 0.002, peak: 0.35, end: 0.3 }), t, 0.35, 'sine', 180, [[85, 0.2]]);
    },
  },

  /** Rain miracle: high hiss swelling up with a soft wet body, then easing away. */
  'miracle-rain': {
    duration: () => 2.4,
    play(ctx, dest) {
      const t = ctx.currentTime;
      const hiss = swell(ctx, dest, t, { rise: 1.3, peak: 0.42, end: 2.4 });
      noise(ctx, filter(ctx, filter(ctx, hiss, t, 'lowpass', 9000), t, 'highpass', 2600, 0.6), t, 2.4, 'white', 0.6);
      const body = swell(ctx, dest, t, { rise: 1.1, peak: 0.25, end: 2.3 });
      noise(ctx, filter(ctx, body, t, 'bandpass', 900, 0.5), t, 2.3, 'brown', 1.3);
    },
  },

  /** Fire miracle: low whoomp, then a churning low roar with a crackle on top. */
  'miracle-fire': {
    duration: () => 1.8,
    play(ctx, dest) {
      const t = ctx.currentTime;
      osc(ctx, env(ctx, dest, t, { attack: 0.05, peak: 0.3, end: 0.8 }), t, 0.8, 'sine', 62, [[44, 0.7]]);
      const roarEnv = env(ctx, dest, t, { attack: 0.25, peak: 0.5, hold: 0.3, end: 1.8 });
      const churn = gain(ctx, roarEnv, 0.7);
      osc(ctx, gain(ctx, churn.gain, 0.3), t, 1.8, 'sine', 6.5);
      noise(ctx, filter(ctx, churn, t, 'lowpass', 520, 0.9, [[380, 1.7]]), t, 1.8, 'brown', 0.35);
      const crackleEnv = env(ctx, dest, t + 0.1, { attack: 0.2, peak: 0.16, end: 1.6 });
      const gate = gain(ctx, crackleEnv, 0.5);
      osc(ctx, gain(ctx, gate.gain, 0.5), t, 1.8, 'square', 13);
      noise(ctx, filter(ctx, gate, t, 'bandpass', 2600, 3), t, 1.8, 'white', 0.9);
    },
  },

  /** Heal miracle: a soft chime, three bell-like partials struck a moment apart. */
  'miracle-heal': {
    duration: () => 1.8,
    play(ctx, dest) {
      const t = ctx.currentTime;
      const partials = [[523.25, 0, 0.2, 1.7], [785.1, 0.07, 0.14, 1.6], [1049.6, 0.14, 0.1, 1.55], [1570, 0.14, 0.035, 1.2]];
      for (const [f, at, peak, end] of partials) {
        osc(ctx, env(ctx, dest, t + at, { attack: 0.006, peak, end }), t + at, end, 'sine', f);
      }
    },
  },

  /** Lightning miracle: a split-second crack, a second snap, then a long low rumble rolling in. */
  'miracle-lightning': {
    duration: () => 2.8,
    play(ctx, dest) {
      const t = ctx.currentTime;
      noise(ctx, filter(ctx, env(ctx, dest, t, { attack: 0.001, peak: 0.65, end: 0.12 }), t, 'highpass', 1200, 0.8), t, 0.12, 'white', 0.25);
      noise(ctx, filter(ctx, env(ctx, dest, t + 0.05, { attack: 0.002, peak: 0.45, end: 0.16 }), t, 'bandpass', 3000, 1.2), t, 0.22, 'white', 1.25);
      const rumble = swell(ctx, dest, t + 0.08, { rise: 0.32, peak: 0.85, end: 2.7 });
      noise(ctx, filter(ctx, rumble, t, 'lowpass', 180, 0.9, [[90, 2.5]]), t, 2.8, 'brown', 0.55);
      osc(ctx, swell(ctx, dest, t + 0.1, { rise: 0.4, peak: 0.18, end: 2.2 }), t, 2.3, 'sine', 46, [[34, 2.2]]);
    },
  },

  /** Building placed: two wood knocks, the second a little lower. */
  'building-placed': {
    duration: () => 0.45,
    play(ctx, dest) {
      const t = ctx.currentTime;
      knock(ctx, dest, t, 215, 1);
      knock(ctx, dest, t + 0.14, 180, 0.8);
    },
  },

  /** Building complete: a short rising tone, warm triangle with a quiet octave. */
  'building-complete': {
    duration: () => 0.8,
    play(ctx, dest) {
      const t = ctx.currentTime;
      const tone = filter(ctx, env(ctx, dest, t, { attack: 0.03, peak: 0.32, hold: 0.3, end: 0.8 }), t, 'lowpass', 1800, 0.7);
      osc(ctx, tone, t, 0.8, 'triangle', 196, [[247, 0.15], [294, 0.32]]);
      osc(ctx, gain(ctx, tone, 0.3), t, 0.8, 'sine', 392, [[494, 0.15], [588, 0.32]]);
    },
  },

  /** Villager died: one muted low note that sags slightly as it fades. */
  'villager-died': {
    duration: () => 1.1,
    play(ctx, dest) {
      const t = ctx.currentTime;
      const note = filter(ctx, env(ctx, dest, t, { attack: 0.04, peak: 0.45, end: 1.1 }), t, 'lowpass', 420, 0.6);
      osc(ctx, note, t, 1.1, 'triangle', 110, [[98, 0.9]]);
      osc(ctx, gain(ctx, note, 0.5), t, 1.1, 'sine', 55, [[49, 0.9]]);
    },
  },

  /** Village converted: a bright major chord swelling open, then settling. */
  'village-converted': {
    duration: () => 2.6,
    play(ctx, dest) {
      const t = ctx.currentTime;
      const chord = filter(ctx, swell(ctx, dest, t, { rise: 1.0, peak: 0.55, end: 2.6 }), t, 'lowpass', 500, 0.9, [[2800, 1.1], [1200, 2.4]]);
      for (const [f, det] of [[196, -4], [196, 4], [247, 0], [294, -3], [392, 3]]) {
        const o = osc(ctx, gain(ctx, chord, 0.17), t, 2.6, 'sawtooth', f);
        o.detune.setValueAtTime(det, t);
      }
      osc(ctx, swell(ctx, dest, t + 0.3, { rise: 0.9, peak: 0.08, end: 2.2 }), t, 2.6, 'sine', 784);
    },
  },
};

export const SOUND_IDS = Object.keys(SOUNDS);

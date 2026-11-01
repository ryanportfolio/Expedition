// Small Web Audio building blocks for the sound functions: envelopes, oscillators, seeded noise
// and filters. Frame-time only (they build audio nodes); nothing here runs in the sim.
//
// Every chain ends in an envelope gain that reaches 0 at its stated end and every source stops
// there, so a sound is silent after its duration however its filters ring.
import { createRng } from '../engine/rng.js';

const FLOOR = 0.0001; // exponential ramps cannot reach 0
const NOISE_SECONDS = 2;
const NOISE_SEED = 0x5eed;
const noiseCache = new WeakMap();

/** Gain node with attack (linear) -> optional hold -> exponential decay to silence at t0 + end. */
export function env(ctx, dest, t0, { attack, peak, end, hold = 0 }) {
  const g = ctx.createGain();
  const p = g.gain;
  p.setValueAtTime(0, Math.min(ctx.currentTime, t0)); // silent until t0 (the default value is 1)
  p.setValueAtTime(0, t0);
  p.linearRampToValueAtTime(peak, t0 + attack);
  if (hold > 0) p.setValueAtTime(peak, t0 + attack + hold);
  p.exponentialRampToValueAtTime(FLOOR, t0 + end);
  p.setValueAtTime(0, t0 + end);
  g.connect(dest);
  return g;
}

/** Gain node with a linear swell to `peak` at t0 + rise, then exponential decay to silence at t0 + end. */
export function swell(ctx, dest, t0, { from = FLOOR, rise, peak, end }) {
  const g = ctx.createGain();
  const p = g.gain;
  p.setValueAtTime(0, Math.min(ctx.currentTime, t0));
  p.setValueAtTime(from, t0);
  p.linearRampToValueAtTime(peak, t0 + rise);
  p.exponentialRampToValueAtTime(FLOOR, t0 + end);
  p.setValueAtTime(0, t0 + end);
  g.connect(dest);
  return g;
}

/** Oscillator running t0 .. t0 + end, connected to dest unless dest is null. `glide` = [[freq, atTime], ...] exponential pitch moves. */
export function osc(ctx, dest, t0, end, type, freq, glide = []) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  for (const [f, at] of glide) o.frequency.exponentialRampToValueAtTime(f, t0 + at);
  if (dest) o.connect(dest);
  o.start(t0);
  o.stop(t0 + end);
  return o;
}

/** Looping seeded noise source ('white' or 'brown') running t0 .. t0 + end, starting `offset` s in. */
export function noise(ctx, dest, t0, end, kind = 'white', offset = 0) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffers(ctx)[kind];
  s.loop = true;
  s.connect(dest);
  s.start(t0, offset % NOISE_SECONDS);
  s.stop(t0 + end);
  return s;
}

/** Biquad filter connected to dest. `sweep` = [[freq, atTime], ...] exponential moves. */
export function filter(ctx, dest, t0, type, freq, Q = 0.707, sweep = []) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t0);
  f.Q.setValueAtTime(Q, t0);
  for (const [v, at] of sweep) f.frequency.exponentialRampToValueAtTime(v, t0 + at);
  f.connect(dest);
  return f;
}

/** Plain gain node connected to dest. */
export function gain(ctx, dest, value) {
  const g = ctx.createGain();
  g.gain.value = value;
  g.connect(dest);
  return g;
}

/** Fixed-seed white and brown noise buffers, built once per audio context. */
export function noiseBuffers(ctx) {
  let b = noiseCache.get(ctx);
  if (b) return b;
  const n = Math.round(NOISE_SECONDS * ctx.sampleRate);
  const rng = createRng(NOISE_SEED);
  const white = ctx.createBuffer(1, n, ctx.sampleRate);
  const brown = ctx.createBuffer(1, n, ctx.sampleRate);
  const w = white.getChannelData(0), br = brown.getChannelData(0);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const v = rng.next() * 2 - 1;
    w[i] = v * 0.9;
    acc = (acc + 0.02 * v) / 1.02; // leaky integrator: -6 dB / octave
    br[i] = acc;
  }
  // remove the drift between the ends so the loop point does not click, then normalize
  const drift = br[n - 1] - br[0];
  let peak = 0;
  for (let i = 0; i < n; i++) {
    br[i] -= (drift * i) / (n - 1);
    peak = Math.max(peak, Math.abs(br[i]));
  }
  const k = peak > 0 ? 0.9 / peak : 0;
  for (let i = 0; i < n; i++) br[i] *= k;
  b = { white, brown };
  noiseCache.set(ctx, b);
  return b;
}

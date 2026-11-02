// Pure alignment and belief math, shared by the alignment system and scripts/check-alignment.mjs.
// No game object, no DOM, no randomness.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** A number read from shared state: finite values clamped to [lo, hi], anything else -> fallback. */
export function readNumber(v, lo, hi, fallback = 0) {
  return Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
}

/** An act's weight, or null when it is not a finite number. Clamped to the spec range [-1, 1]. */
export function actWeight(payload) {
  const w = payload?.weight;
  return typeof w === 'number' && Number.isFinite(w) ? clamp(w, -1, 1) : null;
}

/** The running sum held within the clamp plus `headroom` (negative or NaN headroom counts as 0). */
export function bankSum(sum, headroom = 0) {
  const cap = 1 + (headroom > 0 ? headroom : 0);
  return clamp(sum, -cap, cap);
}

/**
 * The running sum (in alignment units) after one act: sum + weight * scale, held within
 * +-(1 + headroom). Alignment is this sum clamped to [-1, 1]. With headroom 0 the sum saturates at
 * the clamp, so after a long run of good acts the first evil act lowers alignment at once instead
 * of paying off a hidden surplus first; with headroom Infinity it is a plain unbounded sum.
 */
export function addAct(sum, weight, scale, headroom = 0) {
  return bankSum(sum + weight * scale, headroom);
}

/** Exponential drift toward 0 of the alignment or the banked sum: the magnitude halves every
 * `halfLife` seconds; the sign never flips. */
export function drift(alignment, dt, halfLife) {
  if (!(halfLife > 0) || !Number.isFinite(halfLife)) return alignment;
  const a = alignment * Math.pow(0.5, dt / halfLife);
  return Math.abs(a) < 1e-6 ? 0 : a;
}

/** One move of the displayed LUT step toward the target step: at most one step. */
export function stepToward(display, target) {
  return display === target ? display : display + Math.sign(target - display);
}

/** True when (x, y) lies inside the ring (on the edge counts). */
export function insideRing(ring, x, y) {
  if (!ring || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  const dx = x - ring.x, dy = y - ring.y;
  return dx * dx + dy * dy <= ring.r * ring.r;
}

/**
 * Belief after `dt` seconds with no act: unchanged during the grace period, then linear toward 0.
 * Returns the new value; `idle` is the time since the last act that added belief, before this tick.
 */
export function decayBelief(belief, dt, idle, { beliefGrace, beliefDecay }) {
  if (belief <= 0) return 0;
  const fading = Math.min(dt, Math.max(0, idle + dt - beliefGrace));
  return fading > 0 ? Math.max(0, belief - beliefDecay * fading) : belief;
}

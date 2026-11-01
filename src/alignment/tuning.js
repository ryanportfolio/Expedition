// Alignment and rival-influence tuning. Every number a designer may want to change lives here.
// Distances in tiles, times in seconds of sim time. The alignment system copies this object when it
// is created (game.systems.alignment.tuning), so tests and debug panels can change one game's
// numbers without touching another's.

export const TUNING = {
  // ---- player alignment (game.state.alignment, -1 evil .. +1 good)
  /** Alignment moved per unit of act weight: alignment = clamp(sum of weights * scale, -1, 1).
   * At 0.15, about 7 full-weight acts (17 heals, 22 rains, 11 villager kills) swing it end to end. */
  scale: 0.15,
  /** How far past +-1 (in alignment units) the running sum may bank before it is clamped.
   * 0 = the sum saturates at the clamp, so the first evil act after a long good streak shows at
   * once; Infinity = a plain, unbounded running sum (every good act must be paid off first);
   * in between = a capped surplus. Drift shrinks the banked sum too. */
  headroom: 0,
  /** Drift toward 0 when the player stops acting: exponential, alignment halves every this many
   * seconds (1.0 -> 0.71 after 2 minutes, -> 0.5 after 4, -> 0.18 after 10). Slow on purpose: the
   * world's look should answer to the last several minutes of play, not the last few acts. */
  driftHalfLife: 240,

  // ---- displayed LUT
  /** The displayed alignment moves one LUT step (0.125) at most this often, and at most one step per
   * rendered frame, so a swing from -1 to +1 takes 16 steps (4 s) instead of one flicker. */
  lutStepTime: 0.25,

  // ---- rival influence ring and belief (game.state.belief, 0 .. 1)
  /** Ring radius around the rival village center (sites.rival tile center). The rival plateau is 7. */
  ringRadius: 10,
  /** Belief added per unit of |weight| for an act inside the ring: 10 full-weight acts fill it
   * (25 heals, 17 lightning strikes). Good acts impress, evil acts scare; both count. */
  beliefGain: 0.1,
  /** Belief starts to fade this long after the last act that added to it. */
  beliefGrace: 5,
  /** Belief lost per second once fading: a full meter empties in 500 s (about 8 minutes). */
  beliefDecay: 0.002,
  /** After the conversion, how often stray rival-owned villagers and buildings are claimed too. */
  sweepInterval: 1,
};

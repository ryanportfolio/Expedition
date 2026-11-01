// Audio tuning. Pure data: the queue (sim side) and the player (frame side) both read it, and
// scripts/check-audio.mjs checks against it.
//
// Per sound: minInterval (s of sim time between two accepted plays of that sound), maxVoices
// (plays of that sound still sounding at once). Requests over either limit are dropped, loudest
// kept first when several arrive in one tick.

export const LIMITS = {
  grab: { minInterval: 0.15, maxVoices: 2 },
  release: { minInterval: 0.1, maxVoices: 3 },
  landed: { minInterval: 0.08, maxVoices: 4 },
  splash: { minInterval: 0.1, maxVoices: 3 },
  stroke: { minInterval: 0.25, maxVoices: 2 },
  slap: { minInterval: 0.12, maxVoices: 2 },
  'miracle-rain': { minInterval: 0.3, maxVoices: 2 },
  'miracle-fire': { minInterval: 0.3, maxVoices: 2 },
  'miracle-heal': { minInterval: 0.3, maxVoices: 2 },
  'miracle-lightning': { minInterval: 0.25, maxVoices: 3 },
  'building-placed': { minInterval: 0.1, maxVoices: 3 },
  'building-complete': { minInterval: 0.2, maxVoices: 2 },
  'villager-died': { minInterval: 0.15, maxVoices: 3 },
  'village-converted': { minInterval: 1.0, maxVoices: 1 },
};

export const AUDIO = {
  /** Voices of all sounds sounding at once. */
  maxVoicesTotal: 12,
  /** Requests waiting for the next frame; oldest dropped past this. */
  maxQueue: 32,
  /** Requests kept in `history` for tests and debugging. */
  maxHistory: 256,
  /** Requests older than this (s of sim time) when a frame finally plays them are dropped. */
  staleAfter: 0.25,
  /**
   * Distance attenuation. r = how far the sound is from the view center, in half-view sizes
   * (box metric: r <= 1 is on screen). Full volume up to `inner`, linear fade to 0 at `outer`;
   * a request whose final gain falls under `minGain` is skipped.
   */
  inner: 1.0,
  outer: 2.5,
  minGain: 0.04,
  /** Stereo pan at the view edge (r = 1 horizontally); clamped beyond. */
  panWidth: 0.5,
  /** Speeds (tiles / s) that map to intensity 1 for release whooshes and landing thuds. */
  fullSpeed: 12,
  /** Master volume before the limiter. */
  master: 0.7,
};

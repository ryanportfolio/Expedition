// Fixed-step sim clock. advance(realDt, tick) runs tick(STEP) as many whole steps as the accumulated
// time allows, at most maxSteps per call; time beyond that is dropped so a stalled tab does not spiral.
export const STEP = 1 / 30;

export function createClock({ step = STEP, maxSteps = 5 } = {}) {
  let acc = 0;
  const clock = {
    step,
    maxSteps,
    ticks: 0,
    /** Sim time in seconds (ticks * step). */
    get time() { return clock.ticks * step; },
    /** Fraction of a step left in the accumulator, for optional render interpolation. */
    get alpha() { return acc / step; },
    advance(realDt, tick) {
      acc += Math.max(0, realDt);
      let n = 0;
      while (acc >= step - 1e-9 && n < maxSteps) {
        acc -= step;
        clock.ticks++;
        n++;
        tick(step);
      }
      if (n === maxSteps && acc >= step) acc = 0;
      return n;
    },
    /** Run exactly n ticks (scenarios). */
    run(n, tick) {
      for (let i = 0; i < n; i++) { clock.ticks++; tick(step); }
      return n;
    },
  };
  return clock;
}

# Pitfalls

> Accumulated project-specific gotchas. Dated entries, newest at the bottom. If this file exceeds ~200 lines, split by area (`pitfalls-<area>.md`) and update the CLAUDE.md index.

## Synthetic pointer: release under 100 ms after a move = throw (2026-11-02)

`input.synth` tests (`scripts/check-hand.mjs`, `src/dev/scenarios/*.js`): `s.up(0)` less than 100 ms (3 ticks) after the last `s.move(...)` → hand reads a throw, not a drop. Release speed = pointer velocity over last 100 ms (`VELOCITY_WINDOW_MS`, `sample()` in `src/engine/input.js`; pointer resampled every tick). Move of more than ~7 px across (~3.4 px down) inside the window → speed past `throwMin` (`releaseVelocity()`, `src/hand/tunables.js`) → `thrown`: no store/blueprint put (`releaseOne()` skips `handPut` on throws), held group flies instead of stowing.

`moveTo()` in check-hand already steps one tick, so `moveTo(q); s.up(0)` still throws. For a drop, step ~0.2 s after last move: `moveTo(q); step(0.2); s.up(0)`. Cost several retries in the bulk-hand work.

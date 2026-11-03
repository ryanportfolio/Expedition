# Pitfalls

> Accumulated project-specific gotchas. Dated entries, newest at the bottom. If this file exceeds ~200 lines, split by area (`pitfalls-<area>.md`) and update the CLAUDE.md index.

## Synthetic pointer: release under 100 ms after a move = throw (2026-11-02)

`input.synth` tests (`scripts/check-hand.mjs`, `src/dev/scenarios/*.js`): `s.up(0)` less than 100 ms (3 ticks) after the last `s.move(...)` → hand reads a throw, not a drop. Release speed = pointer velocity over last 100 ms (`VELOCITY_WINDOW_MS`, `sample()` in `src/engine/input.js`; pointer resampled every tick). Move of more than ~7 px across (~3.4 px down) inside the window → speed past `throwMin` (`releaseVelocity()`, `src/hand/tunables.js`) → `thrown`: no store/blueprint put (`releaseOne()` skips `handPut` on throws), held group flies instead of stowing.

`moveTo()` in check-hand already steps one tick, so `moveTo(q); s.up(0)` still throws. For a drop, step ~0.2 s after last move: `moveTo(q); step(0.2); s.up(0)`. Cost several retries in the bulk-hand work.

## `systems.village.validate` takes no options (2026-11-02)

`game.systems.village.validate(kind, tx, ty, owner)` (`src/systems/village.js`) drops a 5th argument. `{ setup: true }`, `{ margin }`, `{ auto }` reach only `game.systems.village.sim.validate(...)`. A check passing `{ setup: true }` to the system's validate still gets the influence rule, so "out of range" hides the reason under test. On the 64 x 64 map a rock happened to sit inside the temple influence and check-village's live-rocks test passed by luck; on 192 x 192 none did. Use `vs.sim.validate` when options matter.

## Checks and scenarios that name island tiles (2026-11-02)

Island coordinates written as numbers (`20.5, 40.5`, "the sea is 5 tiles west") broke when the island grew to 192 x 192 (`SCALE` in `src/world/island.js`). Write spots as offsets from `world.sites.*`, and find the sea, a shore or a clearing by searching the map (see the shore search in `scripts/check-hand.mjs`), never by distance from the village. Cost: 7 browser scenarios and 4 node checks to fix in step 2.

# Pitfalls

> Accumulated project-specific gotchas. Dated entries, newest at the bottom. If this file exceeds ~200 lines, split by area (`pitfalls-<area>.md`) and update the CLAUDE.md index.

## Synthetic pointer: release under 100 ms after a move = throw (2026-11-02)

`input.synth` tests (`scripts/check-hand.mjs`, `src/dev/scenarios/*.js`): `s.up(0)` less than 100 ms (3 ticks) after the last `s.move(...)` → hand reads a throw, not a drop. Release speed = pointer velocity over last 100 ms (`VELOCITY_WINDOW_MS`, `sample()` in `src/engine/input.js`; pointer resampled every tick). Move of more than ~7 px across (~3.4 px down) inside the window → speed past `throwMin` (`releaseVelocity()`, `src/hand/tunables.js`) → `thrown`: no store/blueprint put (`releaseOne()` skips `handPut` on throws), held group flies instead of stowing.

`moveTo()` in check-hand already steps one tick, so `moveTo(q); s.up(0)` still throws. For a drop, step ~0.2 s after last move: `moveTo(q); step(0.2); s.up(0)`. Cost several retries in the bulk-hand work.

## `systems.village.validate` takes no options (2026-11-02)

`game.systems.village.validate(kind, tx, ty, owner)` (`src/systems/village.js`) drops a 5th argument. `{ setup: true }`, `{ margin }`, `{ auto }` reach only `game.systems.village.sim.validate(...)`. A check passing `{ setup: true }` to the system's validate still gets the influence rule, so "out of range" hides the reason under test. On the 64 x 64 map a rock happened to sit inside the temple influence and check-village's live-rocks test passed by luck; on 192 x 192 none did. Use `vs.sim.validate` when options matter.

## Checks and scenarios that name island tiles (2026-11-02)

Island coordinates written as numbers (`20.5, 40.5`, "the sea is 5 tiles west") broke when the island grew to 192 x 192 (`SCALE` in `src/world/island.js`). Write spots as offsets from `world.sites.*`, and find the sea, a shore or a clearing by searching the map (see the shore search in `scripts/check-hand.mjs`), never by distance from the village. Cost: 7 browser scenarios and 4 node checks to fix in step 2.

## Village layout or random-draw changes move fixed-seed checks (2026-11-02)

Any change to the start layout (`START_LAYOUT`), building kinds or what draws from `game.rng` (step 3: one store, the mine, forest spread) shifts every seeded run. Checks with one-seed thresholds then fail on dice, not on a regression: `check-creature` training counts, the `check-village` recovery sweep, `check-hand` exact store deltas (a forester or builder delivers in the same window), `check-miracles` fire on the village centre. Before changing a check, compare against `origin/main` over several seeds (reference worktree under `C:\Users\Home\CoreWise\_wt\Expedition\`, `node_modules` junctioned). Fix by isolating the test (freeze villagers with `wait`, keep a store stocked) or by aggregating over the seeds the file already uses, and say so in the handover. Cost several reruns in step 3.

## A hand-emitted `release` without `thrown` is a slow drop: permanent job (2026-11-03)

Since step 4 a villager `release` sets its job for good unless the payload says `thrown: true` or `shaken: true` (or `by: 'creature'`); landing re-runs `dropAssign` the same way. A check or scenario that emits `release` itself and moves the villager far (the check-village chaos flights, 7 tiles in 0.3-2 s) must pass `thrown`, else every flight locks a job where it lands (forester by any tree, farmer by a field) and the economy weakens: on the first version of step 4 the recovery sweep failed on seed 1008 (1 re-placed building standing, `origin/main`: 8); on the merged version it passes but chaos ends with fewer villagers (pop 20 against 34). Chaos now sets `thrown` from flight speed against `HAND.throwMin`, as the hand does. Cost one full check-village rerun and a baseline run on `origin/main`.

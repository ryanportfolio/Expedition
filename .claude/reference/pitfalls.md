# Pitfalls

> Accumulated project-specific gotchas. Dated entries, newest at the bottom. If this file exceeds ~200 lines, split by area (`pitfalls-<area>.md`) and update the CLAUDE.md index.

## Synthetic pointer: move then release same tick = throw (2026-11-02)

`input.synth` tests (`scripts/check-hand.mjs`, `src/dev/scenarios/*.js`): `s.move(...)` then `s.up(0)` in same tick → hand reads a throw, not a drop. Release speed = pointer velocity over last 100 ms (`src/hand/tunables.js`, release block); fresh move → speed above `throwMin` → `thrown`, so store/blueprint drop never happens (`releaseOne()` skips `handPut` on throws) and a held group flies instead of stowing.

Fix: step ~0.2 s after last move before `s.up` when test wants a drop (`moveTo(q); step(0.2); s.up(0)`). Cost several retries in PR #4 (bulk hand).

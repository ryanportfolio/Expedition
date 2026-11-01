# Commands

> Build / dev / test / deploy commands for this project.

Run everything from the repo root. Node 24.

| Command | What it does |
|---|---|
| `npm ci` | Install from the lockfile. In a worktree whose `node_modules` links to the main checkout, never run it (or `npm install`): it writes into the shared install. |
| `npm run dev` | Vite dev server. The game opens on the title screen. |
| `npm run build` | Static build into `dist/` (`vite build`, relative base `./`). |
| `npm run preview` | Serve `dist/` locally (`vite preview`). |
| `npm run check` | `scripts/run-checks.mjs`: every `scripts/check-*.mjs` in name order, one at a time, then a PASS/FAIL summary. Exit 1 if any fails. New checks are picked up by file name. |
| `npm run check:browser` | `scripts/run-browser-checks.mjs`: every `src/dev/scenarios/*.js` through `scripts/browser-check.mjs`, one at a time, then a summary. `-- --only a,b` runs just those. Exit 1 if any fails, 2 on a bad argument. |
| `npm run check:ip` | `scripts/check-ip.mjs`: name gate for the spec's banned names. Case-sensitive whole words over the whole repo (minus `node_modules`, `.tmp`, `.git`, `dist`), case-insensitive over `src`, `scripts`, `docs`, `index.html`, `README.md`. Prints `path:line`, exit 1 on any hit. `--extra <path>` adds a file or folder (used to prove it fails on a planted file under `.tmp/`). |

Single checks:

- `node scripts/check-<area>.mjs`: one node check (engine, art, island, brain, terrain, village, creature, hand, miracles, alignment, ui, audio, ip).
- `node scripts/browser-check.mjs --scenario <name> [--out <dir>] [--window WxH] [--seed n] [--timeout s]`: one scenario in headed Chrome, off screen and muted. Screenshots and `result.json` go to `D:/screenshots/Expedition/<folder name>/<scenario>/`. Builds into `.tmp/browser-check/<pid>/`, serves on a free port, closes Chrome and the server itself.
- `?scenario=<name>&seed=<n>` on the dev server URL runs a scenario by hand. `play` drives the full loop: title, setup, miracle, stroke, conversion, win.

CI (`.github/workflows/ci.yml`, job `ci`) runs `npm ci`, `npm run build`, `npm run check` and `npm run check:ip` on Node 24. Browser checks stay local: they need headed Chrome on a real GPU.

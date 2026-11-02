# Tech stack

> Non-default library choices and WHY they were made, so future sessions don't "fix" deliberate picks.

- Plain JavaScript ES modules. No TypeScript, no framework, no game engine: the game draws palette-index sprites into one `Uint32Array` and puts it on a canvas with `putImageData`, so nothing else is needed.
- Vite 8 for the dev server and the static build. `vite.config.js` sets `cacheDir: '.tmp/vite-cache'` because `node_modules` may be a link shared between worktrees and nothing may write into it.
- `pixelfx` (patch-gg, MIT) is the only runtime dependency. It draws effects such as fire, rain, splashes and magic. Pinned to commit `a84159688af3ca37a4be05a0d422b94451b2e24e` with an https git URL in `package.json`, so machines and CI without GitHub SSH keys can install it. npm rewrites the lockfile's `resolved` for GitHub git dependencies to `git+ssh://` on every `npm install`; `npm ci` still installs over https when SSH fails (tested with SSH disabled), so a flip back to `git+ssh` in the lockfile is harmless.
- `playwright-core` (dev, exact latest) only drives the installed Chrome for browser checks through `scripts/lib/launch-chrome.mjs`. No bundled browser download. Dependabot keeps it current (`.github/dependabot.yml`) and `.github/workflows/dependabot-playwright-automerge.yml` merges those PRs once CI passes.
- No other dependencies without a user decision (spec).
- Sound is synthesized with WebAudio at run time; there are no audio files. All art except the divine hand is drawn in code by painter functions. The hand's six pose sprites are baked by `scripts/bake-hand.mjs` from the six PNGs in `art-src/hand/` (panels of concept 12, which the user chose as the hand's art source) into palette-index rows in `src/art/painters/hand-data.js`. Those PNGs are the repo's only image files, and the game never loads them: it ships no image files.

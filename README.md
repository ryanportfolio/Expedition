# Expedition

Expedition is a god game for the browser, drawn as isometric pixel art on one island. You reach down with a divine hand to move villagers, trees and rocks, cast miracles paid for by your followers' worship, train a stone giant with strokes and slaps, and win by converting the rival village.

## Run it

You need Node 24 and npm.

```bash
npm ci
npm run dev
```

Open the address Vite prints. The game starts on the title screen; click or press Enter to play.

`npm run build` writes a static build to `dist/`, and `npm run preview` serves that build locally.

## Controls

- Drag with the left button to grab something and carry it. Let go while the mouse is still to drop it, or while it is moving to throw it.
- Move back and forth over the creature with the left button held to stroke it.
- Right-click the creature to slap it.
- Click the creature, then right-click the ground to send it there. Esc cancels the selection.
- Take a miracle orb (rain, fire, heal or lightning) from its pedestal at your temple and drop or throw it to cast that miracle. Each cast costs worship power.
- Press a number key from 1 to 4, or click an icon on the build bar, to pick a building, then click the ground to place it. Right-click or Esc cancels.
- Scroll the mouse wheel to zoom. Pan with WASD, the arrow keys, the middle button or by moving the mouse to the edge of the window.
- Press M to mute or unmute the sound.
- Press the backquote key (`) to show or hide the debug panel with the creature's needs and what it has learned. Page Up and Page Down scroll it.

## Check it

```bash
npm run check
```

Runs every node check in `scripts/check-*.mjs`, one after another, and prints a pass or fail line for each. It exits with an error if any check fails.

```bash
npm run check:browser
```

Runs every scenario in `src/dev/scenarios/` in a real Chrome window, one at a time. The window opens off screen and muted. Screenshots and a `result.json` for each scenario go to `D:/screenshots/Expedition/<folder name>/<scenario>/`. Add `-- --only smoke,play` to run some of them. These checks need a desktop with a GPU, so CI does not run them.

```bash
npm run check:ip
```

Fails if a name from another company's game appears in the name or text of a file in the repository. It scans every text file, including UTF-16 files with a byte order mark, and skips binary files, symlinks, and the `.git`, `.tmp`, `dist`, `build`, `node_modules`, `.playwright-mcp` and `.claude/worktrees` folders. Game content (`src`, `scripts`, `docs`, `index.html`, this README) is also checked without regard to case. The banned names are listed in `scripts/check-ip.mjs`.

## Credits

Effects such as fire, rain and magic use [pixelfx](https://github.com/patch-gg/pixelfx) by patch-gg, under the MIT license.

# Engine architecture

Expedition is a browser god game drawn as isometric pixel art. This page covers the engine layer: the game object, the sim loop, the renderer and the test tooling. Game systems (terrain, village, creature and so on) plug into it; "Game systems" below lists them, and each module's header comment documents it.

The engine is plain JavaScript ES modules with no framework. Vite serves and builds it. The only runtime dependency is `pixelfx`, which draws effects such as fire and magic.

## Module map

| Path | What it does |
|---|---|
| `index.html` | Full-window canvas with `image-rendering: pixelated`, no margins, no scrollbars. |
| `src/main.js` | Browser boot. Creates the game on the canvas, sizes it to the window, wires DOM input, then runs a scenario when the URL has `?scenario=`, or else opens on the title screen and starts the real-time loop. The first `game-start` (a click or Enter on the title) sets up the village, then the creature. |
| `src/game.js` | `createGame({ seed, canvas })` builds the game object and creates the systems in their fixed order. Works in node without a canvas. |
| `src/engine/clock.js` | Fixed-step clock: 1/30 s per tick, at most 5 catch-up ticks per frame. |
| `src/engine/rng.js` | Seeded mulberry32: `next()`, `range(a, b)`, `int(n)`, `pick(list)`. |
| `src/engine/events.js` | Event bus: `on(type, fn)` (returns an unsubscribe function), `off`, `emit`. |
| `src/engine/input.js` | Pointer, buttons, drag, velocity, wheel and keys, fed by DOM listeners or by the synthetic API. |
| `src/engine/display.js` | Pixel scale and view size math, and presenting the view buffer on the canvas. |
| `src/engine/camera.js` | Pan (keys, edge, middle drag), wheel zoom about the pointer, clamping to the map. |
| `src/world/iso.js` | Projection, inverse, depth order and height-aware picking. |
| `src/world/world.js` | Tile grid, bilinear `heightAt`, entity store with a spatial grid, `loadMap`. |
| `src/render/blit.js` | Sprite blit in the shared sprite format. |
| `src/render/buffer.js` | View buffer: a `Uint32Array` that shares memory with an `ImageData`. |
| `src/render/drawlist.js` | Per-frame list of world items, sorted by depth before drawing. |
| `src/render/fx.js` | World-anchored pixelfx layer. |
| `src/render/renderer.js` | Frame order: clear, terrain passes, systems, entities, effects, overlays, present. |
| `src/systems/*.js` | One module per system; see "Game systems". |
| `src/dev/` | `window.__game`, the scenario runner, engine test art and scenarios. |
| `scripts/` | Node checks and the browser check harness. |

## The game object

`createGame` returns one object that every system receives:

| Field | Contents |
|---|---|
| `world` | Map grid and entities (`src/world/world.js`). |
| `events` | Event bus. |
| `rng` | Seeded random source. Sim code uses this and never `Math.random`. |
| `clock` | Fixed-step clock: `step`, `ticks`, `time`, `advance(realDt, tick)`, `run(n, tick)`. |
| `input` | Input state and the synthetic API `input.synth`. |
| `camera` | Camera position in world pixels and its controls. |
| `display` | Scale, view size, canvas presentation. |
| `renderer` | `render()`, `addTerrainPass(fn)`, the current `lut`, the draw list and the view buffer. |
| `fx` | Effect layer: `spawn`, `update`, `clear`, `live`. |
| `systems` | Systems by name, created in `systemOrder`. |
| `debug` | Free-form object for debug toggles and panels. |
| `scenario` | State of the running scenario, or `null`. |

`game.tick(dt)` runs one sim step: camera, input refresh, each system's `update(dt)` in order, then effects. `game.frame(realDt)` runs the due ticks and renders once. `game.start()` and `game.stop()` control the real-time loop.

## Coordinates

World positions are in tiles: `x` and `y` on the island's 192 x 192 grid, `z` in height units. The island's shapes were laid out on a 64 x 64 grid and are drawn `SCALE` (3) times larger (`src/world/island.js`); temples, village plateaus and the woods the villagers cut keep their tile distances from their village. `worldToScreen(x, y, z)` returns world pixels: `sx = (x - y) * 16`, `sy = (x + y) * 8 - z * 8`. The camera position is the world pixel at the top-left of the view, so a view pixel is the world pixel minus the camera position.

`pickTile(screenX, screenY, heightAt, { w, h })` finds the terrain point under a world pixel. It walks the view ray from high to low and returns the first point at or under the surface, which is the front-most hit, then bisects to refine the height. The result is `{ x, y, z, tx, ty }` or `null` off the map. The pointer's world position goes through this pick on every move and every tick.

Tile heights are sampled at tile centers. `world.heightAt(x, y)` blends the four nearest centers, so a point between a low and a high tile gets a height in between.

## Display

One game pixel is 3 x 3 device pixels at zoom 1. The view is `floor(device px / scale)` game pixels in each direction, so a 1920 x 1080 window at a pixel ratio of 1 gives a 640 x 360 view. The canvas buffer holds exactly the view, and CSS stretches it to `view * scale` device pixels with `image-rendering: pixelated`. The strip under one game pixel wide that is left at the right and bottom edges shows the page background, which matches the clear color.

The mouse wheel steps the scale through 2, 3, 4 and 6 device pixels per game pixel, keeping the world point under the pointer in place. There is no rotation.

## Systems

Each `src/systems/<name>.js` exports `create(game)` and returns `{ update(dt), draw(ctx) }`. Systems run in this fixed order for both update and draw: terrain, village, creature, hand, miracles, alignment, ui, audio.

`update` runs on sim ticks and must not touch the DOM, the canvas or `window`, because node checks import and run it. `draw(ctx)` runs once per rendered frame with the draw context below.

## Game systems

Each system keeps its internals in a folder of the same name under `src/` (`src/village/`, `src/hand/` and so on); the module in `src/systems/` is its entry point.

| Module | Job |
|---|---|
| `terrain.js` | Loads the island when the world has no map, draws land, water and cliffs from a cached buffer kept in 128 px chunks that are painted the first time the view reaches them, and spawns the map's rocks. |
| `village.js` | Both villages: villagers, jobs, hauling, building from blueprints, fields and worship power in `game.state.power`. Inert until `setup()`. |
| `creature.js` | The giant: senses the world, lets its brain (`src/creature/brain.js`) pick an action, walks there and acts; learns from strokes and slaps; follows tethers. Inert until `setup()`. |
| `hand.js` | The player's hand: grab, carry, drop and throw with arcs and shadows, stroke, slap and tether the creature. |
| `miracles.js` | Orbs on the temple pedestals; rain, fire, heal and lightning cast when an orb is dropped or thrown, paid from worship power. |
| `alignment.js` | Good or evil alignment from the player's acts, the palette LUT that follows it, and the rival village's belief meter that converts it and wins the game. |
| `ui.js` | Title screen, HUD, build bar, thought bubble, debug panel and win banner, all drawn into the pixel buffer. |
| `audio.js` | Synthesized WebAudio sound effects for game events; M mutes. |

Browser boot: `src/main.js` opens on the title. The UI emits `game-start` once when play begins, and main.js then calls `village.setup()` and `creature.setup()`, in that order. Scenarios set up their own worlds; the `play` scenario runs this same bootstrap through `game.debug.installPlayBootstrap`.


## Rendering

Each frame the renderer:

1. Clears the view buffer to the background color.
2. Runs terrain passes in registration order (`renderer.addTerrainPass(fn)` returns an unregister function).
3. Calls each system's `draw(ctx)` in system order. Systems push world items into `ctx.list` or register screen overlays with `ctx.overlay(fn)`.
4. Adds every world entity whose `sprite` overlaps the view to the draw list (`spriteInView`). Entities off screen are skipped before sorting; on the island most of them are.
5. Composites the back layer of every effect.
6. Sorts the draw list by `x + y`, then `z`, then `id`, and draws it back to front.
7. Composites the front layer of every effect.
8. Runs overlays, then puts the view buffer on the canvas.

The draw context `ctx` holds `buf`, `w`, `h` (the view buffer and its size), `camX`, `camY`, `lut`, `world`, `list`, `game`, and three helpers: `ctx.blit(sprite, vx, vy, flipX, lut)`, `ctx.toView(x, y, z)` which returns view pixels, and `ctx.overlay(fn)`.

A draw list item is `{ x, y, z, id, sprite, flipX, lut }`; the sprite's anchor lands on the projected point. An item with a `draw(ctx, vx, vy)` function paints itself instead.

### Sprites and blit

A sprite is `{ w, h, ax, ay, data }`, where `data` is a `Uint8Array` of palette indices and 0 is transparent. `blit(dst, dw, dh, sprite, x, y, lut, flipX)` puts the anchor pixel `(ax, ay)` at `(x, y)` in `dst`, skips index 0, maps every other index through the LUT (a `Uint32Array(256)` of `0xAABBGGRR` colors) and clips to the buffer. `flipX` mirrors the sprite about its anchor column, so the anchor stays on the same pixel.

### Effects layer

`game.fx.spawn(fxModule, { x, y, z, ...options })` starts a pixelfx effect anchored at a world point and returns a handle with `move(x, y, z)`, `stop()` (loops fade out) and `done()`. Any other option is passed to pixelfx, for example `palette`, `seed` or the effect's own options. Effects advance only on sim ticks, through `game.fx.update(dt)` inside `game.tick`, and finished effects are dropped.

Drawing: pixelfx paints an effect into a frame with two buffers, `color` (pixels, possibly translucent) and `light` (additive glow), with the frame's top-left at a chosen origin. The layer uses one frame the size of the view whose origin is the camera position, and places each effect's origin at the projected world point. pixelfx's own `composite(frame, out, background)` blends color over the background by alpha and adds light on top; it never discards the background. The layer passes the view buffer as the background and its own bytes as the output, so effects composite in place over the world. A separate compositor was not needed.

pixelfx splits each effect into a back part (behind a character) and a front part. The renderer composites the back part before the sorted sprites and the front part after them. All effects share these two layers; an effect is not sorted between individual sprites.

## Input

The input module keeps the pointer position in view pixels (`pointer.sx`, `pointer.sy`), the world point under it (`pointer.x`, `y`, `z`, and `hit`), the button mask (`buttons`: 1 left, 2 right, 4 middle), the drag in progress, and velocity over the last 100 ms in view pixels and in tiles per second. The wheel accumulates until the camera consumes it, and `keys` holds the `KeyboardEvent.code` values currently down.

It emits `pointer-down`, `pointer-up`, `drag-start` (after 3 view pixels of movement with a button held), `drag-end`, `wheel`, `key-down` and `key-up` on `game.events`. DOM listeners and the synthetic API `input.synth` (`move`, `down`, `up`, `wheel`, `keyDown`, `keyUp`, `leave`) call the same internal functions, so scenarios exercise the real code path.

## Scenarios

Opening the game with `?scenario=<name>&seed=<n>` pauses the real-time loop and runs `src/dev/scenarios/<name>.js`. The runner finds scenario files with `import.meta.glob`, so adding a scenario changes no shared file. A scenario exports a default async function that receives a helper `t` and the game:

```js
export default async function (t, game) {
  t.step(1);                  // advance 30 fixed ticks, then render
  t.input.move(10.5, 10.5, { world: true });
  t.assert(game.input.pointer.hit, 'pointer is over land');
  await t.shot('island');     // ask the harness for a screenshot
}
```

| Helper | What it does |
|---|---|
| `t.step(seconds)` | Runs `round(seconds * 30)` fixed ticks (at least one), then renders. Returns the tick count. |
| `t.shot(name)` | Renders, waits two animation frames, and asks the harness to save `<name>.png`. |
| `t.assert(cond, msg)` | Records a pass or failure. Any failure fails the run. |
| `t.log(...args)` | Adds a line to the result log. |
| `t.input.move(x, y, opts)` | Moves the pointer. View pixels by default; `{ world: true, z }` takes a world point. |
| `t.input.down(button)`, `up(button)` | Presses or releases a button (0 left, 1 middle, 2 right). |
| `t.input.wheel(dy)` | Wheel delta; negative zooms in. |
| `t.input.keyDown(code)`, `keyUp(code)`, `key(code, seconds)` | Keyboard, with `key` holding a key for that much sim time. |
| `t.input.drag(from, to, { button, seconds, world })` | Press, move one step per tick, release. |
| `t.input.toScreen(x, y, z)` | World point to view pixels. |

In scenario mode the input clock reads sim time, so pointer velocity is deterministic. Progress and results are kept on `window.__scenario` (`done`, `ok`, `asserts`, `logs`, `shots`, `error`, `view`). The live game is always available as `window.__game`.

`src/dev/test-art.js` holds the engine's own test material: a small LUT, a 9 x 14 marker sprite, a 16 x 16 test map in the island format, and a debug terrain pass that draws each tile as a flat diamond with side walls. The real palette, sprites, island and terrain come from their own modules.

## Checks

Run these from the repository root.

```bash
node scripts/check-engine.mjs
```

Node only, no browser. Checks the projection and its inverse, height-aware picking on the test map, depth order, blit (anchor, transparency, clipping, flipX, LUT), the random source against a reference mulberry32, clock step counts and the catch-up cap, the event bus, the world model and its spatial query against brute force, display size math for several window sizes and pixel ratios (including that the uncovered edge strip is under one game pixel at every zoom step), camera panning, zoom and clamping, drag events and velocity, that every system's `update` runs in node in the right order, and one full render of the test map with a sprite and an effect. Exits 1 and prints each failing check.

```bash
node scripts/browser-check.mjs --scenario smoke
```

Builds the game with Vite into `.tmp/browser-check/<pid>/`, serves it from node on a free port, launches headed Chrome through `launchPlacedChrome()` (off screen, muted), opens the scenario and waits for it to finish. Screenshots and `result.json` go to `D:/screenshots/Expedition/<folder name>/<scenario>/`; if the D: drive is missing, they go to `.tmp/screenshots/` and the script says so. Flags: `--out <dir>`, `--window <W>x<H>` (default 1920x1080, as the page size in CSS pixels at a pixel ratio of 1), `--seed <n>`, `--timeout <seconds>` (default 90). Each screenshot is decoded and checked: every game pixel must show as one solid block of scale x scale device pixels with the same color as the matching view buffer pixel (4 levels of slack per channel), and a frame with 8 or fewer colors counts as blank. The result goes into `result.json` under `pixelChecks`. It exits non-zero on a failed assert, a failed pixel check, a page error, a console error, a scenario that throws, or a timeout, and closes Chrome and the server every time.

The `smoke` scenario loads the test map, places four marker sprites (one mirrored) and a pixelfx campfire, checks the view size against the window and the uncovered edge strip, that every marker sprite pixel lands at its offset from the projected anchor, the projection round trip, picking on flat ground, on the plateau and behind it, a sweep of about 1,000 picks that must each be the front-most point on the surface, drag events and pointer velocity, wheel zoom about the pointer through all four steps (2, 3, 4, 6), key, middle-drag and edge panning (edge panning stops when the pointer moves to the middle or leaves the window), clamping, and saves `zoom1.png` and `zoom2.png`.

## Performance

The budget is a p95 frame time at or under 16.7 ms in the worst-case scene, measured headed on the real GPU in a 1920 x 1080 window at a pixel ratio of 1.

```bash
node scripts/perf-check.mjs
```

The check builds with Vite, serves the build from node and opens headed Chrome off screen and muted through `launchPlacedChrome()`. It first measures the display refresh rate from `requestAnimationFrame` in an empty page, then opens `?scenario=perf` (`src/dev/scenarios/perf.js`). After 5 s of warm-up it records 20 s of frames. The frame time is the gap between consecutive rAF timestamps. Inside the page, a profiler that wraps the game's own entry points splits each `game.frame` into sim ticks and render phases. Numbers go to stdout and to `D:/screenshots/Expedition/<folder>/perf/perf.json`, with a screenshot taken at the end of the window in `perf/perf-check/scene.png`. `--budget <ms>`, `--warmup <s>`, `--seconds <s>`, `--window <W>x<H>`, `--out <dir>` and `--scenario <name>` change the defaults.

The scene boots like play, then builds a town round each village through the village's own placement rules (`buildTown` in `src/dev/town.js`): 600 villagers in the player's and 120 in the rival's by default, with a house for every three villagers, a field per 15, a storehouse and a woodpile per 100. The player town is 200 houses, 40 fields, 6 storehouses and 6 woodpiles round the temple; every store holds enough that the woodpiles stay above the woodcutters' target and nobody goes hungry. A park with no buildings is kept round the densest wood near the camera, so the fires there stay out of reach of every house. The sim then settles for 30 s, and the camera frames the player temple, the town centre and the creature. `--town <n>` and `--rival <n>` change the town sizes (`?town=<n>&rival=<n>` on the URL). A tick hook keeps 40 house blueprints open in the player town, so about 80 builders keep hauling wood from the woodpiles, and keeps all four miracles alive, each re-cast for free on its own period:

- Fire, every 3.5 s, on trees in view near the view centre, never on a building. A cast lights everything within the fire radius as one blaze, and a blaze catches at most `spreadBudget` (2) more entities, each jump at most `spreadReach` (1.5 tiles) edge to edge. So the scene casts only where everything the ring would light is more than 3.25 tiles from every building footprint. Each cast aims at a ring that lights 3 to 5 trees, which keeps 7 to 17 fires burning through the window. A burning tree carries the same flame effect as a burning building.
- Rain, every 8 s, on the player building farthest from the first fire, so it does not put the fires out.
- Heal, every 2.5 s, on the village centre.
- Lightning, every 2.5 s, beside the village: the spot within 14 tiles of the village centre, nearest it, that keeps the bolt off buildings, lights no fire that could reach one, and stands at least 3.2 tiles from every villager where such a spot exists (else the spot farthest from them), so none can walk into the kill radius before the bolt lands.

The check exits 1 when p95 is over budget or when the scene is no longer the worst case at the end of the window: player houses standing must be at least the count at window start minus 1, player villagers at least 80% of the start count, and each of the four miracle effects alive on every sim tick of the last 2 s. Two edited copies of the scene confirmed that this check can fail: one that aimed fire at the houses after its first cast lost 2 of 4 houses during the window, and one with lightning cast every 9 s had no live strike on 60 ticks of the last 2 s. Both exited 1 while their p95 stayed at 10.1 to 10.2 ms.

Measured on this machine (100 Hz display, 2026-11-02), seed 1, three runs one after another, and one run with towns of 1,000 and 200. The scene is deterministic: every run cast rain 3 times, fire 6, heal 8 and lightning 8 in the window, kept every house, building and villager on every tick (a birth added one villager), and had all four effects alive on every tick.

| | Run A | Run B | Run C | 1,000 + 200 villagers |
|---|---|---|---|---|
| Entities at window end | 2,708 | 2,708 | 2,708 | 3,289 |
| Frame time median / p95 / p99 / max | 10.0 / 10.2 / 20.0 / 20.3 ms | 10.0 / 10.1 / 10.3 / 20.1 ms | 10.0 / 10.2 / 10.3 / 30.1 ms | 10.0 / 10.2 / 19.8 / 20.2 ms |
| Frames over 16.7 ms | 39 (1.99%) | 6 (0.30%) | 12 (0.60%) | 20 (1.01%) |
| `game.frame` work, median / p95 | 4.5 / 17.7 ms | 4.2 / 16.4 ms | 4.3 / 16.9 ms | 4.4 / 17.3 ms |
| Frames that ran a sim tick: work median / p95 / max | 15.2 / 20.2 / 26.9 ms | 14.2 / 17.9 / 28.4 ms | 14.5 / 18.6 / 33.0 ms | 14.6 / 19.0 / 25.1 ms |
| Effects composite on those frames, back + front (median) | 2.3 + 8.3 ms | 2.3 + 7.8 ms | 2.3 + 7.8 ms | 2.6 + 7.7 ms |

Everything else in a render costs about 3 ms at 600 villagers: sort and blit 1.6 (about 800 sprites in view), terrain 0.6, systems draw 0.3, overlays 0.3. Sim ticks take about 0.7 to 0.9 ms each. Rain falls on the player building in view farthest from the first fire; before that rule the farthest building of all was chosen, which in the town stands off screen, and the clouds were not drawn (work p95 was 15.2 ms then).

### Crowds (step 2)

Before step 2 the scene was the 64 x 64 island with 12 villagers. The same engine on the 192 x 192 island with the 600 + 120 towns measured p95 19.9 ms and failed the budget: `game.frame` work p95 19.8 ms, sort and blit 2.6 ms over all 2,685 entities, and sim ticks with spikes past 7 ms. Five changes, each measured on its own (`node scripts/sim-bench.mjs`, 640 x 360 view over the player town, numbers in ms):

| Change | Before | After |
|---|---|---|
| Draw list holds only sprites that overlap the view (`spriteInView`, `src/render/renderer.js`) | sort + blit 1.41 over 2,659 items | 0.62 over 792 |
| The village picks sprites only near the view and only when what they are picked by changes (`src/systems/village.js`) | village draw 1.08 | 0.29 |
| Village paths search only as far as the starts asked of them, and resume for the next (`src/village/path.js`) | 1.27 per tick on average, p95 6.82 | 0.30, p95 0.39 |
| Shared typed heap and per-map step masks for the creature's paths (`src/creature/path.js`) | 2.64 per field | 0.96 (tick max 7.7 to 3.8) |
| `world.query({ kind })` walks that kind alone (`src/world/world.js`) | 0.31 per tick on average, p95 0.43 | 0.21, p95 0.37 |

None of them changes what the sim does: 2,000 random path requests on the island give the same paths and distances as the old whole-map search, the creature's fields are identical, and a 120 s replay with 480 villagers ends in the same state with the old and the new code. The terrain cache, which took 0.6 s and 20 MB to build for the whole island at load, is now painted in 128 px chunks the first time the view reaches them, about 0.5 ms each, with each chunk byte for byte what the whole build holds (`scripts/check-terrain.mjs` compares all 1,200).

The effects layer (`src/render/fx.js`) was 11.5 of the 12.8 ms a frame took before it was optimized. Two changes, neither of which changes a pixel:

- **Frame cache.** Effects change only on sim ticks (30 per second) or when the camera moves, but the old layer cleared its view-sized frame and repainted every effect on every rendered frame, at 100 Hz. Each layer (back, front) now keeps its own frame and a signature of what was painted into it: camera, view size, and for each live effect its handle, time, anchor and option values. A render with the same signature composites the cached frame again without repainting. Options are compared by value, so `fire.js` setting `light` between ticks still repaints.
- **Composite.** `compositeOver()` computes the same bytes as pixelfx's `composite(frame, view.bytes, view.data)`, but it skips the pixels the frame leaves empty (no color, no light) instead of recomputing them, and it writes fully opaque effect pixels as one 32-bit store. Most of the view is empty.

Checked with a seeded random comparison (296,000 pixels, every alpha and light case, 0 differences) and a node replay of 400 frames with casts, camera pans and an option changed between ticks, rendered through the old and the new layer: the outputs differ only on the two frames where re-rendering after a cast differs in the old layer too. In the scene of that time (fire on houses first, which left every house a wreck about 10 s into the window), p95 went from 20.1 ms to 10.1 ms and the frames over 16.7 ms from 490 to 0.

The margin is on frames that also run a sim tick: those repaint every effect, and pixelfx painting is most of their 12 ms. Their p95 of 17.9 to 20.2 ms (19.0 ms with 1,000 villagers) is over a 60 Hz frame, and the effects are most of it. On this 100 Hz display, where a frame lasts 10 ms, the rAF callback that follows such a frame runs late; the check prints those callback gaps too (p95 about 21 to 22 ms here). The rAF timestamps still advance every 10 ms except on the 6 to 39 frames per run that show a 20 ms gap, so p95 holds. A slower CPU would cross 16.7 ms on these frames first.

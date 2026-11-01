# Hand sprite sources

The six PNGs here are the source art for the divine hand's poses: `open`, `grab`, `hold`, `point`, `stroke` and `slap`. Each one is a panel of concept 12, the project's own generated hand sheet (`12-hand-sheet.png` in the concept artifacts folder). The user chose to build the hand from these panels instead of drawing it in code.

The game never loads these files. `scripts/bake-hand.mjs` turns them into palette-index sprites in `src/art/painters/hand-data.js`, and `src/art/painters/hand.js` serves those sprites under the usual names (`hand-open`, `hand-grab` and so on).

## How the sources were made

`node scripts/bake-hand.mjs --import <path to 12-hand-sheet.png>` cuts the six panels out of the sheet (crop boxes in `CROPS`), reduces them to 0.6 of the sheet's size with area averaging, and flattens the near-black navy background to one colour so the files stay small (about 300 KB for all six). All six use the same reduction, so the hand is the same size in every panel. At 0.6 a source is about four times the size of the finished sprite.

The `hold` panel still shows the villager from the concept; the bake erases it (see `erase` in the `POSES` table).

## How to rebake

1. Change a rule or a per-pose entry (anchor, wrist line, erase box) in `scripts/bake-hand.mjs`. Never edit `hand-data.js` by hand: the next bake overwrites it.
2. Run `node scripts/bake-hand.mjs`. It prints each pose's size, anchor and body size, and fails without writing when a hand body falls outside 44-56 px on its longest side.
3. Look at the result: `node scripts/bake-hand.mjs --sheet <out.png>` writes a preview with each source panel, the sprite at 6x and at native size over grass, water and sand, the evil colours, and a 3x view over water.
4. Run `node scripts/bake-hand.mjs --check` (also run by `scripts/check-art.mjs`). It exits 1 when `hand-data.js` differs from a fresh bake, so a rule change without a rebake fails the checks.

The bake is deterministic: the same sources and rules give a byte-identical `hand-data.js`.

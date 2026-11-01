// Small-font glyph overrides. pixelfx's "mini" font is 3x5, and at that width three capitals lose
// their shape: its W is two stems joined by a two-row bar (it reads as H, so "AWE" reads "AHE"), its
// M differs from H by one pixel, and its N is a lowercase n. These replace them with wider capitals
// whose strokes a reader can tell apart at 1x:
//   W  5 wide, outer stems and a centre stroke rising from the bottom, feet meeting in points
//   M  5 wide, W upside down: the centre stroke hangs from the top between two diagonals
//   N  4 wide, two stems and a diagonal from top-left to bottom-right
// H (3 wide, full crossbar in the middle row) and V (3 wide, stems meeting in one point) read fine
// and stay pixelfx's. The UI's text helpers (src/ui/draw.js) read glyphs only through here; other
// fonts ("big") pass through unchanged. node_modules is never edited.
import { FONTS } from 'pixelfx';

const rows = (...lines) => lines.map((l) => Array.from(l, (c) => (c === '#' ? 1 : 0)));
const glyphOf = (...lines) => Object.freeze({ w: lines[0].length, rows: rows(...lines) });

export const MINI_OVERRIDES = Object.freeze({
  W: glyphOf(
    '#...#',
    '#...#',
    '#.#.#',
    '#.#.#',
    '.#.#.',
  ),
  M: glyphOf(
    '#...#',
    '##.##',
    '#.#.#',
    '#...#',
    '#...#',
  ),
  N: glyphOf(
    '#..#',
    '##.#',
    '#.##',
    '#..#',
    '#..#',
  ),
});

const OVERRIDES = { mini: MINI_OVERRIDES };

/** The font record ({ h, space, gap }) for a font name. */
export const fontOf = (font) => FONTS[font];

/** Glyph { w, rows } for character ch in font, after overrides; undefined when the font lacks it. */
export function glyphFor(font, ch) {
  const o = OVERRIDES[font], F = FONTS[font];
  return o?.[ch] ?? o?.[ch.toUpperCase()] ?? F.glyphs[ch] ?? F.glyphs[ch.toUpperCase()];
}

/** Width in font pixels of str (as given, not uppercased), the same sum pixelfx's textWidth uses. */
export function textWidthOf(str, font = 'mini') {
  const F = FONTS[font];
  let w = 0;
  for (const ch of String(str)) {
    const g = glyphFor(font, ch);
    w += (g ? g.w : F.space) + F.gap;
  }
  return Math.max(0, w - F.gap);
}

// Sprite kit: indexed-pixel drawing primitives for painter functions.
//
// Sprite = { w, h, ax, ay, data: Uint8Array(w*h) } (see the shared spec). data[i] = 0 is
// transparent, otherwise 1 + ramp * 8 + shade (palette.js `idx`). (ax, ay) is the anchor pixel
// that sits on the entity's projected world point.
//
// Conventions:
// - Drawing primitives mutate the sprite they get, clip silently to its bounds and return it,
//   so calls can chain. Coordinates are floored to whole pixels.
// - `outline`, `mirror`, `trim` and `clone` return new sprites and leave the input alone.
// - Area fills (polygon, isoDiamond, isoBox, ellipse) fill a pixel when its center lies inside
//   the shape. Shapes that share an edge therefore never overlap or leave a gap, and 2:1 iso
//   edges between integer vertices come out as clean 2-pixel stairs.
// - Light comes from the top-left: brightest on top and up-left surfaces, darkest down-right.
// - Pure ES module: no DOM or canvas, runs in node and the browser.

import { RAMP, RAMPS, SHADES } from './palette.js';

export function createSprite(w, h, ax = 0, ay = 0) {
  w = Math.max(0, Math.floor(w));
  h = Math.max(0, Math.floor(h));
  return { w, h, ax: Math.floor(ax), ay: Math.floor(ay), data: new Uint8Array(w * h) };
}

export function clone(s) {
  return { w: s.w, h: s.h, ax: s.ax, ay: s.ay, data: s.data.slice() };
}

/** Sets one pixel (c = 0 erases). Out-of-bounds writes are ignored. */
export function px(s, x, y, c) {
  x = Math.floor(x);
  y = Math.floor(y);
  if (x >= 0 && y >= 0 && x < s.w && y < s.h) s.data[y * s.w + x] = c;
  return s;
}

/** Pixel index at (x, y); 0 outside the sprite. */
export function get(s, x, y) {
  x = Math.floor(x);
  y = Math.floor(y);
  return x >= 0 && y >= 0 && x < s.w && y < s.h ? s.data[y * s.w + x] : 0;
}

/** Filled axis-aligned rectangle, top-left (x, y), size w x h. */
export function rect(s, x, y, w, h, c) {
  const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(s.w, Math.floor(x) + Math.floor(w)), y1 = Math.min(s.h, Math.floor(y) + Math.floor(h));
  for (let yy = y0; yy < y1; yy++) s.data.fill(c, yy * s.w + x0, yy * s.w + Math.max(x0, x1));
  return s;
}

/** 1 px Bresenham line, both endpoints included. */
export function line(s, x0, y0, x1, y1, c) {
  x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.floor(x1); y1 = Math.floor(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    px(s, x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return s;
}

// Inside test for pixel-art ellipses. The 0.4 pad keeps radius-1 circles a plus shape and
// gives a full 2r+1 span across the middle row. Pixel (x, y) is tested at its index, so an
// integer center gives an odd width and a .5 center (e.g. 4.5) an even width.
function inEllipse(x, y, cx, cy, rx, ry) {
  const nx = (x - cx) / (rx + 0.4), ny = (y - cy) / (ry + 0.4);
  return nx * nx + ny * ny <= 1;
}

/**
 * Ellipse centered on (cx, cy) with radii rx, ry. `fill` paints the inside (0 = leave it),
 * `outlineC` paints the inside pixels that touch the outside (4-neighborhood); 0 = no outline.
 */
export function ellipse(s, cx, cy, rx, ry, fill, outlineC = 0) {
  const x0 = Math.max(0, Math.floor(cx - rx - 1)), x1 = Math.min(s.w - 1, Math.ceil(cx + rx + 1));
  const y0 = Math.max(0, Math.floor(cy - ry - 1)), y1 = Math.min(s.h - 1, Math.ceil(cy + ry + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inEllipse(x, y, cx, cy, rx, ry)) continue;
      const edge = outlineC && !(inEllipse(x - 1, y, cx, cy, rx, ry) && inEllipse(x + 1, y, cx, cy, rx, ry)
        && inEllipse(x, y - 1, cx, cy, rx, ry) && inEllipse(x, y + 1, cx, cy, rx, ry));
      if (edge) s.data[y * s.w + x] = outlineC;
      else if (fill) s.data[y * s.w + x] = fill;
    }
  }
  return s;
}

/**
 * Filled polygon (even-odd rule) from points [[x, y], ...] or [{ x, y }, ...]. A pixel is
 * filled when its center (x + 0.5, y + 0.5) is inside; edges are left-inclusive and
 * top-inclusive, so polygons sharing an edge partition the pixels between them.
 */
export function polygon(s, points, c) {
  const pts = points.map((p) => (Array.isArray(p) ? p : [p.x, p.y]));
  if (pts.length < 3) return s;
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const yStart = Math.max(0, Math.floor(minY)), yEnd = Math.min(s.h - 1, Math.ceil(maxY));
  const xs = [];
  for (let y = yStart; y <= yEnd; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      if (ay === by) continue;
      const [lx, ly, hx, hy] = ay < by ? [ax, ay, bx, by] : [bx, by, ax, ay];
      if (yc < ly || yc >= hy) continue;
      xs.push(lx + ((yc - ly) * (hx - lx)) / (hy - ly));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // Pixel x is inside when xs[k] <= x + 0.5 < xs[k + 1].
      const from = Math.max(0, Math.ceil(xs[k] - 0.5)), to = Math.min(s.w, Math.ceil(xs[k + 1] - 0.5));
      if (to > from) s.data.fill(c, y * s.w + from, y * s.w + to);
    }
  }
  return s;
}

/**
 * One iso tile top: a w x w/2 diamond (default 32 x 16) whose bounding box starts at (x, y).
 * Row widths for 32 x 16 are 2, 6, ..., 30, 30, ..., 6, 2, so diamonds placed at offsets of
 * (+-16, +8) tile the plane with no gap or overlap. The tile center (the projected world point
 * of the tile's middle) is the pixel corner at (x + w/2, y + w/4).
 */
export function isoDiamond(s, x, y, c, w = 32) {
  const h = w / 2;
  return polygon(s, [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]], c);
}

/**
 * Iso box: top face plus the two visible side faces, light from the top-left.
 * (x, y) = back (top) corner of the top face. wx = length along world +x in 2:1 steps
 * (each step moves +2, +1 px), wy = length along world +y (each step moves -2, +1 px),
 * h = wall height in px. faces = { top, left, right } pixel indices: left faces the light
 * (use a mid shade), right faces away (darkest), top brightest. Bounding box spans
 * x - 2*wy .. x + 2*wx and y .. y + wx + wy + h.
 */
export function isoBox(s, x, y, wx, wy, h, { top, left, right }) {
  const p0 = [x, y], p1 = [x + 2 * wx, y + wx], p2 = [x + 2 * wx - 2 * wy, y + wx + wy], p3 = [x - 2 * wy, y + wy];
  const down = ([px_, py]) => [px_, py + h];
  if (h > 0) {
    if (left) polygon(s, [p3, p2, down(p2), down(p3)], left);
    if (right) polygon(s, [p2, p1, down(p1), down(p2)], right);
  }
  if (top) polygon(s, [p0, p1, p2, p3], top);
  return s;
}

function rampIndex(ramp) {
  const r = typeof ramp === 'number' ? ramp : RAMP[ramp];
  if (!Number.isInteger(r) || r < 0 || r >= RAMPS.length) throw new Error(`sprite: unknown ramp ${String(ramp)}`);
  return r;
}

// 2x2 ordered-dither thresholds, anchored to sprite coordinates so neighboring fills line up.
const BAYER2 = [0, 2, 3, 1];
const bayer = (x, y) => (BAYER2[(y & 1) * 2 + (x & 1)] + 0.5) / 4;

/**
 * Re-shades already-drawn pixels as a lit rounded volume (sphere or ellipsoid), light from the
 * top-left, using shades of one ramp (name or position). Options:
 *   only:  which pixels to shade: an index, an array of indices, or (index) => boolean.
 *          Default: every opaque pixel in the region.
 *   x, y, w, h: region to scan (default the whole sprite).
 *   cx, cy, rx, ry: the volume's center and radii in pixels (default: bounding box of the
 *          matched pixels).
 *   lo, hi: darkest and brightest shade used (default 1 and 7; keep 0 for outlines).
 *   ambient: light on surfaces facing away (0..1, default 0.12).
 *   dither: true blends neighboring shades with a 2x2 ordered pattern instead of hard bands.
 */
export function sphereShade(s, ramp, opts = {}) {
  const base = 1 + rampIndex(ramp) * SHADES;
  const { lo = 1, hi = 7, ambient = 0.12, dither: useDither = false } = opts;
  const rx0 = Math.max(0, Math.floor(opts.x ?? 0)), ry0 = Math.max(0, Math.floor(opts.y ?? 0));
  const rx1 = Math.min(s.w, rx0 + Math.floor(opts.w ?? s.w)), ry1 = Math.min(s.h, ry0 + Math.floor(opts.h ?? s.h));
  const only = opts.only;
  const match = only == null ? (v) => v !== 0
    : typeof only === 'function' ? (v) => v !== 0 && only(v)
    : Array.isArray(only) ? (v) => only.includes(v)
    : (v) => v === only;
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) {
    if (!match(s.data[y * s.w + x])) continue;
    bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
  }
  if (bx0 === Infinity) return s;
  const cx = opts.cx ?? (bx0 + bx1 + 1) / 2, cy = opts.cy ?? (by0 + by1 + 1) / 2;
  const rx = opts.rx ?? (bx1 - bx0 + 1) / 2, ry = opts.ry ?? (by1 - by0 + 1) / 2;
  // Light direction: up-left and toward the viewer, normalized.
  const L = [-0.55, -0.6, 0.58];
  const ln = Math.hypot(L[0], L[1], L[2]);
  const lx = L[0] / ln, ly = L[1] / ln, lz = L[2] / ln;
  const span = hi - lo;
  const hits = [];
  for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) {
    if (match(s.data[y * s.w + x])) hits.push(y * s.w + x);
  }
  for (const i of hits) {
    const x = i % s.w, y = (i - x) / s.w;
    let nx = (x + 0.5 - cx) / Math.max(rx, 0.5), ny = (y + 0.5 - cy) / Math.max(ry, 0.5);
    const d = nx * nx + ny * ny;
    if (d > 1) { const k = 1 / Math.sqrt(d); nx *= k; ny *= k; }
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    const lambert = Math.max(0, nx * lx + ny * ly + nz * lz);
    const level = lo + span * (ambient + (1 - ambient) * lambert);
    let shade = useDither ? Math.floor(level) + (level - Math.floor(level) > bayer(x, y) ? 1 : 0) : Math.round(level);
    shade = Math.max(lo, Math.min(hi, shade));
    s.data[i] = base + shade;
  }
  return s;
}

/**
 * 2x2 ordered blend of two indices over a rectangle: t = 0 is all c0, 1 is all c1, 0.5 a
 * checkerboard, 0.25 / 0.75 sparse patterns. onlyOpaque = true leaves transparent pixels alone.
 */
export function dither(s, x, y, w, h, c0, c1, t = 0.5, onlyOpaque = false) {
  const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(s.w, Math.floor(x) + Math.floor(w)), y1 = Math.min(s.h, Math.floor(y) + Math.floor(h));
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
    const i = yy * s.w + xx;
    if (onlyOpaque && !s.data[i]) continue;
    s.data[i] = bayer(xx, yy) < t ? c1 : c0;
  }
  return s;
}

/**
 * New sprite with a 1 px ring of index c around the opaque pixels (4-neighborhood; corners: true
 * also fills diagonal corners). grow (default true) adds a 1 px border on every side so the ring
 * always fits, moving the anchor by +1, +1 to keep its world position.
 */
export function outline(s, c, { corners = false, grow = true } = {}) {
  const g = grow ? 1 : 0;
  const out = createSprite(s.w + 2 * g, s.h + 2 * g, s.ax + g, s.ay + g);
  stamp(out, s, g, g);
  const src = out.data.slice();
  const at = (x, y) => (x >= 0 && y >= 0 && x < out.w && y < out.h ? src[y * out.w + x] : 0);
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
    if (src[y * out.w + x]) continue;
    let near = at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1);
    if (!near && corners) near = at(x - 1, y - 1) || at(x + 1, y - 1) || at(x - 1, y + 1) || at(x + 1, y + 1);
    if (near) out.data[y * out.w + x] = c;
  }
  return out;
}

/** Horizontally flipped copy. The anchor pixel ax maps to w - 1 - ax. */
export function mirror(s) {
  const out = createSprite(s.w, s.h, s.w - 1 - s.ax, s.ay);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) out.data[y * s.w + (s.w - 1 - x)] = s.data[y * s.w + x];
  return out;
}

/**
 * Draws src into dst with src's top-left corner at (x, y) of dst; transparent src pixels are
 * skipped. { flipX: true } draws src mirrored. Clips to dst.
 */
export function stamp(dst, src, x, y, { flipX = false } = {}) {
  x = Math.floor(x);
  y = Math.floor(y);
  for (let sy = 0; sy < src.h; sy++) {
    const dy = y + sy;
    if (dy < 0 || dy >= dst.h) continue;
    for (let sx = 0; sx < src.w; sx++) {
      const v = src.data[sy * src.w + (flipX ? src.w - 1 - sx : sx)];
      if (!v) continue;
      const dx = x + sx;
      if (dx >= 0 && dx < dst.w) dst.data[dy * dst.w + dx] = v;
    }
  }
  return dst;
}

/**
 * Crops the transparent border. The anchor moves with the crop so it still marks the same
 * pixel (it may end up outside the new bounds, which blit handles). A fully transparent sprite
 * becomes 1 x 1 transparent with the anchor at 0, 0.
 */
export function trim(s) {
  let x0 = s.w, y0 = s.h, x1 = -1, y1 = -1;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    if (!s.data[y * s.w + x]) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return createSprite(1, 1, 0, 0);
  const out = createSprite(x1 - x0 + 1, y1 - y0 + 1, s.ax - x0, s.ay - y0);
  for (let y = 0; y < out.h; y++) out.data.set(s.data.subarray((y + y0) * s.w + x0, (y + y0) * s.w + x1 + 1), y * out.w);
  return out;
}

/** RGBA bytes (Uint8ClampedArray, w*h*4) of a sprite through a LUT; index 0 -> transparent. */
export function toRGBA(s, lut) {
  const out = new Uint8ClampedArray(s.w * s.h * 4);
  for (let i = 0; i < s.data.length; i++) {
    const v = s.data[i];
    if (!v) continue;
    const c = lut[v] >>> 0;
    out[i * 4] = c & 255;
    out[i * 4 + 1] = (c >>> 8) & 255;
    out[i * 4 + 2] = (c >>> 16) & 255;
    out[i * 4 + 3] = (c >>> 24) & 255;
  }
  return out;
}

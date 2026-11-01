// Bakes the divine hand's six pose sprites from the source panels in art-src/hand/ into
// src/art/painters/hand-data.js (palette indices only, as rows of characters).
//
//   node scripts/bake-hand.mjs                 bake art-src/hand/<pose>.png -> src/art/painters/hand-data.js
//   node scripts/bake-hand.mjs --check         exit 1 when hand-data.js differs from a fresh bake (0 when current)
//   node scripts/bake-hand.mjs --sheet <png>   also write a preview sheet: source panel, sprite 6x and native
//                                              over grass, water and sand, at alignment 0 (hand LUT) and -1
//   node scripts/bake-hand.mjs --import <12-hand-sheet.png>
//                                              remake art-src/hand/<pose>.png from concept 12 (crop, reduce)
//
// The sources are the six panels of concept 12 (the project's own generated hand sheet, user-approved
// as the hand's art source), reduced to 0.6 of the sheet's size: about 4x the sprite size. Each bake
// step below is a rule, and every per-pose fix lives in the POSES table, so a rebake reproduces the
// shipped sprites byte for byte:
//   1. Per-pose erase boxes drop things that are not the hand (the villager in the pinch panel).
//   2. The hand body is the largest bright, blue-white region (opened so impact rays and motes split
//      off), plus the enclosed shading inside it; see-through gaps that show the navy background stay
//      gaps.
//   3. All six poses are reduced by one shared factor (SCALE), so palm and fingers are the same size
//      in every pose. A native pixel is body when at least half of it is covered; its colour is the
//      mean colour of the body under it, matched to the nearest `hand-glow` shade by lightness.
//   4. Cleanup: no orphan pixels or 1 px holes; interior shades never drop below shade 3, shade 3
//      survives only in thin crease lines, and a lone dark pixel takes its neighbours' shade (no dark
//      blotches); finger gaps that the reduction
//      closed are reopened where the source shows background between two fingers; the silhouette
//      gets a crisp bright rim (lit from the top left) and a 1 px dithered halo outside it.
//   5. The wrist dissolves: just before each pose's wrist line the edge frays; past it the body breaks
//      into 2x2 particles on a checker of blocks (they touch only at corners) that thin out with distance.
//   6. Loose motes, sparkles, speed lines and impact rays from the source become 1 px (or 2x2)
//      squares and 1 px lines in `hand-glow`; pink pixels (the stroke's hearts and trail) become
//      pixel hearts and dots in the `heart` ramp.
// Anchor = the pose's grip point (POSES[pose].anchor, in source pixels): fingertip for point, the
// pinch between thumb and index for hold. src/hand/draw.js places held objects under it.
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodePNG, encodePNG } from './lib/png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'art-src/hand');
const OUT = join(ROOT, 'src/art/painters/hand-data.js');
const ORDER = ['open', 'grab', 'hold', 'point', 'stroke', 'slap'];

// ---- import: concept 12 panels -> art-src/hand/<pose>.png
const IMPORT_SCALE = 0.6; // sources are stored at 0.6 of the concept sheet
const CROPS = { open: [50, 60, 540, 400], grab: [590, 60, 520, 400], hold: [1130, 60, 490, 400], point: [40, 520, 550, 380], stroke: [590, 500, 520, 400], slap: [1130, 480, 510, 420] };
const NAVY = [2, 26, 66]; // the sheet's background

// ---- bake rules
const SCALE = 0.26; // native pixels per source pixel, shared by every pose
const BODY_SIZE = [44, 56]; // hand body, longest side in native px (as the hand-art scenario measures it)
// Per pose, in source pixels: anchor = grip point; wrist = where the arm starts to dissolve (a point
// on the cut line and the direction toward the elbow) and how far (native px) the particles reach;
// erase = boxes [x0, y0, x1, y1] where only blue-white hand pixels are kept.
const POSES = {
  open: { anchor: [200, 120], wrist: { at: [92, 140], dir: [-1, 0.25], len: 7 } },
  grab: { anchor: [205, 150], wrist: { at: [70, 150], dir: [-1, 0.6], len: 7 } },
  hold: { anchor: [236, 74], wrist: { at: [70, 160], dir: [-1, 0.6], len: 7 }, erase: [[219, 64, 252, 114]] },
  point: { anchor: [290, 70], wrist: { at: [94, 90], dir: [-1, 0], len: 7 } },
  stroke: { anchor: [240, 150], wrist: { at: [62, 60], dir: [-1, -0.6], len: 7 } },
  slap: { anchor: [235, 195], wrist: { at: [72, 52], dir: [-1, -0.9], len: 7 } },
};
const BODY_LUM = 95;
const LIFT = 12; // the reduction averages rim light with shading; lift the mean lightness this much before matching a shade // body: source lightness above this, blue-white
const MOTE_LUM = 120;
const HALO = 4; // shade of the dithered 1 px halo // loose motes and lines: source lightness above this

const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;
const hexRGB = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hash = (x, y, k = 0) => {
  let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Area-weighted box resampling weights: for each output index, the source indices and their share. */
function boxWeights(n, size, scale) {
  return Array.from({ length: n }, (_, o) => {
    const a = o / scale, b = (o + 1) / scale, list = [];
    for (let i = Math.floor(a); i < Math.min(size, Math.ceil(b)); i++) {
      const wt = Math.min(b, i + 1) - Math.max(a, i);
      if (wt > 1e-9) list.push([i, wt]);
    }
    return list;
  });
}

function importSources(sheetPath) {
  const S = decodePNG(readFileSync(sheetPath));
  mkdirSync(SRC_DIR, { recursive: true });
  let total = 0;
  for (const pose of ORDER) {
    const [cx, cy, cw, ch] = CROPS[pose];
    const w = Math.round(cw * IMPORT_SCALE), h = Math.round(ch * IMPORT_SCALE), out = new Uint8Array(w * h * 4);
    const WX = boxWeights(w, cw, IMPORT_SCALE), WY = boxWeights(h, ch, IMPORT_SCALE);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0];
      let tw = 0;
      for (const [sy, wy] of WY[y]) for (const [sx, wx] of WX[x]) {
        const i = ((cy + sy) * S.width + cx + sx) * 4, wt = wx * wy;
        acc[0] += S.rgba[i] * wt; acc[1] += S.rgba[i + 1] * wt; acc[2] += S.rgba[i + 2] * wt; tw += wt;
      }
      let [r, g, b] = acc.map((v) => Math.round(v / tw));
      // flatten the near-black navy background to one colour (the files shrink by a third; the bake drops it anyway)
      if (lum(r, g, b) < lum(...NAVY) + 10 && b >= r) [r, g, b] = NAVY;
      out.set([r, g, b, 255], (y * w + x) * 4);
    }
    const file = join(SRC_DIR, `${pose}.png`);
    writeFileSync(file, encodePNG(w, h, out, { rgb: true, filter: true }));
    total += statSync(file).size;
    console.log(`art-src/hand/${pose}.png ${w}x${h} ${statSync(file).size} B`);
  }
  console.log(`total ${total} B`);
}

// ---- bake one pose
function components(mask, w, h, eight = true) {
  const lab = new Int32Array(w * h), comps = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || lab[s]) continue;
    const id = comps.length + 1, stack = [s], px = [];
    lab[s] = id;
    while (stack.length) {
      const q = stack.pop(), x = q % w, y = (q - x) / w;
      px.push(q);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || (!eight && dx && dy)) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const r = ny * w + nx;
        if (mask[r] && !lab[r]) { lab[r] = id; stack.push(r); }
      }
    }
    comps.push(px);
  }
  return { lab, comps };
}

/** Binary erode (grow = false) or dilate (grow = true) with a disc of radius r. */
function morph(mask, w, h, r, grow) {
  const out = new Uint8Array(w * h), offs = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r) offs.push([dx, dy]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = grow ? 0 : 1;
    for (const [dx, dy] of offs) {
      const nx = x + dx, ny = y + dy, m = nx >= 0 && ny >= 0 && nx < w && ny < h ? mask[ny * w + nx] : 0;
      if (grow ? m : !m) { v = grow ? 1 : 0; break; }
    }
    out[y * w + x] = v;
  }
  return out;
}

function bakePose(pose, idx) {
  const P = POSES[pose];
  const { width: w, height: h, rgba } = decodePNG(readFileSync(join(SRC_DIR, `${pose}.png`)));
  const R = (i) => rgba[i * 4], G = (i) => rgba[i * 4 + 1], B = (i) => rgba[i * 4 + 2];
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = lum(R(i), G(i), B(i));
  const isBg = (i) => L[i] < lum(...NAVY) + 12;
  const pinkish = (i) => R(i) > B(i) + 8 && R(i) > G(i) + 20 && R(i) > 90;
  const bluish = (i) => B(i) >= R(i) + 10;

  // 1. erase boxes: keep only blue-white hand pixels inside them
  const erased = new Uint8Array(w * h);
  for (const [x0, y0, x1, y1] of P.erase ?? []) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (!(bluish(i) && L[i] > BODY_LUM && G(i) > R(i) + 30)) erased[i] = 1;
    }
  }

  // 2. body mask at source size
  let m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = !erased[i] && L[i] > BODY_LUM && bluish(i) ? 1 : 0;
  const opened = morph(morph(m, w, h, 3, false), w, h, 3, true);
  for (let i = 0; i < w * h; i++) opened[i] &= m[i];
  let { comps } = components(opened, w, h);
  const main = comps.reduce((a, b) => (b.length > a.length ? b : a));
  const body = new Uint8Array(w * h);
  for (const q of main) body[q] = 1;
  // enclosed holes: shading inside the hand is filled; holes showing the navy background stay open
  {
    const inv = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) inv[i] = body[i] ? 0 : 1;
    const holes = components(inv, w, h, false).comps;
    for (const px of holes) {
      const edge = px.some((q) => { const x = q % w, y = (q - x) / w; return !x || !y || x === w - 1 || y === h - 1; });
      if (edge) continue;
      const bg = px.filter((q) => isBg(q) || erased[q]).length;
      if (bg < 6) for (const q of px) body[q] = 1;
    }
  }

  // 3. reduce: coverage and mean body colour per native pixel
  const nw = Math.ceil(w * SCALE), nh = Math.ceil(h * SCALE);
  const WX = boxWeights(nw, w, SCALE), WY = boxWeights(nh, h, SCALE);
  const cover = new Float32Array(nw * nh), bgCover = new Float32Array(nw * nh), col = new Float32Array(nw * nh * 3);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    let tw = 0, bw = 0, gw = 0, r = 0, g = 0, b = 0;
    for (const [sy, wy] of WY[y]) for (const [sx, wx] of WX[x]) {
      const i = sy * w + sx, wt = wx * wy;
      tw += wt;
      if (body[i]) { bw += wt; r += R(i) * wt; g += G(i) * wt; b += B(i) * wt; }
      else if (isBg(i) || erased[i]) gw += wt;
    }
    const o = y * nw + x;
    cover[o] = bw / tw; bgCover[o] = gw / tw;
    if (bw) { col[o * 3] = r / bw; col[o * 3 + 1] = g / bw; col[o * 3 + 2] = b / bw; }
  }
  const GLOW = Array.from({ length: 8 }, (_, s) => lum(...hexRGB(idx.goodHex('hand-glow', s))));
  const nearestShade = (l) => GLOW.reduce((best, v, s) => (Math.abs(v - l) < Math.abs(GLOW[best] - l) ? s : best), 0);

  // canvas with a margin for halo, wrist particles and effects
  const M = 6, W = nw + 2 * M, H = nh + 2 * M;
  const shade = new Int8Array(W * H).fill(-1); // body shade, -1 = not body
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : shade[y * W + x]);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const o = y * nw + x;
    if (cover[o] >= 0.5) shade[(y + M) * W + x + M] = nearestShade(lum(col[o * 3], col[o * 3 + 1], col[o * 3 + 2]) + LIFT);
  }
  // reopen finger gaps: a pixel mostly background in the source, with body on two opposite sides
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const o = y * nw + x, X = x + M, Y = y + M;
    if (shade[Y * W + X] < 0 || bgCover[o] < 0.3) continue;
    const pairs = [[[-1, 0], [1, 0]], [[0, -1], [0, 1]], [[-1, -1], [1, 1]], [[1, -1], [-1, 1]]];
    if (pairs.some(([[ax, ay], [bx, by]]) => at(X + ax, Y + ay) >= 0 && at(X + bx, Y + by) >= 0)) shade[Y * W + X] = -2; // gap marker
  }
  for (let i = 0; i < W * H; i++) if (shade[i] === -2) shade[i] = -1;

  // 4. cleanup: orphans and pinholes, then interior floor and lone dark pixels
  const N8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, n4 = N4.filter(([dx, dy]) => at(x + dx, y + dy) >= 0).length;
      if (shade[i] >= 0 && n4 <= 1) shade[i] = -1;
      else if (shade[i] < 0 && n4 >= 3) {
        const ns = N4.map(([dx, dy]) => at(x + dx, y + dy)).filter((v) => v >= 0).sort((a, b) => a - b);
        shade[i] = ns[ns.length >> 1];
      }
    }
  }
  const isEdge = (x, y) => N4.some(([dx, dy]) => at(x + dx, y + dy) < 0);
  const base = shade.slice();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (base[i] < 0) continue;
    let s = Math.max(3, base[i]);
    const ns = N8.map(([dx, dy]) => at(x + dx, y + dy)).filter((v) => v >= 0);
    const darker = ns.filter((v) => v <= s).length;
    if (darker === 0 && ns.length) s = [...ns].sort((a, b) => a - b)[ns.length >> 1]; // lone dark pixel
    else if (s <= 3 && darker < 2) s = 4; // a dark pixel only stays dark as part of a crease line
    shade[i] = s;
  }
  // shade 3 stays in thin crease lines only: inside a dark patch it lifts to 4
  {
    const cur = shade.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (cur[i] !== 3) continue;
      if (N8.filter(([dx, dy]) => { const v = x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H ? cur[(y + dy) * W + x + dx] : -1; return v >= 0 && v <= 3; }).length >= 5) shade[i] = 4;
    }
  }

  // 5. wrist: past the cut line the body breaks into 2x2 particles that thin out
  const { at: [wx, wy], dir: [dx0, dy0], len } = P.wrist;
  const dl = Math.hypot(dx0, dy0), ux = dx0 / dl, uy = dy0 / dl;
  const cx = wx * SCALE + M, cy = wy * SCALE + M;
  // native px past the wrist line; the line is ragged (shifted up to 1.5 px every 2 px along it), not straight
  const past = (x, y) => {
    const along = Math.floor(((x + 0.5 - cx) * -uy + (y + 0.5 - cy) * ux) / 2);
    return (x + 0.5 - cx) * ux + (y + 0.5 - cy) * uy + (hash(along, 0, 17) - 0.5) * 3;
  };
  const particles = new Int8Array(W * H).fill(-1), FRAY = 3;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, d = past(x, y);
    if (shade[i] < 0 || d <= -FRAY) continue;
    if (d <= 0) { if (hash(x, y, 13) < 0.45 * (1 + d / FRAY)) shade[i] = -1; continue; } // fraying just before the line
    const s = shade[i];
    shade[i] = -1;
    const bx = x >> 1, by = y >> 1;
    if (((bx + by) & 1) === 0 && hash(bx, by, 7) < 0.95 - d / len) particles[i] = Math.max(4, Math.min(7, s + (hash(bx, by, 3) < 0.3 ? 1 : 0)));
  }

  // rim and halo
  const out = new Uint8Array(W * H);
  const glow = (s) => idx('hand-glow', s), heart = (s) => idx('heart', s);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (shade[i] < 0) continue;
    const up = at(x, y - 1) < 0, left = at(x - 1, y) < 0, down = at(x, y + 1) < 0, right = at(x + 1, y) < 0;
    let s = shade[i];
    if (up || left) s = 7;
    else if (down || right) s = Math.max(s, 6);
    out[i] = glow(s);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (out[i]) continue;
    const touch = N4.some(([dx, dy]) => at(x + dx, y + dy) >= 0);
    if (touch && ((x + y) & 1) === 0) out[i] = glow(HALO);
  }
  for (let i = 0; i < W * H; i++) if (!out[i] && particles[i] >= 0) out[i] = glow(particles[i]);

  // 6. loose motes, lines and hearts from the source (outside the body and its bloom)
  const near = morph(body, w, h, 6, true);
  const loose = new Uint8Array(w * h), pink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (near[i] || erased[i]) continue;
    if (pinkish(i) && L[i] > 80) pink[i] = 1;
    else if (L[i] > MOTE_LUM && !pinkish(i)) loose[i] = 1;
  }
  const put = (x, y, v) => { const X = Math.round(x), Y = Math.round(y); if (X >= 0 && Y >= 0 && X < W && Y < H && !out[Y * W + X]) out[Y * W + X] = v; };
  for (const [mask, isPink] of [[loose, false], [pink, true]]) {
    for (const px of components(mask, w, h).comps) {
      let sx = 0, sy = 0, maxL = 0;
      for (const q of px) { sx += q % w; sy += (q - (q % w)) / w; maxL = Math.max(maxL, L[q]); }
      const mx = sx / px.length, my = sy / px.length;
      // principal axis: lines (speed lines, rays, trails) stay lines
      let sxx = 0, syy = 0, sxy = 0;
      for (const q of px) { const ddx = (q % w) - mx, ddy = (q - (q % w)) / w - my; sxx += ddx * ddx; syy += ddy * ddy; sxy += ddx * ddy; }
      const tr = (sxx + syy) / px.length, det = (sxx * syy - sxy * sxy) / px.length ** 2;
      const l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det)), l2 = tr / 2 - Math.sqrt(Math.max(0, tr * tr / 4 - det));
      const area = px.length * SCALE * SCALE;
      const X = mx * SCALE + M, Y = my * SCALE + M;
      const s = maxL > 225 ? 7 : maxL > 180 ? 6 : maxL > 145 ? 5 : 4;
      if (area < 0.15) continue;
      if (l1 > 4 * Math.max(l2, 1) && Math.sqrt(l1) * SCALE * 3.4 >= 2) {
        // a line: from end to end along the axis
        const ang = Math.atan2(2 * sxy, sxx - syy) / 2, half = Math.sqrt(3 * l1) * SCALE, ex = Math.cos(ang), ey = Math.sin(ang);
        const n = Math.ceil(half * 2);
        for (let k = 0; k <= n; k++) {
          const t = -half + (2 * half * k) / n;
          put(X + ex * t, Y + ey * t, isPink ? heart(Math.min(6, s)) : glow(k === 0 || k === n ? Math.max(4, s - 2) : s));
        }
      } else if (isPink && area >= 2.5) {
        stampHeart(out, W, H, Math.round(X), Math.round(Y), area >= 6 ? 5 : 3, heart);
      } else if (area >= 1.6) {
        for (let ddy = 0; ddy < 2; ddy++) for (let ddx = 0; ddx < 2; ddx++) put(X - 0.5 + ddx, Y - 0.5 + ddy, isPink ? heart(6) : glow(s));
      } else put(X, Y, isPink ? heart(Math.min(7, s)) : glow(s));
    }
  }

  // anchor and trim
  const ax = Math.round(P.anchor[0] * SCALE) + M, ay = Math.round(P.anchor[1] * SCALE) + M;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (out[y * W + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const tw = x1 - x0 + 1, th = y1 - y0 + 1, data = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) data[y * tw + x] = out[(y + y0) * W + x + x0];
  return { w: tw, h: th, ax: ax - x0, ay: ay - y0, data, body: handBody(tw, th, data, glow(0)) };
}

/**
 * Hand body size [w, h], measured as the hand-art scenario does: `hand-glow` pixels whose four
 * neighbours are `hand-glow` too (drops halo, motes and 1 px lines), the largest 4-connected group of
 * them, its box grown back by the 1 px the erosion took on each side.
 */
function handBody(w, h, data, g0) {
  const glow = (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] >= g0 && data[y * w + x] < g0 + 8;
  const core = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) core[y * w + x] = glow(x, y) && glow(x + 1, y) && glow(x - 1, y) && glow(x, y + 1) && glow(x, y - 1) ? 1 : 0;
  const { comps } = components(core, w, h, false);
  if (!comps.length) return [0, 0];
  const best = comps.reduce((a, b) => (b.length > a.length ? b : a));
  const xs = best.map((q) => q % w), ys = best.map((q) => (q - (q % w)) / w);
  return [Math.max(...xs) - Math.min(...xs) + 3, Math.max(...ys) - Math.min(...ys) + 3];
}

/** Pixel heart: size 5 (5x5) or 3 (3x3), centred on (cx, cy); bright top-left, deeper at the point. */
function stampHeart(out, W, H, cx, cy, size, heart) {
  const rows = size >= 5 ? ['XX.XX', 'XXXXX', 'XXXXX', '.XXX.', '..X..'] : ['X.X', 'XXX', '.X.'];
  const o = size >> 1;
  rows.forEach((row, r) => [...row].forEach((ch, c) => {
    const x = cx - o + c, y = cy - o + r;
    if (ch !== 'X' || x < 0 || y < 0 || x >= W || y >= H || out[y * W + x]) return;
    out[y * W + x] = heart(r === 0 && c === 0 ? 7 : r >= rows.length - 2 ? 4 : r === 0 ? 6 : 5);
  }));
}

// ---- output
const CHARS = { glow: '01234567', heart: 'abcdefgh' };

async function bakeAll() {
  const pal = await import(pathToFileURL(join(ROOT, 'src/art/palette.js')).href);
  const idx = (ramp, s) => pal.idx(ramp, s);
  idx.goodHex = (ramp, s) => pal.RAMPS[pal.RAMP[ramp]].good[s];
  const toChar = new Map();
  for (let s = 0; s < 8; s++) { toChar.set(pal.idx('hand-glow', s), CHARS.glow[s]); toChar.set(pal.idx('heart', s), CHARS.heart[s]); }
  const poses = {};
  for (const pose of ORDER) {
    const b = bakePose(pose, idx);
    poses[pose] = { ...b, rows: Array.from({ length: b.h }, (_, y) => Array.from(b.data.subarray(y * b.w, (y + 1) * b.w), (v) => (v ? toChar.get(v) : '.')).join('')) };
  }
  const lines = [
    '// GENERATED by scripts/bake-hand.mjs from art-src/hand/<pose>.png (concept 12 panels). Do not edit by hand:',
    '// change the rules or the POSES table in scripts/bake-hand.mjs and rebake with `node scripts/bake-hand.mjs`;',
    '// `node scripts/bake-hand.mjs --check` fails when this file is stale.',
    '//',
    '// One entry per pose: w, h, anchor (ax, ay) = grip point, data = h rows of w characters:',
    "// '.' transparent, '0'-'7' `hand-glow` shade 0-7, 'a'-'h' `heart` shade 0-7.",
    'export const HAND_POSES = {',
  ];
  for (const pose of ORDER) {
    const p = poses[pose];
    lines.push(`  'hand-${pose}': {`, `    w: ${p.w}, h: ${p.h}, ax: ${p.ax}, ay: ${p.ay},`, '    data: [');
    for (const r of p.rows) lines.push(`      '${r}',`);
    lines.push('    ],', '  },');
  }
  lines.push('};', '');
  return { text: lines.join('\n'), poses, pal };
}

// ---- preview sheet
async function writeSheet(file, poses, pal) {
  const { makeLut } = await import(pathToFileURL(join(ROOT, 'src/art/lut.js')).href);
  const BG = { grass: '#6b8750', water: '#317d98', sand: '#ac936f' };
  const luts = [makeLut(1), makeLut(-1)]; // what handLut gives at alignment 0 and -1
  const Z = 6, PAD = 8;
  const cells = [];
  for (const pose of ORDER) {
    const p = poses[pose];
    const src = decodePNG(readFileSync(join(SRC_DIR, `${pose}.png`)));
    const row = [{ kind: 'src', img: src }];
    row.push({ kind: 'sprite', p, z: Z, bg: BG.grass, lut: luts[0] });
    for (const [bg, lut] of [[BG.grass, luts[0]], [BG.water, luts[0]], [BG.sand, luts[0]], [BG.grass, luts[1]]]) row.push({ kind: 'sprite', p, z: 1, bg, lut });
    row.push({ kind: 'sprite', p, z: 3, bg: BG.water, lut: luts[0] });
    cells.push(row);
  }
  const cw = (c) => (c.kind === 'src' ? c.img.width : c.p.w * c.z + 8 * c.z);
  const chh = (c) => (c.kind === 'src' ? c.img.height : c.p.h * c.z + 8 * c.z);
  const colW = cells[0].map((_, i) => Math.max(...cells.map((r) => cw(r[i]))));
  const rowH = cells.map((r) => Math.max(...r.map(chh)));
  const SW = colW.reduce((a, b) => a + b + PAD, PAD), SH = rowH.reduce((a, b) => a + b + PAD, PAD);
  const img = new Uint8Array(SW * SH * 4);
  for (let i = 0; i < SW * SH; i++) img.set([24, 26, 30, 255], i * 4);
  let oy = PAD;
  cells.forEach((row, ri) => {
    let ox = PAD;
    row.forEach((c, ci) => {
      if (c.kind === 'src') {
        for (let y = 0; y < c.img.height; y++) for (let x = 0; x < c.img.width; x++) img.set(c.img.rgba.subarray((y * c.img.width + x) * 4, (y * c.img.width + x) * 4 + 4), ((oy + y) * SW + ox + x) * 4);
      } else {
        const bg = hexRGB(c.bg), cwid = cw(c), chei = chh(c);
        for (let y = 0; y < chei; y++) for (let x = 0; x < cwid; x++) {
          const sx = Math.floor(x / c.z) - 4, sy = Math.floor(y / c.z) - 4;
          let rgb = bg;
          const v = sx >= 0 && sy >= 0 && sx < c.p.w && sy < c.p.h ? c.p.data[sy * c.p.w + sx] : 0;
          if (v) { const u = c.lut[v]; rgb = [u & 255, (u >>> 8) & 255, (u >>> 16) & 255]; }
          if (sx === c.p.ax && sy === c.p.ay && c.z > 1 && (x % c.z === 0 || y % c.z === 0)) rgb = [255, 0, 255];
          img.set([...rgb, 255], ((oy + y) * SW + ox + x) * 4);
        }
      }
      ox += colW[ci] + PAD;
    });
    oy += rowH[ri] + PAD;
  });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, encodePNG(SW, SH, img));
  console.log(`sheet ${file} ${SW}x${SH}`);
}

// ---- main
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--check') continue;
  if ((args[i] === '--sheet' || args[i] === '--import') && args[i + 1]) { i++; continue; }
  console.error(`bake-hand: unknown or incomplete argument ${args[i]} (use --check, --sheet <png>, --import <png>)`);
  process.exit(2);
}
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (args.includes('--import')) {
  const sheet = opt('--import');
  if (!sheet) { console.error('bake-hand: --import needs the path of concept 12 (12-hand-sheet.png)'); process.exit(2); }
  importSources(sheet);
} else {
  const { text, poses, pal } = await bakeAll();
  let badSize = false;
  for (const pose of ORDER) {
    const p = poses[pose], long = Math.max(...p.body);
    console.log(`hand-${pose}: ${p.w}x${p.h}, anchor ${p.ax},${p.ay}, body ${p.body[0]}x${p.body[1]}`);
    if (long < BODY_SIZE[0] || long > BODY_SIZE[1]) {
      console.error(`bake-hand: hand-${pose} body is ${long} px along its longest side (want ${BODY_SIZE[0]}-${BODY_SIZE[1]}); adjust SCALE or its wrist line`);
      badSize = true;
    }
  }
  if (badSize) process.exitCode = 1;
  else if (args.includes('--check')) {
    let cur = '';
    try { cur = readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n'); } catch { /* missing counts as stale */ }
    if (cur !== text) {
      console.error('bake-hand: src/art/painters/hand-data.js is stale; run node scripts/bake-hand.mjs');
      process.exitCode = 1;
    } else console.log('bake-hand: hand-data.js is current');
  } else {
    writeFileSync(OUT, text);
    console.log(`wrote ${OUT}`);
  }
  const sheet = opt('--sheet');
  if (sheet) await writeSheet(sheet, poses, pal);
}

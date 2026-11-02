// Static terrain, pre-rendered once per map into a palette-index buffer that covers the whole map
// in world pixels. The terrain pass copies the visible window of it through the LUT every frame.
//
// Each tile is a 32 x 16 top diamond at its surface height plus the side faces that show where a
// front neighbor is lower: the left face toward (tx, ty + 1), the right face toward (tx + 1, ty).
// Water tiles sit flat at sea level, shaded by distance to land; their own stored height (the
// sea bed) only feeds that depth. Tiles are drawn back to front (ascending tx + ty), so nearer,
// higher tiles cover what they hide.
//
// Deterministic: hash noise only (src/terrain/noise.js), no Math.random, no shared state.

import { idx } from '../art/palette.js';
import { hash32, hash01, valueNoise, fbm } from './noise.js';

export const GROUND = Object.freeze({ DEEP: 0, SHALLOW: 1, SAND: 2, GRASS: 3, DIRT: 4, ROCK: 5 });
/** Pixel kinds in the optional owner map. */
export const PART = Object.freeze({ TOP: 1, LEFT: 2, RIGHT: 3 });

const ramp = (name) => Array.from({ length: 8 }, (_, s) => idx(name, s));
const GRASS = ramp('grass'), DIRT = ramp('dirt'), SAND = ramp('sand'), ROCK = ramp('rock');
const WATER = ramp('water'), MOSS = ramp('moss'), BARK = ramp('bark');
/** Palette index range of the water ramp: the pass animates these pixels. */
export const WATER_LO = WATER[0], WATER_HI = WATER[7];

const isWater = (g) => g === GROUND.DEEP || g === GROUND.SHALLOW;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Noise salts.
const S_PATCH = 101, S_FINE = 131, S_BLEND = 151, S_TUFT = 171, S_PEBBLE = 181, S_GRAIN = 191;
const S_CRACK = 211, S_MOSS = 223, S_STRATA = 239, S_JOINT = 251, S_LIP = 263, S_BANK = 271;
const S_DEPTH = 283, S_FOAM = 293, S_SHADE = 307;

/** Surface height per tile: water lies flat at sea level, land at its own height. */
export function surfaceHeights(world) {
  const n = world.w * world.h, out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = isWater(world.ground[i]) ? Math.max(world.height[i], world.seaLevel) : world.height[i];
  return out;
}

/** Chebyshev distance in tiles from every tile to the nearest land tile (0 on land; 99 with no land). */
function distanceToLand(world) {
  const { w, h, ground } = world, n = w * h;
  const d = new Int16Array(n).fill(-1), queue = new Int32Array(n);
  let qn = 0;
  for (let i = 0; i < n; i++) if (!isWater(ground[i])) { d[i] = 0; queue[qn++] = i; }
  for (let q = 0; q < qn; q++) {
    const i = queue[q], x = i % w, y = (i - x) / w;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const nx = x + ox, ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (d[j] < 0) { d[j] = d[i] + 1; queue[qn++] = j; }
    }
  }
  for (let i = 0; i < n; i++) if (d[i] < 0) d[i] = 99;
  return d;
}

/**
 * Builds the cache for the world's current map.
 * Returns { data: Uint8Array(w*h) of palette indices (0 = nothing), w, h, ox, oy, mapW, mapH,
 *   surf, height, ground, owner? }. (ox, oy) is the world pixel of data[0]. `height` and
 * `ground` are the world arrays the cache was built from (identity marks the map version).
 * opts.owner = true also fills `owner`: Int32Array, per pixel (tileIndex + 1) * 4 + PART (final
 * pixels), and `faces`: Int32Array(w*h*2), side-face pixels each tile wrote [left, right] (before
 * nearer tiles cover any of them). Checks use both; the game never asks for them.
 */
export function buildTerrainCache(world, { owner: wantOwner = false } = {}) {
  const MW = world.w, MH = world.h, H = world.height, G = world.ground;
  const surf = surfaceHeights(world);
  let maxS = 0;
  for (let i = 0; i < surf.length; i++) if (surf[i] > maxS) maxS = surf[i];
  const ox = -MH * 16, oy = -maxS * 8;
  const cw = (MW + MH) * 16, ch = (MW + MH) * 8 + maxS * 8;
  const data = new Uint8Array(cw * ch);
  const owner = wantOwner ? new Int32Array(cw * ch) : null;
  const faces = wantOwner ? new Int32Array(MW * MH * 2) : null;
  const dist = distanceToLand(world);
  const map = { w: MW, h: MH, ground: G, surf };
  const inMap = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH;
  const at = (x, y) => (inMap(x, y) ? y * MW + x : -1);
  const distAt = (x, y) => dist[clamp(y, 0, MH - 1) * MW + clamp(x, 0, MW - 1)];

  for (let s = 0; s <= MW + MH - 2; s++) {
    for (let tx = Math.max(0, s - MH + 1); tx <= Math.min(s, MW - 1); tx++) {
      const ty = s - tx, i = ty * MW + tx, S = surf[i], g0 = G[i];
      const cx = (tx - ty) * 16 - ox, cy = (tx + ty) * 8 - S * 8 - oy;
      // Neighbors: back-left (tx-1), back-right (ty-1), front-left (ty+1), front-right (tx+1).
      const nBL = at(tx - 1, ty), nBR = at(tx, ty - 1), nFL = at(tx, ty + 1), nFR = at(tx + 1, ty);
      const sBL = nBL >= 0 ? surf[nBL] : S, sBR = nBR >= 0 ? surf[nBR] : S;
      const dropL = nFL >= 0 ? S - surf[nFL] : 0, dropR = nFR >= 0 ? S - surf[nFR] : 0;
      const water = isWater(g0);
      // Land neighbors (8-way) for foam and wet sand: [index, kind, cu, cv]; kind 0 = edge u, 1 = edge v, 2 = corner.
      const shore = [];
      for (let oy2 = -1; oy2 <= 1; oy2++) for (let ox2 = -1; ox2 <= 1; ox2++) {
        if (!ox2 && !oy2) continue;
        const j = at(tx + ox2, ty + oy2);
        if (j < 0 || isWater(G[j]) === water) continue;
        shore.push([ox2, oy2]);
      }

      for (let c = 0; c < 32; c++) {
        // Rows whose pixel centers lie inside the diamond: k above and k below the center line,
        // so neighboring diamonds tile with no gap or overlap (same rule as sprite.js isoDiamond).
        const x = cx - 16 + c, k = c < 16 ? (c + 1) >> 1 : (32 - c) >> 1;
        const yTop = cy + 8 - k, yBot = cy + 7 + k;
        for (let y = yTop; y <= yBot; y++) {
          // Pixel center -> position on this tile (u along +x, v along +y), in [0, 1].
          const wsx = x + ox + 0.5, wsy = y + oy + 0.5 + S * 8;
          const d16 = wsx / 16, s8 = wsy / 8;
          const u = (s8 + d16) / 2 - tx, v = (s8 - d16) / 2 - ty;
          const gx = (tx + u) * 16, gy = (ty + v) * 16; // ground-plane coordinates, 16 per tile
          let e = 9; // distance to the nearest tile of the other kind (land vs water), in tiles
          for (const [ax, ay] of shore) {
            const du = ax < 0 ? u : ax > 0 ? 1 - u : 0, dv = ay < 0 ? v : ay > 0 ? 1 - v : 0;
            const dd = ax && ay ? Math.sqrt(du * du + dv * dv) : ax ? du : dv;
            if (dd < e) e = dd;
          }
          let col;
          if (water) col = waterTop(gx, gy, tx + u - 0.5, ty + v - 0.5, e, distAt);
          else {
            const g = blendGround(map, g0, u, v, gx, gy, S, tx, ty);
            col = landTop(g, x, y, gx, gy);
            const k = rampShift(col);
            let shift = 0;
            // Shade at the foot of higher ground: wide on the light side (back-left), thin on the back-right.
            if (sBL > S && u < 0.16 + 0.12 * valueNoise(gx, gy, 5, S_SHADE)) shift--;
            else if (sBR > S && v < 0.07) shift--;
            // Rim light on the lip above a lit (left) face.
            if (y === yBot && c < 16 && dropL > 0) shift++;
            if (shift) col = k.base + clamp(k.shade + shift, 1, 7);
          }
          const o = y * cw + x;
          data[o] = col;
          if (owner) owner[o] = (i + 1) * 4 + PART.TOP;
        }
        // Side face below this column when the front neighbor on that side is lower.
        const left = c < 16, drop = left ? dropL : dropR;
        if (drop <= 0) continue;
        const nIdx = left ? nFL : nFR, frontWater = isWater(G[nIdx]);
        const depth = drop * 8;
        for (let d = 1; d <= depth; d++) {
          const y = yBot + d, o = y * cw + x;
          data[o] = facePixel(g0, left, x, d, depth, S * 8 - d, i, frontWater);
          if (owner) { owner[o] = (i + 1) * 4 + (left ? PART.LEFT : PART.RIGHT); faces[i * 2 + (left ? 0 : 1)]++; }
        }
      }
    }
  }
  return { data, w: cw, h: ch, ox, oy, mapW: MW, mapH: MH, surf, height: H, ground: G, owner, faces };
}

function rampShift(col) {
  const shade = (col - 1) % 8;
  return { base: col - shade, shade };
}

/**
 * Ground under a top pixel. Where two land grounds meet on level tiles the border wanders: one
 * displaced boundary per edge (noise sampled on the ground plane, so both tiles agree on it).
 */
function blendGround(map, g, u, v, gx, gy, S, tx, ty) {
  // Edge distances and neighbor offsets: u=0 (tx-1), u=1 (tx+1), v=0 (ty-1), v=1 (ty+1).
  let best = g, bestD = 1;
  for (let k = 0; k < 4; k++) {
    const nx = tx + (k === 0 ? -1 : k === 1 ? 1 : 0), ny = ty + (k === 2 ? -1 : k === 3 ? 1 : 0);
    if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
    const j = ny * map.w + nx, gn = map.ground[j];
    if (gn === g || isWater(gn) || map.surf[j] !== S) continue;
    const d = k === 0 ? u : k === 1 ? 1 - u : k === 2 ? v : 1 - v;
    const off = (valueNoise(gx, gy, 7, S_BLEND) - 0.5) * 0.9; // > 0: the lower ground id spreads
    const reach = g > gn ? off : -off;
    if (d < reach && d < bestD) { best = gn; bestD = d; }
  }
  return best;
}

function landTop(g, x, y, gx, gy) {
  const t = 0.6 * valueNoise(gx, gy, 22, S_PATCH + g) + 0.4 * valueNoise(gx, gy, 7, S_FINE + g);
  if (g === GROUND.GRASS) {
    // Sparse tufts: a lit blade with its shadow under it.
    const T = (px, py) => (hash32(px, py, S_TUFT) & 1023) < 9;
    if (T(x, y)) return GRASS[t < 0.5 ? 5 : 6];
    if (T(x, y - 1)) return GRASS[2];
    const f = valueNoise(gx, gy, 3, S_FINE + 9);
    return GRASS[t < 0.42 ? (f < 0.3 ? 2 : 3) : t < 0.66 ? 4 : f > 0.6 ? 5 : 4];
  }
  if (g === GROUND.DIRT) {
    const P = (px, py) => (hash32(px, py, S_PEBBLE) & 1023) < 5;
    if (P(x, y)) return ROCK[6];
    if (P(x - 1, y)) return ROCK[4];
    if (P(x, y - 1) || P(x - 1, y - 1)) return DIRT[2];
    return DIRT[t < 0.38 ? 3 : t < 0.62 ? 4 : 5];
  }
  if (g === GROUND.SAND) {
    const r = hash32(x, y, S_GRAIN) & 1023;
    if (r < 10) return SAND[3];
    if (r < 18) return SAND[7];
    return SAND[t < 0.35 ? 4 : t < 0.68 ? 5 : 6];
  }
  // Rock top: weathered slate with winding cracks and moss in the hollows.
  const crack = Math.abs(valueNoise(gx, gy, 11, S_CRACK) - 0.5);
  if (crack < 0.022) return ROCK[2];
  if (crack < 0.04 && (x + y) & 1) return ROCK[3];
  const m = valueNoise(gx, gy, 13, S_MOSS);
  if (m > 0.7) return MOSS[m > 0.8 ? 3 : 4];
  return ROCK[t < 0.38 ? 4 : t < 0.62 ? 5 : 6];
}

/** Water surface: depth bands from the distance to land, foam rings at the shore. */
function waterTop(gx, gy, fx, fy, e, distAt) {
  // Bilinear distance to land between tile centers, with a little wobble.
  const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  const top = distAt(x0, y0) * (1 - ax) + distAt(x0 + 1, y0) * ax;
  const bot = distAt(x0, y0 + 1) * (1 - ax) + distAt(x0 + 1, y0 + 1) * ax;
  const D = top * (1 - ay) + bot * ay + (valueNoise(gx, gy, 12, S_DEPTH) - 0.5) * 0.9;
  const fn = valueNoise(gx, gy, 5, S_FOAM);
  if (e < 0.1 + 0.12 * fn) return WATER[7];
  if (e < 0.2 + 0.08 * fn) return WATER[6];
  if (e > 0.34 && e < 0.42 && fn > 0.4) return WATER[6];
  return WATER[D < 1.1 ? 5 : D < 1.7 ? 4 : D < 2.6 ? 3 : D < 4.2 ? 2 : D < 7 ? 1 : 0];
}

/**
 * Rock cliff face pixel. k = rows below the top edge (0-based), L = face height in px, z = absolute
 * height in px. Strata bands 7 px tall follow world height, bent by slow noise along the face; the
 * top row of each band is a ledge that catches light, the bottom row a crease; joints lean and break
 * at band edges; moss tucks under the ledges on the lit face.
 */
function rockFace(x, z, k, L, left) {
  const b0 = left ? 4 : 2;
  const zq = z + (valueNoise(x, 0, 13, S_STRATA) - 0.5) * 7;
  const band = Math.floor(zq / 7), inBand = zq - band * 7;
  let s = b0 + (hash01(band, 0, S_STRATA + 1) < 0.3 ? -1 : 0);
  if (inBand >= 6) s += 1; // ledge
  else if (inBand < 1 && hash01(x >> 1, band, S_STRATA + 2) < 0.75) s -= 1; // crease
  const wb = fbm(x, z * 2, 9, S_STRATA + 3); // weathering blotches
  if (wb > 0.68) s += 1;
  else if (wb < 0.28) s -= 1;
  // Joints: a few per band, offset per band and leaning by one px every 3 rows.
  const j = x + ((hash01(band, 1, S_JOINT) * 23) | 0) + Math.floor(inBand / 3) * (hash01(band, 2, S_JOINT) < 0.5 ? 1 : -1);
  const seg = Math.floor(j / 11), pos = j - seg * 11;
  const jx = 3 + ((hash01(seg, band, S_JOINT + 1) * 6) | 0);
  if (hash01(seg, band, S_JOINT + 2) < 0.55) {
    if (pos === jx) s = b0 - 2;
    else if (pos === jx - 1 && left) s += 1; // lit edge of the joint
  }
  if (left && inBand >= 5.5 && hash01(x, band, S_MOSS) < 0.18) return MOSS[3];
  if (k > 20) s -= 1; // tall faces darken toward the foot
  if (k >= L - 2) s -= 1; // contact shade
  return ROCK[clamp(s, 1, 7)];
}

/**
 * One side-face pixel. d = rows below the top edge (1..depth), z = absolute height in px of the
 * point, so strata line up across neighboring tiles. Left faces take the light, right faces less.
 */
function facePixel(g, left, x, d, depth, z, tile, frontWater) {
  const foot = d > depth - 2; // contact shade where the face meets lower ground
  if (isWater(g)) return WATER[left ? 2 : 1];
  if (g === GROUND.ROCK) {
    // Moss hanging over the top edge on about half the columns, one or two rows deep.
    if (d <= 1 + (hash01(x, 0, S_LIP) < 0.3 ? 1 : 0) && hash01(x >> 1, 1, S_LIP) < 0.5) return MOSS[left ? 3 : 2];
    return rockFace(x, z, d - 1, depth, left);
  }
  if (g === GROUND.GRASS || g === GROUND.DIRT) {
    if (g === GROUND.GRASS) {
      const lip = 1 + (hash32(x, tile, S_LIP) % 3);
      if (d <= lip) return GRASS[left ? (d === 1 ? 4 : 3) : 2];
    } else if (d === 1) return DIRT[left ? 5 : 3];
    // Bedrock under deep banks: 8-11 px of earth, then cliff rock.
    if (depth > 10 && d > 8 + (hash32(x >> 1, 2, S_LIP) & 3)) return rockFace(x, z, d - 1, depth, left);
    const r = hash32(x, z, S_BANK) & 255;
    if (r < 6) return ROCK[left ? 4 : 3];
    if (r < 9) return BARK[2];
    let s = left ? 3 : 2;
    if ((z + Math.floor(valueNoise(x, 0, 11, S_STRATA) * 3)) % 6 === 0) s -= 1;
    if (foot) s -= 1;
    return DIRT[clamp(s, 1, 7)];
  }
  // Sand bank: darker and wet near the water line.
  let s = left ? 4 : 3;
  if (d === 1) s = left ? 5 : 4;
  if (frontWater && d > depth - 3) s -= 2;
  return SAND[clamp(s, 1, 7)];
}


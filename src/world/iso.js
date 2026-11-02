// Isometric projection per spec: 32x16 tile diamonds, one height unit = 8 px. Results are world
// pixels; subtract the camera position to get view pixels.
export const TILE_W = 32;
export const TILE_H = 16;
export const Z_PX = 8;

export function worldToScreen(x, y, z = 0) {
  return { sx: (x - y) * 16, sy: (x + y) * 8 - z * 8 };
}

/** Inverse of worldToScreen for a known height z. */
export function screenToWorld(sx, sy, z = 0) {
  const d = sx / 16; // x - y
  const s = (sy + z * 8) / 8; // x + y
  return { x: (s + d) / 2, y: (s - d) / 2 };
}

/**
 * Depth sort key: ascending is drawn first. x + y for upright sprites, whose anchor is the one
 * ground point they stand on. An item may carry `sortDepth` instead: flat ground footprints (fields)
 * set it to their back corner's x + y. Sorted by its centre, a 3 x 3 field was drawn after every
 * villager standing on its back half and covered them, since the opaque diamond spans the whole
 * footprint (round 42: 43 of 815 villager samples on finished fields were more than half hidden).
 * Keyed by the back corner, everything standing on the footprint or in front of it draws over the
 * field, and things behind both back edges still draw under it.
 */
export function depthKey(e) {
  return e.sortDepth ?? e.x + e.y;
}

/** Draw-order comparator: depth key, then z, then id. */
export function compareDepth(a, b) {
  return depthKey(a) - depthKey(b) || (a.z ?? 0) - (b.z ?? 0) || (a.id ?? 0) - (b.id ?? 0);
}

/**
 * Pick against the drawn terrain: the front-most point of the stepped surface under world pixel
 * (screenX, screenY). The pointer goes through this (game.js input.toWorld).
 *
 * Why not pickTile with world.heightAt: the terrain pass (src/terrain/cache.js) draws every tile as
 * a flat top diamond at one height, with side faces where the front neighbor is lower, and water
 * flat at sea level. heightAt blends tile centers into a smooth slope, so near every height step
 * and shore the smooth surface and the drawn one sit up to a few px apart and the pick landed on
 * another tile than the one drawn under the pointer (round 42: 10.7% of land top pixels on the
 * island, 7.4% near the player village; the build ghost snapped to the wrong tile).
 *
 * surface = { surf, w, h, max }: surf[ty * w + tx] is the drawn top height of each tile (the same
 * surfaceHeights the cache draws from), max its largest value. Each tile is a solid column
 * [tx, tx+1) x [ty, ty+1) x [0, surf]; the painter's order the cache uses (back to front, by
 * tx + ty) shows the front-most faces of those columns, except that it draws no face toward the
 * outside of the map. The view ray through a pixel has a fixed d = x - y, and as z drops it moves
 * away from the viewer along x + y = s0 + z. Walking the tiles it crosses front to back, the first
 * drawn face it meets is the hit: a top at z = surf, or a front side face where the ray enters a
 * column below its top and above the top of the on-map tile it came from. Exact, no height
 * sampling: a ray can cross a tile for a sliver near the diamond's side corners, which a fixed z
 * step can skip. Checked against the cache's own pixel owner map on the island and the engine test
 * map: every top and side-face pixel picks the tile that drew it, and no undrawn pixel picks a tile
 * (scripts/check-terrain.mjs).
 *
 * Pass the pixel center (world px + 0.5): the cache colors a pixel by the tile whose diamond holds
 * its center. Returns { x, y, z, tx, ty } or null when no tile is drawn there (off the map, or
 * under the map's front edge, where the cache draws no wall). A side-face hit lies on the tile's
 * front boundary; x and y are kept just inside the tile so Math.floor(x), Math.floor(y) name the
 * tile whose face was hit, not the lower one in front.
 */
export function pickSurface(screenX, screenY, { surf, w, h, max }) {
  const d = screenX / 16, s0 = screenY / 8;
  const IN = 1e-7; // tiles: how far inside the tile a front-boundary hit is moved
  let s = s0 + max + 1; // start above every top
  // Top of the tile the ray just left; Infinity when it was off the map. A side face is drawn only
  // from the tile's top down to the top of the on-map tile in front of it (cache.js: depth = drop),
  // and never toward the outside of the map.
  let frontTop = Infinity;
  while (s > s0) {
    // The tile the ray is in just behind s (ceil - 1: a point exactly on a boundary moving back is
    // in the tile behind it). The ray leaves it at the back where x reaches tx (s = 2tx - d) or y
    // reaches ty (s = 2ty + d). Rounding can put s exactly on such a boundary while ceil picked the
    // tile in front; step back one tile then, or the walk would not advance.
    let tx = Math.ceil((s + d) / 2) - 1, ty = Math.ceil((s - d) / 2) - 1;
    if (2 * tx - d >= s) tx--;
    if (2 * ty + d >= s) ty--;
    if (tx < 0 || ty < 0) return null; // x and y only shrink from here: the ray has left the map
    const sb = Math.max(2 * tx - d, 2 * ty + d, s0); // < s, so every step moves back
    if (tx < w && ty < h) {
      const S = surf[ty * w + tx], za = s - s0;
      if (za <= S) {
        // Entered below the top: on the drawn front face when it is above the front tile's top.
        // Else nothing of this column is drawn on the ray (it passed under the front tile, through
        // the map's front edge, or below this face's foot) and the ray goes on behind it.
        if (za > frontTop) return { x: Math.min((s + d) / 2, tx + 1 - IN), y: Math.min((s - d) / 2, ty + 1 - IN), z: za, tx, ty };
      } else if (sb - s0 <= S) {
        const sh = s0 + S; // reaches the top inside this tile
        return { x: Math.min((sh + d) / 2, tx + 1 - IN), y: Math.min((sh - d) / 2, ty + 1 - IN), z: S, tx, ty };
      }
      frontTop = S;
    } else frontTop = Infinity;
    s = sb;
  }
  return null;
}

/**
 * Height-aware pick: the front-most terrain point under world pixel (screenX, screenY).
 * The view ray through a screen pixel is the set of (x, y, z) with that projection; as z drops the
 * point moves away from the viewer (x + y shrinks). Walking z down from maxZ, the first sample at or
 * under the surface is the front-most hit; bisection refines it to under 1/64 height unit.
 * heightAt(x, y) gives terrain height; opts.w / opts.h bound the map (points outside are skipped).
 * Returns { x, y, z, tx, ty } or null.
 */
export function pickTile(screenX, screenY, heightAt, { maxZ = 16, minZ = 0, w = Infinity, h = Infinity } = {}) {
  const inside = (p) => p.x >= 0 && p.y >= 0 && p.x < w && p.y < h;
  const below = (z) => {
    const p = screenToWorld(screenX, screenY, z);
    return inside(p) && heightAt(p.x, p.y) >= z;
  };
  const dz = 1 / 8; // one screen pixel of height per sample
  let prev = maxZ;
  for (let z = maxZ; z >= minZ - 1e-9; z -= dz) {
    if (below(z)) {
      // the surface crosses between prev (above) and z (under): bisect
      let hi = z === maxZ ? z : prev, lo = z;
      if (hi !== lo) {
        for (let i = 0; i < 6; i++) {
          const mid = (hi + lo) / 2;
          if (below(mid)) lo = mid; else hi = mid;
        }
      }
      const p = screenToWorld(screenX, screenY, lo);
      return { x: p.x, y: p.y, z: lo, tx: Math.floor(p.x), ty: Math.floor(p.y) };
    }
    prev = z;
  }
  return null;
}

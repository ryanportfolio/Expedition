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

/** Depth sort key: ascending x + y is drawn first. */
export function depthKey(e) {
  return e.x + e.y;
}

/** Draw-order comparator: depth key, then z, then id. */
export function compareDepth(a, b) {
  return a.x + a.y - (b.x + b.y) || (a.z ?? 0) - (b.z ?? 0) || (a.id ?? 0) - (b.id ?? 0);
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

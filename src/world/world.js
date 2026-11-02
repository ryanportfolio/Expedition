// World model: tile grid (height, ground) plus an entity store with a uniform spatial grid.
// Heights are stored per tile and sampled at tile centers: heightAt(x, y) blends the four tile
// centers around (x, y) bilinearly (edges clamp). Move entities with world.move so the spatial
// grid stays correct.

const CELL = 4; // spatial grid cell size in tiles

export function createWorld({ w = 64, h = 64 } = {}) {
  let nextId = 1;
  const entities = new Map();
  let grid = [];
  let gw = 0, gh = 0;

  const world = {
    w, h,
    seaLevel: 0,
    height: new Uint8Array(w * h),
    ground: new Uint8Array(w * h),
    trees: [],
    rocks: [],
    sites: {},
    entities,

    /** Island map format: { w, h, seaLevel, height, ground, trees, rocks, sites }. Clears entities. */
    loadMap(map) {
      const n = map.w * map.h;
      if (map.height.length !== n || map.ground.length !== n) throw new Error('loadMap: height/ground length must be w*h');
      world.w = map.w;
      world.h = map.h;
      world.seaLevel = map.seaLevel ?? 0;
      world.height = Uint8Array.from(map.height);
      world.ground = Uint8Array.from(map.ground);
      world.trees = (map.trees ?? []).map((t) => ({ ...t }));
      world.rocks = (map.rocks ?? []).map((r) => ({ ...r }));
      world.sites = structuredClone(map.sites ?? {});
      entities.clear();
      resetGrid();
      return world;
    },

    inBounds(tx, ty) { return tx >= 0 && ty >= 0 && tx < world.w && ty < world.h; },

    /** { tx, ty, height, ground } or null outside the map. */
    tile(tx, ty) {
      if (!world.inBounds(tx, ty)) return null;
      const i = ty * world.w + tx;
      return { tx, ty, height: world.height[i], ground: world.ground[i] };
    },

    heightAt(x, y) {
      const fx = Math.min(Math.max(x - 0.5, 0), world.w - 1);
      const fy = Math.min(Math.max(y - 0.5, 0), world.h - 1);
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(x0 + 1, world.w - 1), y1 = Math.min(y0 + 1, world.h - 1);
      const ax = fx - x0, ay = fy - y0, H = world.height, W = world.w;
      const top = H[y0 * W + x0] * (1 - ax) + H[y0 * W + x1] * ax;
      const bot = H[y1 * W + x0] * (1 - ax) + H[y1 * W + x1] * ax;
      return top * (1 - ay) + bot * ay;
    },

    // ---- entities
    spawn(kind, props = {}) {
      const e = { x: 0, y: 0, ...props, id: nextId++, kind };
      if (e.z === undefined) e.z = world.heightAt(e.x, e.y);
      entities.set(e.id, e);
      e._cell = cellIndex(e.x, e.y);
      grid[e._cell].add(e);
      return e;
    },
    remove(id) {
      const e = entities.get(id);
      if (!e) return false;
      grid[e._cell].delete(e);
      entities.delete(id);
      return true;
    },
    get(id) { return entities.get(id); },
    /** Set an entity's position and keep the spatial grid in step. */
    move(e, x, y, z = e.z) {
      e.x = x; e.y = y; e.z = z;
      const c = cellIndex(x, y);
      if (c !== e._cell) { grid[e._cell].delete(e); grid[c].add(e); e._cell = c; }
    },
    /** query({ kind, x, y, r }): kind filter and/or circle (tile units). Ascending id order. */
    query({ kind, x, y, r } = {}) {
      const out = [];
      const test = (e) => (kind === undefined || e.kind === kind) &&
        (r === undefined || (e.x - x) ** 2 + (e.y - y) ** 2 <= r * r);
      if (r === undefined) {
        for (const e of entities.values()) if (test(e)) out.push(e);
        return out;
      }
      const cx0 = clampC(Math.floor((x - r) / CELL), gw), cx1 = clampC(Math.floor((x + r) / CELL), gw);
      const cy0 = clampC(Math.floor((y - r) / CELL), gh), cy1 = clampC(Math.floor((y + r) / CELL), gh);
      for (let cy = cy0; cy <= cy1; cy++)
        for (let cx = cx0; cx <= cx1; cx++)
          for (const e of grid[cy * gw + cx]) if (test(e)) out.push(e);
      return out.sort((a, b) => a.id - b.id);
    },
  };

  function clampC(c, n) { return Math.min(Math.max(c, 0), n - 1); }
  function cellIndex(x, y) {
    return clampC(Math.floor(y / CELL), gh) * gw + clampC(Math.floor(x / CELL), gw);
  }
  function resetGrid() {
    gw = Math.ceil(world.w / CELL);
    gh = Math.ceil(world.h / CELL);
    grid = Array.from({ length: gw * gh }, () => new Set());
  }
  resetGrid();
  return world;
}

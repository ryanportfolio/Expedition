// Tile pathfinding for villagers. Walkable ground is sand, grass and dirt (2, 3, 4); a step may
// change tile height by at most 1. Moves are 8-neighbour; a diagonal must itself change height by at
// most 1 and needs both orthogonal tiles it passes to be valid steps too, so paths never cut a
// cliff corner.
//
// Costs are symmetric, so one Dijkstra search rooted at a goal tile serves every start: a path is a
// walk downhill through its distances. Searches are cached per goal (LRU) and dropped when a new map
// loads.
//
// A search only runs as far as the starts asked of it (step 2 of docs/gameplay-spec.md: on the
// 192 x 192 island a whole-map search per goal was most of the village's tick). It pops tiles in
// order of distance and pauses once every tile nearer the goal than the start is settled; the next
// start asked of the same goal resumes it. The pops come in the same order as a whole-map search
// (ties broken by tile index), so every settled distance is the one the whole search gives, and the
// walk downhill only steps onto tiles nearer than the one it stands on, all of them settled: paths
// are the same as before. An unreachable start runs the search over the goal's whole component.
//
// The steps allowed from each tile are worked out once per map (steps[i], one bit per D8 move), from
// world.ground and world.height as they are when the map is first searched; like the cached searches,
// they are rebuilt when world.loadMap swaps the height array, not after an in-place edit of it.

const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const COST = D8.map(([dx, dy]) => (dx && dy ? Math.SQRT2 : 1));
const CACHE_MAX = 96;

export function isWalkGround(g) { return g === 2 || g === 3 || g === 4; }

/** Per tile of the world's map, bit k set when canStep(x, y, D8[k]) allows that move. Shared with
 * the creature's paths (src/creature/path.js), which pass their own canStep. */
export function stepMasks(world, canStep) {
  const W = world.w, N = W * world.h, steps = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const x = i % W, y = (i - x) / W;
    let m = 0;
    for (let k = 0; k < 8; k++) if (canStep(x, y, D8[k][0], D8[k][1])) m |= 1 << k;
    steps[i] = m;
  }
  return steps;
}

// Binary min-heap of (key, tile) in parallel typed arrays, ordered by key, then tile index. The
// order is total (a tile is pushed again only with a smaller key), so pops come out in the same
// order whatever the heap's layout: the searches stay deterministic. Shared with the creature's paths.
export const newHeap = () => ({ key: new Float64Array(64), at: new Int32Array(64), n: 0 });
const less = (h, a, b) => h.key[a] < h.key[b] || (h.key[a] === h.key[b] && h.at[a] < h.at[b]);
function swap(h, a, b) {
  const k = h.key[a], t = h.at[a];
  h.key[a] = h.key[b]; h.at[a] = h.at[b]; h.key[b] = k; h.at[b] = t;
}
export function heapPush(h, d, i) {
  if (h.n === h.key.length) {
    const cap = Math.max(64, h.n * 2), key = new Float64Array(cap), at = new Int32Array(cap);
    key.set(h.key); at.set(h.at); h.key = key; h.at = at;
  }
  let c = h.n++;
  h.key[c] = d; h.at[c] = i;
  while (c > 0) { const p = (c - 1) >> 1; if (!less(h, c, p)) break; swap(h, c, p); c = p; }
}
/** Removes the smallest entry; it is left at index h.n (read h.key[h.n], h.at[h.n]). */
export function heapPop(h) {
  const last = --h.n;
  swap(h, 0, last);
  for (let c = 0; ;) {
    const l = 2 * c + 1, r = l + 1;
    let m = c;
    if (l < last && less(h, l, m)) m = l;
    if (r < last && less(h, r, m)) m = r;
    if (m === c) break;
    swap(h, c, m); c = m;
  }
}

export function createPaths(world) {
  let mapRef = null;
  let steps = null; // per tile: bit k set when the D8[k] move from it is valid
  const cache = new Map();

  const walkable = (tx, ty) => world.inBounds(tx, ty) && isWalkGround(world.ground[ty * world.w + tx]);
  /** Valid single step between two 4-adjacent tiles. */
  const step4 = (ax, ay, bx, by) => walkable(bx, by) &&
    Math.abs(world.height[ay * world.w + ax] - world.height[by * world.w + bx]) <= 1;
  /** Valid move from (ax, ay) by (dx, dy), dx and dy in -1..1. */
  function canStep(ax, ay, dx, dy) {
    if (!walkable(ax, ay)) return false;
    if (!dx || !dy) return step4(ax, ay, ax + dx, ay + dy);
    return step4(ax, ay, ax + dx, ay + dy) &&
      step4(ax, ay, ax + dx, ay) && step4(ax + dx, ay, ax + dx, ay + dy) &&
      step4(ax, ay, ax, ay + dy) && step4(ax, ay + dy, ax + dx, ay + dy);
  }

  function sync() {
    if (mapRef === world.height && steps?.length === world.w * world.h) return;
    mapRef = world.height;
    cache.clear();
    steps = stepMasks(world, canStep);
  }

  /** The cached search for `goal`, created (unstarted) on a miss. */
  function search(goal) {
    sync();
    const hit = cache.get(goal);
    if (hit) { cache.delete(goal); cache.set(goal, hit); return hit; }
    const N = world.w * world.h;
    const s = { dist: new Float64Array(N).fill(Infinity), heap: newHeap() };
    if (walkable(goal % world.w, (goal / world.w) | 0)) { s.dist[goal] = 0; heapPush(s.heap, 0, goal); }
    cache.set(goal, s);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return s;
  }

  /** Runs search s until every tile nearer its goal than `start` is settled (all of the goal's
   * component when start is unreachable, or when start is -1). */
  function settle(s, start) {
    const W = world.w, dist = s.dist, h = s.heap;
    if (!h) return; // searched to the end already
    while (h.n > 0 && (start < 0 || h.key[0] <= dist[start])) {
      heapPop(h);
      const d = h.key[h.n], i = h.at[h.n];
      if (d > dist[i]) continue;
      const x = i % W, y = (i - x) / W, m = steps[i];
      for (let k = 0; k < 8; k++) {
        if (!(m & (1 << k))) continue;
        const j = (y + D8[k][1]) * W + x + D8[k][0], nd = d + COST[k];
        if (nd < dist[j]) { dist[j] = nd; heapPush(h, nd, j); }
      }
    }
    if (!h.n) s.heap = null; // finished: drop the heap
  }

  /** Path cost from start tile index to goal tile index (Infinity when unreachable). */
  function distance(start, goal) {
    const s = search(goal);
    settle(s, start);
    return s.dist[start];
  }

  /** The whole distance field to `goal` (Float64Array, Infinity where unreachable), searched to the end. */
  function field(goal) {
    const s = search(goal);
    settle(s, -1);
    return s.dist;
  }

  /** Tile indices from start to goal inclusive, or null when unreachable. */
  function find(start, goal) {
    const s = search(goal);
    settle(s, start);
    const dist = s.dist;
    if (!Number.isFinite(dist[start])) return null;
    const W = world.w, out = [start];
    let cur = start;
    while (cur !== goal) {
      const x = cur % W, y = (cur - x) / W, m = steps[cur];
      let best = -1, bestD = dist[cur];
      for (let k = 0; k < 8; k++) {
        if (!(m & (1 << k))) continue;
        const j = (y + D8[k][1]) * W + x + D8[k][0];
        const nd = dist[j] + COST[k];
        if (dist[j] < bestD && nd <= dist[cur] + 1e-9) { best = j; bestD = dist[j]; }
      }
      if (best < 0) return null;
      out.push(best);
      cur = best;
    }
    return out;
  }

  return { walkable, canStep, find, distance, field, D8 };
}

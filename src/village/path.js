// Tile pathfinding for villagers. Walkable ground is sand, grass and dirt (2, 3, 4); a step may
// change tile height by at most 1. Moves are 8-neighbour; a diagonal must itself change height by at
// most 1 and needs both orthogonal tiles it passes to be valid steps too, so paths never cut a
// cliff corner.
//
// Costs are symmetric, so one Dijkstra field rooted at a goal tile serves every start: a path is a
// walk downhill through the field. Fields are cached per goal (LRU) and dropped when a new map loads.
// The descent gives shortest paths, as A* would, and each goal is searched once.

const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const SQRT2 = Math.SQRT2;
const CACHE_MAX = 96;

export function isWalkGround(g) { return g === 2 || g === 3 || g === 4; }

export function createPaths(world) {
  let mapRef = null;
  const cache = new Map();

  function sync() {
    if (mapRef !== world.height) { mapRef = world.height; cache.clear(); }
  }
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

  function field(goal) {
    sync();
    const hit = cache.get(goal);
    if (hit) { cache.delete(goal); cache.set(goal, hit); return hit; }
    const W = world.w, N = W * world.h;
    const dist = new Float64Array(N).fill(Infinity);
    const gx = goal % W, gy = (goal / W) | 0;
    if (walkable(gx, gy)) {
      dist[goal] = 0;
      // Binary heap of [cost, index]; ties broken by index for determinism.
      const heap = [[0, goal]];
      const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
      const push = (n) => {
        heap.push(n);
        let i = heap.length - 1;
        while (i > 0) { const p = (i - 1) >> 1; if (!less(heap[i], heap[p])) break; [heap[i], heap[p]] = [heap[p], heap[i]]; i = p; }
      };
      const pop = () => {
        const top = heap[0], last = heap.pop();
        if (heap.length) {
          heap[0] = last;
          let i = 0;
          for (;;) {
            const l = 2 * i + 1, r = l + 1;
            let m = i;
            if (l < heap.length && less(heap[l], heap[m])) m = l;
            if (r < heap.length && less(heap[r], heap[m])) m = r;
            if (m === i) break;
            [heap[i], heap[m]] = [heap[m], heap[i]]; i = m;
          }
        }
        return top;
      };
      while (heap.length) {
        const [d, i] = pop();
        if (d > dist[i]) continue;
        const x = i % W, y = (i / W) | 0;
        for (const [dx, dy] of D8) {
          if (!canStep(x, y, dx, dy)) continue;
          const j = (y + dy) * W + x + dx;
          const nd = d + (dx && dy ? SQRT2 : 1);
          if (nd < dist[j]) { dist[j] = nd; push([nd, j]); }
        }
      }
    }
    cache.set(goal, dist);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return dist;
  }

  /** Path cost from start tile index to goal tile index (Infinity when unreachable). */
  function distance(start, goal) { return field(goal)[start]; }

  /** Tile indices from start to goal inclusive, or null when unreachable. */
  function find(start, goal) {
    const dist = field(goal);
    if (!Number.isFinite(dist[start])) return null;
    const W = world.w, out = [start];
    let cur = start;
    while (cur !== goal) {
      const x = cur % W, y = (cur / W) | 0;
      let best = -1, bestD = dist[cur];
      for (const [dx, dy] of D8) {
        if (!canStep(x, y, dx, dy)) continue;
        const j = (y + dy) * W + x + dx;
        const nd = dist[j] + (dx && dy ? SQRT2 : 1);
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

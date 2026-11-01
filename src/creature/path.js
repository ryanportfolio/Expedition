// Creature pathing. Same ground rule as villagers (isWalkGround from the village path module: sand,
// grass, dirt; never water or bare rock), but the giant may cross a height change of up to
// maxStep per step. Moves are 8-neighbour; a diagonal needs both orthogonal tiles it passes to be
// valid steps too, so paths never cut a cliff corner. One Dijkstra field from the creature's tile
// gives the cost to every tile; a path is read back through the predecessor array.
import { isWalkGround } from '../village/path.js';

const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export function createCreaturePaths(world, maxStep = 2) {
  const walkable = (tx, ty) => world.inBounds(tx, ty) && isWalkGround(world.ground[ty * world.w + tx]);
  const step4 = (ax, ay, bx, by) => walkable(bx, by) &&
    Math.abs(world.height[ay * world.w + ax] - world.height[by * world.w + bx]) <= maxStep;
  function canStep(ax, ay, dx, dy) {
    if (!walkable(ax, ay)) return false;
    if (!dx || !dy) return step4(ax, ay, ax + dx, ay + dy);
    return step4(ax, ay, ax + dx, ay + dy) &&
      step4(ax, ay, ax + dx, ay) && step4(ax + dx, ay, ax + dx, ay + dy) &&
      step4(ax, ay, ax, ay + dy) && step4(ax, ay + dy, ax + dx, ay + dy);
  }

  /** { dist: Float64Array, prev: Int32Array } from start tile index (dist Infinity = unreachable). */
  function field(start) {
    const W = world.w, N = W * world.h;
    const dist = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const sx = start % W, sy = (start / W) | 0;
    if (!walkable(sx, sy)) return { dist, prev, start };
    dist[start] = 0;
    const heap = [[0, start]];
    const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
    const swap = (i, j) => { const t = heap[i]; heap[i] = heap[j]; heap[j] = t; };
    while (heap.length) {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && less(heap[l], heap[m])) m = l;
          if (r < heap.length && less(heap[r], heap[m])) m = r;
          if (m === i) break;
          swap(i, m); i = m;
        }
      }
      const [d, i] = top;
      if (d > dist[i]) continue;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of D8) {
        if (!canStep(x, y, dx, dy)) continue;
        const j = (y + dy) * W + x + dx;
        const nd = d + (dx && dy ? Math.SQRT2 : 1);
        if (nd < dist[j]) {
          dist[j] = nd; prev[j] = i;
          heap.push([nd, j]);
          for (let k = heap.length - 1; k > 0;) { const p = (k - 1) >> 1; if (!less(heap[k], heap[p])) break; swap(k, p); k = p; }
        }
      }
    }
    return { dist, prev, start };
  }

  /** Tile indices from the field's start (exclusive) to goal (inclusive), or null when unreachable. */
  function pathTo(f, goal) {
    if (!Number.isFinite(f.dist[goal])) return null;
    const out = [];
    for (let i = goal; i !== f.start; i = f.prev[i]) out.push(i);
    return out.reverse();
  }

  /**
   * Cheapest reachable tile whose centre is within `reach` tiles of point (x, y), or -1.
   * The tile under the point itself counts when walkable.
   */
  function goalNear(f, x, y, reach) {
    const W = world.w;
    let best = -1, bd = Infinity;
    const r = Math.ceil(reach);
    for (let ty = Math.floor(y) - r; ty <= Math.floor(y) + r; ty++)
      for (let tx = Math.floor(x) - r; tx <= Math.floor(x) + r; tx++) {
        if (!world.inBounds(tx, ty)) continue;
        if (Math.hypot(tx + 0.5 - x, ty + 0.5 - y) > reach && !(tx === Math.floor(x) && ty === Math.floor(y))) continue;
        const d = f.dist[ty * W + tx];
        if (d < bd) { bd = d; best = ty * W + tx; }
      }
    return best;
  }

  return { walkable, canStep, field, pathTo, goalNear, D8 };
}

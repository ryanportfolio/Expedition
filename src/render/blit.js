// Sprite blit per spec. Sprite = { w, h, ax, ay, data: Uint8Array(w*h) } of palette indices
// (0 transparent). (x, y) is where the anchor pixel (ax, ay) lands in dst. flipX mirrors the sprite
// about its anchor column, so the anchor stays put. lut maps index -> 0xAABBGGRR. Clips to dst.
export function blit(dst, dw, dh, sprite, x, y, lut, flipX = false) {
  const { w, h, ax, ay, data } = sprite;
  x |= 0; y |= 0;
  const top = y - ay;
  const r0 = Math.max(0, -top), r1 = Math.min(h, dh - top);
  if (r0 >= r1) return;
  // destination column of source column c: x + (c - ax) normally, x - (c - ax) mirrored
  const dir = flipX ? -1 : 1;
  const base = x - dir * ax;
  let c0, c1;
  if (!flipX) { c0 = Math.max(0, -base); c1 = Math.min(w, dw - base); }
  else { c0 = Math.max(0, base - dw + 1); c1 = Math.min(w, base + 1); }
  if (c0 >= c1) return;
  for (let r = r0; r < r1; r++) {
    const srow = r * w, drow = (top + r) * dw + base;
    for (let c = c0; c < c1; c++) {
      const v = data[srow + c];
      if (v) dst[drow + dir * c] = lut[v];
    }
  }
}

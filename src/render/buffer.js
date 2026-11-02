// View buffer: one Uint32Array of 0xAABBGGRR pixels sharing memory with an ImageData (browser only),
// so putImageData shows it without a copy.
export function createViewBuffer(w, h) {
  const data = new Uint32Array(w * h);
  const bytes = new Uint8ClampedArray(data.buffer);
  const image = typeof ImageData !== 'undefined' && w > 0 && h > 0 ? new ImageData(bytes, w, h) : null;
  return { w, h, data, bytes, image };
}

/** '#rrggbb' -> 0xAABBGGRR (opaque). */
export function rgba(hex) {
  const v = parseInt(hex.slice(1, 7), 16);
  return (0xff000000 | ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff)) >>> 0;
}

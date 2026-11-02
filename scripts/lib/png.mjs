// Minimal PNG encoder and decoder on node's zlib. No dependencies.
//
// encodePNG writes 8-bit RGBA (color type 6), or 8-bit RGB (color type 2) with { rgb: true }.
// Rows are stored unfiltered unless { filter: true }, which picks the Paeth filter for every row
// (smaller files for photo-like images; deterministic). decodePNG reads non-interlaced 8-bit
// grayscale, gray+alpha, RGB, RGBA and palette images and returns RGBA bytes.

import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(data, crc32(head.subarray(4, 8))), 0);
  return Buffer.concat([head, data, crc]);
}

const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/**
 * PNG file bytes for a width x height image from RGBA bytes (length width * height * 4).
 * opts.rgb: drop the alpha channel (color type 2); opts.filter: Paeth-filter every row.
 */
export function encodePNG(width, height, rgba, opts = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`encodePNG: bad size ${width}x${height}`);
  }
  if (rgba.length !== width * height * 4) {
    throw new Error(`encodePNG: expected ${width * height * 4} bytes, got ${rgba.length}`);
  }
  const bpp = opts.rgb ? 3 : 4;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = opts.rgb ? 2 : 6; // color type RGB or RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace
  const stride = width * bpp;
  const raw = Buffer.alloc((stride + 1) * height);
  const src = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  const px = Buffer.alloc(stride * height);
  if (bpp === 4) src.copy(px);
  else for (let i = 0, n = width * height; i < n; i++) { px[i * 3] = src[i * 4]; px[i * 3 + 1] = src[i * 4 + 1]; px[i * 3 + 2] = src[i * 4 + 2]; }
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1), row = y * stride;
    if (!opts.filter) {
      raw[o] = 0; // filter: none
      px.copy(raw, o + 1, row, row + stride);
      continue;
    }
    raw[o] = 4; // filter: Paeth
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0, b = y ? px[row - stride + x] : 0, c = x >= bpp && y ? px[row - stride + x - bpp] : 0;
      raw[o + 1 + x] = (px[row + x] - paeth(a, b, c)) & 255;
    }
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Decodes PNG file bytes into { width, height, rgba: Uint8Array(width * height * 4) }.
 * Supports bit depth 8, color types 0 (gray), 2 (RGB), 3 (palette, with tRNS), 4 (gray + alpha)
 * and 6 (RGBA), no interlace. Throws on anything else, on a bad signature or on a CRC mismatch.
 */
export function decodePNG(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('decodePNG: not a PNG file');
  let off = 8, ihdr = null, plte = null, trns = null;
  const idat = [];
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8);
    if (off + 12 + len > buf.length) throw new Error(`decodePNG: truncated ${type} chunk`);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (buf.readUInt32BE(off + 8 + len) !== crc32(buf.subarray(off + 4, off + 8 + len))) throw new Error(`decodePNG: bad CRC in ${type}`);
    if (type === 'IHDR') ihdr = data;
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr || !idat.length) throw new Error('decodePNG: missing IHDR or IDAT');
  const width = ihdr.readUInt32BE(0), height = ihdr.readUInt32BE(4), depth = ihdr[8], ct = ihdr[9];
  if (depth !== 8) throw new Error(`decodePNG: bit depth ${depth} not supported (8 only)`);
  if (ihdr[12] !== 0) throw new Error('decodePNG: interlaced images not supported');
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  if (!bpp) throw new Error(`decodePNG: color type ${ct} not supported`);
  if (ct === 3 && !plte) throw new Error('decodePNG: palette image without PLTE');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  if (raw.length < (stride + 1) * height) throw new Error('decodePNG: image data too short');
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], o = y * (stride + 1) + 1, row = y * stride;
    if (f > 4) throw new Error(`decodePNG: bad filter ${f} on row ${y}`);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0, b = y ? px[row - stride + x] : 0, c = x >= bpp && y ? px[row - stride + x - bpp] : 0;
      const v = raw[o + x];
      px[row + x] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    const s = i * bpp, d = i * 4;
    if (ct === 0) { rgba[d] = rgba[d + 1] = rgba[d + 2] = px[s]; rgba[d + 3] = 255; }
    else if (ct === 4) { rgba[d] = rgba[d + 1] = rgba[d + 2] = px[s]; rgba[d + 3] = px[s + 1]; }
    else if (ct === 2) { rgba[d] = px[s]; rgba[d + 1] = px[s + 1]; rgba[d + 2] = px[s + 2]; rgba[d + 3] = 255; }
    else if (ct === 6) { rgba[d] = px[s]; rgba[d + 1] = px[s + 1]; rgba[d + 2] = px[s + 2]; rgba[d + 3] = px[s + 3]; }
    else {
      const k = px[s];
      if (k * 3 + 2 >= plte.length) throw new Error(`decodePNG: palette index ${k} out of range`);
      rgba[d] = plte[k * 3]; rgba[d + 1] = plte[k * 3 + 1]; rgba[d + 2] = plte[k * 3 + 2];
      rgba[d + 3] = trns && k < trns.length ? trns[k] : 255;
    }
  }
  return { width, height, rgba };
}

// A faster Painter.glow for pixelfx, writing the same light buffer bytes. Adapted from pixelfx's
// glow() and add() (src/core/painter.js), Copyright (c) 2026 Patch, MIT License.
//
// pixelfx's glow(x, y, r, c, k) visits every pixel of the square round the glow's centre and calls
// add(sx, sy, c, f * f * k) for those inside the radius (f = 1 - distance / r). add() multiplies by the
// painter's fade and light strength, drops the pixel when the result is 0.004 or less or the pixel is
// outside the frame, and otherwise adds the color to the light buffer, clamped at 255 per channel.
// Glows are a large share of effect painting (each burning tree throws three big ones, about 50, 90
// and 100 px across), and much of the square adds nothing: its corners lie outside the radius, the
// rim falls under the 0.004 cut, and part of it is often outside the frame.
//
// This version runs the same arithmetic on the same pixels in the same order, minus the ones that
// cannot be written:
// - rows and columns outside the frame (add() returns for them);
// - pixels farther from the centre than re = r * (1 - q) + 1, where q = sqrt(0.004 / (k * strength)) is
//   the f below which f * f * k * strength <= 0.004. The pixel margin (1 px against radii of at most a
//   few hundred) dwarfs floating point error, so every pixel left out fails add()'s cut in the original.
// Every visited pixel still goes through the original's two tests (inside the radius, above the cut).
// The original touches nothing but the light buffer, so the results are byte for byte the same (the
// comparison is described in docs/architecture.md, "Performance"). A NaN strength, which the
// original turns into writes, goes to the original.
import { Painter } from 'pixelfx';

const original = Painter.prototype.glow;

export function glow(x, y, r, c, k = 0.5) {
  if (r < 1 || k <= 0.004) return;
  const ks = this.fade * this.lightK; // add(): k *= this.fade * this.lightK
  if (ks * k <= 0.004) return; // no pixel can pass add()'s cut (f <= 1)
  if (!(ks * k > 0.004)) return original.call(this, x, y, r, c, k);
  const cx = this.toX(x, y), cy = this.toY(x, y);
  const re = Math.min(r, r * (1 - Math.sqrt(0.004 / (k * ks)))) + 1;
  const ox = this.ox, oy = this.oy, w = this.w, L = this.L;
  const y0 = Math.max(Math.floor(cy - r), Math.floor(cy - re), oy);
  const y1 = Math.min(Math.ceil(cy + r), Math.ceil(cy + re), oy + this.h - 1);
  const cr = c & 255, cg = (c >>> 8) & 255, cb = (c >>> 16) & 255;
  for (let sy = y0; sy <= y1; sy++) {
    const DY = sy + 0.5 - cy, dy = DY / r, half = Math.sqrt(Math.max(0, re * re - DY * DY));
    const x0 = Math.max(Math.floor(cx - r), Math.floor(cx - half - 1), ox);
    const x1 = Math.min(Math.ceil(cx + r), Math.ceil(cx + half + 1), ox + w - 1);
    const row = (sy - oy) * w - ox;
    for (let sx = x0; sx <= x1; sx++) {
      const dx = (sx + 0.5 - cx) / r, d = dx * dx + dy * dy;
      if (d >= 1) continue;
      const f = 1 - Math.sqrt(d);
      const kk = f * f * k * ks;
      if (kk <= 0.004) continue;
      const i = row + sx, v = L[i];
      const R = Math.min(255, (v & 255) + cr * kk) | 0;
      const G = Math.min(255, ((v >>> 8) & 255) + cg * kk) | 0;
      const B = Math.min(255, ((v >>> 16) & 255) + cb * kk) | 0;
      L[i] = (255 << 24) | (B << 16) | (G << 8) | R;
    }
  }
}

/** Puts glow() on pixelfx's Painter, for every effect. */
export function installGlow() {
  Painter.prototype.glow = glow;
}

// Display: fixed integer device-pixel scale per game pixel (3 at zoom 1). The game renders a view of
// floor(device px / scale) game pixels; the canvas holds exactly that many pixels and is stretched by
// CSS to view * scale device pixels with image-rendering: pixelated, so each game pixel is a whole
// scale x scale block. The leftover strip (under `scale` device pixels) at the right and bottom edge
// shows the page background, which matches the clear color.

export const BASE_SCALE = 3;
/** Wheel zoom steps, in device pixels per game pixel. zoom = scale / BASE_SCALE. */
export const SCALES = [2, 3, 4, 6];

export function devicePixels(cssW, cssH, dpr) {
  return { w: Math.round(cssW * dpr), h: Math.round(cssH * dpr) };
}
export function viewSize(devW, devH, scale) {
  return { w: Math.floor(devW / scale), h: Math.floor(devH / scale) };
}

export function createDisplay(canvas = null) {
  const display = {
    canvas,
    ctx: null,
    scale: BASE_SCALE,
    dpr: 1,
    cssW: 0,
    cssH: 0,
    devW: 0,
    devH: 0,
    w: 0,
    h: 0,
    /** Bumped whenever w or h changes; the renderer reallocates its buffer on change. */
    version: 0,
    dirty: true,
    get zoom() { return display.scale / BASE_SCALE; },
    /** Pure math: set the window size in CSS px and the device-pixel ratio. No DOM access. */
    setDevice(cssW, cssH, dpr = 1) {
      Object.assign(display, { cssW, cssH, dpr });
      const dev = devicePixels(cssW, cssH, dpr);
      display.devW = dev.w;
      display.devH = dev.h;
      recompute();
    },
    /** Pure math: change the integer scale (one of SCALES). */
    setScale(scale) {
      if (!SCALES.includes(scale)) throw new Error(`scale ${scale} not in ${SCALES}`);
      display.scale = scale;
      recompute();
    },
    /** Step through SCALES; dir +1 zooms in. Returns true when the scale changed. */
    stepScale(dir) {
      const i = SCALES.indexOf(display.scale) + Math.sign(dir);
      if (i < 0 || i >= SCALES.length) return false;
      display.setScale(SCALES[i]);
      return true;
    },
    /** Browser only: read the window size and pixel ratio. */
    fitWindow(win) {
      display.setDevice(win.innerWidth, win.innerHeight, win.devicePixelRatio || 1);
    },
    /** Browser only: apply size changes to the canvas and draw the view image. */
    present(image) {
      if (!canvas) return;
      if (display.dirty) {
        canvas.width = display.w;
        canvas.height = display.h;
        canvas.style.width = `${(display.w * display.scale) / display.dpr}px`;
        canvas.style.height = `${(display.h * display.scale) / display.dpr}px`;
        display.ctx = canvas.getContext('2d');
        display.ctx.imageSmoothingEnabled = false;
        display.dirty = false;
      }
      if (image && image.width === display.w && image.height === display.h) display.ctx.putImageData(image, 0, 0);
    },
  };
  function recompute() {
    const v = viewSize(display.devW, display.devH, display.scale);
    if (v.w !== display.w || v.h !== display.h) display.version++;
    display.w = v.w;
    display.h = v.h;
    display.dirty = true;
  }
  return display;
}

/*
 * Shared Canvas 2D kit for the overview's procedural pictures: the Meet our
 * Icons cinema and the Explore the Lumen home interiors. Pure functions over
 * a 2D context. Nothing here reads the DOM: a caller that needs an offscreen
 * surface passes a `makeCanvas(width, height)` factory, so the math stays
 * testable in Node and every texture repaints identically for a given seed.
 */

/** Mulberry32: a tiny seeded PRNG. Same seed, same sequence, every load. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(a, b, v) {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Sine ease: zero velocity at both ends, so camera moves start and land softly. */
export function easeInOutSine(t) {
  return 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));
}

export function rgba(rgb, alpha) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

/** Linear gradient from a list of [offset, colour] stops. */
export function linear(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [offset, color] of stops) g.addColorStop(offset, color);
  return g;
}

/** Radial gradient from a centre and radius with [offset, colour] stops. */
export function radial(ctx, x, y, r, stops, innerRadius = 0) {
  const g = ctx.createRadialGradient(x, y, innerRadius, x, y, Math.max(r, innerRadius + 0.001));
  for (const [offset, color] of stops) g.addColorStop(offset, color);
  return g;
}

/** A soft light pool: full colour at the centre falling to nothing at the radius. */
export function pool(ctx, x, y, r, rgb, alpha, mode = 'source-over') {
  if (!(r > 0) || !(alpha > 0)) return;
  ctx.save();
  ctx.globalCompositeOperation = mode;
  ctx.fillStyle = radial(ctx, x, y, r, [
    [0, rgba(rgb, alpha)],
    [0.42, rgba(rgb, alpha * 0.38)],
    [1, rgba(rgb, 0)],
  ]);
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

export function tracePolygon(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
}

export function fillPolygon(ctx, points, style) {
  tracePolygon(ctx, points);
  ctx.fillStyle = style;
  ctx.fill();
}

/**
 * Smooth value noise in one channel, built from a few tiny random grids drawn
 * up with bilinear smoothing, each octave half the weight of the last. Cheap
 * (no per-pixel loop at full size) and soft enough for plaster and stone.
 * Returns a canvas whose grey level is the noise and alpha is opaque.
 */
export function valueNoise(makeCanvas, width, height, seed, { cells = 5, octaves = 4 } = {}) {
  const out = makeCanvas(width, height);
  const ctx = out.getContext('2d');
  const random = seededRandom(seed);
  ctx.fillStyle = 'rgb(128, 128, 128)';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  let weight = 0.55;
  for (let octave = 0; octave < octaves; octave += 1) {
    const gx = cells * 2 ** octave + 1;
    const gy = Math.max(2, Math.round((gx * height) / width));
    const grid = makeCanvas(gx, gy);
    const gctx = grid.getContext('2d');
    const image = gctx.createImageData(gx, gy);
    for (let i = 0; i < gx * gy; i += 1) {
      const v = Math.round(random() * 255);
      image.data[i * 4] = v;
      image.data[i * 4 + 1] = v;
      image.data[i * 4 + 2] = v;
      image.data[i * 4 + 3] = 255;
    }
    gctx.putImageData(image, 0, 0);
    ctx.globalAlpha = weight;
    // Half a cell of overscan hides the clamped border row of the upscaled grid.
    const ox = width / (gx - 1) / 2;
    const oy = height / (gy - 1) / 2;
    ctx.drawImage(grid, -ox, -oy, width + ox * 2, height + oy * 2);
    weight *= 0.52;
  }
  ctx.globalAlpha = 1;
  return out;
}

/**
 * Turns a grey noise canvas into a tinted overlay: light where the noise is
 * high, dark where it is low, transparent around the midpoint. Laid over a
 * wall it reads as trowelled plaster or veined stone.
 */
export function mottle(makeCanvas, noise, { light, dark, strength = 0.5, contrast = 2.2 }) {
  const { width, height } = noise;
  const out = makeCanvas(width, height);
  const ctx = out.getContext('2d');
  const source = noise.getContext('2d').getImageData(0, 0, width, height).data;
  const image = ctx.createImageData(width, height);
  const px = image.data;
  for (let i = 0; i < width * height; i += 1) {
    const n = (source[i * 4] / 255 - 0.5) * contrast;
    const tone = n >= 0 ? light : dark;
    px[i * 4] = tone[0];
    px[i * 4 + 1] = tone[1];
    px[i * 4 + 2] = tone[2];
    px[i * 4 + 3] = Math.round(Math.min(1, Math.abs(n)) * strength * 255);
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

/** Fine monochrome grain with a little alpha, for film texture and matte housings. */
export function grain(makeCanvas, size, seed, strength = 0.5) {
  const out = makeCanvas(size, size);
  const ctx = out.getContext('2d');
  const random = seededRandom(seed);
  const image = ctx.createImageData(size, size);
  const px = image.data;
  for (let i = 0; i < size * size; i += 1) {
    const v = random();
    const light = v > 0.5;
    px[i * 4] = light ? 255 : 0;
    px[i * 4 + 1] = light ? 248 : 0;
    px[i * 4 + 2] = light ? 236 : 0;
    px[i * 4 + 3] = Math.round(Math.abs(v - 0.5) * 2 * strength * 255);
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

/**
 * The scallop a wall light throws along a flat wall: a cone meeting a plane
 * parallel to its axis cuts a hyperbola, so the half width grows as
 * w0 * sqrt(1 + (s / knee)^2) with distance s from the opening. Six nested
 * spreads build a soft penumbra; intensity falls off along the reach.
 * `dir` is -1 for an uplight, 1 for a downlight. Screen-blended.
 */
export function hyperbolicWash(ctx, x, y0, dir, { reach, width, knee, glow = 1, rgb = [255, 206, 148], hot = [255, 228, 190] }) {
  const steps = 20;
  const halfWidth = (s, spread) => width * spread * Math.sqrt(1 + (s / knee) ** 2);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (const [spread, alpha] of [
    [1.4, 0.06],
    [1.26, 0.08],
    [1.12, 0.1],
    [1, 0.12],
    [0.88, 0.14],
    [0.76, 0.16],
  ]) {
    ctx.beginPath();
    for (let i = 0; i <= steps; i += 1) {
      const s = (i / steps) * reach;
      const px = x - halfWidth(s, spread);
      const py = y0 + dir * s;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    for (let i = steps; i >= 0; i -= 1) {
      const s = (i / steps) * reach;
      ctx.lineTo(x + halfWidth(s, spread), y0 + dir * s);
    }
    ctx.closePath();
    ctx.fillStyle = linear(ctx, 0, y0, 0, y0 + dir * reach, [
      [0, rgba(rgb, alpha * glow * 1.7)],
      [0.24, rgba(rgb, alpha * glow)],
      [0.68, rgba(rgb, alpha * glow * 0.32)],
      [1, rgba(rgb, 0)],
    ]);
    ctx.fill();
  }
  ctx.restore();
  pool(ctx, x, y0 + dir * knee * 0.4, knee * 2, hot, 0.56 * glow, 'screen');
}

/** Darkens the frame edges like a lens: transparent centre, soft umber corners. */
export function vignette(ctx, width, height, strength = 0.55, rgb = [12, 10, 8]) {
  const r = Math.hypot(width, height) / 2;
  ctx.save();
  ctx.fillStyle = radial(ctx, width / 2, height / 2, r, [
    [0, rgba(rgb, 0)],
    [0.55, rgba(rgb, strength * 0.18)],
    [1, rgba(rgb, strength)],
  ]);
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

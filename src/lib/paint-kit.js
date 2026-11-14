/*
 * Canvas 2D kit for the overview's film, Meet our Icons. Pure functions over
 * a 2D context. Nothing here reads the DOM: a caller that needs an offscreen
 * surface passes a `makeCanvas(width, height)` factory, so the math stays
 * testable in Node and every texture repaints identically for a given seed.
 * The Explore the Lumen home rooms are smooth SVG vectors and use none of it.
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

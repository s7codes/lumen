// The grade: linear light passes in, display-ready sRGB out. One code path
// for stills and film frames, so a poster and frame 0 of its loop match.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORK = join(ROOT, 'scripts', 'media', '.work');

export const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
export const PASSES = `${WORK}/passes`;

export function loadPass(shot, pass) {
  const meta = JSON.parse(readFileSync(`${PASSES}/${shot}/${pass}.json`, 'utf8'));
  const buf = readFileSync(`${PASSES}/${shot}/${pass}.f32`);
  const data = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  // A rare NaN or Inf sample (a degenerate path) would smear through every
  // blur downstream: replace it with its left neighbour.
  for (let i = 0; i < data.length; i += 1) if (!Number.isFinite(data[i])) data[i] = i >= 3 ? data[i - 3] : 0;
  return { w: meta.w, h: meta.h, data };
}

export function loadShot(shot, names) {
  const out = {};
  for (const name of names) out[name] = loadPass(shot, name);
  return out;
}

/** Weighted sum of passes; weights may be numbers or [r, g, b] gains. */
export function compose(passes, weights, into = null) {
  const names = Object.keys(weights).filter((n) => passes[n]);
  const { w, h } = passes[names[0]];
  const out = into ?? new Float32Array(w * h * 3);
  out.fill(0);
  for (const name of names) {
    const wt = weights[name];
    const [wr, wg, wb] = Array.isArray(wt) ? wt : [wt, wt, wt];
    if (wr === 0 && wg === 0 && wb === 0) continue;
    const src = passes[name].data;
    for (let i = 0; i < out.length; i += 3) {
      out[i] += src[i] * wr;
      out[i + 1] += src[i + 1] * wg;
      out[i + 2] += src[i + 2] * wb;
    }
  }
  return { w, h, data: out };
}

/* ---------- glare ---------- */

function boxBlurH(src, dst, w, h, r) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y += 1) {
    let sr = 0;
    let sg = 0;
    let sb = 0;
    const row = y * w * 3;
    for (let x = -r; x <= r; x += 1) {
      const i = row + Math.min(w - 1, Math.max(0, x)) * 3;
      sr += src[i];
      sg += src[i + 1];
      sb += src[i + 2];
    }
    for (let x = 0; x < w; x += 1) {
      const o = row + x * 3;
      dst[o] = sr * inv;
      dst[o + 1] = sg * inv;
      dst[o + 2] = sb * inv;
      const add = row + Math.min(w - 1, x + r + 1) * 3;
      const sub = row + Math.max(0, x - r) * 3;
      sr += src[add] - src[sub];
      sg += src[add + 1] - src[sub + 1];
      sb += src[add + 2] - src[sub + 2];
    }
  }
}

function boxBlurV(src, dst, w, h, r) {
  const inv = 1 / (2 * r + 1);
  for (let x = 0; x < w; x += 1) {
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let y = -r; y <= r; y += 1) {
      const i = (Math.min(h - 1, Math.max(0, y)) * w + x) * 3;
      sr += src[i];
      sg += src[i + 1];
      sb += src[i + 2];
    }
    for (let y = 0; y < h; y += 1) {
      const o = (y * w + x) * 3;
      dst[o] = sr * inv;
      dst[o + 1] = sg * inv;
      dst[o + 2] = sb * inv;
      const add = (Math.min(h - 1, y + r + 1) * w + x) * 3;
      const sub = (Math.max(0, y - r) * w + x) * 3;
      sr += src[add] - src[sub];
      sg += src[add + 1] - src[sub + 1];
      sb += src[add + 2] - src[sub + 2];
    }
  }
}

/** Gaussian-like blur from three box passes, on a quarter-size copy. */
function blurQuarter(img, w, h, radiusPx) {
  const qw = Math.ceil(w / 4);
  const qh = Math.ceil(h / 4);
  const q = new Float32Array(qw * qh * 3);
  for (let y = 0; y < qh; y += 1) {
    for (let x = 0; x < qw; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = 0; dy < 4; dy += 1) {
        const sy = y * 4 + dy;
        if (sy >= h) continue;
        for (let dx = 0; dx < 4; dx += 1) {
          const sx = x * 4 + dx;
          if (sx >= w) continue;
          const i = (sy * w + sx) * 3;
          r += img[i];
          g += img[i + 1];
          b += img[i + 2];
          n += 1;
        }
      }
      const o = (y * qw + x) * 3;
      q[o] = r / n;
      q[o + 1] = g / n;
      q[o + 2] = b / n;
    }
  }
  const tmp = new Float32Array(q.length);
  const r = Math.max(1, Math.round(radiusPx / 4 / 1.7));
  for (let k = 0; k < 3; k += 1) {
    boxBlurH(q, tmp, qw, qh, r);
    boxBlurV(tmp, q, qw, qh, r);
  }
  return { q, qw, qh };
}

function sampleQuarter({ q, qw, qh }, x, y, out) {
  const fx = Math.min(qw - 1.001, Math.max(0, x / 4 - 0.375));
  const fy = Math.min(qh - 1.001, Math.max(0, y / 4 - 0.375));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const i00 = (y0 * qw + x0) * 3;
  const i10 = i00 + 3;
  const i01 = i00 + qw * 3;
  const i11 = i01 + 3;
  for (let c = 0; c < 3; c += 1) {
    out[c] = (q[i00 + c] * (1 - tx) + q[i10 + c] * tx) * (1 - ty) + (q[i01 + c] * (1 - tx) + q[i11 + c] * tx) * ty;
  }
}

/**
 * Lens glare: whatever burns past `threshold` (scene-linear, after
 * exposure) spreads in two soft lobes, a tight halo and a wide veil.
 */
export function glare(img, { exposure = 1, threshold = 2.5, tight = 0.08, wide = 0.035, tightPx = 10, widePx = 70 } = {}) {
  const { w, h, data } = img;
  const bright = new Float32Array(data.length);
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i] * exposure;
    const g = data[i + 1] * exposure;
    const b = data[i + 2] * exposure;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const k = l > threshold ? (l - threshold) / Math.max(l, 1e-6) : 0;
    bright[i] = r * k;
    bright[i + 1] = g * k;
    bright[i + 2] = b * k;
  }
  const a = blurQuarter(bright, w, h, tightPx);
  const b = blurQuarter(bright, w, h, widePx);
  const ta = [0, 0, 0];
  const tb = [0, 0, 0];
  const out = new Float32Array(data.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 3;
      sampleQuarter(a, x, y, ta);
      sampleQuarter(b, x, y, tb);
      out[i] = data[i] + (ta[0] * tight + tb[0] * wide) / exposure;
      out[i + 1] = data[i + 1] + (ta[1] * tight + tb[1] * wide) / exposure;
      out[i + 2] = data[i + 2] + (ta[2] * tight + tb[2] * wide) / exposure;
    }
  }
  return { w, h, data: out };
}

/* ---------- tone ---------- */

const MIN_EV = -12.47393;
const MAX_EV = 4.026069;

function agxContrast(x) {
  const x2 = x * x;
  const x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

/** three.js AgXToneMapping, linear sRGB in and out. */
export function agx(r, g, b, out) {
  // sRGB -> Rec.2020
  let R = 0.6274 * r + 0.3293 * g + 0.0433 * b;
  let G = 0.0691 * r + 0.9195 * g + 0.0113 * b;
  let B = 0.0164 * r + 0.088 * g + 0.8956 * b;
  // Inset
  const ir = 0.856627153315983 * R + 0.0951212405381588 * G + 0.0482516061458583 * B;
  const ig = 0.137318972929847 * R + 0.761241990602591 * G + 0.101439036467562 * B;
  const ib = 0.11189821299995 * R + 0.0767994186031903 * G + 0.811302368396859 * B;
  const enc = (v) => {
    const l = (Math.log2(Math.max(v, 1e-10)) - MIN_EV) / (MAX_EV - MIN_EV);
    return agxContrast(l < 0 ? 0 : l > 1 ? 1 : l);
  };
  R = enc(ir);
  G = enc(ig);
  B = enc(ib);
  // Outset
  const or = 1.1271005818144368 * R - 0.11060664309660323 * G - 0.016493938717834573 * B;
  const og = -0.1413297634984383 * R + 1.157823702216272 * G - 0.016493938717834257 * B;
  const ob = -0.14132976349843826 * R - 0.11060664309660294 * G + 1.2519364065950405 * B;
  const lr = Math.max(0, or) ** 2.2;
  const lg = Math.max(0, og) ** 2.2;
  const lb = Math.max(0, ob) ** 2.2;
  // Rec.2020 -> sRGB
  out[0] = Math.min(1, Math.max(0, 1.6605 * lr - 0.5876 * lg - 0.0728 * lb));
  out[1] = Math.min(1, Math.max(0, -0.1246 * lr + 1.1329 * lg - 0.0083 * lb));
  out[2] = Math.min(1, Math.max(0, -0.0182 * lr - 0.1006 * lg + 1.1187 * lb));
}

const SRGB_LUT = new Uint8Array(4097);
for (let i = 0; i <= 4096; i += 1) {
  const v = i / 4096;
  SRGB_LUT[i] = Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
}

/**
 * Display transform: exposure, white balance, AgX, then a gentle look
 * (saturation and an S-curve around mid grey) and an optional vignette.
 * Writes 8-bit RGB.
 */
export function develop(img, { exposure = 1, wb = [1, 1, 1], saturation = 1.12, contrast = 1.06, vignette = 0.08, lift = 0, out = null } = {}) {
  const { w, h, data } = img;
  const bytes = out ?? new Uint8Array(w * h * 3);
  const t = [0, 0, 0];
  const cx = w / 2;
  const cy = h / 2;
  const rmax = Math.hypot(cx, cy);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 3;
      const d = Math.hypot(x - cx, y - cy) / rmax;
      const vig = 1 - vignette * d * d * d;
      const k = exposure * vig;
      agx(data[i] * k * wb[0], data[i + 1] * k * wb[1], data[i + 2] * k * wb[2], t);
      // Look: saturation round luma, then a soft S-curve.
      const l = 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
      for (let c = 0; c < 3; c += 1) {
        let v = l + (t[c] - l) * saturation;
        v = 0.18 * (v / 0.18) ** contrast;
        v = lift + v * (1 - lift);
        t[c] = v < 0 ? 0 : v > 1 ? 1 : v;
      }
      bytes[i] = SRGB_LUT[Math.round(t[0] * 4096)];
      bytes[i + 1] = SRGB_LUT[Math.round(t[1] * 4096)];
      bytes[i + 2] = SRGB_LUT[Math.round(t[2] * 4096)];
    }
  }
  return { w, h, bytes };
}

/** Bilinear crop-and-scale of a linear image: frame [x0, y0, cw, ch] to ow x oh. */
export function resample(img, [x0, y0, cw, ch], ow, oh, into = null) {
  const { w, h, data } = img;
  const out = into ?? new Float32Array(ow * oh * 3);
  const sx = cw / ow;
  const sy = ch / oh;
  // Box-filter when shrinking more than 1.5x keeps the grain of the stone clean.
  const taps = Math.max(1, Math.round(Math.min(sx, sy)));
  for (let y = 0; y < oh; y += 1) {
    for (let x = 0; x < ow; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let ty = 0; ty < taps; ty += 1) {
        for (let tx = 0; tx < taps; tx += 1) {
          const fx = Math.min(w - 1.001, Math.max(0, x0 + (x + (tx + 0.5) / taps) * sx - 0.5));
          const fy = Math.min(h - 1.001, Math.max(0, y0 + (y + (ty + 0.5) / taps) * sy - 0.5));
          const ix = Math.floor(fx);
          const iy = Math.floor(fy);
          const ax = fx - ix;
          const ay = fy - iy;
          const i00 = (iy * w + ix) * 3;
          const i10 = i00 + 3;
          const i01 = i00 + w * 3;
          const i11 = i01 + 3;
          r += (data[i00] * (1 - ax) + data[i10] * ax) * (1 - ay) + (data[i01] * (1 - ax) + data[i11] * ax) * ay;
          g += (data[i00 + 1] * (1 - ax) + data[i10 + 1] * ax) * (1 - ay) + (data[i01 + 1] * (1 - ax) + data[i11 + 1] * ax) * ay;
          b += (data[i00 + 2] * (1 - ax) + data[i10 + 2] * ax) * (1 - ay) + (data[i01 + 2] * (1 - ax) + data[i11 + 2] * ax) * ay;
        }
      }
      const n = taps * taps;
      const o = (y * ow + x) * 3;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
    }
  }
  return { w: ow, h: oh, data: out };
}

/** Replaces isolated outliers (fireflies) with the median of their 3x3 neighbourhood. */
export function fireflies(img, { ratio = 3 } = {}) {
  const { w, h, data } = img;
  const out = new Float32Array(data);
  const lum = (i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  const ring = new Float32Array(8);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const c = (y * w + x) * 3;
      const lc = lum(c);
      let k = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (dx || dy) ring[k++] = lum(((y + dy) * w + x + dx) * 3);
      const sorted = Array.from(ring).sort((a, b) => a - b);
      const med = (sorted[3] + sorted[4]) / 2;
      if (lc > ratio * med + 0.05 && lc > sorted[7] * 1.4) {
        const s = (med + 1e-6) / (lc + 1e-6);
        out[c] = data[c] * s;
        out[c + 1] = data[c + 1] * s;
        out[c + 2] = data[c + 2] * s;
      }
    }
  }
  return { w, h, data: out };
}

/** Edge-aware smoothing of residual Monte Carlo noise (a small bilateral pass). */
export function denoise(img, { radius = 2, sigmaL = 0.06, strength = 1 } = {}) {
  const { w, h, data } = img;
  const out = new Float32Array(data.length);
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) lum[i] = Math.log2(1e-4 + 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2]);
  const inv2s = 1 / (2 * sigmaL * sigmaL * 100);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const c = y * w + x;
      const lc = lum[c];
      let r = 0;
      let g = 0;
      let b = 0;
      let ws = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const n = yy * w + xx;
          const dl = lum[n] - lc;
          const wt = Math.exp(-(dl * dl) * inv2s - (dx * dx + dy * dy) / (2 * radius * radius));
          r += data[n * 3] * wt;
          g += data[n * 3 + 1] * wt;
          b += data[n * 3 + 2] * wt;
          ws += wt;
        }
      }
      out[c * 3] = data[c * 3] + (r / ws - data[c * 3]) * strength;
      out[c * 3 + 1] = data[c * 3 + 1] + (g / ws - data[c * 3 + 1]) * strength;
      out[c * 3 + 2] = data[c * 3 + 2] + (b / ws - data[c * 3 + 2]) * strength;
    }
  }
  return { w, h, data: out };
}

/** Writes 8-bit RGB through ffmpeg: .png, or .webp at a given quality. */
export function writeImage(path, { w, h, bytes }, { quality = 86, scale = null } = {}) {
  const vf = scale ? ['-vf', `scale=${scale[0]}:${scale[1]}:flags=lanczos+accurate_rnd+full_chroma_int`] : [];
  const codec = path.endsWith('.webp') ? ['-c:v', 'libwebp', '-quality', String(quality), '-preset', 'photo', '-compression_level', '6'] : [];
  const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`, '-i', '-', ...vf, ...codec, '-frames:v', '1', path], { input: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(r.stderr.toString());
}

/** A raw-frame pipe into ffmpeg; returns { write(bytes), close() }. */
export function videoPipe(path, w, h, fps, args) {
  const proc = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`, '-r', String(fps), '-i', '-', ...args, path], { stdio: ['pipe', 'inherit', 'inherit'] });
  return {
    write(bytes) {
      return new Promise((resolve) => {
        if (proc.stdin.write(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))) resolve();
        else proc.stdin.once('drain', resolve);
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
        proc.stdin.end();
      });
    },
  };
}

/**
 * Linear lens glare: the whole image through a point-spread function with a
 * narrow halo and a wide veil. Linear in the input, so it can be applied to
 * each light pass once and any weighted sum of glared passes is the glare of
 * the sum. Bright LEDs bloom; a plaster wall barely changes.
 */
export function veil(img, { halo = 0.045, wide = 0.022, haloPx = 9, widePx = 64 } = {}) {
  const { w, h, data } = img;
  const a = blurQuarter(data, w, h, haloPx);
  const b = blurQuarter(data, w, h, widePx);
  const ta = [0, 0, 0];
  const tb = [0, 0, 0];
  const keep = 1 - halo - wide;
  const out = new Float32Array(data.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 3;
      sampleQuarter(a, x, y, ta);
      sampleQuarter(b, x, y, tb);
      out[i] = data[i] * keep + ta[0] * halo + tb[0] * wide;
      out[i + 1] = data[i + 1] * keep + ta[1] * halo + tb[1] * wide;
      out[i + 2] = data[i + 2] * keep + ta[2] * halo + tb[2] * wide;
    }
  }
  return { w, h, data: out };
}

/** Pass cleanup before the grade: fireflies out, a light edge-aware smooth. */
export function clean(img, { radius = 3, sigmaL = 0.045, strength = 0.9 } = {}) {
  return denoise(fireflies(img), { radius, sigmaL, strength });
}

/** Loads the rasterised guides of a shot, or null when they are not there. */
export function loadGuides(shot) {
  try {
    const albedo = loadPass(shot, 'aux-albedo');
    const normal = loadPass(shot, 'aux-normal');
    const depth = loadPass(shot, 'aux-depth');
    return { albedo, normal, depth };
  } catch {
    return null;
  }
}

/**
 * Guided denoiser: an edge-aware a-trous wavelet filter (the spatial half of
 * SVGF) on albedo-demodulated light. Texture lives in the albedo guide, so
 * the light underneath can be smoothed hard across a wall while normals,
 * depth and strong light edges (a scallop's rim, a shadow) stop the kernel.
 * Pixels with no geometry (the sky through a window) pass through untouched.
 */
export function guidedDenoise(img, guides, { levels = 5, sigmaN = 96, sigmaZ = 0.012, sigmaL = 0.42 } = {}) {
  const { w, h, data } = img;
  const A = guides.albedo.data;
  const N = guides.normal.data;
  const Z = guides.depth.data;
  const n = w * h;
  const eps = 0.03;
  let irr = new Float32Array(n * 3);
  const valid = new Uint8Array(n);
  const lum = new Float32Array(n);
  const nx = new Float32Array(n);
  const ny = new Float32Array(n);
  const nz = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const z = Z[i * 3];
    valid[i] = z > 1e-4 ? 1 : 0;
    for (let c = 0; c < 3; c += 1) irr[i * 3 + c] = valid[i] ? data[i * 3 + c] / Math.max(A[i * 3 + c], eps) : data[i * 3 + c];
    const vx = N[i * 3] * 2 - 1;
    const vy = N[i * 3 + 1] * 2 - 1;
    const vz = N[i * 3 + 2] * 2 - 1;
    const l = Math.hypot(vx, vy, vz) || 1;
    nx[i] = vx / l;
    ny[i] = vy / l;
    nz[i] = vz / l;
  }
  const kernel = [1 / 16, 1 / 4, 3 / 8, 1 / 4, 1 / 16];
  let next = new Float32Array(n * 3);
  for (let level = 0; level < levels; level += 1) {
    const step = 1 << level;
    for (let i = 0; i < n; i += 1) lum[i] = Math.log2(1e-4 + 0.2126 * irr[i * 3] + 0.7152 * irr[i * 3 + 1] + 0.0722 * irr[i * 3 + 2]);
    // Light edges tighten at the coarse levels, where a leak would travel far.
    const sl = sigmaL * (level < 2 ? 1 : 0.75);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const p = y * w + x;
        if (!valid[p]) {
          next[p * 3] = irr[p * 3];
          next[p * 3 + 1] = irr[p * 3 + 1];
          next[p * 3 + 2] = irr[p * 3 + 2];
          continue;
        }
        const zp = Z[p * 3];
        const lp = lum[p];
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let sw = 0;
        for (let j = -2; j <= 2; j += 1) {
          const yy = y + j * step;
          if (yy < 0 || yy >= h) continue;
          const kj = kernel[j + 2];
          for (let i = -2; i <= 2; i += 1) {
            const xx = x + i * step;
            if (xx < 0 || xx >= w) continue;
            const q = yy * w + xx;
            if (!valid[q]) continue;
            const dn = nx[p] * nx[q] + ny[p] * ny[q] + nz[p] * nz[q];
            if (dn <= 0) continue;
            const wn = dn ** sigmaN;
            const wz = Math.exp(-Math.abs(zp - Z[q * 3]) / (sigmaZ * zp * step + 1e-6));
            const wl = Math.exp(-Math.abs(lp - lum[q]) / sl);
            const wt = kj * kernel[i + 2] * wn * wz * wl;
            sr += irr[q * 3] * wt;
            sg += irr[q * 3 + 1] * wt;
            sb += irr[q * 3 + 2] * wt;
            sw += wt;
          }
        }
        next[p * 3] = sr / sw;
        next[p * 3 + 1] = sg / sw;
        next[p * 3 + 2] = sb / sw;
      }
    }
    [irr, next] = [next, irr];
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    for (let c = 0; c < 3; c += 1) out[i * 3 + c] = valid[i] ? irr[i * 3 + c] * Math.max(A[i * 3 + c], eps) : irr[i * 3 + c];
  }
  return { w, h, data: out };
}

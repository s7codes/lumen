// Turns rendered light passes into the shipped media: graded WebP stills and
// seamless 60 fps films (VP9 WebM and H.264 MP4) composed from the passes.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { clean, compose, develop, FFMPEG, fireflies, guidedDenoise, loadGuides, loadPass, resample, veil, videoPipe, writeImage } from './grade-lib.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORK = join(ROOT, 'scripts', 'media', '.work');

const PUBLIC = join(ROOT, 'public', 'media');
const TMP = `${WORK}/media-tmp`;
mkdirSync(TMP, { recursive: true });
const TAU = Math.PI * 2;

export const DAY_GRADE = { exposure: 1.0, wb: [0.97, 1.0, 1.04], saturation: 1.0, contrast: 1.06, vignette: 0.07 };

/** Loads, cleans and glares every pass of a shot once. */
export function preparedPasses(shot, names, { denoise = true, windowGain = 1 } = {}) {
  const out = {};
  const guides = denoise ? loadGuides(shot) : null;
  for (const name of names) {
    let p = loadPass(shot, name);
    if (guides) {
      // Guided: fireflies out, then the a-trous filter on demodulated light.
      const soft = name !== 'sky' && name !== 'sun';
      p = guidedDenoise(fireflies(p), guides, soft ? { levels: 5, sigmaL: 0.5 } : { levels: 4, sigmaL: 0.36 });
      // The view through a window (no geometry under the pixel) reads bright,
      // as an interior photograph exposes it; the light it casts is untouched.
      if (name === 'sky' && windowGain !== 1) {
        const Z = guides.depth.data;
        for (let i = 0; i < Z.length / 3; i += 1) {
          if (Z[i * 3] <= 1e-4) for (let c = 0; c < 3; c += 1) p.data[i * 3 + c] *= windowGain;
        }
      }
      out[name] = veil(p);
      continue;
    }
    // LED passes are mostly soft indirect light: they take a wider smooth.
    if (denoise) p = name === 'sky' || name === 'sun' ? clean(p) : clean(clean(p, { radius: 4, sigmaL: 0.06, strength: 1 }), { radius: 2, sigmaL: 0.05, strength: 0.8 });
    out[name] = veil(p);
  }
  return out;
}

function weightsAt(spec, t) {
  const w = {};
  for (const [name, value] of Object.entries(spec)) w[name] = typeof value === 'function' ? value(t) : value;
  return w;
}

/** One still: weights, grade, optional crop, and the sizes to write. */
export function writeStill(passes, weights, grade, outputs) {
  const img = compose(passes, weights);
  for (const { path, width, height, quality = 84 } of outputs) {
    const sized = width === img.w && height === img.h ? img : resample(img, [0, 0, img.w, img.h], width, height);
    writeImage(path, develop(sized, grade), { quality });
  }
}

const ENCODERS = {
  webm: (crf) => ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(crf), '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', '-tile-columns', '2', '-frame-parallel', '0', '-auto-alt-ref', '1', '-lag-in-frames', '25', '-g', '240', '-pix_fmt', 'yuv420p', '-an'],
  mp4: (crf) => ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-g', '120', '-an'],
};

/** Encodes the deliverables from a lossless intermediate. */
export function encodeFilm(master, base, { webmCrf = 34, mp4Crf = 24, poster = null } = {}) {
  for (const [ext, args] of Object.entries(ENCODERS)) {
    const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', master, ...args(ext === 'webm' ? webmCrf : mp4Crf), `${base}.${ext}`]);
    if (r.status !== 0) throw new Error(r.stderr.toString());
  }
  if (poster) {
    // Back to RGB from the BT.709 master first: libwebp then makes its own (601) YUV.
    const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', master, '-frames:v', '1', '-vf', 'scale=in_color_matrix=bt709:in_range=tv,format=bgra', '-c:v', 'libwebp', '-quality', String(poster.quality ?? 82), '-preset', 'photo', '-compression_level', '6', `${base}.webp`]);
    if (r.status !== 0) throw new Error(r.stderr.toString());
  }
}

/**
 * A film composed from passes: `spec` maps pass names to constant weights or
 * functions of t, `zoom(t)` gives a crop factor about `focus` (0..1 frame
 * coordinates). Frame i is t = i / fps over `seconds`, so periodic functions
 * loop without a seam.
 */
export async function composeFilm(passes, spec, grade, { seconds, fps = 60, width, height, zoom = () => 1, focus = [0.5, 0.5], master }) {
  const frames = Math.round(seconds * fps);
  // BT.709 limited range, tagged, so a browser decodes the film to the same colours as its still.
  const pipe = videoPipe(master, width, height, fps, ['-vf', 'scale=out_color_matrix=bt709:out_range=tv', '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'yuv444p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']);
  const first = passes[Object.keys(passes)[0]];
  const t0 = Date.now();
  for (let i = 0; i < frames; i += 1) {
    const t = i / fps;
    const img = compose(passes, weightsAt(spec, t));
    const z = zoom(t);
    const cw = first.w / z;
    const ch = first.h / z;
    const x0 = (first.w - cw) * focus[0];
    const y0 = (first.h - ch) * focus[1];
    const frame = resample(img, [x0, y0, cw, ch], width, height);
    await pipe.write(develop(frame, typeof grade === 'function' ? grade(t) : grade).bytes);
    if (i % 60 === 0) process.stdout.write(`  frame ${i}/${frames} ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  }
  await pipe.close();
}

export const cosLoop = (seconds, lo, hi, phase = 0) => (t) => lo + (hi - lo) * (0.5 - 0.5 * Math.cos(TAU * (t / seconds + phase)));
export { PUBLIC, TMP, existsSync, rmSync };

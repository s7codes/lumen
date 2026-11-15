// Meet our Icons: real camera footage. Fetches the three Pexels clips of the
// reel from the Pexels video CDN (or reuses the copies in .work/footage),
// checks each against its SHA-256, cuts ICON_FILM_SECONDS from its in point,
// scales it to 1920 x 1080 at 29.97 fps with Lanczos and grades it lightly
// (one calm contrast, saturation and gamma pass, BT.709 throughout) into a
// lossless FFV1 master. The masters are then encoded as VP9 WebM, H.264 MP4
// with fast start and a WebP poster of frame 0 into public/media/icons/.
//
// The clips are camera originals under the Pexels License (use and
// modification allowed, no attribution required). Their titles, authors and
// pages are credited in src/lib/media-manifest.js (ICONS_MEDIA).
//
// Usage: FFMPEG=/path/to/ffmpeg node scripts/media/make-footage.mjs [pendant plaster stair]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeFilm, PUBLIC } from './build-media.mjs';
import { FFMPEG } from './grade-lib.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORK = join(ROOT, 'scripts', 'media', '.work', 'footage');
const { ICONS_MEDIA, ICONS_SIZE } = await import(new URL('../../src/lib/media-manifest.js', import.meta.url));
const { ICON_FILM_SECONDS, REEL_IDS } = await import(new URL('../../src/lib/icons-reel.js', import.meta.url));

// In points were picked frame by frame: the pendant drifts along its glowing
// underside, the plaster tilt rises from the rattan pendant to the arched
// niche, and the stair starts once the foreground has left the left edge.
const CLIPS = [
  {
    id: 'pendant',
    pexels: 39024324,
    source: 'https://videos.pexels.com/video-files/39024324/16605508_3840_2160_30fps.mp4',
    sha256: '85e8d82af5aed7491caa149284eb2d5223453989afcc070f5c372007384feb5b',
    start: 0.3,
    grade: 'eq=contrast=1.04:saturation=0.94:gamma=0.98',
    rate: { webmCrf: 27, mp4Crf: 20 },
  },
  {
    id: 'plaster',
    pexels: 35660680,
    source: 'https://videos.pexels.com/video-files/35660680/15111832_1920_1080_60fps.mp4',
    sha256: '885fc9e9954f046423fa6ae4539830e8d6723dd296807ed5bc37446020cdaa65',
    start: 1.6,
    grade: 'eq=contrast=1.05:brightness=-0.035:saturation=0.86:gamma=0.94',
    rate: { webmCrf: 30, mp4Crf: 21 },
  },
  {
    id: 'stair',
    pexels: 39024320,
    source: 'https://videos.pexels.com/video-files/39024320/16605538_3840_2160_30fps.mp4',
    sha256: 'bd4d1f0e4bf8de50149becfd83bff173870feaec22f476c41d3acdb29849972e',
    start: 3.8,
    grade: 'eq=contrast=1.03:saturation=0.86:gamma=0.97',
    rate: { webmCrf: 27, mp4Crf: 20 },
  },
];

// Each clip has its own rate. The soft, defocused pendant and stair keep
// their wood grain and lens texture only at a low CRF (VP9 at 33 smooths
// them to wax); the sharp plaster tilt holds its detail a step coarser.
// Every file stays inside the library budget (4 MB WebM, 5 MB MP4, 420 KB
// poster).
const POSTER = { quality: 84 };

if (CLIPS.map((clip) => clip.id).join() !== REEL_IDS.join()) throw new Error('make-footage: the clips must follow ICON_REEL order');

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** The verified camera original for a clip, fetched once into .work/footage. */
async function original(clip) {
  const file = join(WORK, `pexels-${clip.pexels}.mp4`);
  if (existsSync(file) && sha256(file) === clip.sha256) return file;
  const res = await fetch(clip.source);
  if (!res.ok) throw new Error(`${clip.id}: ${clip.source} answered ${res.status}`);
  const part = `${file}.part`;
  writeFileSync(part, Buffer.from(await res.arrayBuffer()));
  const digest = sha256(part);
  if (digest !== clip.sha256) throw new Error(`${clip.id}: SHA-256 ${digest} does not match the pinned ${clip.sha256}`);
  renameSync(part, file);
  return file;
}

function run(args) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
}

/** Cut, scale and grade into a lossless BT.709 master, frame 0 at the in point. */
function master(clip, input) {
  const out = join(WORK, `${ICONS_MEDIA[clip.id].base}.mkv`);
  const { width, height } = ICONS_SIZE;
  const vf = [
    'fps=30000/1001',
    `scale=${width}:${height}:flags=lanczos+accurate_rnd+full_chroma_int:in_color_matrix=bt709:out_color_matrix=bt709:in_range=tv:out_range=tv`,
    clip.grade,
    'format=yuv444p',
  ].join(',');
  run(['-ss', String(clip.start), '-i', input, '-t', String(ICON_FILM_SECONDS), '-an', '-vf', vf, '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'yuv444p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', out]);
  return out;
}

mkdirSync(WORK, { recursive: true });
mkdirSync(join(PUBLIC, 'icons'), { recursive: true });
const only = process.argv.slice(2);
for (const clip of CLIPS) {
  if (only.length && !only.includes(clip.id)) continue;
  const base = join(PUBLIC, 'icons', ICONS_MEDIA[clip.id].base);
  encodeFilm(master(clip, await original(clip)), base, { ...clip.rate, poster: POSTER });
  for (const ext of ['.webp', '.webm', '.mp4']) console.log(`${ICONS_MEDIA[clip.id].base}${ext}`, (statSync(`${base}${ext}`).size / 1024).toFixed(0), 'KB');
}

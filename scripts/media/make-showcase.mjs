// Encodes the four 3D Spatial Studio showcase films from their FFV1 masters
// (cinema.mjs, the CAD chamber acts): VP9 WebM, H.264 MP4 with fast start
// and a WebP poster of frame 0 each, 1440 x 960, BT.709.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, statSync } from 'node:fs';
import { encodeFilm, PUBLIC } from './build-media.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MASTERS = join(ROOT, 'scripts', 'media', '.work', 'cinema');
mkdirSync(`${PUBLIC}/showcase`, { recursive: true });

// The 18 s envelope turns the whole lattice every frame: its rate is capped so
// both files stay inside the library's per-file budget (4 MB WebM, 5 MB MP4).
const FILMS = [
  ['cad-orbit', '01-envelope', { webmCrf: 33, mp4Crf: 23, webmBitrate: '1500k', mp4MaxRate: '1900k', mp4BufSize: '3800k' }],
  ['cad-inside', '02-walkthrough', {}],
  ['cad-gizmo', '03-raycast-gizmo', {}],
  ['cad-isolux', '04-iso-lux', {}],
];

const only = process.argv.slice(2);
for (const [master, base, rate] of FILMS) {
  if (only.length && !only.includes(base) && !only.includes(master)) continue;
  encodeFilm(`${MASTERS}/${master}.mkv`, `${PUBLIC}/showcase/${base}`, { webmCrf: 31, mp4Crf: 22, poster: { quality: 86 }, ...rate });
  for (const ext of ['.webp', '.webm', '.mp4']) console.log(base + ext, (statSync(`${PUBLIC}/showcase/${base}${ext}`).size / 1024).toFixed(0), 'KB');
}

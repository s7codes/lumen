// Encodes the Meet our Icons films from their FFV1 masters (cinema.mjs):
// VP9 WebM, H.264 MP4 with fast start and a WebP poster of frame 0 each,
// 1920 x 800, BT.709. The masters are dark and smooth, so both codecs run
// at a low CRF: the gradients round the light stay free of banding.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, statSync } from 'node:fs';
import { encodeFilm, PUBLIC } from './build-media.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MASTERS = join(ROOT, 'scripts', 'media', '.work', 'cinema');
mkdirSync(`${PUBLIC}/icons`, { recursive: true });

const FILMS = [
  ['icon-monolith', 'icon-01-monolith'],
  ['icon-suspension', 'icon-02-suspension'],
  ['icon-column', 'icon-03-column-spot'],
];

const only = process.argv.slice(2);
for (const [master, base] of FILMS) {
  if (only.length && !only.includes(master)) continue;
  encodeFilm(`${MASTERS}/${master}.mkv`, `${PUBLIC}/icons/${base}`, { webmCrf: 28, mp4Crf: 18, poster: { quality: 90 } });
  for (const ext of ['.webp', '.webm', '.mp4']) console.log(base + ext, (statSync(`${PUBLIC}/icons/${base}${ext}`).size / 1024).toFixed(0), 'KB');
}

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, statSync } from 'node:fs';
import { encodeFilm, PUBLIC } from './build-media.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORK = join(ROOT, 'scripts', 'media', '.work');
const FILMS = `${WORK}/films`;
mkdirSync(`${PUBLIC}/showcase`, { recursive: true });
const only = process.argv.slice(2);
for (const base of ['01-envelope', '02-walkthrough', '03-raycast-gizmo', '04-iso-lux']) {
  if (only.length && !only.includes(base)) continue;
  encodeFilm(`${FILMS}/${base}.mkv`, `${PUBLIC}/showcase/${base}`, { webmCrf: 33, mp4Crf: 23, poster: { quality: 84 } });
  for (const ext of ['.webp', '.webm', '.mp4']) console.log(base + ext, (statSync(`${PUBLIC}/showcase/${base}${ext}`).size / 1024).toFixed(0), 'KB');
}

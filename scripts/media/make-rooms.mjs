import { mkdirSync, statSync } from 'node:fs';
import { compose, develop, writeImage } from './grade-lib.mjs';
import { composeFilm, cosLoop, encodeFilm, preparedPasses, PUBLIC, TMP, writeStill } from './build-media.mjs';

// Each room rests in daylight with its Lumen channels low; its hover film
// turns the room to dusk and back in 6 s while the camera eases in 3.5 percent.
const T = 6;
const ROOMS = {
  'room-dining': {
    slug: 'dining-living',
    passes: ['sky', 'pendant', 'frame'],
    day: { sky: 1, pendant: 0.0016, frame: 0.0014 },
    dusk: { sky: 0.12, pendant: 0.0095, frame: 0.007 },
    focus: [0.5, 0.42],
    windowGain: 2.6,
  },
  'room-bedroom': {
    slug: 'bedroom-sanctuary',
    passes: ['sky', 'sconce'],
    day: { sky: 1, sconce: 0.0018 },
    dusk: { sky: 0.26, sconce: 0.0062 },
    focus: [0.5, 0.45],
  },
  'room-studio': {
    slug: 'studio-wall',
    passes: ['sky', 'shelf', 'track', 'column', 'frame'],
    day: { sky: 1, shelf: 0.0022, track: 0.0016, column: 0.0014, frame: 0.0014 },
    dusk: { sky: 0.22, shelf: 0.008, track: 0.008, column: 0.006, frame: 0.006 },
    focus: [0.42, 0.42],
  },
};
const GRADE = { exposure: 1.0, wb: [0.97, 1.0, 1.04], saturation: 1.0, contrast: 1.06, vignette: 0.08 };
const DUSK_WB = [0.9, 0.98, 1.14];

const only = process.argv.slice(2);
const preview = only.includes('--preview');
mkdirSync(`${PUBLIC}/rooms`, { recursive: true });
for (const [shot, room] of Object.entries(ROOMS)) {
  if (only.filter((a) => !a.startsWith('--')).length && !only.includes(shot)) continue;
  const passes = preparedPasses(shot, room.passes, { windowGain: room.windowGain ?? 1 });
  const mix = (k) => Object.fromEntries(room.passes.map((n) => [n, room.day[n] + (room.dusk[n] - room.day[n]) * k]));
  if (preview) {
    writeImage(`${TMP}/${room.slug}-day.png`, develop(compose(passes, room.day), GRADE));
    writeImage(`${TMP}/${room.slug}-dusk.png`, develop(compose(passes, mix(1)), { ...GRADE, wb: DUSK_WB }));
    console.log('preview', room.slug);
    continue;
  }
  writeStill(passes, room.day, GRADE, [{ path: `${PUBLIC}/rooms/${room.slug}-1600.webp`, width: 1600, height: 2000, quality: 86 }]);
  const k = cosLoop(T, 0, 1);
  const spec = Object.fromEntries(room.passes.map((n) => [n, (t) => mix(k(t))[n]]));
  const grade = (t) => {
    const kk = k(t);
    return { ...GRADE, wb: GRADE.wb.map((v, i) => v + (DUSK_WB[i] - v) * kk) };
  };
  const master = `${TMP}/${room.slug}.mkv`;
  await composeFilm(passes, spec, grade, { seconds: T, width: 1080, height: 1350, zoom: cosLoop(T, 1, 1.035), focus: room.focus, master });
  encodeFilm(master, `${PUBLIC}/rooms/${room.slug}`, { webmCrf: 30, mp4Crf: 21 });
  for (const ext of ['-1600.webp', '.webm', '.mp4']) console.log(room.slug + ext, (statSync(`${PUBLIC}/rooms/${room.slug}${ext}`).size / 1024).toFixed(0), 'KB');
}

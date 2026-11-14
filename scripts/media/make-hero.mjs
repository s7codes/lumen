import { mkdirSync, statSync } from 'node:fs';
import { composeFilm, encodeFilm, preparedPasses, PUBLIC, TMP, writeStill } from './build-media.mjs';

const T = 6;
const TAU = Math.PI * 2;
const names = ['sky', 'sun', 'pendant', 'shelf', 'track', 'wash', 'column'];
const passes = preparedPasses('hero', names);
mkdirSync(`${PUBLIC}/hero`, { recursive: true });

const bump = (t) => Math.sin((Math.PI * t) / T) ** 2;
const DAY = { exposure: 1.0, wb: [0.97, 1.0, 1.04], saturation: 1.0, contrast: 1.06, vignette: 0.07 };
const WARM = { exposure: 1.0, wb: [0.86, 0.97, 1.22], saturation: 0.96, contrast: 1.06, vignette: 0.09 };
const day = { sky: 1, sun: (t) => 0.4 * (1 - 0.62 * bump(t)), pendant: 0.0016, shelf: 0.0016, track: 0.0012, wash: 0, column: 0.0012 };
const warm = {
  sky: [0.035, 0.05, 0.095],
  sun: 0,
  pendant: 0.011,
  shelf: (t) => 0.009 * (1 + 0.18 * bump(t)),
  track: (t) => 0.012 * (1 - 0.24 * bump(t)),
  wash: 0.024,
  column: (t) => 0.007 * (1 + 0.08 * Math.sin(TAU * (t / T))),
};
const at0 = (spec) => Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, typeof v === 'function' ? v(0) : v]));

for (const [id, spec, grade] of [['daylight', day, DAY], ['warm', warm, WARM]]) {
  writeStill(passes, at0(spec), grade, [
    { path: `${PUBLIC}/hero/${id}-2560.webp`, width: 2560, height: 1440, quality: 88 },
    { path: `${PUBLIC}/hero/${id}-1280.webp`, width: 1280, height: 720, quality: 88 },
  ]);
  const master = `${TMP}/hero-${id}.mkv`;
  await composeFilm(passes, spec, grade, { seconds: T, width: 1920, height: 1080, master });
  encodeFilm(master, `${PUBLIC}/hero/${id}`, { webmCrf: 28, mp4Crf: 20 });
  for (const ext of ['-2560.webp', '-1280.webp', '.webm', '.mp4']) console.log(id + ext, (statSync(`${PUBLIC}/hero/${id}${ext}`).size / 1024).toFixed(0), 'KB');
}

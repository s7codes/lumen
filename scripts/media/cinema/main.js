import '@fontsource-variable/inter-tight';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import { createEngine } from './engine/engine.js';
import { SCENES } from './scenes/index.js';

/*
 * The cinema stage page. The driver (scripts/media/cinema.mjs) loads one
 * film at a time and renders it frame by frame: window.cinema.render(t)
 * draws film time t into the canvases and resolves once it is on screen.
 */

const engine = createEngine(document.getElementById('gl'), document.getElementById('hud'));
let film = null;

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

async function fontsReady() {
  await Promise.all([
    document.fonts.load('500 32px "IBM Plex Mono"'),
    document.fonts.load('400 32px "IBM Plex Mono"'),
    document.fonts.load('500 32px "Inter Tight Variable"'),
  ]);
  await document.fonts.ready;
}

window.cinema = {
  scenes: Object.keys(SCENES),
  async load(id) {
    await fontsReady();
    if (!SCENES[id]) throw new Error(`unknown film ${id}`);
    film?.dispose?.();
    film = await SCENES[id](engine);
    engine.prepare(film);
    return { id, width: film.width, height: film.height, seconds: film.seconds, fps: film.fps ?? 60, samples: film.samples };
  },
  async render(t, options = {}) {
    engine.renderFrame(film, t, options);
    await nextFrame();
    return true;
  },
};
window.cinemaReady = true;

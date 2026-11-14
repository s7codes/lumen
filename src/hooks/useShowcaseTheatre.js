import { useEffect, useRef } from 'react';
import { FILM_SECONDS, filmBearing, filmDimPct, filmFloorUnder, filmShelf } from '../lib/showcase-film.js';
import { ACT_SECONDS, buildLuxField, EYE_FOV_DEG, EYE_HEIGHT_CM, eyeHeading, eyeIlluminance, illuminance, isActId, nextAct, PENDANT, SHELF, shelfDimensions } from '../lib/showcase-scene.js';
import { frameDelta } from '../lib/spring.js';

// A resumed tab or a long frame advances the act clock by at most this much.
const THEATRE_MAX_DT = 0.25;
const UP = [0, 1, 0];
const PENDANT_FLOOR = [(PENDANT.x0 + PENDANT.x1) / 2, 0, PENDANT.z];
const STAGE_ASPECT = 1.5;

function pad(n, width) {
  return String(Math.max(0, Math.round(n))).padStart(width, '0');
}

function clampUnit(v) {
  return Math.max(0, Math.min(1, v));
}

/**
 * The overview theatre engine. Each act is a film of the 3D Spatial Studio
 * engine; one rAF loop, running only while the stage is on screen, reads the
 * playing film's clock, advances the acts and writes the HUD (bearing, pitch,
 * lux and the act's readout) straight into the DOM from the same functions
 * that posed the film, so every figure matches the frame under it. React
 * only hears about act changes (every few seconds) through `onAct`.
 *
 * A film plays only while the stage is visible, never under reduced motion
 * (each act then rests on its poster, its first frame) and pauses the moment
 * the stage scrolls away. Returns a ref to the controller: pick (click: hold
 * or release an act), preview / endPreview (hover).
 */
export function useShowcaseTheatre({ stageRef, screenRef, onAct }) {
  const controller = useRef(null);
  const onActRef = useRef(onAct);
  useEffect(() => {
    onActRef.current = onAct;
  });

  useEffect(() => {
    const stage = stageRef.current;
    const screen = screenRef.current;
    if (!stage || !screen) return undefined;

    const films = {};
    for (const el of screen.querySelectorAll('video[data-film]')) films[el.dataset.film] = el;
    const hud = {
      az: stage.querySelector('[data-hud="az"]'),
      pitch: stage.querySelector('[data-hud="pitch"]'),
      lux: stage.querySelector('[data-hud="lux"]'),
      line: stage.querySelector('[data-hud="line"]'),
    };
    const fills = {};
    for (const el of stage.querySelectorAll('[data-act-fill]')) fills[el.dataset.actFill] = el;
    const written = new Map();
    const write = (el, text) => {
      if (el && written.get(el) !== text) {
        written.set(el, text);
        el.textContent = text;
      }
    };

    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const field = buildLuxField();
    const s = {
      auto: 'orbit',
      locked: null,
      hover: null,
      act: 'orbit',
      age: 0,
      cycle: 0,
      filmT: 0,
      lastFilmT: null,
      pointer: null,
      visible: false,
      reduced: reducedQuery.matches,
      frame: 0,
      last: 0,
      fill: { act: null, value: -1 },
    };

    const notify = () => onActRef.current?.({ act: s.act, locked: s.locked, preview: s.hover });

    const activeFilm = () => films[s.act];

    // A film that cannot play (no codec, a failed source, autoplay refused)
    // hands its act back to the wall clock; any other film sets the pace.
    const failed = new Set();
    const onFilmError = (event) => {
      const film = event.currentTarget.closest('video');
      if (film?.dataset.film) failed.add(film.dataset.film);
    };
    for (const el of Object.values(films)) {
      el.addEventListener('error', onFilmError);
      el.querySelector('source:last-of-type')?.addEventListener('error', onFilmError);
    }
    const startFilm = (film) => {
      if (film.preload !== 'auto') film.preload = 'auto';
      film.muted = true;
      const attempt = film.play();
      attempt?.catch?.((error) => {
        if (error?.name === 'NotAllowedError' || error?.name === 'NotSupportedError') failed.add(film.dataset.film);
      });
    };

    /** Plays the act's film from its first frame, or rests it on its poster. */
    const cueFilm = () => {
      for (const [id, el] of Object.entries(films)) {
        if (id !== s.act && !el.paused) el.pause();
      }
      const film = activeFilm();
      if (!film) return;
      try {
        film.currentTime = 0;
      } catch {
        /* not seekable yet: it starts at 0 anyway */
      }
      s.filmT = 0;
      s.lastFilmT = null;
      if (s.visible && !s.reduced) startFilm(film);
    };

    const enter = (act) => {
      s.act = act;
      s.age = 0;
      s.cycle = 0;
      notify();
      cueFilm();
    };

    const settle = () => {
      const next = s.hover ?? s.locked ?? s.auto;
      if (next !== s.act) enter(next);
      else notify();
      if (s.reduced || !s.frame) drawStill();
    };

    const writeFill = (value) => {
      if (s.fill.act !== s.act) {
        for (const [id, el] of Object.entries(fills)) if (id !== s.act) el.style.transform = 'scaleX(0)';
        s.fill.act = s.act;
        s.fill.value = -1;
      }
      const el = fills[s.act];
      if (el && Math.abs(value - s.fill.value) > 0.002) {
        s.fill.value = value;
        el.style.transform = `scaleX(${value.toFixed(3)})`;
      }
    };

    /** The HUD for film time t: bearing and pitch of the frame, the act's lux and readout. */
    const writeHud = (t) => {
      const { az, pitch } = filmBearing(s.act, t);
      write(hud.az, pad(az, 3));
      write(hud.pitch, pad(pitch, 2));
      const shelf = filmShelf(s.act, t);
      let key;
      let line;
      if (s.act === 'inside') {
        key = eyeIlluminance(eyeHeading(t));
        line = `Eye ${EYE_HEIGHT_CM} cm / FOV ${EYE_FOV_DEG} deg / ${Math.round(key)} lx`;
      } else if (s.act === 'gizmo') {
        const d = shelfDimensions(shelf);
        key = illuminance([shelf.x + SHELF.widthCm / 2, 0, 40], UP, shelf);
        line = `X: ${d.x} cm / Y: ${d.y} cm / R: ${d.r} cm / C: ${d.c} cm`;
      } else if (s.act === 'isolux') {
        key = field.surfaces[0].peak * (filmDimPct(s.act, t) / 100);
        line = `Iso-lux 100 / 250 / 500 lx / Floor peak ${Math.round(key)} lx`;
      } else {
        key = illuminance(PENDANT_FLOOR, UP);
        line = '24V DC daisy chain / 5 nodes / 2700K';
      }
      const probe = s.pointer ? filmFloorUnder(s.act, t, s.pointer.x, s.pointer.y, STAGE_ASPECT) : null;
      write(hud.lux, pad(probe ? illuminance(probe, UP, shelf) : key, 3));
      write(hud.line, line);
    };

    /** Reduced motion, or a stage off screen: the act's first frame, which is its poster. */
    function drawStill() {
      writeFill(1);
      writeHud(0);
    }

    /**
     * Film time from the playing film's clock. While a film loads or buffers
     * the clock holds on the frame on screen (its poster at first), so the HUD
     * never runs ahead of the picture or jumps back when playback starts;
     * only a film that cannot play at all lets wall time carry its act.
     */
    const advance = (dt) => {
      const film = activeFilm();
      const span = FILM_SECONDS[s.act] ?? ACT_SECONDS;
      if (film && !film.paused && film.readyState >= 2 && !film.seeking) {
        const t = film.currentTime;
        const step = s.lastFilmT === null ? 0 : (((t - s.lastFilmT) % span) + span) % span;
        s.lastFilmT = t;
        s.filmT = t % span;
        return Math.min(step, THEATRE_MAX_DT);
      }
      s.lastFilmT = null;
      if (!film || failed.has(s.act)) {
        s.filmT = (s.filmT + dt) % span;
        return dt;
      }
      return 0;
    };

    // The act clock is wall time (an act holds the stage 7 s however the
    // decoder copes); the HUD reads the film clock, so it never leaves its frame.
    const loop = (now) => {
      const dt = frameDelta(now, s.last, THEATRE_MAX_DT);
      s.last = now;
      advance(dt);
      s.age += dt;
      const holding = s.locked !== null || s.hover !== null;
      if (!holding) {
        s.cycle += dt;
        if (s.cycle >= ACT_SECONDS) {
          s.auto = nextAct(s.act);
          enter(s.auto);
        }
      }
      writeFill(holding ? 1 : clampUnit(s.cycle / ACT_SECONDS));
      writeHud(s.filmT);
      s.frame = requestAnimationFrame(loop);
    };

    // Posters wait for the stage: four photographs nobody has scrolled to are never fetched.
    const revealPosters = () => {
      for (const el of Object.values(films)) {
        if (!el.getAttribute('poster') && el.dataset.poster) el.setAttribute('poster', el.dataset.poster);
      }
    };

    const startLoop = () => {
      if (s.visible) revealPosters();
      if (s.frame || s.reduced || !s.visible) return;
      s.last = performance.now();
      const film = activeFilm();
      if (film?.paused) startFilm(film);
      s.frame = requestAnimationFrame(loop);
    };

    const stopLoop = () => {
      cancelAnimationFrame(s.frame);
      s.frame = 0;
      for (const el of Object.values(films)) if (!el.paused) el.pause();
    };

    const onMove = (event) => {
      const rect = screen.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      s.pointer = { x: clampUnit((event.clientX - rect.left) / rect.width), y: clampUnit((event.clientY - rect.top) / rect.height) };
      if (s.reduced || !s.frame) writeHud(s.reduced ? 0 : s.filmT);
    };

    const onLeave = () => {
      s.pointer = null;
      if (s.reduced || !s.frame) writeHud(s.reduced ? 0 : s.filmT);
    };

    const onReducedChange = () => {
      s.reduced = reducedQuery.matches;
      if (s.reduced) {
        stopLoop();
        for (const el of Object.values(films)) {
          try {
            el.currentTime = 0;
          } catch {
            /* not seekable yet */
          }
        }
        drawStill();
      } else {
        startLoop();
      }
    };

    const visibility = new IntersectionObserver(
      ([entry]) => {
        s.visible = entry.isIntersecting;
        if (s.visible) startLoop();
        else stopLoop();
      },
      { threshold: 0.2 },
    );

    visibility.observe(screen);
    screen.addEventListener('pointermove', onMove, { passive: true });
    screen.addEventListener('pointerleave', onLeave);
    reducedQuery.addEventListener('change', onReducedChange);
    drawStill();

    controller.current = {
      pick(act) {
        if (!isActId(act)) return;
        if (s.locked === act) {
          s.locked = null;
          s.auto = act;
          s.cycle = 0;
        } else {
          s.locked = act;
        }
        settle();
      },
      preview(act) {
        if (!isActId(act) || s.hover === act) return;
        s.hover = act;
        settle();
      },
      endPreview(act) {
        if (s.hover !== act) return;
        s.hover = null;
        settle();
      },
    };
    notify();

    return () => {
      stopLoop();
      visibility.disconnect();
      for (const el of Object.values(films)) {
        el.removeEventListener('error', onFilmError);
        el.querySelector('source:last-of-type')?.removeEventListener('error', onFilmError);
      }
      screen.removeEventListener('pointermove', onMove);
      screen.removeEventListener('pointerleave', onLeave);
      reducedQuery.removeEventListener('change', onReducedChange);
      controller.current = null;
    };
  }, [stageRef, screenRef]);

  return controller;
}


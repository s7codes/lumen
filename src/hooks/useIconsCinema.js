import { useEffect } from 'react';
import { CINEMA_ACTS, CINEMA_STILL_SECONDS, dominantAct } from '../lib/icons-cinema.js';
import { createCinemaAssets, paintCinemaFrame } from '../lib/icons-cinema-painter.js';
import { frameDelta } from '../lib/spring.js';

// The loop is a pure function of its clock, so one long frame is as exact as
// many short ones: a slow software rasteriser keeps wall-clock time down to
// 4 fps instead of stretching the acts, and a resumed tab skips at most 250 ms.
const CINEMA_MAX_DT = 0.25;
// A cinematic picture is soft by nature: 1.5x density and a 1920 px backing
// width keep a full-bleed 2K frame cheap without visible loss.
const MAX_DENSITY = 1.5;
const MAX_BACKING_WIDTH = 1920;

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/**
 * Drives the Meet our Icons canvas. One rAF loop advances the clock with the
 * frame's dt and paints straight into the canvas; nothing here touches React
 * state. The loop runs only while the section is on screen and never under
 * reduced motion, which holds one composed still. The section mirrors the act
 * on screen as `data-act` and the loop state as `data-playing`; nothing but
 * the title and its key is ever written over the picture.
 */
export function useIconsCinema(sectionRef, canvasRef) {
  useEffect(() => {
    const section = sectionRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!section || !ctx) return undefined;

    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const assets = createCinemaAssets(makeCanvas);
    const buffer = makeCanvas(1, 1);
    const s = {
      time: 0,
      last: 0,
      frame: 0,
      visible: false,
      reduced: reducedQuery.matches,
      width: 0,
      height: 0,
      scale: 1,
      act: -1,
    };

    const showAct = (index) => {
      if (index === s.act) return;
      s.act = index;
      section.dataset.act = CINEMA_ACTS[index].id;
    };

    const paint = () => {
      if (s.width === 0 || s.height === 0) return;
      paintCinemaFrame(ctx, { width: s.width, height: s.height, scale: s.scale, time: s.time, assets, buffer });
      showAct(dominantAct(s.time));
    };

    const loop = (now) => {
      s.time += frameDelta(now, s.last, CINEMA_MAX_DT);
      s.last = now;
      paint();
      s.frame = requestAnimationFrame(loop);
    };

    const setPlaying = (playing) => {
      section.dataset.playing = playing ? 'true' : 'false';
    };

    const startLoop = () => {
      if (s.frame || s.reduced || !s.visible) return;
      s.last = performance.now();
      s.frame = requestAnimationFrame(loop);
      setPlaying(true);
    };

    const stopLoop = () => {
      cancelAnimationFrame(s.frame);
      s.frame = 0;
      setPlaying(false);
    };

    const drawStill = () => {
      s.time = CINEMA_STILL_SECONDS;
      paint();
    };

    const resize = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;
      const scale = Math.min(window.devicePixelRatio || 1, MAX_DENSITY, MAX_BACKING_WIDTH / width);
      if (width === s.width && height === s.height && scale === s.scale) return;
      s.width = width;
      s.height = height;
      s.scale = scale;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      buffer.width = canvas.width;
      buffer.height = canvas.height;
      if (!s.frame) {
        if (s.reduced) drawStill();
        else paint();
      }
    };

    const onReducedChange = () => {
      s.reduced = reducedQuery.matches;
      if (s.reduced) {
        stopLoop();
        drawStill();
      } else {
        startLoop();
      }
    };

    const visibility = new IntersectionObserver(([entry]) => {
      s.visible = entry.isIntersecting;
      if (s.visible) startLoop();
      else stopLoop();
    });
    const sizing = new ResizeObserver(resize);

    setPlaying(false);
    if (s.reduced) s.time = CINEMA_STILL_SECONDS;
    resize();
    sizing.observe(canvas);
    visibility.observe(section);
    reducedQuery.addEventListener('change', onReducedChange);

    return () => {
      stopLoop();
      visibility.disconnect();
      sizing.disconnect();
      reducedQuery.removeEventListener('change', onReducedChange);
    };
  }, [sectionRef, canvasRef]);
}

import { useEffect, useRef } from 'react';
import { isReelIndex, nextReelIndex, REEL_FADE_MS, REEL_SLOT_SECONDS } from '../lib/icons-reel.js';
import { frameDelta } from '../lib/spring.js';
import { shouldPlay, VIEW_THRESHOLD } from '../lib/viewport-video.js';

// A resumed tab or a long frame advances the reel clock by at most this much.
const REEL_MAX_DT = 0.25;
// Posters and the first films are fetched a little before the banner arrives.
const NEAR_MARGIN = '400px 0px';

/**
 * Drives the Meet our Icons reel. The films obey the overview's viewport rule
 * (src/lib/viewport-video.js, shouldPlay): one rAF clock runs only while the
 * banner is on screen in a visible tab, without reduced motion or save-data,
 * and hands the banner to the next icon every REEL_SLOT_SECONDS. Each icon's
 * film starts from its first frame as it fades in and keeps playing through
 * its own fade out, then pauses; nothing else decodes.
 *
 * React hears only about icon changes (every 3 s) through `onIndex`; the
 * hairline progress fill is written straight to the DOM each frame. The
 * section mirrors the loop as data-playing and counts automatic advances in
 * data-cycles. Returns a ref to the controller: pick(index) jumps to an icon
 * and restarts its 3 s.
 */
export function useIconsReel({ sectionRef, onIndex }) {
  const controller = useRef(null);
  const onIndexRef = useRef(onIndex);
  useEffect(() => {
    onIndexRef.current = onIndex;
  });

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || typeof IntersectionObserver === 'undefined') return undefined;
    const films = [...section.querySelectorAll('video[data-reel]')];
    const fills = [...section.querySelectorAll('[data-key-fill]')];
    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const s = { index: 0, slot: 0, frame: 0, last: 0, inView: false, reduced: reducedQuery.matches, fading: new Map(), cycles: 0, fill: -1 };

    const wanted = () =>
      shouldPlay({
        mode: 'auto',
        inView: s.inView,
        docVisible: document.visibilityState !== 'hidden',
        reduced: s.reduced,
        saveData: typeof navigator !== 'undefined' && navigator.connection?.saveData === true,
      });

    const setPlaying = (playing) => {
      section.dataset.playing = playing ? 'true' : 'false';
    };

    const writeFill = (value) => {
      if (Math.abs(value - s.fill) < 0.002) return;
      s.fill = value;
      fills.forEach((el, i) => {
        el.style.transform = `scaleX(${i === s.index ? value.toFixed(3) : '0'})`;
      });
    };

    const revealPosters = () => {
      for (const el of films) if (!el.getAttribute('poster') && el.dataset.poster) el.setAttribute('poster', el.dataset.poster);
    };

    const prime = (index) => {
      const el = films[index];
      if (el && el.preload !== 'auto') el.preload = 'auto';
    };

    const rewind = (el) => {
      try {
        el.currentTime = 0;
      } catch {
        /* not seekable yet: it starts at 0 anyway */
      }
    };

    const start = (el) => {
      el.muted = true;
      el.play()?.catch?.(() => {
        /* autoplay refused or the source failed: the poster stays */
      });
    };

    const pauseAll = () => {
      s.fading.clear();
      for (const el of films) if (!el.paused) el.pause();
    };

    /** Hands the banner to icon `index`: its film from the first frame, the last one fading out. */
    const go = (index, now = performance.now()) => {
      const previous = s.index;
      s.index = index;
      s.slot = 0;
      s.fill = -1;
      writeFill(0);
      onIndexRef.current?.(index);
      const film = films[index];
      if (!film) return;
      rewind(film);
      if (s.frame) {
        prime(index);
        prime(nextReelIndex(index));
        start(film);
        s.fading.delete(index);
        if (previous !== index && films[previous]) s.fading.set(previous, now + REEL_FADE_MS + 60);
      }
    };

    const loop = (now) => {
      const dt = frameDelta(now, s.last, REEL_MAX_DT);
      s.last = now;
      s.slot += dt;
      for (const [index, until] of s.fading) {
        if (now >= until) {
          films[index]?.pause();
          s.fading.delete(index);
        }
      }
      if (s.slot >= REEL_SLOT_SECONDS) {
        s.cycles += 1;
        section.dataset.cycles = String(s.cycles);
        go(nextReelIndex(s.index), now);
      }
      writeFill(Math.min(1, s.slot / REEL_SLOT_SECONDS));
      s.frame = requestAnimationFrame(loop);
    };

    const stop = () => {
      cancelAnimationFrame(s.frame);
      s.frame = 0;
      pauseAll();
      setPlaying(false);
    };

    /** The one rule: play while wanted, rest on the poster otherwise. */
    const sync = () => {
      if (wanted()) {
        if (s.frame) return;
        revealPosters();
        s.last = performance.now();
        s.frame = requestAnimationFrame(loop);
        setPlaying(true);
        // Entering view restarts the icon on screen, so its film and its 3 s run together.
        go(s.index, s.last);
      } else if (s.frame) {
        stop();
        s.fill = -1;
        writeFill(s.reduced ? 1 : Math.min(1, s.slot / REEL_SLOT_SECONDS));
      }
    };

    const view = new IntersectionObserver(
      ([entry]) => {
        s.inView = entry.isIntersecting && entry.intersectionRatio >= VIEW_THRESHOLD;
        sync();
      },
      { threshold: [0, VIEW_THRESHOLD, 0.6] },
    );
    const near = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        revealPosters();
        if (!s.reduced) {
          prime(s.index);
          prime(nextReelIndex(s.index));
        }
        near.disconnect();
      },
      { rootMargin: NEAR_MARGIN },
    );
    const onReducedChange = () => {
      s.reduced = reducedQuery.matches;
      if (s.reduced) for (const el of films) rewind(el);
      sync();
    };

    setPlaying(false);
    section.dataset.cycles = '0';
    writeFill(s.reduced ? 1 : 0);
    view.observe(section);
    near.observe(section);
    document.addEventListener('visibilitychange', sync);
    reducedQuery.addEventListener('change', onReducedChange);

    controller.current = {
      pick(index) {
        if (!isReelIndex(index)) return;
        if (s.frame) {
          go(index);
          return;
        }
        // At rest (reduced motion, save-data or off screen): show that icon's poster.
        s.index = index;
        s.slot = 0;
        s.fill = -1;
        writeFill(s.reduced ? 1 : 0);
        revealPosters();
        onIndexRef.current?.(index);
      },
      get index() {
        return s.index;
      },
    };

    return () => {
      stop();
      view.disconnect();
      near.disconnect();
      document.removeEventListener('visibilitychange', sync);
      reducedQuery.removeEventListener('change', onReducedChange);
      controller.current = null;
    };
  }, [sectionRef]);

  return controller;
}


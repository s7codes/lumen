/*
 * Viewport video engine. A film plays only while someone can see it: on
 * screen, in a visible tab, and either set to run on its own ('auto') or
 * held by the pointer or focus ('hover'). Off screen it pauses at once, so
 * scrolling never pays for a decoder nobody watches. Under
 * prefers-reduced-motion an 'auto' film rests on its poster; a film the
 * visitor asks for by hovering or focusing still plays. Framework-free: the
 * React hook (src/hooks/useViewportVideo.js) only wires refs to it.
 */

export const VIDEO_MODES = Object.freeze(['auto', 'hover']);
export const VIDEO_STATES = Object.freeze(['idle', 'loading', 'playing', 'paused', 'blocked']);

/** Share of the film's box that must be on screen before it may play. */
export const VIEW_THRESHOLD = 0.25;

/**
 * The single rule every film obeys. Pure, so it is tested in Node.
 * reduced: prefers-reduced-motion; saveData: the browser asked for less data.
 */
export function shouldPlay({ mode = 'auto', inView = false, engaged = false, docVisible = true, reduced = false, saveData = false }) {
  if (!docVisible || !inView) return false;
  if (mode === 'hover') return engaged;
  return engaged || (!reduced && !saveData);
}

function prefersSaveData() {
  return typeof navigator !== 'undefined' && navigator.connection?.saveData === true;
}

/**
 * Drives one <video>. `host` carries the state for CSS as data-video
 * ('idle' | 'loading' | 'playing' | 'paused' | 'blocked'); the film is shown
 * only once it is actually playing, so a slow network never flashes black
 * over the poster. Returns { engage, release, sync, destroy, get state }.
 */
export function createViewportVideo(video, { host = video, mode = 'auto', threshold = VIEW_THRESHOLD, rewindOnRelease = false } = {}) {
  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const s = { inView: false, engaged: false, state: 'idle', destroyed: false };

  const write = (state) => {
    if (s.state === state) return;
    s.state = state;
    host.dataset.video = state;
  };

  const wanted = () =>
    shouldPlay({ mode, inView: s.inView, engaged: s.engaged, docVisible: document.visibilityState !== 'hidden', reduced: reducedQuery.matches, saveData: prefersSaveData() });

  const sync = () => {
    if (s.destroyed) return;
    if (wanted()) {
      if (!video.paused && s.state === 'playing') return;
      if (video.preload === 'none') video.preload = 'auto';
      write(video.readyState >= 3 ? s.state : 'loading');
      video.muted = true;
      const attempt = video.play();
      attempt?.catch?.(() => {
        // Autoplay refused or the source failed: the poster stays.
        if (!s.destroyed && wanted()) write('blocked');
      });
    } else if (!video.paused) {
      video.pause();
    } else if (s.state === 'loading') {
      write('paused');
    }
  };

  const onPlaying = () => {
    if (wanted()) write('playing');
    else video.pause();
  };
  const onPause = () => {
    if (s.state !== 'blocked') write('paused');
  };
  const onError = () => write('blocked');

  video.addEventListener('playing', onPlaying);
  video.addEventListener('pause', onPause);
  video.addEventListener('error', onError);
  // A <source> error does not bubble to the element: listen on the last one.
  const lastSource = video.querySelector('source:last-of-type');
  lastSource?.addEventListener('error', onError);

  const observer = new IntersectionObserver(
    ([entry]) => {
      s.inView = entry.isIntersecting && entry.intersectionRatio >= threshold;
      sync();
    },
    { threshold: [0, threshold, 0.6] },
  );
  observer.observe(host);
  document.addEventListener('visibilitychange', sync);
  reducedQuery.addEventListener('change', sync);
  host.dataset.video = s.state;

  return {
    engage() {
      s.engaged = true;
      sync();
    },
    release() {
      s.engaged = false;
      sync();
      if (rewindOnRelease && video.paused) {
        // Back to the first frame, which is the poster, once the fade is over.
        try {
          video.currentTime = 0;
        } catch {
          /* not seekable yet */
        }
      }
    },
    sync,
    get state() {
      return s.state;
    },
    destroy() {
      s.destroyed = true;
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
      reducedQuery.removeEventListener('change', sync);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('error', onError);
      lastSource?.removeEventListener('error', onError);
      if (!video.paused) video.pause();
    },
  };
}

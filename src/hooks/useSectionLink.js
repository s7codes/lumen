import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const SECTION_STATE_KEY = 'lumenSection';

/*
 * Scroll-spy for overview sections. The current section is the last spied
 * section whose head has crossed a reading line 45 percent down the viewport,
 * so the navbar steps through the sections in page order and holds across the
 * gaps between them instead of flashing back to Overview. At the very bottom
 * of the page the last section in view takes over, so a short closing section
 * still gets its turn. A glide pins its target for the whole flight: the line
 * would otherwise read every section the glide passes on the way.
 */
const READING_LINE = 0.45;
const END_SLACK_PX = 2;
// Without scrollend, a glide has landed once the page holds still for this many frames in a row.
const SETTLE_FRAMES = 3;
const USER_INPUT = ['wheel', 'touchstart', 'pointerdown', 'keydown'];

const spy = { sections: new Map(), measured: null, pinned: null, listeners: new Set(), detach: null };
let releasePin = null;

function emit() {
  for (const listener of spy.listeners) listener();
}

function subscribe(listener) {
  spy.listeners.add(listener);
  return () => spy.listeners.delete(listener);
}

function currentSection() {
  return spy.pinned ?? spy.measured;
}

function measure() {
  const viewport = window.innerHeight;
  const root = document.documentElement;
  const atEnd = window.scrollY > 0 && window.scrollY + viewport >= root.scrollHeight - END_SLACK_PX;
  const limit = atEnd ? viewport : viewport * READING_LINE;
  let best = null;
  let bestTop = -Infinity;
  for (const [id, el] of spy.sections) {
    const { top } = el.getBoundingClientRect();
    if (top <= limit && top > bestTop) {
      best = id;
      bestTop = top;
    }
  }
  return best;
}

function remeasure() {
  const before = currentSection();
  spy.measured = measure();
  if (currentSection() !== before) emit();
}

// Scroll events already arrive once per frame, and the read is a handful of
// rects, so the spy measures in the handler and only emits on a change.
function attachSpy() {
  window.addEventListener('scroll', remeasure, { passive: true });
  window.addEventListener('resize', remeasure);
  const sizing = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(remeasure);
  sizing?.observe(document.body);
  spy.detach = () => {
    window.removeEventListener('scroll', remeasure);
    window.removeEventListener('resize', remeasure);
    sizing?.disconnect();
    spy.detach = null;
  };
}

/**
 * Holds `id` as the current section until the glide lands or the user takes
 * over the page. The browser's scrollend marks the landing where it exists.
 * Elsewhere the first scroll event starts a per-frame watch on window.scrollY
 * that lands once the page holds still for SETTLE_FRAMES frames in a row.
 * Both paths count events and frames, never milliseconds: a device drawing a
 * few frames a second delivers one scroll step per frame, so a wall-clock
 * timer would fire between two steps and drop the pin mid-glide.
 */
function pinSection(id) {
  releasePin?.();
  const before = currentSection();
  spy.pinned = id;
  const hasScrollEnd = 'onscrollend' in window;
  let frame = 0;
  let lastY = Number.NaN;
  let still = 0;

  const watch = () => {
    const y = window.scrollY;
    still = y === lastY ? still + 1 : 0;
    lastY = y;
    if (still >= SETTLE_FRAMES) release();
    else frame = requestAnimationFrame(watch);
  };
  const onScroll = () => {
    if (frame === 0) frame = requestAnimationFrame(watch);
  };
  function release() {
    cancelAnimationFrame(frame);
    frame = 0;
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('scrollend', release);
    for (const type of USER_INPUT) window.removeEventListener(type, release, true);
    if (releasePin === release) releasePin = null;
    if (spy.pinned !== id) return;
    spy.pinned = null;
    spy.measured = measure();
    if (currentSection() !== id) emit();
  }

  if (hasScrollEnd) window.addEventListener('scrollend', release);
  else window.addEventListener('scroll', onScroll, { passive: true });
  for (const type of USER_INPUT) window.addEventListener(type, release, { capture: true, passive: true });
  releasePin = release;
  if (currentSection() !== before) emit();
}

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Glides an overview section into view, focuses it for keyboard and screen
 * reader users, and writes its hash into the address bar. The hash goes in
 * with replaceState, not a router navigation: the router's scroll restoration
 * would jump straight to the anchor and cut the glide short. The router's own
 * entry state is cleared, so back / forward never replays the glide.
 */
export function revealSection(id) {
  const el = document.getElementById(id);
  if (!el) return false;
  pinSection(id);
  el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  el.focus({ preventScroll: true });
  window.history.replaceState({ ...window.history.state, usr: null }, '', `/#${id}`);
  return true;
}

function plainClick(event) {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * Click handler for a link to an overview section. On the overview it glides
 * there in place; elsewhere it routes to the overview, which glides on
 * arrival. Modified clicks keep the browser's own new-tab behaviour.
 */
export function useSectionLink(id) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return useCallback(
    (event) => {
      if (!plainClick(event)) return;
      event.preventDefault();
      if (pathname === '/' && revealSection(id)) return;
      navigate('/', { state: { [SECTION_STATE_KEY]: id } });
    },
    [pathname, navigate, id],
  );
}

/** On the overview: a navigation that asked for one of `ids` glides to it once the page has painted. */
export function useSectionArrival(ids) {
  const location = useLocation();
  const requested = location.state?.[SECTION_STATE_KEY];
  const target = ids.includes(requested) ? requested : null;
  useEffect(() => {
    if (!target) return undefined;
    // Pinned before the glide frame, so the navbar never flashes the section above.
    pinSection(target);
    const frame = requestAnimationFrame(() => revealSection(target));
    return () => cancelAnimationFrame(frame);
  }, [location.key, target]);
}

/** Reports the section behind `ref` to the scroll-spy while it is mounted. */
export function useSectionSpy(ref, id) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    spy.sections.set(id, el);
    if (!spy.detach) attachSpy();
    remeasure();
    return () => {
      if (spy.pinned === id) releasePin?.();
      if (spy.sections.get(id) === el) spy.sections.delete(id);
      if (spy.sections.size === 0) spy.detach?.();
      remeasure();
    };
  }, [ref, id]);
}

/** The overview section the reader is in, or null above the first spied section. */
export function useCurrentSection() {
  return useSyncExternalStore(subscribe, currentSection, () => null);
}

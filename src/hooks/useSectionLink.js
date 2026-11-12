import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const SECTION_STATE_KEY = 'lumenSection';

/*
 * Scroll-spy for overview sections. A section is current while it crosses a
 * thin reading band 40 to 45 percent down the viewport, so it takes over once
 * its head has settled under the navbar and hands back once it scrolls clear.
 * A glide pins its target for the whole flight: the band would otherwise read
 * every section the glide passes on the way.
 */
const SPY_BAND = '-40% 0px -55% 0px';
const SCROLL_SETTLE_MS = 180;
const USER_INPUT = ['wheel', 'touchstart', 'pointerdown', 'keydown'];

const spy = { observed: new Set(), pinned: null, listeners: new Set() };
let releasePin = null;

function emit() {
  for (const listener of spy.listeners) listener();
}

function subscribe(listener) {
  spy.listeners.add(listener);
  return () => spy.listeners.delete(listener);
}

function currentSection() {
  if (spy.pinned) return spy.pinned;
  for (const id of spy.observed) return id;
  return null;
}

function setObserved(id, inBand) {
  const before = currentSection();
  if (inBand) spy.observed.add(id);
  else spy.observed.delete(id);
  if (currentSection() !== before) emit();
}

/**
 * Holds `id` as the current section until the glide settles (scrollend, or
 * no scroll for SCROLL_SETTLE_MS) or the user takes over the page.
 */
function pinSection(id) {
  releasePin?.();
  const before = currentSection();
  spy.pinned = id;
  let timer = 0;

  const onScroll = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(release, SCROLL_SETTLE_MS);
  };
  function release() {
    window.clearTimeout(timer);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('scrollend', release);
    for (const type of USER_INPUT) window.removeEventListener(type, release, true);
    if (releasePin === release) releasePin = null;
    if (spy.pinned !== id) return;
    spy.pinned = null;
    if (currentSection() !== id) emit();
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('scrollend', release);
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
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([entry]) => setObserved(id, entry.isIntersecting), {
      rootMargin: SPY_BAND,
      threshold: 0,
    });
    io.observe(el);
    return () => {
      io.disconnect();
      if (spy.pinned === id) releasePin?.();
      setObserved(id, false);
    };
  }, [ref, id]);
}

/** The overview section the reader is in, or null above and between spied sections. */
export function useCurrentSection() {
  return useSyncExternalStore(subscribe, currentSection, () => null);
}

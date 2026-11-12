import { useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const SECTION_STATE_KEY = 'lumenSection';

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
    const frame = requestAnimationFrame(() => revealSection(target));
    return () => cancelAnimationFrame(frame);
  }, [location.key, target]);
}

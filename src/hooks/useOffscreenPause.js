import { useEffect } from 'react';

/**
 * Marks the element `data-offscreen` while it is out of the viewport, so CSS
 * can pause its ambient keyframes (animation-play-state) instead of running a
 * compositor loop nobody sees.
 */
export function useOffscreenPause(ref) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const watch = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) el.removeAttribute('data-offscreen');
      else el.setAttribute('data-offscreen', '');
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [ref]);
}

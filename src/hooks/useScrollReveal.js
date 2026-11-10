import { useCallback } from 'react';

const MAX_STAGGER_STEPS = 6;
const ROOT_MARGIN = '0px 0px -10% 0px';

const supported = typeof window !== 'undefined' && 'IntersectionObserver' in window;

// The hidden pre-reveal state is gated on this flag, so content never stays
// invisible in an environment without IntersectionObserver.
if (supported) document.documentElement.dataset.reveal = 'on';

let observer = null;

// The step is multiplied by --reveal-stagger in animations.css, so the timing
// stays a design token.
function markRevealed(el, value, step = 0) {
  if (step > 0) el.style.setProperty('--reveal-step', String(step));
  el.setAttribute('data-revealed', value);
}

function staggerGroup(el) {
  const parent = el.parentElement;
  return parent && parent.classList.contains('reveal-stagger') ? parent : null;
}

/**
 * One shared observer for the whole app. Entries that cross the threshold in
 * the same callback are ordered top-to-bottom, left-to-right, and each
 * `.reveal-stagger` parent hands its children one stagger step apiece, so a
 * row of three cards lands at 0, 100 and 200 ms however it was scrolled to.
 */
function onIntersect(entries) {
  const entering = [];
  for (const entry of entries) {
    if (entry.isIntersecting) {
      entering.push(entry);
    } else if (entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0)) {
      // Already scrolled past, for example on a restored scroll position.
      observer.unobserve(entry.target);
      markRevealed(entry.target, 'instant');
    }
  }

  entering.sort(
    (a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left,
  );

  const steps = new Map();
  for (const { target } of entering) {
    observer.unobserve(target);
    const group = staggerGroup(target);
    let step = 0;
    if (group) {
      step = steps.get(group) ?? 0;
      steps.set(group, step + 1);
    }
    markRevealed(target, 'in', Math.min(step, MAX_STAGGER_STEPS));
  }
}

function getObserver() {
  if (!supported) return null;
  observer ??= new IntersectionObserver(onIntersect, { rootMargin: ROOT_MARGIN, threshold: 0 });
  return observer;
}

/**
 * Returns a stable ref callback. Attach it to any `.reveal-up` element; the
 * element slides up and fades in once, the first time it enters the viewport.
 */
export function useScrollReveal() {
  return useCallback((node) => {
    if (!node || node.hasAttribute('data-revealed')) return undefined;
    const io = getObserver();
    if (!io) {
      markRevealed(node, 'instant');
      return undefined;
    }
    io.observe(node);
    return () => io.unobserve(node);
  }, []);
}

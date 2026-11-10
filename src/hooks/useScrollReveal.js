import { useCallback } from 'react';

const MAX_STAGGER_STEPS = 6;
const ROOT_MARGIN = '0px 0px -12% 0px';
// Longest reveal (1200 ms) plus the deepest stagger step, with headroom.
const SETTLE_FALLBACK_MS = 2400;

const supported = typeof window !== 'undefined' && 'IntersectionObserver' in window;

// The hidden pre-reveal state is gated on this flag, so content never stays
// invisible in an environment without IntersectionObserver.
if (supported) document.documentElement.dataset.reveal = 'on';

let observer = null;

/**
 * Once the element has resolved, `data-reveal-settled` drops the compositor
 * hints (will-change on transform, filter, opacity) so a page of revealed
 * cards does not keep dozens of GPU layers alive.
 */
function settleAfterMotion(el) {
  let timer = 0;
  const settle = () => {
    window.clearTimeout(timer);
    el.removeEventListener('transitionend', onEnd);
    el.removeEventListener('animationend', onEnd);
    el.setAttribute('data-reveal-settled', '');
  };
  // Copy and media settle on their opacity transition; product cards run a
  // keyframe entrance instead, so their own hover transitions stay untouched.
  function onEnd(event) {
    if (event.target !== el) return;
    if (event.type === 'animationend' || event.propertyName === 'opacity') settle();
  }
  el.addEventListener('transitionend', onEnd);
  el.addEventListener('animationend', onEnd);
  timer = window.setTimeout(settle, SETTLE_FALLBACK_MS);
}

// The step is multiplied by --reveal-stagger in animations.css, so the timing
// stays a design token.
function markRevealed(el, value, step = 0) {
  if (step > 0) el.style.setProperty('--reveal-step', String(step));
  el.setAttribute('data-revealed', value);
  if (value === 'instant') el.setAttribute('data-reveal-settled', '');
  else settleAfterMotion(el);
}

// A card reveals itself from inside its grid cell, so the group is the
// nearest `.reveal-stagger` ancestor rather than the direct parent.
function staggerGroup(el) {
  return el.parentElement?.closest('.reveal-stagger') ?? null;
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
 * Returns a stable ref callback for any reveal target, once, the first time
 * it enters the viewport:
 * - `.reveal-up` (copy) rises a short distance out of a soft blur.
 * - `.reveal-cinematic` (media) resolves from 1.05 scale and an 8px blur to
 *   full focus over 1200 ms on cubic-bezier(0.16, 1, 0.3, 1).
 * - `.reveal-card` (product cards) grows from 0.95 scale and fades in over
 *   1000 ms on the same curve.
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

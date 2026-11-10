import { useEffect } from 'react';

const SELECTOR = '.button';

function clampUnit(value) {
  return Math.max(-1, Math.min(1, value));
}

function px(value) {
  return Number.parseFloat(value) || 0;
}

// Measure from where the key rests, not where it has already drifted, so the
// pull does not feed back into itself.
function restCenter(el, style) {
  const rect = el.getBoundingClientRect();
  const [tx = '0', ty = '0'] = style.translate === 'none' ? [] : style.translate.split(' ');
  return {
    x: rect.left - px(tx) + rect.width / 2,
    y: rect.top - px(ty) + rect.height / 2,
    halfW: rect.width / 2,
    halfH: rect.height / 2,
  };
}

/**
 * Magnetic keys. One delegated pointer listener for the whole document: the
 * `.button` under a fine pointer is pulled toward it by at most the
 * --magnet-range tokens, and glides back on leave through the CSS transition
 * on `translate`. Touch, coarse pointers and reduced motion opt out.
 */
export function useMagneticField() {
  useEffect(() => {
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let active = null;
    let pending = null;
    let frame = 0;

    const release = () => {
      if (!active) return;
      active.style.removeProperty('--mx');
      active.style.removeProperty('--my');
      active = null;
    };

    const apply = () => {
      frame = 0;
      const event = pending;
      pending = null;
      if (!event) return;
      const target = event.target instanceof Element ? event.target.closest(SELECTOR) : null;
      if (target !== active) release();
      if (!target || target.matches(':disabled')) return;

      const style = getComputedStyle(target);
      const rest = restCenter(target, style);
      if (rest.halfW === 0 || rest.halfH === 0) return;
      const pullX = clampUnit((event.clientX - rest.x) / rest.halfW);
      const pullY = clampUnit((event.clientY - rest.y) / rest.halfH);
      active = target;
      target.style.setProperty('--mx', `${(pullX * px(style.getPropertyValue('--magnet-range-x'))).toFixed(2)}px`);
      target.style.setProperty('--my', `${(pullY * px(style.getPropertyValue('--magnet-range-y'))).toFixed(2)}px`);
    };

    const onMove = (event) => {
      if (event.pointerType !== 'mouse' || !finePointer.matches || reducedMotion.matches) return;
      pending = event;
      if (!frame) frame = requestAnimationFrame(apply);
    };

    const onLeaveDocument = (event) => {
      if (event.relatedTarget === null) {
        pending = null;
        release();
      }
    };

    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerout', onLeaveDocument);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerout', onLeaveDocument);
      release();
    };
  }, []);
}

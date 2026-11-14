import { useEffect } from 'react';
import { approach, frameDelta } from '../lib/spring.js';

const GLOW_RATE = 9;
const SETTLE_EPSILON = 0.002;

/**
 * Cursor light for a catalog plinth. Pointer input sets a target, a rAF loop
 * eases the light in and out and writes `--glow-x`, `--glow-y` and `--glow-a`
 * straight onto the element; the plinth paints a warm pool at that point in
 * the fixture's own colour temperature. No React state is touched, and the
 * element itself never moves: an object on a plinth does not tilt. Touch
 * input is ignored; reduced motion keeps the light, which never travels.
 */
export function useCursorGlow(ref) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const s = { glow: 0, target: 0, x: 0, y: 0 };
    let frame = 0;
    let lastTime = 0;

    const render = () => {
      el.style.setProperty('--glow-x', `${s.x.toFixed(1)}px`);
      el.style.setProperty('--glow-y', `${s.y.toFixed(1)}px`);
      el.style.setProperty('--glow-a', s.glow.toFixed(3));
    };

    const step = (now) => {
      const dt = frameDelta(now, lastTime);
      lastTime = now;
      s.glow = approach(s.glow, s.target, GLOW_RATE, dt);
      const settled = Math.abs(s.target - s.glow) < SETTLE_EPSILON;
      if (settled) s.glow = s.target;
      render();
      frame = settled ? 0 : requestAnimationFrame(step);
    };

    const start = () => {
      if (frame) return;
      lastTime = performance.now();
      frame = requestAnimationFrame(step);
    };

    const onMove = (event) => {
      if (event.pointerType === 'touch') return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      s.x = event.clientX - rect.left;
      s.y = event.clientY - rect.top;
      s.target = 1;
      // A settled light still follows the pointer: write the position now.
      if (!frame) render();
      start();
    };

    const onLeave = () => {
      s.target = 0;
      start();
    };

    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [ref]);
}

import { useEffect } from 'react';
import { approach, frameDelta, stepSpring } from '../lib/spring.js';
import { clampNumber } from '../security/sanitize.js';

export const LIGHT_REST = { x: 0.74, y: 0.34 };

// Spring constant k (1/s^2) and damping c (1/s). Critical damping is
// 2 * sqrt(k) ~= 18.97, so c = 12 lets the light overshoot slightly and
// settle like a pendant on a cable instead of snapping to the cursor.
export const LIGHT_SPRING = { stiffness: 90, damping: 12 };
const ENERGY_RATE = 6;
const SETTLE_EPSILON = 0.0004;

function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * Drives `--light-x`, `--light-y` and `--light-energy` on the surface element
 * from pointer position, integrated through a damped spring. The rAF loop only
 * runs while the light is moving.
 */
export function useAmbientLight(surfaceRef, readoutRef) {
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return undefined;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const s = {
      x: LIGHT_REST.x,
      y: LIGHT_REST.y,
      vx: 0,
      vy: 0,
      tx: LIGHT_REST.x,
      ty: LIGHT_REST.y,
      energy: 0,
    };
    let frame = 0;
    let lastTime = 0;

    const render = () => {
      surface.style.setProperty('--light-x', formatPercent(s.x));
      surface.style.setProperty('--light-y', formatPercent(s.y));
      surface.style.setProperty('--light-energy', s.energy.toFixed(3));
      const readout = readoutRef?.current;
      if (readout) readout.textContent = `X ${s.x.toFixed(3)}  Y ${s.y.toFixed(3)}`;
    };

    const step = (now) => {
      const dt = frameDelta(now, lastTime);
      lastTime = now;

      const { stiffness, damping } = LIGHT_SPRING;
      [s.x, s.vx] = stepSpring(s.x, s.vx, s.tx, dt, stiffness, damping);
      [s.y, s.vy] = stepSpring(s.y, s.vy, s.ty, dt, stiffness, damping);

      const speed = Math.hypot(s.vx, s.vy);
      s.energy = approach(s.energy, Math.min(speed / 1.6, 1), ENERGY_RATE, dt);

      render();

      const settled =
        Math.abs(s.tx - s.x) < SETTLE_EPSILON &&
        Math.abs(s.ty - s.y) < SETTLE_EPSILON &&
        speed < SETTLE_EPSILON &&
        s.energy < 0.002;

      frame = settled ? 0 : requestAnimationFrame(step);
    };

    const start = () => {
      if (frame) return;
      lastTime = performance.now();
      frame = requestAnimationFrame(step);
    };

    const snap = () => {
      s.x = s.tx;
      s.y = s.ty;
      s.vx = 0;
      s.vy = 0;
      s.energy = 0;
      render();
    };

    const setTarget = (x, y) => {
      s.tx = clampNumber(x, 0, 1, LIGHT_REST.x);
      s.ty = clampNumber(y, 0, 1, LIGHT_REST.y);
      if (reducedMotion.matches) snap();
      else start();
    };

    const onPointerMove = (event) => {
      const rect = surface.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      setTarget((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
    };

    const onPointerLeave = () => setTarget(LIGHT_REST.x, LIGHT_REST.y);

    render();
    surface.addEventListener('pointermove', onPointerMove, { passive: true });
    surface.addEventListener('pointerleave', onPointerLeave);

    return () => {
      cancelAnimationFrame(frame);
      surface.removeEventListener('pointermove', onPointerMove);
      surface.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [surfaceRef, readoutRef]);
}

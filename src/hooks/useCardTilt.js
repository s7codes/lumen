import { useEffect } from 'react';
import { approach, frameDelta, stepSpring } from '../lib/spring.js';

export const TILT_MAX_DEG = 4;
export const TILT_PERSPECTIVE_PX = 1000;

// Near-critical spring (critical c = 2 * sqrt(170) ~= 26.1): the card leans
// into the pointer without wobble and the same curve plays at any refresh rate.
export const TILT_SPRING = { stiffness: 170, damping: 26 };
const GLOW_RATE = 9;
const SETTLE_EPSILON = 0.0005;

function clampUnit(value) {
  return Math.max(-1, Math.min(1, value));
}

/**
 * 3D tilt and cursor glow for a card. Pointer input sets a target, a rAF loop
 * integrates the tilt through a damped spring and writes `transform`,
 * `--glow-x`, `--glow-y` and `--glow-a` straight onto the element. No React
 * state is touched. At rest the inline transform is removed entirely, so an
 * idle card is not a containing block. Touch, coarse pointers and reduced
 * motion get the glow only.
 */
export function useCardTilt(ref) {
  useEffect(() => {
    const card = ref.current;
    if (!card) return undefined;

    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const s = { x: 0, vx: 0, y: 0, vy: 0, tx: 0, ty: 0, glow: 0, tglow: 0, gx: 0, gy: 0 };
    let frame = 0;
    let lastTime = 0;

    const render = () => {
      card.style.setProperty('--glow-x', `${s.gx.toFixed(1)}px`);
      card.style.setProperty('--glow-y', `${s.gy.toFixed(1)}px`);
      card.style.setProperty('--glow-a', s.glow.toFixed(3));
      const atRest = Math.abs(s.x) < SETTLE_EPSILON && Math.abs(s.y) < SETTLE_EPSILON && s.tx === 0 && s.ty === 0;
      if (atRest) {
        card.style.removeProperty('transform');
        return;
      }
      // The hovered corner lifts toward the viewer, so a control under the
      // pointer grows toward it instead of sliding out from under it.
      const rx = (s.y * TILT_MAX_DEG).toFixed(3);
      const ry = (-s.x * TILT_MAX_DEG).toFixed(3);
      card.style.transform = `perspective(${TILT_PERSPECTIVE_PX}px) rotateX(${rx}deg) rotateY(${ry}deg)`;
    };

    const step = (now) => {
      const dt = frameDelta(now, lastTime);
      lastTime = now;
      const { stiffness, damping } = TILT_SPRING;
      [s.x, s.vx] = stepSpring(s.x, s.vx, s.tx, dt, stiffness, damping);
      [s.y, s.vy] = stepSpring(s.y, s.vy, s.ty, dt, stiffness, damping);
      s.glow = approach(s.glow, s.tglow, GLOW_RATE, dt);

      const settled =
        Math.abs(s.tx - s.x) < SETTLE_EPSILON &&
        Math.abs(s.ty - s.y) < SETTLE_EPSILON &&
        Math.hypot(s.vx, s.vy) < SETTLE_EPSILON &&
        Math.abs(s.tglow - s.glow) < 0.002;
      if (settled) {
        s.x = s.tx;
        s.y = s.ty;
        s.glow = s.tglow;
      }
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
      const rect = card.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      s.gx = event.clientX - rect.left;
      s.gy = event.clientY - rect.top;
      s.tglow = 1;
      const tilt = finePointer.matches && !reducedMotion.matches;
      s.tx = tilt ? clampUnit(((event.clientX - rect.left) / rect.width) * 2 - 1) : 0;
      s.ty = tilt ? clampUnit(((event.clientY - rect.top) / rect.height) * 2 - 1) : 0;
      start();
    };

    const onLeave = () => {
      s.tx = 0;
      s.ty = 0;
      s.tglow = 0;
      start();
    };

    card.addEventListener('pointermove', onMove, { passive: true });
    card.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      card.removeEventListener('pointermove', onMove);
      card.removeEventListener('pointerleave', onLeave);
      card.style.removeProperty('transform');
    };
  }, [ref]);
}

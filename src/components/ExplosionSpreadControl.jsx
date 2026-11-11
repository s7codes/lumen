import { useEffect, useId, useRef } from 'react';

// Exponential approach time constant: about 0.9 s from end to end, and the
// same curve at 60, 120 or 240 Hz because each step is weighted by dt.
const GLIDE_TAU_S = 0.12;
const SETTLE_EPSILON = 0.0005;
const MAX_STEP_S = 0.05;

const percent = (value) => Math.round(value * 100);

/**
 * Explosion Spread fader for the exploded assembly sheet. Input never goes
 * through React state: a native listener aims a requestAnimationFrame glide
 * that writes `--spread` on the drawing, and the layers translate in CSS.
 * `spreadRef` keeps the last target across view switches.
 */
export function ExplosionSpreadControl({ targetRef, spreadRef }) {
  const id = useId();
  const inputRef = useRef(null);
  const outputRef = useRef(null);
  const aimRef = useRef(null);
  const initial = percent(spreadRef.current);

  useEffect(() => {
    const input = inputRef.current;
    const output = outputRef.current;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motion = { current: spreadRef.current, target: spreadRef.current, frame: 0, last: 0 };

    const paint = () => targetRef.current?.style.setProperty('--spread', motion.current.toFixed(4));
    const settle = () => {
      motion.current = motion.target;
      motion.frame = 0;
      paint();
      targetRef.current?.setAttribute('data-spread', String(percent(motion.target)));
    };

    const step = (time) => {
      const dt = Math.min(MAX_STEP_S, Math.max(0, (time - motion.last) / 1000));
      motion.last = time;
      motion.current += (motion.target - motion.current) * (1 - Math.exp(-dt / GLIDE_TAU_S));
      if (Math.abs(motion.target - motion.current) < SETTLE_EPSILON) {
        settle();
        return;
      }
      paint();
      motion.frame = requestAnimationFrame(step);
    };

    const aim = (value) => {
      const target = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
      motion.target = target;
      spreadRef.current = target;
      const label = `${percent(target)}%`;
      output.textContent = label;
      input.setAttribute('aria-valuetext', `${label} exploded`);
      if (Number(input.value) !== percent(target)) input.value = String(percent(target));
      if (reduceMotion.matches) {
        cancelAnimationFrame(motion.frame);
        settle();
        return;
      }
      if (!motion.frame) {
        motion.last = performance.now();
        motion.frame = requestAnimationFrame(step);
      }
    };

    const onInput = () => aim(Number(input.value) / 100);
    input.addEventListener('input', onInput);
    aimRef.current = aim;
    settle();

    return () => {
      input.removeEventListener('input', onInput);
      cancelAnimationFrame(motion.frame);
      aimRef.current = null;
    };
  }, [targetRef, spreadRef]);

  return (
    <div className="explode-control" data-testid="exploded-controls">
      <div className="explode-control__head">
        <label htmlFor={id} className="explode-control__label">
          Explosion Spread
        </label>
        <output ref={outputRef} htmlFor={id} className="explode-control__value mono" data-testid="exploded-spread-value">
          {initial}%
        </output>
      </div>
      <input
        ref={inputRef}
        id={id}
        className="explode-control__range"
        type="range"
        min="0"
        max="100"
        step="1"
        defaultValue={initial}
        aria-valuetext={`${initial}% exploded`}
        data-testid="exploded-spread-slider"
      />
      <div className="explode-control__scale mono" aria-hidden="true">
        <span>Assembled</span>
        <span>Exploded</span>
      </div>
      <div className="explode-control__actions">
        <button
          type="button"
          className="button explode-control__action"
          data-testid="exploded-assemble"
          onClick={() => aimRef.current?.(0)}
        >
          Assemble (0%)
        </button>
        <button
          type="button"
          className="button explode-control__action"
          data-testid="exploded-explode"
          onClick={() => aimRef.current?.(1)}
        >
          Explode (100%)
        </button>
      </div>
    </div>
  );
}

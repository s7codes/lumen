import { expect, test } from '@playwright/test';
import { LIGHT_SPRING } from '../src/hooks/useAmbientLight.js';
import { approach, frameDelta, MAX_FRAME_DT, stepSpring } from '../src/lib/spring.js';

const { stiffness: K, damping: C } = LIGHT_SPRING;
const START = { x: 0.74, v: 0 };
const TARGET = 0.15;

// Simulates a display refreshing at `hz` and samples the spring at `times`.
function runAt(hz, times, { stiffness = K, damping = C } = {}) {
  const samples = [];
  let x = START.x;
  let v = START.v;
  let frame = 0;
  for (const t of times) {
    const frames = Math.round(t * hz);
    while (frame < frames) {
      [x, v] = stepSpring(x, v, TARGET, 1 / hz, stiffness, damping);
      frame += 1;
    }
    samples.push({ x, v });
  }
  return samples;
}

// Reference: classical RK4 on x'' = -k (x - target) - c x' at a 0.1 ms step.
function referenceAt(t, { stiffness = K, damping = C } = {}) {
  const h = 1e-4;
  const accel = (x, v) => -stiffness * (x - TARGET) - damping * v;
  let x = START.x;
  let v = START.v;
  for (let i = 0; i < Math.round(t / h); i += 1) {
    const k1x = v;
    const k1v = accel(x, v);
    const k2x = v + (h / 2) * k1v;
    const k2v = accel(x + (h / 2) * k1x, v + (h / 2) * k1v);
    const k3x = v + (h / 2) * k2v;
    const k3v = accel(x + (h / 2) * k2x, v + (h / 2) * k2v);
    const k4x = v + h * k3v;
    const k4v = accel(x + h * k3x, v + h * k3v);
    x += (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
    v += (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
  }
  return { x, v };
}

// Each time is a whole number of frames at 60, 120, 144 and 240 Hz.
const SAMPLE_TIMES = [0.25, 0.5, 0.75, 1, 1.5];

test.describe('ambient light spring', () => {
  test('60, 120, 144 and 240 Hz displays trace an identical trajectory', () => {
    const at60 = runAt(60, SAMPLE_TIMES);
    for (const hz of [120, 144, 240]) {
      runAt(hz, SAMPLE_TIMES).forEach((sample, i) => {
        const label = `${hz} Hz at ${SAMPLE_TIMES[i]} s`;
        expect(Math.abs(sample.x - at60[i].x), label).toBeLessThan(1e-12);
        expect(Math.abs(sample.v - at60[i].v), label).toBeLessThan(1e-11);
      });
    }
  });

  test('matches a high-resolution numerical solution of the spring equation', () => {
    for (const hz of [60, 120, 240]) {
      runAt(hz, [0.25, 0.5, 1]).forEach((sample, i) => {
        const reference = referenceAt([0.25, 0.5, 1][i]);
        expect(Math.abs(sample.x - reference.x), `${hz} Hz`).toBeLessThan(1e-9);
        expect(Math.abs(sample.v - reference.v), `${hz} Hz`).toBeLessThan(1e-8);
      });
    }
  });

  test('critically and over-damped springs are exact as well', () => {
    const critical = { stiffness: 36, damping: 12 };
    const over = { stiffness: 20, damping: 12 };
    for (const params of [critical, over]) {
      const [at60, at240] = [runAt(60, [0.5, 1], params), runAt(240, [0.5, 1], params)];
      [0.5, 1].forEach((t, i) => {
        const reference = referenceAt(t, params);
        expect(Math.abs(at60[i].x - reference.x)).toBeLessThan(1e-9);
        expect(Math.abs(at240[i].x - at60[i].x)).toBeLessThan(1e-12);
      });
    }
  });

  test('irregular frame pacing lands on the same state as a steady clock', () => {
    // Deterministic jitter between 3 ms and 21 ms per frame, as a throttled or
    // variable-refresh display would deliver.
    let seed = 7;
    const nextDt = () => {
      seed = (seed * 16807) % 2147483647;
      return 0.003 + (seed / 2147483647) * 0.018;
    };

    let x = START.x;
    let v = START.v;
    let elapsed = 0;
    while (elapsed < 0.9) {
      const dt = Math.min(nextDt(), 0.9 - elapsed);
      [x, v] = stepSpring(x, v, TARGET, dt, K, C);
      elapsed += dt;
    }
    const [steadyX, steadyV] = stepSpring(START.x, START.v, TARGET, 0.9, K, C);
    expect(Math.abs(x - steadyX)).toBeLessThan(1e-12);
    expect(Math.abs(v - steadyV)).toBeLessThan(1e-11);
  });

  test('the light is slightly under-damped: it overshoots once and settles', () => {
    const trace = runAt(240, Array.from({ length: 480 }, (_, i) => (i + 1) / 240));
    const minimum = Math.min(...trace.map((s) => s.x));
    expect(minimum).toBeLessThan(TARGET);
    expect(TARGET - minimum).toBeLessThan(0.1 * (START.x - TARGET));
    expect(Math.abs(trace.at(-1).x - TARGET)).toBeLessThan(1e-3);
  });

  test('frame delta is measured in seconds and clamped to 0..50 ms', () => {
    expect(MAX_FRAME_DT).toBe(0.05);
    expect(frameDelta(1016.6667, 1000)).toBeCloseTo(1 / 60, 6);
    expect(frameDelta(1008.3333, 1000)).toBeCloseTo(1 / 120, 6);
    expect(frameDelta(1004.1667, 1000)).toBeCloseTo(1 / 240, 6);
    expect(frameDelta(995, 1000)).toBe(0);
    expect(frameDelta(4000, 1000)).toBe(0.05);
    expect(stepSpring(0.5, 0.2, 0.1, 0, K, C)).toEqual([0.5, 0.2]);
  });

  test('glow energy relaxes at the same rate regardless of refresh', () => {
    let at60 = 1;
    let at240 = 1;
    for (let i = 0; i < 30; i += 1) at60 = approach(at60, 0, 6, 1 / 60);
    for (let i = 0; i < 120; i += 1) at240 = approach(at240, 0, 6, 1 / 240);
    expect(Math.abs(at60 - at240)).toBeLessThan(1e-12);
    expect(at60).toBeCloseTo(Math.exp(-3), 12);
  });
});

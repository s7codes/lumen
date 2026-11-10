export const MAX_FRAME_DT = 0.05;

/**
 * Seconds elapsed between two rAF timestamps, clamped to [0, MAX_FRAME_DT].
 * A rAF timestamp can precede the performance.now() taken when the loop was
 * armed, and a backgrounded tab can return after seconds, so both ends clamp.
 */
export function frameDelta(now, lastTime) {
  return Math.min(Math.max((now - lastTime) / 1000, 0), MAX_FRAME_DT);
}

/**
 * Advances a damped spring x'' = -k (x - target) - c x' by dt seconds using
 * the closed-form solution of the ODE, not a numerical integrator. With the
 * target held for the frame the result is exact for any dt, so 60, 120 and
 * 240 Hz displays trace the same curve: N small steps equal one large step.
 *
 * Returns [position, velocity].
 */
export function stepSpring(position, velocity, target, dt, stiffness, damping) {
  if (!(dt > 0)) return [position, velocity];

  const d0 = position - target;
  const v0 = velocity;
  const alpha = damping / 2;
  const disc = stiffness - alpha * alpha;
  const decay = Math.exp(-alpha * dt);

  // Under-damped: d(t) = e^(-at) (d0 cos wt + ((v0 + a d0) / w) sin wt)
  if (disc > 1e-9) {
    const w = Math.sqrt(disc);
    const cos = Math.cos(w * dt);
    const sin = Math.sin(w * dt);
    const d = decay * (d0 * cos + ((v0 + alpha * d0) / w) * sin);
    const v = decay * (v0 * cos - ((alpha * v0 + stiffness * d0) / w) * sin);
    return [target + d, v];
  }

  // Critically damped: d(t) = e^(-at) (d0 + (v0 + a d0) t)
  if (disc > -1e-9) {
    const b = v0 + alpha * d0;
    return [target + decay * (d0 + b * dt), decay * (v0 - alpha * b * dt)];
  }

  // Over-damped: two real roots s1, s2 = -a +/- r
  const r = Math.sqrt(-disc);
  const s1 = -alpha + r;
  const s2 = -alpha - r;
  const c1 = (v0 - s2 * d0) / (s1 - s2);
  const c2 = d0 - c1;
  const e1 = Math.exp(s1 * dt);
  const e2 = Math.exp(s2 * dt);
  return [target + c1 * e1 + c2 * e2, s1 * c1 * e1 + s2 * c2 * e2];
}

/**
 * First-order exponential approach toward `target` at `rate` (1/s). Exact for
 * a target held over dt, so it also composes identically across frame rates.
 */
export function approach(value, target, rate, dt) {
  if (!(dt > 0)) return value;
  return target + (value - target) * Math.exp(-rate * dt);
}

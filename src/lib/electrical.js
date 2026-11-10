export const BUS_VOLTAGE = 24;
export const BUS_RATED_W = 150;
export const BUS_RATED_A = BUS_RATED_W / BUS_VOLTAGE;
export const DROP_LIMIT = 0.03;
export const CONDUCTOR_MM2 = 2.5;

const COPPER_OHM_MM2_PER_M = 0.0172;

// Two conductors per run, so the loop resistance is twice the line resistance.
export const LOOP_OHM_PER_M = (2 * COPPER_OHM_MM2_PER_M) / CONDUCTOR_MM2;

export const BUS_LOADS_W = Object.freeze([60, 100, 150]);

export function busCurrent(loadW) {
  return Math.max(0, loadW) / BUS_VOLTAGE;
}

/**
 * Worst case for an end-fed run: the whole load lumped at the far end, so
 * the full current crosses the entire loop. A load spread evenly along the
 * track drops half as much.
 */
export function voltageDrop(loadW, lengthM) {
  const volts = busCurrent(loadW) * LOOP_OHM_PER_M * Math.max(0, lengthM);
  return { volts, ratio: volts / BUS_VOLTAGE, endVolts: BUS_VOLTAGE - volts };
}

export function maxRunM(loadW, limit = DROP_LIMIT) {
  const amps = busCurrent(loadW);
  return amps > 0 ? (limit * BUS_VOLTAGE) / (amps * LOOP_OHM_PER_M) : Infinity;
}

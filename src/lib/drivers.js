// Boxed 24V drivers. Dimensions are the retail carton, not the bare can.
export const DRIVERS = Object.freeze({
  'driver-60': Object.freeze({
    sku: 'LMN-DR-060',
    name: 'Lumen 60W 24V Driver',
    priceUsd: 58,
    weightKg: 0.6,
    dimsCm: Object.freeze({ w: 20, h: 6, d: 4 }),
    leadWeeks: Object.freeze([1, 2]),
  }),
  'driver-150': Object.freeze({
    sku: 'LMN-DR-150',
    name: 'Lumen 150W 24V Driver',
    priceUsd: 112,
    weightKg: 1.2,
    dimsCm: Object.freeze({ w: 26, h: 7, d: 5 }),
    leadWeeks: Object.freeze([1, 2]),
  }),
});

/** The driver unit behind a sized PSU. Arrays are built from 150W units. */
export function driverUnit(psuId) {
  return psuId === 'driver-60' ? DRIVERS['driver-60'] : DRIVERS['driver-150'];
}

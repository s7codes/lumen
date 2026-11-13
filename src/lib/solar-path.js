import { kelvinToRgb } from './photometry.js';

/*
 * Solar path for the daylight studio. The studio sits in Budapest, at
 * 47.5 deg N, on a late-spring day (solar declination +15 deg) with solar
 * noon at 13:00 local summer time, so the sun rises just before 06:00 and
 * sets just after 20:00. Hours are local decimal hours.
 *
 * Room frame: X along the north wall toward the east, Y up, Z toward the
 * south wall. A compass azimuth (0 north, 90 east) maps to the plan
 * direction [sin A, -cos A].
 */

export const SOLAR_HOUR = Object.freeze({ min: 6, max: 21, step: 0.25, initial: 14.5 });

export const SOLAR_PRESETS = Object.freeze([
  Object.freeze({ id: 'dawn', label: 'Dawn', hour: 7 }),
  Object.freeze({ id: 'noon', label: 'Noon', hour: 13 }),
  Object.freeze({ id: 'golden', label: 'Golden Hour', hour: 17.5 }),
  Object.freeze({ id: 'dusk', label: 'Dusk', hour: 20 }),
]);

/** Walls that can take the daylight window. North never sees the sun at this latitude. */
export const WINDOW_WALLS = Object.freeze(['none', 'west', 'east', 'south']);
export const WINDOW_LABELS = Object.freeze({ none: 'None', west: 'West', east: 'East', south: 'South' });

const LATITUDE_DEG = 47.5;
const DECLINATION_DEG = 15;
const SOLAR_NOON_HOUR = 13;
const DEG = Math.PI / 180;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Clamped to 06:00 to 21:00 and snapped to the 15 minute slider step. */
export function sanitizeSolarHour(value) {
  if (!isFiniteNumber(value)) return SOLAR_HOUR.initial;
  const clamped = Math.min(SOLAR_HOUR.max, Math.max(SOLAR_HOUR.min, value));
  return Math.round(clamped / SOLAR_HOUR.step) * SOLAR_HOUR.step;
}

/** 24-hour clock readout, 17.5 to "17:30". */
export function formatSolarHour(hour) {
  const minutes = Math.round(sanitizeSolarHour(hour) * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Compass azimuth and elevation of the sun, in degrees, for a local hour. */
export function sunAngles(hour) {
  const h = isFiniteNumber(hour) ? hour : SOLAR_HOUR.initial;
  const H = (h - SOLAR_NOON_HOUR) * 15 * DEG;
  const phi = LATITUDE_DEG * DEG;
  const delta = DECLINATION_DEG * DEG;
  const sinAlt = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(H);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinAlt))) / DEG;
  const azimuth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(delta) * Math.cos(phi)) / DEG + 180;
  return { azimuthDeg: azimuth, elevationDeg: elevation };
}

// Colour temperature follows the elevation through three anchors read off
// the path itself: crisp 6000K at noon, 2900K amber at 17:30 and 2200K at
// dusk, eased between them, falling toward 1900K below the horizon.
const NOON_ELEVATION = sunAngles(13).elevationDeg;
const KELVIN_ANCHORS = Object.freeze([
  [-6, 1900],
  [sunAngles(20).elevationDeg, 2200],
  [sunAngles(17.5).elevationDeg, 2900],
  [NOON_ELEVATION, 6000],
]);

function smooth(t) {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** Correlated colour temperature of direct sunlight at an elevation, in kelvin, to 10 K. */
export function sunKelvin(elevationDeg) {
  const e = isFiniteNumber(elevationDeg) ? elevationDeg : NOON_ELEVATION;
  if (e <= KELVIN_ANCHORS[0][0]) return KELVIN_ANCHORS[0][1];
  for (let i = 1; i < KELVIN_ANCHORS.length; i += 1) {
    const [e1, k1] = KELVIN_ANCHORS[i];
    if (e <= e1) {
      const [e0, k0] = KELVIN_ANCHORS[i - 1];
      return Math.round((k0 + (k1 - k0) * smooth((e - e0) / (e1 - e0))) / 10) * 10;
    }
  }
  return KELVIN_ANCHORS[KELVIN_ANCHORS.length - 1][1];
}

function hex(rgb) {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

const tenth = (value) => Math.round(value * 10) / 10;

/**
 * Everything the room needs from the sun at `hour`: compass azimuth,
 * elevation, colour temperature and colour, a relative strength from 0 below
 * the horizon to 1 at noon, and `direction`, the unit vector from the room
 * toward the sun in the room frame.
 */
export function solarState(hour) {
  const h = sanitizeSolarHour(hour);
  const { azimuthDeg, elevationDeg } = sunAngles(h);
  const up = elevationDeg > 0;
  const strength = up
    ? smooth(elevationDeg / 6) * Math.min(1, Math.sin(elevationDeg * DEG) / Math.sin(NOON_ELEVATION * DEG)) ** 0.55
    : 0;
  const kelvin = sunKelvin(elevationDeg);
  const a = azimuthDeg * DEG;
  const e = elevationDeg * DEG;
  return {
    hour: h,
    label: formatSolarHour(h),
    azimuthDeg: tenth(azimuthDeg),
    elevationDeg: tenth(elevationDeg),
    kelvin,
    color: hex(kelvinToRgb(kelvin)),
    strength: Math.round(strength * 1000) / 1000,
    up,
    direction: [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)],
  };
}

/** The preset a solar hour sits on, or null between presets. */
export function solarPreset(hour) {
  const h = sanitizeSolarHour(hour);
  return SOLAR_PRESETS.find((preset) => preset.hour === h)?.id ?? null;
}

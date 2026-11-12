import { clampNumber } from '../security/sanitize.js';
import { OCTAVE_BANDS } from './room-physics.js';

/*
 * RT60 audition: the room's six-band Sabine decay turned into a sound and a
 * decay curve. RT60 is the time for sound energy to fall 60 dB, so a band's
 * amplitude follows exp(-t ln(1000) / RT60) and Web Audio's setTargetAtTime
 * reproduces it exactly with time constant tau = RT60 / ln(1000).
 *
 * The sound is a short noise impulse split into the six octave bands, each
 * band ringing out on its own RT60 (a synthetic reverberation tail), under a
 * warm open D chord whose partials each sustain on the band they sound in.
 */

const LN_1000 = Math.log(1000);
const C50_SEC = 0.05;

export const AUDITION_RT60 = Object.freeze({ min: 0.1, max: 6 });
export const AUDITION_DURATION = Object.freeze({ min: 0.6, max: 5 });
/** The decay curve shares the octave spectrum's fixed 2.5 s axis, so a damped room visibly falls sooner. */
export const ENVELOPE_WINDOW_SEC = 2.5;
export const ENVELOPE_POINTS = 32;

// Open D voicing, strummed low to high; the two top partials are a quiet shimmer
// that lets the 1 and 2 kHz bands be heard.
export const AUDITION_CHORD = Object.freeze([
  Object.freeze({ hz: 73.42, level: 0.11, delay: 0 }),
  Object.freeze({ hz: 110, level: 0.09, delay: 0.03 }),
  Object.freeze({ hz: 146.83, level: 0.08, delay: 0.06 }),
  Object.freeze({ hz: 185, level: 0.07, delay: 0.09 }),
  Object.freeze({ hz: 220, level: 0.065, delay: 0.12 }),
  Object.freeze({ hz: 329.63, level: 0.055, delay: 0.15 }),
  Object.freeze({ hz: 369.99, level: 0.05, delay: 0.18 }),
  Object.freeze({ hz: 440, level: 0.045, delay: 0.21 }),
  Object.freeze({ hz: 1318.51, level: 0.012, delay: 0.24 }),
  Object.freeze({ hz: 2637.02, level: 0.006, delay: 0.27 }),
]);

const MASTER_GAIN = 0.5;
const IMPULSE_LEVEL = 0.32;
const ATTACK_SEC = 0.006;
const START_LEAD_SEC = 0.03;
const RELEASE_PAD_SEC = 0.35;
// Q of a one-octave band-pass: f0 / (f0 * (sqrt(2) - 1 / sqrt(2))).
const OCTAVE_Q = Math.SQRT2;

function round(value, digits) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** The octave band a frequency falls in, by nearest band centre on a log axis. */
export function bandIndexFor(hz) {
  const k = Math.round(Math.log2(hz / OCTAVE_BANDS[0]));
  return Math.min(OCTAVE_BANDS.length - 1, Math.max(0, k));
}

/** Clarity C50 in dB for an exponential decay: early (0 to 50 ms) over late energy. */
export function clarityC50(rt60Sec) {
  return 10 * Math.log10(Math.exp((2 * C50_SEC * LN_1000) / rt60Sec) - 1);
}

/**
 * Decay parameters for the audition, from computeEnvironmentalPhysics output.
 * Pure and deterministic; every field is clamped, so a tampered or partial
 * physics object still yields a playable, finite profile.
 *
 * envelope: the band-averaged energy decay in dB over ENVELOPE_WINDOW_SEC,
 * normalised 1 at the impulse to 0 at -60 dB.
 */
export function synthesizeAcousticProfile(physics) {
  const source = physics !== null && typeof physics === 'object' ? physics : {};
  const octave = source.octaveRt60 !== null && typeof source.octaveRt60 === 'object' ? source.octaveRt60 : {};
  const { min, max } = AUDITION_RT60;
  const rt60Sec = round(clampNumber(source.rt60Sec, min, max, 0.5), 2);
  const baselineRt60Sec = round(clampNumber(source.baselineRt60Sec, min, max, rt60Sec), 2);

  const bands = OCTAVE_BANDS.map((hz) => {
    const t60 = round(clampNumber(Object.hasOwn(octave, hz) ? octave[hz] : rt60Sec, min, max, rt60Sec), 2);
    return Object.freeze({
      hz,
      rt60Sec: t60,
      decayPerSec: round(LN_1000 / t60, 3),
      tauSec: t60 / LN_1000,
    });
  });

  const longest = Math.max(...bands.map((band) => band.rt60Sec));
  const durationSec = round(clampNumber(longest + RELEASE_PAD_SEC, AUDITION_DURATION.min, AUDITION_DURATION.max), 2);
  const dampingPct = Math.round(clampNumber((1 - rt60Sec / baselineRt60Sec) * 100, 0, 100, 0));
  const speech = (bands[OCTAVE_BANDS.indexOf(500)].rt60Sec + bands[OCTAVE_BANDS.indexOf(1000)].rt60Sec) / 2;

  const envelope = Array.from({ length: ENVELOPE_POINTS }, (_, i) => {
    const t = (i / (ENVELOPE_POINTS - 1)) * ENVELOPE_WINDOW_SEC;
    let energy = 0;
    for (const band of bands) energy += Math.exp(-2 * band.decayPerSec * t);
    const db = 10 * Math.log10(energy / bands.length);
    return round(clampNumber(1 + db / 60, 0, 1, 0), 3);
  });

  return Object.freeze({
    rt60Sec,
    baselineRt60Sec,
    durationSec,
    dampingPct,
    clarityDb: round(clarityC50(speech), 1),
    stiScore: round(clampNumber(source.stiScore, 0, 1, 0), 2),
    bands: Object.freeze(bands),
    envelope: Object.freeze(envelope),
    windowSec: ENVELOPE_WINDOW_SEC,
  });
}

/* ---------- playback ---------- */

let active = null;

/** Stops the audition in progress, if any, and releases its audio context. */
export function stopAcousticAudition() {
  if (!active) return;
  const { ctx, timer } = active;
  active = null;
  clearTimeout(timer);
  ctx.close().catch(() => {});
}

// mulberry32: a seeded generator, so every audition of one room is the same sound.
function seededNoise(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

function noiseBuffer(ctx, seconds) {
  const length = Math.max(1, Math.round(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const next = seededNoise(0x1a2b3c);
  for (let i = 0; i < length; i += 1) data[i] = next();
  return buffer;
}

/** A gain node that rises to `level` and decays on `tauSec` from `at`. */
function decayGain(ctx, at, level, tauSec) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(level, at + ATTACK_SEC);
  gain.gain.setTargetAtTime(0, at + ATTACK_SEC, tauSec);
  return gain;
}

function silent(profile, reason) {
  return { played: false, reason, profile, durationSec: profile.durationSec, stop() {} };
}

/**
 * Plays the room's acoustic signature through the Web Audio API. Never
 * throws: without an AudioContext (or when one cannot start) it returns
 * { played: false } and the caller still animates the decay curve.
 */
export function playAcousticAudition(physics, { audioWindow = globalThis.window } = {}) {
  const profile = synthesizeAcousticProfile(physics);
  stopAcousticAudition();
  const Context = audioWindow?.AudioContext ?? audioWindow?.webkitAudioContext;
  if (typeof Context !== 'function') return silent(profile, 'unsupported');

  let ctx;
  try {
    ctx = new Context({ latencyHint: 'interactive' });
  } catch {
    return silent(profile, 'unavailable');
  }

  try {
    const t0 = ctx.currentTime + START_LEAD_SEC;
    const end = t0 + profile.durationSec;
    const master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.ratio.value = 8;
    master.connect(limiter);
    limiter.connect(ctx.destination);

    const noise = noiseBuffer(ctx, profile.durationSec);
    for (const band of profile.bands) {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = band.hz;
      filter.Q.value = OCTAVE_Q;
      src.connect(filter);
      filter.connect(decayGain(ctx, t0, IMPULSE_LEVEL, band.tauSec)).connect(master);
      src.start(t0);
      src.stop(end);
    }

    for (const note of AUDITION_CHORD) {
      const band = profile.bands[bandIndexFor(note.hz)];
      const osc = ctx.createOscillator();
      osc.type = note.hz < 200 ? 'triangle' : 'sine';
      osc.frequency.value = note.hz;
      osc.connect(decayGain(ctx, t0 + note.delay, note.level, band.tauSec)).connect(master);
      osc.start(t0 + note.delay);
      osc.stop(end);
    }

    ctx.resume?.().catch(() => {});
    const timer = setTimeout(() => {
      if (active?.ctx === ctx) stopAcousticAudition();
    }, (profile.durationSec + 0.25) * 1000);
    active = { ctx, timer };
    return { played: true, reason: null, profile, durationSec: profile.durationSec, stop: stopAcousticAudition };
  } catch {
    ctx.close().catch(() => {});
    return silent(profile, 'unavailable');
  }
}

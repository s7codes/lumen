import { clampNumber } from '../security/sanitize.js';
import { OCTAVE_BANDS } from './room-physics.js';

/*
 * RT60 audition: the room's six-band Sabine decay turned into a sound and a
 * decay curve. RT60 is the time for sound energy to fall 60 dB, so a band's
 * amplitude follows exp(-t ln(1000) / RT60) and Web Audio's setTargetAtTime
 * reproduces it exactly with time constant tau = RT60 / ln(1000).
 *
 * The sound is a soft architectural wood clap split into the six octave
 * bands, each band ringing out on its own RT60 (a synthetic reverberation
 * tail), under a warm open D chord whose partials each sustain on the band
 * they sound in. The clap's character lives in its sample buffer (a short
 * transient, two damped hardwood body modes and a pink tail), so the node
 * graph stays six band-passes and ten partials. Levels are kept low and the
 * upper bands eased off, so a take is never harsh or startling.
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

const MASTER_GAIN = 0.28;
const IMPULSE_LEVEL = 0.09;
const ATTACK_SEC = 0.006;
// Chord partials swell in over 25 ms, like a felt-hammer strike rather than a click.
const CHORD_ATTACK_SEC = 0.025;
// Per-band clap level, 125 Hz to 4 kHz: the top octaves eased off for warmth.
export const CLAP_BAND_WEIGHTS = Object.freeze([1, 1, 0.92, 0.78, 0.58, 0.42]);
/**
 * The wood clap: a 6 ms noise transient, two damped body modes of a hardwood
 * block, and a pink-noise tail for the band gains to shape into the room's
 * reverberation, normalised to a 0.95 peak.
 */
export const WOOD_CLAP = Object.freeze({
  transientSec: 0.006,
  transient: 2.2,
  tail: 0.4,
  peak: 0.95,
  modes: Object.freeze([
    Object.freeze({ hz: 720, tauSec: 0.028, level: 0.7 }),
    Object.freeze({ hz: 1880, tauSec: 0.012, level: 0.32 }),
  ]),
});
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

/**
 * Plain-language echo comparison for the decay curve: the room's RT60 against
 * the same room bare. "Echo: 1.26 s vs. 2.01 s bare (-37% reverb)" once the
 * absorbers take at least 1 percent off; otherwise a bare-room hint.
 */
export function echoReadout(profile) {
  const p = profile !== null && typeof profile === 'object' ? profile : synthesizeAcousticProfile(null);
  if (!(p.dampingPct >= 1)) {
    return { damped: false, text: `Bare room echo ${p.rt60Sec.toFixed(2)} s - add acoustic panels to damp` };
  }
  return {
    damped: true,
    text: `Echo: ${p.rt60Sec.toFixed(2)} s vs. ${p.baselineRt60Sec.toFixed(2)} s bare (-${p.dampingPct}% reverb)`,
  };
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

/**
 * The wood clap as raw samples: deterministic for a sample rate and length,
 * peak-normalised, front-loaded (the transient and body modes ring out in
 * the first few tens of milliseconds over a soft pink tail). Pure, so it is
 * testable without Web Audio.
 */
export function woodClapSamples(sampleRate, seconds) {
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
  const length = Math.max(1, Math.round(rate * clampNumber(seconds, 0.01, AUDITION_DURATION.max, 1)));
  const data = new Float32Array(length);
  const next = seededNoise(0x1a2b3c);
  // Paul Kellet's economy pink filter: equal energy per octave, so the six bands start level.
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let peak = 0;
  for (let i = 0; i < length; i += 1) {
    const white = next();
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    const pink = (b0 + b1 + b2 + white * 0.1848) * 0.25;
    const t = i / rate;
    let body = 0;
    for (const mode of WOOD_CLAP.modes) body += Math.sin(2 * Math.PI * mode.hz * t) * Math.exp(-t / mode.tauSec) * mode.level;
    const sample = pink * WOOD_CLAP.tail + white * Math.exp(-t / WOOD_CLAP.transientSec) * WOOD_CLAP.transient + body;
    data[i] = sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  const scale = peak > 0 ? WOOD_CLAP.peak / peak : 0;
  for (let i = 0; i < length; i += 1) data[i] *= scale;
  return data;
}

function clapBuffer(ctx, seconds) {
  const samples = woodClapSamples(ctx.sampleRate, seconds);
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.getChannelData(0).set(samples);
  return buffer;
}

/** A gain node that rises to `level` over `attackSec` and decays on `tauSec` from there. */
function decayGain(ctx, at, level, tauSec, attackSec = ATTACK_SEC) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(level, at + attackSec);
  gain.gain.setTargetAtTime(0, at + attackSec, tauSec);
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

    const clap = clapBuffer(ctx, profile.durationSec);
    for (const [i, band] of profile.bands.entries()) {
      const src = ctx.createBufferSource();
      src.buffer = clap;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = band.hz;
      filter.Q.value = OCTAVE_Q;
      src.connect(filter);
      filter.connect(decayGain(ctx, t0, IMPULSE_LEVEL * CLAP_BAND_WEIGHTS[i], band.tauSec)).connect(master);
      src.start(t0);
      src.stop(end);
    }

    for (const note of AUDITION_CHORD) {
      const band = profile.bands[bandIndexFor(note.hz)];
      const osc = ctx.createOscillator();
      osc.type = note.hz < 200 ? 'triangle' : 'sine';
      osc.frequency.value = note.hz;
      osc.connect(decayGain(ctx, t0 + note.delay, note.level, band.tauSec, CHORD_ATTACK_SEC)).connect(master);
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

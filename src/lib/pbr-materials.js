/*
 * Procedural PBR material synthesizer.
 *
 * Every material key synthesises a deterministic, tileable set of 8-bit RGBA
 * buffers in memory, with zero network requests:
 *
 * - albedoMap: a neutral tone multiplier (linear data, RGB equal), so one map
 *   serves every finish colour and the finish hex keeps its brightness.
 * - bumpMap: the relief height field, RGB equal.
 * - normalMap: tangent-space normals derived from the bump field with
 *   wrapped central differences, so the relief tiles as cleanly as the tone.
 * - roughnessMap: absolute roughness in every channel; three.js reads green.
 *
 * Noise is integer-hashed value noise on lattices whose periods divide the
 * tile, so the left edge meets the right edge and the top meets the bottom.
 * Pure: no DOM, no three.js. RoomCanvas wraps the buffers in DataTextures,
 * caches them per canvas and disposes them with it.
 */

const TAU = Math.PI * 2;
// Texel slope to tangent-space normal tilt: bumpScale 0.008 (timber) lands
// near a 1.6 gain, felt at 2.4, brushed metal at 0.8.
const NORMAL_GAIN = 200;

export const PBR_MATERIALS = Object.freeze({
  'wood-walnut': Object.freeze({
    family: 'wood',
    label: 'Walnut grain',
    width: 128,
    height: 128,
    tileCm: [48, 48],
    roughness: 0.58,
    metalness: 0,
    bumpScale: 0.008,
    seed: 0x5a17,
    rings: 7,
    // Fine oiled veneer: a soft late-wood figure under dense longitudinal fibre.
    contrast: 0.11,
    fibre: 0.12,
    micro: 0.1,
  }),
  'wood-oak': Object.freeze({
    family: 'wood',
    label: 'Oak grain',
    width: 128,
    height: 128,
    tileCm: [48, 48],
    roughness: 0.58,
    metalness: 0,
    bumpScale: 0.008,
    seed: 0x0a4c,
    rings: 5,
    contrast: 0.08,
    fibre: 0.1,
    micro: 0.09,
  }),
  'metal-obsidian': Object.freeze({
    family: 'metal',
    label: 'Brushed anodised',
    width: 128,
    height: 128,
    tileCm: [24, 24],
    roughness: 0.32,
    metalness: 0.38,
    bumpScale: 0.004,
    seed: 0x0b51,
  }),
  'metal-steel': Object.freeze({
    family: 'metal',
    label: 'Brushed steel',
    width: 128,
    height: 128,
    tileCm: [24, 24],
    roughness: 0.32,
    metalness: 0.38,
    bumpScale: 0.004,
    seed: 0x57ee,
  }),
  'felt-acoustic': Object.freeze({
    family: 'fibre',
    label: 'PET felt',
    width: 128,
    height: 128,
    tileCm: [16, 16],
    roughness: 0.92,
    metalness: 0,
    bumpScale: 0.012,
    seed: 0xfe17,
    macro: 8,
    fleck: 0.016,
  }),
  'matte-chalk': Object.freeze({
    family: 'fibre',
    label: 'Limewash chalk',
    width: 128,
    height: 128,
    tileCm: [32, 32],
    roughness: 0.92,
    metalness: 0,
    bumpScale: 0.012,
    seed: 0xc4a1,
    macro: 4,
    fleck: 0,
  }),
  'floor-parquet': Object.freeze({
    family: 'floor',
    label: 'Wide-plank floor',
    width: 256,
    height: 128,
    tileCm: [144, 72],
    roughness: 0.62,
    metalness: 0,
    bumpScale: 0.01,
    seed: 0xf10a,
    rows: 4,
    // Calm Scandinavian wide plank: a faint ring figure and gentle plank-to-plank tone.
    contrast: 0.035,
    plankTone: 0.09,
  }),
  'wall-plaster': Object.freeze({
    family: 'plaster',
    label: 'Venetian plaster',
    width: 256,
    height: 256,
    tileCm: [160, 160],
    roughness: 0.9,
    metalness: 0,
    bumpScale: 0.006,
    seed: 0x9a57,
  }),
});

export const PBR_MATERIAL_KEYS = Object.freeze(Object.keys(PBR_MATERIALS));

const FINISH_MATERIAL = Object.freeze({
  walnut: 'wood-walnut',
  oak: 'wood-oak',
  obsidian: 'metal-obsidian',
  chalk: 'matte-chalk',
});

/** The PBR family a catalogue finish renders with. */
export function finishMaterial(finishId) {
  return Object.hasOwn(FINISH_MATERIAL, finishId) ? FINISH_MATERIAL[finishId] : 'matte-chalk';
}

export function isPbrMaterial(key) {
  return typeof key === 'string' && Object.hasOwn(PBR_MATERIALS, key);
}

/* Noise */

function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const wrap = (value, period) => ((value % period) + period) % period;

/** Periodic value noise: (x, y) in lattice cells, period (px, py) cells. */
function valueNoise(x, y, px, py, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = wrap(xi, px);
  const y0 = wrap(yi, py);
  const x1 = (x0 + 1) % px;
  const y1 = (y0 + 1) % py;
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal sum over the unit tile: (u, v) in [0, 1), base periods (pu, pv) doubling per octave. */
function fbm(u, v, pu, pv, octaves, seed) {
  let sum = 0;
  let amplitude = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o += 1) {
    const fu = pu << o;
    const fv = pv << o;
    sum += amplitude * valueNoise(u * fu, v * fv, fu, fv, seed + o * 101);
    norm += amplitude;
    amplitude *= 0.5;
  }
  return sum / norm;
}

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/* Families: each returns { tone, height, rough } for a texel. */

function woodTexel(spec, u, v) {
  // u runs along the grain, v across it. The late-wood band eases in on a
  // square curve, so the figure stays a soft veneer flame rather than zebra
  // stripes; dense fibre and micro-fibre along u carry the timber texture.
  const flow = fbm(u, v, 2, 2, 3, spec.seed + 1) - 0.5;
  const band = 0.5 + 0.5 * Math.sin(TAU * (v * spec.rings + flow * 1.5 + 0.18 * Math.sin(TAU * u)));
  const late = band ** 2;
  const fibre = valueNoise(u * 4, v * 64, 4, 64, spec.seed + 2);
  const micro = valueNoise(u * 8, v * 128, 8, 128, spec.seed + 4);
  const pore = valueNoise(u * 16, v * 64, 16, 64, spec.seed + 3);
  return {
    tone: clamp01(1 - spec.contrast * late - spec.fibre * (fibre - 0.5) - spec.micro * (micro - 0.5) - 0.04 * (pore - 0.5)),
    height: clamp01(0.5 + 0.24 * (fibre - 0.5) + 0.16 * (micro - 0.5) - 0.06 * late + 0.08 * (pore - 0.5)),
    rough: clamp01(spec.roughness + 0.03 * late - 0.04 * (fibre - 0.5)),
  };
}

function metalTexel(spec, u, v, i, j) {
  // Fine directional micro-grooves along u, with sparse longer scratches.
  const groove = 0.6 * valueNoise(u * 2, v * 64, 2, 64, spec.seed) + 0.4 * valueNoise(u * 4, v * 32, 4, 32, spec.seed + 7);
  const scratch = hash2(j, 0, spec.seed + 13) > 0.94 ? 0.5 + 0.5 * valueNoise(u * 8, 0, 8, 1, spec.seed + j) : 0;
  return {
    tone: clamp01(0.95 + 0.07 * (groove - 0.5) + 0.03 * scratch),
    height: clamp01(0.5 + 0.38 * (groove - 0.5) + 0.12 * scratch),
    rough: clamp01(spec.roughness + 0.1 * (groove - 0.5) - 0.06 * scratch),
  };
}

function fibreTexel(spec, u, v, i, j) {
  // Isotropic high-frequency felt fibre or limewash micro grain over a soft mottle.
  const micro = valueNoise(u * 64, v * 64, 64, 64, spec.seed);
  const mid = valueNoise(u * 32, v * 32, 32, 32, spec.seed + 1);
  const mottle = fbm(u, v, spec.macro, spec.macro, 2, spec.seed + 2);
  const fleck = spec.fleck > 0 && hash2(i, j, spec.seed + 3) < spec.fleck ? 1 : 0;
  return {
    tone: clamp01(0.92 + 0.1 * (mottle - 0.5) + 0.06 * (mid - 0.5) + 0.06 * fleck),
    height: clamp01(0.5 + 0.3 * (micro - 0.5) + 0.22 * (mid - 0.5)),
    rough: clamp01(spec.roughness + 0.05 * (mid - 0.5)),
  };
}

function floorTexel(spec, u, v, i, j, width, height) {
  // Wide planks along u, `rows` per tile across v, end joints staggered by row.
  const rowPx = height / spec.rows;
  const row = Math.floor(j / rowPx);
  const across = j - row * rowPx;
  const shift = Math.round(([0, 0.5, 0.25, 0.75][row % 4]) * width);
  const along = wrap(i + shift, width);
  const seam = across === 0 || along === 0;
  const plank = hash2(row, 0, spec.seed);
  const uu = along / width;
  const flow = fbm(uu, v, 2, 2, 2, spec.seed + row * 17) - 0.5;
  const band = 0.5 + 0.5 * Math.sin(TAU * (v * spec.rows * 3 + flow * 1.2));
  const ring = band ** 2;
  const fibre = valueNoise(uu * 4, v * 64, 4, 64, spec.seed + 5 + row);
  const tone = 1 - spec.plankTone + spec.plankTone * plank - spec.contrast * ring - 0.08 * (fibre - 0.5);
  return {
    tone: clamp01(seam ? tone * 0.55 : tone),
    height: seam ? 0.12 : clamp01(0.55 + 0.16 * (fibre - 0.5) - 0.04 * ring),
    rough: clamp01(seam ? 0.9 : spec.roughness + 0.06 * (plank - 0.5) + 0.03 * ring),
  };
}

function plasterTexel(spec, u, v) {
  // Venetian plaster: a soft cloudy mottle in the tone, a gentle trowelled
  // swell in the relief (raking LED light exaggerates anything stronger),
  // burnished slightly glossier where the mottle peaks.
  const cloud = fbm(u, v, 4, 4, 4, spec.seed);
  const swell = fbm(u, v, 3, 3, 2, spec.seed + 4);
  const micro = valueNoise(u * 96, v * 96, 96, 96, spec.seed + 9);
  return {
    tone: clamp01(0.94 + 0.1 * (cloud - 0.5) + 0.02 * (micro - 0.5)),
    height: clamp01(0.5 + 0.3 * (swell - 0.5) + 0.025 * (micro - 0.5)),
    rough: clamp01(spec.roughness - 0.12 * (cloud - 0.5)),
  };
}

const FAMILIES = Object.freeze({
  wood: woodTexel,
  metal: metalTexel,
  fibre: fibreTexel,
  floor: floorTexel,
  plaster: plasterTexel,
});

const byte = (value) => Math.round(clamp01(value) * 255);

function grey(buffer, index, value) {
  const b = byte(value);
  buffer[index] = b;
  buffer[index + 1] = b;
  buffer[index + 2] = b;
  buffer[index + 3] = 255;
}

/**
 * Synthesises one material's maps. Returns null for an unknown key. Equal
 * keys always produce byte-identical buffers.
 */
export function synthesizeMaterial(key) {
  if (!isPbrMaterial(key)) return null;
  const spec = PBR_MATERIALS[key];
  const { width, height } = spec;
  const texel = FAMILIES[spec.family];
  const count = width * height;
  const albedoMap = new Uint8Array(count * 4);
  const bumpMap = new Uint8Array(count * 4);
  const roughnessMap = new Uint8Array(count * 4);
  const relief = new Float32Array(count);

  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) {
      const t = texel(spec, i / width, j / height, i, j, width, height);
      const k = j * width + i;
      relief[k] = t.height;
      grey(albedoMap, k * 4, t.tone);
      grey(bumpMap, k * 4, t.height);
      grey(roughnessMap, k * 4, t.rough);
    }
  }

  const normalMap = new Uint8Array(count * 4);
  const gain = spec.bumpScale * NORMAL_GAIN;
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) {
      const dx = relief[j * width + ((i + 1) % width)] - relief[j * width + wrap(i - 1, width)];
      const dy = relief[((j + 1) % height) * width + i] - relief[wrap(j - 1, height) * width + i];
      const nx = -dx * gain;
      const ny = -dy * gain;
      const inv = 1 / Math.hypot(nx, ny, 1);
      const k = (j * width + i) * 4;
      normalMap[k] = byte(nx * inv * 0.5 + 0.5);
      normalMap[k + 1] = byte(ny * inv * 0.5 + 0.5);
      normalMap[k + 2] = byte(inv * 0.5 + 0.5);
      normalMap[k + 3] = 255;
    }
  }

  return {
    key,
    family: spec.family,
    label: spec.label,
    width,
    height,
    tileCm: spec.tileCm,
    roughness: spec.roughness,
    metalness: spec.metalness,
    bumpScale: spec.bumpScale,
    albedoMap,
    bumpMap,
    normalMap,
    roughnessMap,
  };
}

/**
 * Soft contact-occlusion falloff: a squircle that is densest under the
 * object and fades to nothing at the plane's edge. Grey RGB, as three.js
 * reads alpha maps from green.
 */
export function contactShadowMap(size = 64) {
  const n = Math.max(8, Math.min(256, Math.round(size)));
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const x = Math.abs(((i + 0.5) / n) * 2 - 1);
      const y = Math.abs(((j + 0.5) / n) * 2 - 1);
      const d = (x ** 4 + y ** 4) ** 0.25;
      const t = clamp01((d - 0.45) / 0.55);
      grey(data, (j * n + i) * 4, (1 - t * t * (3 - 2 * t)) ** 1.4);
    }
  }
  return { width: n, height: n, data };
}

/**
 * Inside-corner ambient falloff for a plane centred on the corner line:
 * densest down the middle column, easing to nothing at both side edges,
 * constant up the wall. Grey RGB, read as an alpha map.
 */
export function cornerShadeMap(width = 64) {
  const n = Math.max(8, Math.min(256, Math.round(width)));
  const rows = 4;
  const data = new Uint8Array(n * rows * 4);
  for (let i = 0; i < n; i += 1) {
    const x = Math.abs(((i + 0.5) / n) * 2 - 1);
    const level = (1 - x) ** 2.4;
    for (let j = 0; j < rows; j += 1) grey(data, (j * n + i) * 4, level);
  }
  return { width: n, height: rows, data };
}

/*
 * Procedural studio environment for image-based lighting: an 8-bit sRGB
 * equirectangular map (u round the azimuth, row 0 at the nadir) of a warm
 * photographic studio. A broad overhead softbox, two tall strip boxes east
 * and west for crisp specular streaks on steel and lacquer, a warm horizon
 * bounce off the floor and a darker floor below. Deterministic and tiny:
 * 64 x 32 texels, built in well under a millisecond once per canvas, which
 * assigns it to scene.environment at a low intensity on every renderer.
 */
export const STUDIO_ENVIRONMENT = Object.freeze({
  width: 64,
  height: 32,
  intensity: 0.42,
  softbox: Object.freeze([1, 0.96, 0.9]),
  dome: Object.freeze([0.42, 0.4, 0.38]),
  horizon: Object.freeze([0.66, 0.56, 0.44]),
  floor: Object.freeze([0.2, 0.17, 0.14]),
});

// Software rasterisers: SwiftShader (headless Chromium, no GPU), Mesa's
// llvmpipe and softpipe, Microsoft's WARP and Basic Render Driver.
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render|warp\b/i;

/**
 * Quality tier for a WebGL renderer string: 'studio' on a GPU, 'software' on
 * a software rasteriser, where every pixel, MSAA sample and prefilter tap is
 * paid for on the CPU. The canvas keeps image-based lighting on both: a GPU
 * prefilters the studio environment for the whole room, a software tier
 * evaluates the same studio in closed form on its specular materials only,
 * renders without MSAA and tessellates fillets at half the segments.
 */
export function iblTier(rendererName) {
  return typeof rendererName === 'string' && SOFTWARE_RENDERER.test(rendererName) ? 'software' : 'studio';
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** RGB, 0..1, of the studio environment in a direction given by azimuth and elevation in degrees. */
export function studioEnvironmentTexel(azimuthDeg, elevationDeg) {
  const env = STUDIO_ENVIRONMENT;
  const e = elevationDeg;
  // Sky dome above, floor below, a warm bounce band either side of the horizon.
  const above = smoothstep(-6, 6, e);
  const bounce = Math.exp(-((e - 2) ** 2) / (2 * 9 ** 2));
  let rgb = env.floor.map((c, k) => c + (env.dome[k] - c) * above);
  rgb = rgb.map((c, k) => c + (env.horizon[k] - c) * bounce * 0.8);
  // The overhead softbox: a rounded square of light round the zenith.
  const box = smoothstep(52, 64, e);
  // Strip boxes east (90) and west (270), 18 deg wide, from 8 to 48 deg up.
  const a = ((azimuthDeg % 360) + 360) % 360;
  const toStrip = Math.min(Math.abs(a - 90), Math.abs(a - 270));
  const strip = (1 - smoothstep(6, 10, toStrip)) * smoothstep(4, 10, e) * (1 - smoothstep(44, 50, e));
  const light = Math.max(box, strip * 0.85);
  return rgb.map((c, k) => clamp01(c + (env.softbox[k] - c) * light));
}

/** The studio environment as an RGBA buffer, deterministic and byte-identical per call. */
export function studioEnvironmentMap() {
  const { width, height } = STUDIO_ENVIRONMENT;
  const data = new Uint8Array(width * height * 4);
  for (let j = 0; j < height; j += 1) {
    const elevation = ((j + 0.5) / height) * 180 - 90;
    for (let i = 0; i < width; i += 1) {
      const azimuth = ((i + 0.5) / width) * 360;
      const rgb = studioEnvironmentTexel(azimuth, elevation);
      const k = (j * width + i) * 4;
      data[k] = byte(rgb[0]);
      data[k + 1] = byte(rgb[1]);
      data[k + 2] = byte(rgb[2]);
      data[k + 3] = 255;
    }
  }
  return { width, height, intensity: STUDIO_ENVIRONMENT.intensity, data };
}

/**
 * UV scale for one face of a box in world units: a face `uLen` by `vLen`
 * metres repeats the map every tile, and a face whose v axis carries the
 * grain swaps so the grain always runs along the texture's u.
 */
export function faceUvTransform(uLen, vLen, uAxis, vAxis, grain, tileM) {
  const tile = tileM > 0 ? tileM : 1;
  const swap = grain === vAxis && grain !== uAxis;
  return swap ? { swap, su: vLen / tile, sv: uLen / tile } : { swap, su: uLen / tile, sv: vLen / tile };
}

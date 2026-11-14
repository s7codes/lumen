/*
 * Procedural material textures for the media studio. Pure: numbers in,
 * RGBA bytes out, so the same code previews in Node and feeds the path
 * tracer in the browser. Every pattern is smooth and physical (growth rings,
 * medullary rays, plank joints, honed stone clouds), never pixel noise.
 */

/* ---------- noise ---------- */

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded 2D gradient noise in about -1..1, periodic over `period` cells when given. */
export function makeNoise(seed) {
  const rand = mulberry(seed);
  const perm = new Uint16Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i += 1) perm[i] = p[i & 255];
  const gx = new Float32Array(256);
  const gy = new Float32Array(256);
  for (let i = 0; i < 256; i += 1) {
    const a = rand() * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return function noise(x, y, period = 0) {
    let x0 = Math.floor(x);
    let y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    let x1 = x0 + 1;
    let y1 = y0 + 1;
    if (period) {
      x0 = ((x0 % period) + period) % period;
      y0 = ((y0 % period) + period) % period;
      x1 = ((x1 % period) + period) % period;
      y1 = ((y1 % period) + period) % period;
    }
    const h = (ix, iy) => perm[(perm[ix & 255] + iy) & 511];
    const d = (hash, dx, dy) => gx[hash] * dx + gy[hash] * dy;
    const n00 = d(h(x0, y0), fx, fy);
    const n10 = d(h(x1, y0), fx - 1, fy);
    const n01 = d(h(x0, y1), fx, fy - 1);
    const n11 = d(h(x1, y1), fx - 1, fy - 1);
    const u = fade(fx);
    const v = fade(fy);
    return 1.41 * ((n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v);
  };
}

export function fbm(noise, x, y, octaves = 4, lacunarity = 2, gain = 0.5, period = 0) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i += 1) {
    sum += amp * noise(x * f, y * f, period ? period * f : 0);
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return sum / norm;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

/* ---------- colour ---------- */

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c) {
  const v = clamp01(c);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

export function hexToLinear(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}

function writePixel(data, i, rgb) {
  data[i] = Math.round(linearToSrgb(rgb[0]) * 255);
  data[i + 1] = Math.round(linearToSrgb(rgb[1]) * 255);
  data[i + 2] = Math.round(linearToSrgb(rgb[2]) * 255);
  data[i + 3] = 255;
}

function lerp3(a, b, t) {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

function scale3(a, k) {
  return [a[0] * k, a[1] * k, a[2] * k];
}

/* ---------- wood ---------- */

const SPECIES = Object.freeze({
  // Oiled American black walnut, flat sawn: chocolate heartwood with nested
  // cathedral arches, darker latewood, honey and plum streaks.
  walnut: {
    early: '#5a3d2b',
    late: '#311f15',
    streak: '#76533a',
    plum: '#3f2e2b',
    pore: '#2a1a12',
    ringsPerM: 240,
    depthM: 0.1,
    tilt: 0.026,
    pithM: 0.64,
    wobble: 0.022,
    pores: 0.34,
    rays: 0,
    contrast: 1.0,
  },
  // White-oiled Nordic oak, rift sawn: pale linen-beige, near-straight grain
  // and the soft silver medullary flecks of quartered stock.
  oak: {
    early: '#d9c6a6',
    late: '#b49a76',
    streak: '#e6d7bd',
    plum: '#c7b08f',
    pore: '#9a8062',
    ringsPerM: 190,
    depthM: 0.02,
    tilt: 0.012,
    pithM: -0.35,
    wobble: 0.012,
    pores: 0.6,
    rays: 0.8,
    contrast: 0.7,
  },
  // Floor-grade white oak: mostly rift, with the odd flat-sawn arch.
  oakFloor: {
    early: '#dbc8a8',
    late: '#b39874',
    streak: '#e6d6bb',
    plum: '#c4ab88',
    pore: '#9a8062',
    ringsPerM: 170,
    depthM: 0.06,
    tilt: 0.018,
    pithM: 1.25,
    wobble: 0.02,
    pores: 0.55,
    rays: 0.45,
    contrast: 0.66,
  },
});

function hash1(n, seed) {
  let h = Math.imul(n ^ (seed * 374761393), 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * A wood surface `sizeM` metres square, x along the grain, `px` pixels a
 * side. The figure is modelled, not stencilled: the board is a plane cut
 * through concentric growth cylinders round a pith that leans slightly to
 * it, so flat-sawn boards show nested cathedral arches and rift-sawn boards
 * near-straight lines. Ring widths, latewood weight and colour runs vary
 * year to year. Returns sRGB RGBA bytes plus a roughness channel (0..255).
 */
export function woodTexture(speciesId, { px = 1024, sizeM = 1.2, seed = 7 } = {}) {
  const s = SPECIES[speciesId];
  const noise = makeNoise(seed);
  const noise2 = makeNoise(seed + 101);
  const early = hexToLinear(s.early);
  const late = hexToLinear(s.late);
  const streak = hexToLinear(s.streak);
  const plum = hexToLinear(s.plum);
  const pore = hexToLinear(s.pore);
  const data = new Uint8ClampedArray(px * px * 4);
  const rough = new Uint8ClampedArray(px * px);
  for (let j = 0; j < px; j += 1) {
    const y = (j / px) * sizeM;
    for (let i = 0; i < px; i += 1) {
      const x = (i / px) * sizeM;
      // Distance from the pith: the cut plane's depth drifts along the board
      // (the tilt) and the log is never perfectly round (the wobble).
      const depth = s.depthM + s.tilt * (x - sizeM / 2) + s.wobble * fbm(noise, x * 0.9, 0.3 + y * 0.6, 3);
      const across = y - s.pithM + 0.006 * fbm(noise2, x * 1.4, y * 2.2, 3);
      let phase = Math.sqrt(across * across + depth * depth) * s.ringsPerM;
      // Uneven years: some rings wide, some tight.
      phase += 0.9 * fbm(noise, phase * 0.3, 7.7, 3) + 0.22 * noise2(x * 0.9, y * 9);
      const n = Math.floor(phase);
      const f = phase - n;
      const weight = 0.45 + 0.55 * hash1(n, seed);
      // Latewood darkens gradually through the year and ends on a crisp line.
      const lateBand = (smoothstep(0.35, 0.92, f) * (1 - smoothstep(0.94, 1, f))) * weight;
      // Long colour runs along the grain: honey, then a plum-grey cast.
      const run = fbm(noise2, x * 0.9, y * 14, 3, 2, 0.55);
      const runTone = smoothstep(-0.1, 0.55, run);
      const plumTone = smoothstep(0.15, 0.7, fbm(noise, x * 0.5, y * 6 + 3.1, 3));
      // Pores: fine dashes stretched along the grain, denser in the latewood.
      const poreField = noise(x * 160, y * 1300 + n * 0.37);
      const poreMask = s.pores * smoothstep(0.5, 0.85, poreField) * (0.35 + 0.65 * lateBand);
      // Medullary rays: soft silver flecks across the grain (oak).
      let ray = 0;
      if (s.rays > 0) {
        const rf = noise2(x * 28, y * 210);
        ray = s.rays * smoothstep(0.55, 0.78, rf) * smoothstep(-0.2, 0.5, fbm(noise, x * 3, y * 8, 2));
      }
      let c = lerp3(early, late, lateBand * s.contrast);
      c = lerp3(c, streak, runTone * 0.4);
      c = lerp3(c, plum, plumTone * 0.28);
      c = lerp3(c, pore, poreMask * 0.5);
      c = lerp3(c, scale3(streak, 1.06), ray * 0.4);
      c = scale3(c, 1 + 0.05 * fbm(noise, x * 1.2, y * 2.5, 2));
      writePixel(data, (j * px + i) * 4, c);
      rough[j * px + i] = Math.round(clamp01(0.48 + 0.16 * poreMask + 0.05 * lateBand - 0.06 * ray) * 255);
    }
  }
  return { width: px, height: px, data, rough, sizeM };
}

/* ---------- oak plank floor ---------- */

/**
 * Wide white-oiled oak boards, `boardM` wide, random lengths, staggered
 * joints, a hairline shadow between boards. The square covers `sizeM` and
 * tiles; each board samples its own window of the wood field.
 */
export function plankTexture({ px = 2048, sizeM = 3.6, boardM = 0.2, seed = 11, species = 'oak', tint = null } = {}) {
  const FIELD_M = 2.4;
  const wood = woodTexture(species === 'oak' ? 'oakFloor' : species, { px: 2048, sizeM: FIELD_M, seed: seed + 3 });
  const rand = mulberry(seed);
  const rows = Math.round(sizeM / boardM);
  const layout = [];
  for (let r = 0; r < rows; r += 1) {
    // Board lengths 1.3-2.3 m, staggered row to row; joints wrap the tile.
    const joints = [];
    let x = rand() * sizeM;
    const start = x;
    while (x < start + sizeM - 1.0) {
      joints.push(x % sizeM);
      x += 1.3 + rand();
    }
    joints.sort((a, b) => a - b);
    layout.push({ joints, tones: joints.map(() => 0.92 + rand() * 0.16), offsets: joints.map(() => [rand() * 0.02, rand() * (1 - boardM / FIELD_M)]) });
  }
  const data = new Uint8ClampedArray(px * px * 4);
  const rough = new Uint8ClampedArray(px * px);
  const tintLin = tint ? hexToLinear(tint) : null;
  const gapPx = Math.max(1, Math.round((0.0012 / sizeM) * px));
  for (let j = 0; j < px; j += 1) {
    const yM = (j / px) * sizeM;
    const r = Math.floor(yM / boardM);
    const inRow = yM - r * boardM;
    const row = layout[r % rows];
    for (let i = 0; i < px; i += 1) {
      const xM = (i / px) * sizeM;
      // The board under xM starts at the last joint at or before it (wrapping).
      let idx = row.joints.length - 1;
      let bx = xM + sizeM - row.joints[idx];
      for (let q = row.joints.length - 1; q >= 0; q -= 1) {
        if (xM >= row.joints[q]) {
          idx = q;
          bx = xM - row.joints[q];
          break;
        }
      }
      const next = idx + 1 < row.joints.length ? row.joints[idx + 1] : row.joints[0] + sizeM;
      const toEnd = (idx + 1 < row.joints.length ? next : next) - (xM >= row.joints[idx] ? xM : xM + sizeM);
      const [ou, ov] = row.offsets[idx];
      const wu = Math.min(wood.width - 1, Math.floor((bx / FIELD_M + ou) * wood.width));
      const wv = Math.min(wood.height - 1, Math.floor((inRow / FIELD_M + ov) * wood.height));
      const w = (wv * wood.width + wu) * 4;
      let rr = srgbToLinear(wood.data[w] / 255) * row.tones[idx];
      let gg = srgbToLinear(wood.data[w + 1] / 255) * row.tones[idx];
      let bb = srgbToLinear(wood.data[w + 2] / 255) * row.tones[idx];
      if (tintLin) {
        rr = mix(rr, tintLin[0], 0.25);
        gg = mix(gg, tintLin[1], 0.25);
        bb = mix(bb, tintLin[2], 0.25);
      }
      // Hairline joints: along each board edge and at the butt joints.
      const edge = Math.min(inRow, boardM - inRow) / sizeM * px;
      const butt = Math.min(bx, Math.max(0, toEnd)) / sizeM * px;
      const seam = Math.min(edge, butt);
      const shade = seam < gapPx ? 0.45 : seam < gapPx * 2.2 ? 0.82 : 1;
      writePixel(data, (j * px + i) * 4, [rr * shade, gg * shade, bb * shade]);
      rough[j * px + i] = Math.round(clamp01((wood.rough[wv * wood.width + wu] / 255) * 1.05 + (shade < 1 ? 0.2 : 0)) * 255);
    }
  }
  return { width: px, height: px, data, rough, sizeM };
}

/* ---------- stone and plaster ---------- */

/**
 * Honed limestone: a warm, even field with soft clouds, sparse fossil
 * flecks and faint bedding lines. `sizeM` square, tiling.
 */
export function limestoneTexture({ px = 1024, sizeM = 1.2, seed = 21, base = '#d8ccb6' } = {}) {
  const noise = makeNoise(seed);
  const noise2 = makeNoise(seed + 7);
  const c0 = hexToLinear(base);
  const data = new Uint8ClampedArray(px * px * 4);
  const rough = new Uint8ClampedArray(px * px);
  const P = 4;
  for (let j = 0; j < px; j += 1) {
    const v = j / px;
    for (let i = 0; i < px; i += 1) {
      const u = i / px;
      const cloud = fbm(noise, u * P, v * P, 5, 2, 0.5, P);
      const bed = Math.sin(2 * Math.PI * (v * 3 + 0.15 * fbm(noise2, u * 2, v * 2, 3, 2, 0.5, 2)));
      const fleck = smoothstep(0.7, 0.82, noise2(u * 160, v * 160, 160)) * 0.5;
      const k = 1 + 0.045 * cloud + 0.012 * bed - 0.05 * fleck;
      const warm = 1 + 0.02 * fbm(noise2, u * 2, v * 2, 2, 2, 0.5, 2);
      writePixel(data, (j * px + i) * 4, [c0[0] * k * warm, c0[1] * k, c0[2] * k / warm]);
      rough[j * px + i] = Math.round(clamp01(0.62 + 0.06 * cloud) * 255);
    }
  }
  return { width: px, height: px, data, rough, sizeM };
}

/** Lime plaster: almost flat, with the slow tonal drift of a hand-trowelled wall. */
export function plasterTexture({ px = 1024, sizeM = 2.4, seed = 31, base = '#e9e2d6', depth = 0.02 } = {}) {
  const noise = makeNoise(seed);
  const c0 = hexToLinear(base);
  const data = new Uint8ClampedArray(px * px * 4);
  const rough = new Uint8ClampedArray(px * px);
  const P = 3;
  for (let j = 0; j < px; j += 1) {
    const v = j / px;
    for (let i = 0; i < px; i += 1) {
      const u = i / px;
      const cloud = fbm(noise, u * P, v * P, 4, 2, 0.5, P);
      const k = 1 + depth * cloud;
      writePixel(data, (j * px + i) * 4, [c0[0] * k, c0[1] * k, c0[2] * k]);
      rough[j * px + i] = Math.round(clamp01(0.9 + 0.04 * cloud) * 255);
    }
  }
  return { width: px, height: px, data, rough, sizeM };
}

/** Needle-punched PET felt: a dense, soft fibre field with no visible repeat. */
export function feltTexture({ px = 1024, sizeM = 0.3, seed = 41, base = '#3d3b37' } = {}) {
  const noise = makeNoise(seed);
  const noise2 = makeNoise(seed + 3);
  const c0 = hexToLinear(base);
  const data = new Uint8ClampedArray(px * px * 4);
  const rough = new Uint8ClampedArray(px * px);
  for (let j = 0; j < px; j += 1) {
    const v = j / px;
    for (let i = 0; i < px; i += 1) {
      const u = i / px;
      const fibre = 0.5 * noise(u * 220, v * 220, 220) + 0.5 * noise2(u * 90, v * 90, 90);
      const cloud = fbm(noise2, u * 4, v * 4, 3, 2, 0.5, 4);
      const k = 1 + 0.07 * fibre + 0.035 * cloud;
      writePixel(data, (j * px + i) * 4, [c0[0] * k, c0[1] * k, c0[2] * k]);
      rough[j * px + i] = 245;
    }
  }
  return { width: px, height: px, data, rough, sizeM };
}

/** Brushed metal: fine directional strokes along x in colour and roughness. */
export function brushedTexture({ px = 1024, sizeM = 0.4, seed = 51, base = '#2b2d30', roughness = 0.38 } = {}) {
  const noise = makeNoise(seed);
  const c0 = hexToLinear(base);
  const data = new Uint8ClampedArray(px * px * 4);
  const rough = new Uint8ClampedArray(px * px);
  for (let j = 0; j < px; j += 1) {
    const v = j / px;
    for (let i = 0; i < px; i += 1) {
      const u = i / px;
      const stroke = noise(u * 6, v * 900, 0) * 0.6 + noise(u * 2, v * 300, 0) * 0.4;
      const k = 1 + 0.06 * stroke;
      writePixel(data, (j * px + i) * 4, [c0[0] * k, c0[1] * k, c0[2] * k]);
      rough[j * px + i] = Math.round(clamp01(roughness + 0.08 * stroke) * 255);
    }
  }
  return { width: px, height: px, data, rough, sizeM };
}

/** Washed linen: a soft plain weave and slubs. */
export function linenTexture({ px = 1024, sizeM = 0.25, seed = 61, base = '#e6dfd2' } = {}) {
  const noise = makeNoise(seed);
  const c0 = hexToLinear(base);
  const data = new Uint8ClampedArray(px * px * 4);
  const rough = new Uint8ClampedArray(px * px);
  const threads = 160;
  for (let j = 0; j < px; j += 1) {
    const v = j / px;
    for (let i = 0; i < px; i += 1) {
      const u = i / px;
      const warp = Math.sin(2 * Math.PI * u * threads) * 0.5 + 0.5;
      const weft = Math.sin(2 * Math.PI * v * threads) * 0.5 + 0.5;
      const slub = noise(u * 12, v * 240, 0) * 0.5 + noise(u * 240, v * 12, 0) * 0.5;
      const k = 1 + 0.035 * (warp * weft - 0.25) + 0.05 * slub;
      writePixel(data, (j * px + i) * 4, [c0[0] * k, c0[1] * k, c0[2] * k]);
      rough[j * px + i] = 240;
    }
  }
  return { width: px, height: px, data, rough, sizeM };
}

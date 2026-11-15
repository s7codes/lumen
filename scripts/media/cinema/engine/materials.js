import * as THREE from 'three';

/*
 * Surfaces for the cinema stage. Every procedural map is built from smooth
 * value noise limited to low octaves and then blurred: stone bands, plaster
 * clouds and timber figure are all broad features several pixels wide at
 * the output size, so nothing can read as grain or speckle.
 */

/** Kelvin to linear sRGB (Tanner Helland fit, then decoded), normalised to max 1. */
export function kelvin(k) {
  const t = k / 100;
  let r;
  let g;
  let b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * (t - 60) ** -0.1332047592;
    g = 288.1221695283 * (t - 60) ** -0.0755148492;
    b = 255;
  }
  const c = [r, g, b].map((v) => Math.min(255, Math.max(0, v)) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const m = Math.max(...c);
  return new THREE.Color(c[0] / m, c[1] / m, c[2] / m);
}

export const WARM = kelvin(2700);

/* ---------- smooth value noise ---------- */

function hash(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function smooth(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Value noise on a lattice of px x py cells per tile: tileable in u and v. */
function valueNoise(x, y, px, py, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  const wx = (v) => ((v % px) + px) % px;
  const wy = (v) => ((v % py) + py) % py;
  const a = hash(wx(xi), wy(yi), seed);
  const b = hash(wx(xi + 1), wy(yi), seed);
  const c = hash(wx(xi), wy(yi + 1), seed);
  const d = hash(wx(xi + 1), wy(yi + 1), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/**
 * Fractal sum of `octaves` noise layers on a tile (u, v in 0..1, any
 * periodic warp allowed). `base` is the lattice cell count across the tile,
 * one integer or [across u, across v] for stretched figure; integer counts
 * keep every layer seamless.
 */
export function fbm(u, v, { base = 4, octaves = 4, gain = 0.5, seed = 1 } = {}) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let [px, py] = Array.isArray(base) ? base : [base, base];
  for (let o = 0; o < octaves; o += 1) {
    sum += amp * valueNoise(u * px, v * py, px, py, seed + o * 17);
    norm += amp;
    amp *= gain;
    px *= 2;
    py *= 2;
  }
  return sum / norm;
}

/** Builds an RGB canvas texture from a per-pixel function, then softens it with a blur. */
export function canvasTexture(size, pixel, { blur = 1.5, srgb = true, repeat = [1, 1], anisotropy = 8 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixel(x / size, y / size);
      const i = (y * size + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, Math.round(r * 255)));
      img.data[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
      img.data[i + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  let out = canvas;
  if (blur > 0) {
    // Blur on a 3 x 3 tiled canvas so the tile stays seamless.
    const big = document.createElement('canvas');
    big.width = size * 3;
    big.height = size * 3;
    const b = big.getContext('2d');
    for (let j = 0; j < 3; j += 1) for (let i = 0; i < 3; i += 1) b.drawImage(canvas, i * size, j * size);
    const soft = document.createElement('canvas');
    soft.width = size * 3;
    soft.height = size * 3;
    const s = soft.getContext('2d');
    s.filter = `blur(${blur}px)`;
    s.drawImage(big, 0, 0);
    out = document.createElement('canvas');
    out.width = size;
    out.height = size;
    out.getContext('2d').drawImage(soft, size, size, size, size, 0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(out);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = anisotropy;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Honed travertine: warm cream laid down in soft horizontal beds, with the
 * filled voids of the stone as long blurred lenses a shade deeper. Returns
 * colour and roughness maps.
 */
export function travertineMaps(size = 1024, seed = 3) {
  const color = canvasTexture(
    size,
    (u, v) => {
      const warp = fbm(u, v, { base: 2, octaves: 3, seed }) - 0.5;
      const bed = 0.5 + 0.5 * Math.sin((v + warp * 0.12) * Math.PI * 2 * 7 + fbm(u, v, { base: 3, octaves: 2, seed: seed + 5 }) * 3.0);
      const broad = fbm(u, v, { base: 2, octaves: 3, seed: seed + 9 });
      // Voids: stretched along the bed, soft-edged, sparse.
      const lens = fbm(u, v, { base: [2, 13], octaves: 2, seed: seed + 21 });
      const void_ = clamp01((lens - 0.66) * 6.5);
      const light = [0.86, 0.79, 0.68];
      const warm = [0.78, 0.68, 0.55];
      const deep = [0.63, 0.52, 0.4];
      let c = mix3(light, warm, clamp01(bed * 0.55 + (broad - 0.5) * 0.9));
      c = mix3(c, deep, void_ * 0.55);
      return c;
    },
    { blur: 1.6 },
  );
  const rough = canvasTexture(
    size,
    (u, v) => {
      const lens = fbm(u, v, { base: [2, 13], octaves: 2, seed: seed + 21 });
      const r = 0.52 + clamp01((lens - 0.66) * 6.5) * 0.18 + (fbm(u, v, { base: 3, octaves: 2, seed: seed + 2 }) - 0.5) * 0.08;
      return [r, r, r];
    },
    { blur: 2, srgb: false },
  );
  return { color, rough };
}

/**
 * Venetian plaster: deep umber charcoal in soft clouds, polished where the
 * trowel closed it. Colour and roughness maps.
 */
export function plasterMaps(size = 1024, seed = 11, tone = [0.105, 0.094, 0.082]) {
  const color = canvasTexture(
    size,
    (u, v) => {
      const cloud = fbm(u, v, { base: 3, octaves: 4, gain: 0.52, seed });
      const sweep = fbm(u + cloud * 0.25, v, { base: [3, 2], octaves: 3, seed: seed + 4 });
      const k = 0.82 + (cloud - 0.5) * 0.42 + (sweep - 0.5) * 0.22;
      return [tone[0] * k, tone[1] * k, tone[2] * k * 0.98];
    },
    { blur: 2.4 },
  );
  const rough = canvasTexture(
    size,
    (u, v) => {
      const sweep = fbm(u, v, { base: [3, 2], octaves: 3, seed: seed + 4 });
      const r = 0.34 + (sweep - 0.5) * 0.22;
      return [r, r, r];
    },
    { blur: 3, srgb: false },
  );
  return { color, rough };
}

/** Smoked oak: long soft figure along u. */
export function oakMaps(size = 1024, seed = 7, tone = [0.16, 0.12, 0.09]) {
  const color = canvasTexture(
    size,
    (u, v) => {
      const flow = fbm(u, v, { base: [1, 12], octaves: 3, seed });
      const figure = 0.5 + 0.5 * Math.sin((v * 46 + flow * 9) * Math.PI);
      const k = 0.86 + figure * 0.16 + (fbm(u, v, { base: 3, octaves: 2, seed: seed + 3 }) - 0.5) * 0.16;
      return [tone[0] * k, tone[1] * k, tone[2] * k];
    },
    { blur: 1.2 },
  );
  return { color };
}

/** Polished concrete: near-flat dark grey with broad cloud. */
export function concreteMaps(size = 512, seed = 5, tone = [0.07, 0.066, 0.062]) {
  const color = canvasTexture(
    size,
    (u, v) => {
      const k = 0.9 + (fbm(u, v, { base: 2, octaves: 3, seed }) - 0.5) * 0.24;
      return [tone[0] * k, tone[1] * k, tone[2] * k];
    },
    { blur: 3 },
  );
  return { color };
}

/* ---------- materials ---------- */

export function brass({ roughness = 0.28, color = '#cfa760' } = {}) {
  return new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness });
}

export function obsidianGloss({ color = '#0b0a09', roughness = 0.16 } = {}) {
  return new THREE.MeshPhysicalMaterial({ color, metalness: 0, roughness, clearcoat: 1, clearcoatRoughness: 0.06 });
}

export function matte(color, roughness = 0.8, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

/** An emitter: unlit radiance in linear units (cd/m2 scale), warm by default. */
export function emitter(radiance, color = WARM) {
  return new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(radiance), toneMapped: false });
}

/**
 * A standard material with a world-space CAD grid in it: 1 px hairlines
 * every `spacing` metres, a touch stronger every `major`, faintly
 * self-lit so the lattice reads in the dark and brighter in the light.
 */
export function gridSurface({ color = '#0e0d0c', roughness = 0.82, specular = 1, spacing = 0.5, major = 0, line = new THREE.Color('#8a7356'), glow = 0.02, reflect = 0.35, width = 1.0 } = {}) {
  const material = new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, specularIntensity: specular });
  material.userData.grid = { spacing, line, glow, reflect, width, major };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGridSpacing = { value: spacing };
    shader.uniforms.uGridMajor = { value: major };
    shader.uniforms.uGridLine = { value: line };
    shader.uniforms.uGridGlow = { value: glow };
    shader.uniforms.uGridReflect = { value: reflect };
    shader.uniforms.uGridWidth = { value: width };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGridWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGridWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vGridWorld;
uniform float uGridSpacing;
uniform float uGridMajor;
uniform vec3 uGridLine;
uniform float uGridGlow;
uniform float uGridReflect;
uniform float uGridWidth;
float gridLines(vec3 p, float spacing, float widthPx) {
  vec3 q = p / spacing;
  vec3 f = abs(fract(q - 0.5) - 0.5);
  vec3 w = fwidth(q) * widthPx;
  vec3 l = 1.0 - smoothstep(w * 0.5, w * 1.5, f);
  // A face carries the lattice of its two in-plane axes only.
  vec3 n = abs(normalize(cross(dFdx(p), dFdy(p))));
  float g = 0.0;
  if (n.y < 0.5) g = max(g, l.y);
  if (n.x < 0.5) g = max(g, l.x);
  if (n.z < 0.5) g = max(g, l.z);
  return g;
}
float gridMask() {
  float g = gridLines(vGridWorld, uGridSpacing, uGridWidth);
  if (uGridMajor > 0.0) g = max(g, gridLines(vGridWorld, uGridMajor, uGridWidth * 1.4));
  return g;
}`,
      )
      .replace('#include <map_fragment>', '#include <map_fragment>\nfloat gMask = gridMask();\ndiffuseColor.rgb = mix(diffuseColor.rgb, uGridLine * uGridReflect, gMask);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGridLine * uGridGlow * gMask;');
  };
  material.customProgramCacheKey = () => `grid-${spacing}-${major}-${width}`;
  return material;
}

/** A dim studio environment for reflections: soft warm and neutral panels in a dark box. */
export function studioEnvironment(renderer, { warm = 1.0, cool = 0.6, floor = 0.02 } = {}) {
  const env = new THREE.Scene();
  env.background = new THREE.Color(floor, floor * 0.95, floor * 0.9);
  const panel = (w, h, pos, look, color, power) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(power), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(...look);
    env.add(m);
  };
  panel(4, 1.4, [0, 4.5, 1.5], [0, 0, 0], WARM, warm);
  panel(1.6, 3, [-5, 2, -2], [0, 1, 0], new THREE.Color(0.9, 0.92, 1), cool);
  panel(1.2, 2.4, [5, 1.6, 2], [0, 1, 0], WARM, warm * 0.5);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.04).texture;
  pmrem.dispose();
  return tex;
}

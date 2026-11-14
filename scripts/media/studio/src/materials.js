import * as THREE from 'three';
import * as T from './textures.js';

/*
 * Physically based materials for the path tracer. Colour maps are sRGB, the
 * roughness rides in the green channel as three.js expects. Textures are
 * generated once per page and shared.
 */

const textureCache = new Map();

function toDataTexture(tex, kind) {
  const { width, height } = tex;
  let data = tex.data;
  if (kind === 'rough') {
    data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      data[i * 4] = tex.rough[i];
      data[i * 4 + 1] = tex.rough[i];
      data[i * 4 + 2] = tex.rough[i];
      data[i * 4 + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = kind === 'rough' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

export function texturePair(key, make) {
  if (!textureCache.has(key)) {
    const tex = make();
    textureCache.set(key, { map: toDataTexture(tex, 'color'), rough: toDataTexture(tex, 'rough'), sizeM: tex.sizeM });
  }
  return textureCache.get(key);
}

const WOOD = {
  walnut: () => texturePair('walnut', () => T.woodTexture('walnut', { px: 2048, sizeM: 1.2, seed: 7 })),
  oak: () => texturePair('oak', () => T.woodTexture('oak', { px: 2048, sizeM: 1.2, seed: 9 })),
};

/** Texture scale: UVs are authored in metres, the map covers `sizeM`. */
function scaled(material, sizeM) {
  material.userData.uvScale = 1 / sizeM;
  return material;
}

export function woodMaterial(species, { tone = 1 } = {}) {
  const tex = WOOD[species]();
  const m = new THREE.MeshPhysicalMaterial({
    map: tex.map,
    roughnessMap: tex.rough,
    roughness: 0.88,
    metalness: 0,
    color: new THREE.Color(tone, tone, tone),
    specularIntensity: 0.6,
  });
  m.userData.family = 'wood';
  return scaled(m, tex.sizeM);
}

export function floorMaterial({ species = 'oak', sizeM = 3.6, seed = 11 } = {}) {
  const tex = texturePair(`floor-${species}-${seed}`, () => T.plankTexture({ px: 2048, sizeM, seed, species }));
  const m = new THREE.MeshPhysicalMaterial({ map: tex.map, roughnessMap: tex.rough, roughness: 1, metalness: 0, specularIntensity: 0.5 });
  m.userData.family = 'floor';
  return scaled(m, tex.sizeM);
}

export function plasterMaterial({ base = '#e9e2d6', seed = 31, depth = 0.02 } = {}) {
  const tex = texturePair(`plaster-${base}-${seed}-${depth}`, () => T.plasterTexture({ px: 1024, base, seed, depth }));
  const m = new THREE.MeshPhysicalMaterial({ map: tex.map, roughnessMap: tex.rough, roughness: 1, metalness: 0, specularIntensity: 0.25 });
  m.userData.family = 'plaster';
  return scaled(m, tex.sizeM);
}

export function limestoneMaterial({ base = '#d8ccb6', seed = 21 } = {}) {
  const tex = texturePair(`limestone-${base}-${seed}`, () => T.limestoneTexture({ px: 1024, base, seed }));
  const m = new THREE.MeshPhysicalMaterial({ map: tex.map, roughnessMap: tex.rough, roughness: 1, metalness: 0, specularIntensity: 0.4 });
  m.userData.family = 'stone';
  return scaled(m, tex.sizeM);
}

export function feltMaterial(color = '#3d3b37') {
  const tex = texturePair(`felt-${color}`, () => T.feltTexture({ px: 1024, base: color }));
  const m = new THREE.MeshPhysicalMaterial({
    map: tex.map,
    roughness: 1,
    metalness: 0,
    sheen: 0.6,
    sheenRoughness: 0.75,
    sheenColor: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.35),
    specularIntensity: 0.15,
  });
  m.userData.family = 'felt';
  return scaled(m, tex.sizeM);
}

export function linenMaterial(color = '#e6dfd2') {
  const tex = texturePair(`linen-${color}`, () => T.linenTexture({ px: 1024, base: color }));
  const m = new THREE.MeshPhysicalMaterial({
    map: tex.map,
    roughness: 1,
    metalness: 0,
    sheen: 0.45,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color('#ffffff'),
    specularIntensity: 0.2,
  });
  m.userData.family = 'linen';
  return scaled(m, tex.sizeM);
}

/** Black anodised 6063 aluminium: dark satin metal with fine brushing. */
export function anodisedMaterial(color = '#1f2022') {
  const tex = texturePair(`brushed-${color}`, () => T.brushedTexture({ px: 1024, base: color, roughness: 0.4 }));
  const m = new THREE.MeshPhysicalMaterial({ map: tex.map, roughnessMap: tex.rough, roughness: 1, metalness: 0.7, specularIntensity: 1 });
  m.userData.family = 'metal';
  return scaled(m, tex.sizeM);
}

export function aluminiumMaterial(color = '#b5b8bb', roughness = 0.3) {
  const tex = texturePair(`brushed-${color}-${roughness}`, () => T.brushedTexture({ px: 1024, base: color, roughness }));
  const m = new THREE.MeshPhysicalMaterial({ map: tex.map, roughnessMap: tex.rough, roughness: 1, metalness: 1 });
  m.userData.family = 'metal';
  return scaled(m, tex.sizeM);
}

export function powderMaterial(color = '#e4dfd5', roughness = 0.62) {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, specularIntensity: 0.45 });
  m.userData.family = 'powder';
  return m;
}

export function matteMaterial(color, roughness = 0.85) {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, specularIntensity: 0.35 });
  m.userData.family = 'matte';
  return m;
}

export function ceramicMaterial(color, roughness = 0.32) {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.35, specularIntensity: 0.6 });
  m.userData.family = 'ceramic';
  return m;
}

/** A visible LED diffuser: glows to the camera, lights the room through its paired area light. */
export function emitterMaterial(color, intensity, group) {
  const m = new THREE.MeshPhysicalMaterial({ color: '#f4efe6', roughness: 0.6, metalness: 0, emissive: color, emissiveIntensity: intensity });
  m.userData.family = 'emitter';
  m.userData.group = group;
  m.userData.emissiveIntensity = intensity;
  return m;
}

/*
 * Engine material families to studio materials. The engine's colour,
 * roughness and metalness for each sub-part pick the variant: its dark
 * #0d0c0b accents are shadow reveals, #2b2d30 / #2c2e30 is the anodised
 * body, copper and brass tones keep their own metal.
 */
const familyCache = new Map();

export function materialForSubpart(part) {
  const key = `${part.material}|${part.color}|${part.roughness}|${part.metalness}|${part.kind}`;
  if (familyCache.has(key)) return familyCache.get(key);
  let m;
  switch (part.material) {
    case 'wood-walnut':
      m = woodMaterial('walnut', { tone: part.kind === 'back-panel' ? 0.82 : 1 });
      break;
    case 'wood-oak':
      m = woodMaterial('oak', { tone: part.kind === 'back-panel' ? 0.86 : 1 });
      break;
    case 'metal-obsidian':
      if (part.color === '#0d0c0b' || part.color === '#151412') m = matteMaterial('#121110', 0.8);
      else if (part.kind === 'screen' || part.kind === 'display') m = matteMaterial(part.color, 0.2);
      else m = anodisedMaterial('#1e1f21');
      break;
    case 'metal-steel': {
      const c = part.color.toLowerCase();
      if (c === '#b8774a') m = aluminiumMaterial('#b8774a', 0.32);
      else if (c === '#b39060') m = aluminiumMaterial('#b8955f', 0.3);
      else if (c === '#2c2e30' || c === '#2b2d30') m = anodisedMaterial('#1e1f21');
      else m = aluminiumMaterial('#b3b6b9', 0.28);
      break;
    }
    case 'felt-acoustic':
      if (['sheet', 'duvet', 'pillow', 'throw', 'piping', 'mattress'].includes(part.kind)) m = linenMaterial(part.color);
      else m = feltMaterial(part.color);
      break;
    case 'matte-chalk':
    default: {
      const r = part.roughness ?? 0.85;
      if (r < 0.45) m = ceramicMaterial(part.color, r);
      else if (part.kind === 'body' || part.kind === 'carcass' || part.kind === 'housing') m = powderMaterial(part.color, 0.6);
      else m = matteMaterial(part.color, r);
    }
  }
  familyCache.set(key, m);
  return m;
}

/** The finish a whole product wears, for parts the studio models itself. */
export function finishMaterial(finishId) {
  switch (finishId) {
    case 'walnut':
      return woodMaterial('walnut');
    case 'oak':
      return woodMaterial('oak');
    case 'obsidian':
      return anodisedMaterial('#1e1f21');
    case 'chalk':
    default:
      return powderMaterial('#e4dfd5', 0.62);
  }
}

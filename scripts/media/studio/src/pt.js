import * as THREE from 'three';
import { WebGLPathTracer } from 'three-gpu-pathtracer';

/*
 * Path tracer runner. A shot is rendered as separate light passes (sky,
 * sun, each LED group): light transport is linear, so any frame of a film is
 * a weighted sum of the passes, and the grade can balance them without a
 * second render. Each pass is read back as linear float RGB and posted to
 * the driver.
 */

let renderer = null;
let tracer = null;

export function getRenderer(width, height) {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1;
    document.body.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = 'auto';
  }
  renderer.setSize(width, height, false);
  return renderer;
}

export function getTracer() {
  if (!tracer) {
    tracer = new WebGLPathTracer(renderer);
    tracer.tiles.set(2, 2);
    tracer.minSamples = 1;
    tracer.renderDelay = 0;
    tracer.fadeDuration = 0;
    tracer.dynamicLowRes = false;
    tracer.rasterizeScene = false;
    tracer.textureSize.set(2048, 2048);
  }
  return tracer;
}

/** A sky for windows: warm white horizon, soft blue zenith, a muted sunlit ground. */
export function skyTexture({ zenith = [0.42, 0.56, 0.8], horizon = [1.0, 0.97, 0.92], ground = [0.62, 0.6, 0.54], scale = 1 } = {}) {
  const w = 512;
  const h = 256;
  const data = new Float32Array(w * h * 4);
  for (let j = 0; j < h; j += 1) {
    // Row 0 is the top of the equirect: elevation +90 deg.
    const elev = (0.5 - (j + 0.5) / h) * Math.PI;
    for (let i = 0; i < w; i += 1) {
      let c;
      if (elev >= 0) {
        const t = Math.pow(Math.sin(elev), 0.55);
        c = horizon.map((hc, k) => hc + (zenith[k] - hc) * t);
      } else {
        const t = Math.min(1, -elev / 0.7);
        c = horizon.map((hc, k) => hc * (1 - t) + ground[k] * t);
      }
      const o = (j * w + i) * 4;
      data[o] = c[0] * scale;
      data[o + 1] = c[1] * scale;
      data[o + 2] = c[2] * scale;
      data[o + 3] = 1;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Architectural camera: plumb verticals. The camera never pitches; a
 * vertical lens shift places `target` at the frame centre (or `centreY`).
 */
export function archCamera({ position, look, fovV, aspect, shiftY = null, near = 0.02, far = 60 }) {
  const camera = new THREE.PerspectiveCamera(fovV, aspect, near, far);
  camera.position.copy(position);
  const flat = new THREE.Vector3(look.x, position.y, look.z);
  camera.lookAt(flat);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const dist = Math.hypot(look.x - position.x, look.z - position.z);
  const p11 = camera.projectionMatrix.elements[5];
  const shift = shiftY ?? ((look.y - position.y) / dist) * p11;
  camera.projectionMatrix.elements[9] = shift;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  camera.userData.shiftY = shift;
  return camera;
}

function collect(scene) {
  const lights = [];
  const emissive = new Set();
  scene.traverse((node) => {
    if (node.isLight && node.userData.group) lights.push(node);
    if (node.isMesh && node.material?.userData?.group) emissive.add(node.material);
  });
  return { lights, emissive: [...emissive] };
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Projects world points to normalised frame coordinates (0..1, origin top-left). */
export function projectPoints(camera, points) {
  return points.map(({ id, at }) => {
    const v = new THREE.Vector3(...at).project(camera);
    return { id, x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  });
}

/**
 * Renders every pass of a shot and posts each as float RGB.
 * passes: [{ name, groups: [...], env: bool, background: bool, spp, bounces }]
 */
export async function renderPasses({ shot, scene, camera, width, height, passes, onStatus }) {
  getRenderer(width, height);
  const pt = getTracer();
  const { lights, emissive } = collect(scene);
  const envIntensity = scene.userData.envIntensity ?? 1;
  const bgIntensity = scene.userData.backgroundIntensity ?? 1;
  pt.filterGlossyFactor = scene.userData.filterGlossy ?? 0.6;
  pt.setScene(scene, camera);
  const results = [];
  for (const pass of passes) {
    const on = new Set(pass.groups ?? []);
    for (const light of lights) light.intensity = on.has(light.userData.group) ? light.userData.intensity : 0;
    for (const m of emissive) m.emissiveIntensity = on.has(m.userData.group) ? m.userData.emissiveIntensity : 0;
    scene.environmentIntensity = pass.env ? envIntensity : 0;
    scene.backgroundIntensity = pass.background ? bgIntensity : 0;
    pt.bounces = pass.bounces ?? 7;
    pt.updateLights();
    pt.updateMaterials();
    pt.updateEnvironment();
    pt.reset();
    const t0 = performance.now();
    const spp = pass.spp ?? 256;
    let lastReport = 0;
    while (pt.samples < spp) {
      pt.renderSample();
      if (performance.now() - lastReport > 1500) {
        lastReport = performance.now();
        onStatus?.(`${shot} ${pass.name} ${pt.samples.toFixed(1)}/${spp}`);
        console.log(`[studio] ${shot} ${pass.name} ${pt.samples.toFixed(1)}/${spp} ${Math.round(performance.now() - t0)}ms`);
        await nextFrame();
      }
    }
    const target = pt.target;
    const w = target.width;
    const h = target.height;
    const raw = new Float32Array(w * h * 4);
    renderer.readRenderTargetPixels(target, 0, 0, w, h, raw);
    // Flip to top-left origin and drop alpha.
    const rgb = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y += 1) {
      const src = (h - 1 - y) * w * 4;
      const dst = y * w * 3;
      for (let x = 0; x < w; x += 1) {
        rgb[dst + x * 3] = raw[src + x * 4];
        rgb[dst + x * 3 + 1] = raw[src + x * 4 + 1];
        rgb[dst + x * 3 + 2] = raw[src + x * 4 + 2];
      }
    }
    const res = await fetch(`/__upload?shot=${encodeURIComponent(shot)}&pass=${encodeURIComponent(pass.name)}&w=${w}&h=${h}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: rgb.buffer,
    });
    if (!res.ok) throw new Error(`upload failed ${res.status}`);
    results.push({ name: pass.name, ms: Math.round(performance.now() - t0), spp: pt.samples, w, h });
  }
  return results;
}

/*
 * Guide buffers for the denoiser, rasterised from the same camera at twice
 * the resolution and box-filtered down: linear albedo (base colour and map,
 * unlit), view-space normals and linear depth. Uploaded as aux-albedo,
 * aux-normal and aux-depth beside the light passes.
 */
const DEPTH_MATERIAL = () =>
  new THREE.ShaderMaterial({
    vertexShader: 'varying float vDepth; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying float vDepth; void main() { gl_FragColor = vec4(vDepth, vDepth, vDepth, 1.0); }',
    side: THREE.DoubleSide,
  });

export async function renderGuides({ shot, scene, camera, width, height }) {
  const r = getRenderer(width, height);
  const W = width * 2;
  const H = height * 2;
  const target = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true });
  const saved = { background: scene.background, environment: scene.environment, override: scene.overrideMaterial, toneMapping: r.toneMapping };
  scene.background = null;
  scene.environment = null;
  r.toneMapping = THREE.NoToneMapping;
  r.setClearColor(0x000000, 0);
  const swapped = [];
  const raw = new Float32Array(W * H * 4);
  const down = (name) => {
    r.readRenderTargetPixels(target, 0, 0, W, H, raw);
    const out = new Float32Array(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const o = (y * width + x) * 3;
        for (let c = 0; c < 3; c += 1) {
          let sum = 0;
          for (let dy = 0; dy < 2; dy += 1) for (let dx = 0; dx < 2; dx += 1) sum += raw[((H - 1 - (y * 2 + dy)) * W + x * 2 + dx) * 4 + c];
          out[o + c] = sum / 4;
        }
      }
    }
    return fetch(`/__upload?shot=${encodeURIComponent(shot)}&pass=${name}&w=${width}&h=${height}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: out.buffer });
  };
  const draw = () => {
    r.setRenderTarget(target);
    r.clear();
    r.render(scene, camera);
    r.setRenderTarget(null);
  };
  // Albedo: every mesh unlit in its own colour and map.
  scene.traverse((node) => {
    if (!node.isMesh) return;
    const m = node.material;
    const basic = new THREE.MeshBasicMaterial({ color: m.emissiveIntensity > 0 ? m.color : m.color, map: m.map ?? null, side: THREE.DoubleSide });
    swapped.push([node, m]);
    node.material = basic;
  });
  draw();
  await down('aux-albedo');
  for (const [node, m] of swapped) {
    node.material.dispose();
    node.material = m;
  }
  scene.overrideMaterial = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
  draw();
  await down('aux-normal');
  scene.overrideMaterial = DEPTH_MATERIAL();
  draw();
  await down('aux-depth');
  scene.overrideMaterial = saved.override;
  scene.background = saved.background;
  scene.environment = saved.environment;
  r.toneMapping = saved.toneMapping;
  target.dispose();
  return true;
}

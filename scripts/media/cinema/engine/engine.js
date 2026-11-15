import * as THREE from 'three';

/*
 * Deterministic accumulation renderer for the cinema stage.
 *
 * One film frame is the mean of N sub-frames. Each sub-frame moves the
 * camera inside its pixel (anti-aliasing), across the lens aperture with
 * the focal plane held (depth of field), inside the shutter interval
 * (motion blur) and moves every shadow-casting light across its emitter
 * (soft shadows). A raymarched single-scattering pass adds the haze each
 * spotlight lights up, its march offset rotating per sub-frame. Every
 * offset comes from a fixed low-discrepancy pattern, never a random draw,
 * so a frame is noise-free and the same frame renders the same pixels.
 *
 * Light stays linear HDR until one output pass: an energy-conserving lens
 * glare, vignette, AgX and the sRGB encode, with a sub-LSB ordered dither
 * against banding in the dark gradients.
 */

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Radical inverse in base b: the Halton sequence. */
export function halton(index, base) {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

/** Sample k of n on the unit disk: a Vogel spiral, even in area at any n. */
export function vogel(k, n) {
  const r = Math.sqrt((k + 0.5) / n);
  const a = k * GOLDEN_ANGLE;
  return [r * Math.cos(a), r * Math.sin(a)];
}

/**
 * A fixed shuffle of 0..n-1 (mulberry32 from a constant seed). Each sample
 * dimension walks its own stratified pattern through its own shuffle: a
 * Latin hypercube, so no two dimensions ever move in step (a linear link
 * between, say, the light's place on its emitter and the haze march offset
 * would print as moire), and the same seed always gives the same frame.
 */
const shuffles = new Map();
function shuffle(n, seed) {
  const key = `${n}:${seed}`;
  if (shuffles.has(key)) return shuffles.get(key);
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  shuffles.set(key, p);
  return p;
}

const QUAD_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Sub-frame resolve: scene colour plus the haze of up to L spotlights,
 * folded into the running mean. Each light's in-scatter along the view ray
 * is integrated with equiangular sampling (Kulla and Fajardo): samples are
 * spread evenly in the angle the ray subtends at the light, which cancels
 * the inverse-square peak exactly, so what is left to sample (cone, phase,
 * shadow, height falloff) is smooth and a few dozen steps converge cleanly.
 * The light loop is unrolled in JS, because GLSL ES 3.00 indexes sampler
 * arrays only with constants.
 */
function accumulateShader(lightCount, steps) {
  const lights = Array.from({ length: lightCount }, (_, i) => i);
  const decl = lights
    .map(
      (i) => `
uniform vec3 uLPos${i};
uniform vec3 uLDir${i};
uniform vec3 uLCol${i};
uniform vec3 uLCone${i};
uniform mat4 uLShadowM${i};
uniform sampler2DShadow uLShadow${i};`,
    )
    .join('\n');
  const body = lights
    .map(
      (i) => `
  {
    vec3 lp = uLPos${i};
    float t0 = dot(lp - uEye, rd);
    vec3 cp = uEye + rd * t0;
    float h = sqrt(dot(cp - lp, cp - lp) + uLCone${i}.z);
    float ta = atan((segA - t0) / h);
    float tb = atan((segB - t0) / h);
    float span = tb - ta;
    vec3 sum = vec3(0.0);
    for (int s = 0; s < ${steps}; s++) {
      float th = ta + span * (float(s) + uJitter) / float(${steps});
      vec3 p = uEye + rd * (t0 + h * tan(th));
      vec3 l = normalize(p - lp);
      float cone = smoothstep(uLCone${i}.x, uLCone${i}.y, dot(l, uLDir${i}));
      if (cone > 0.0) {
        vec4 sc = uLShadowM${i} * vec4(p, 1.0);
        vec3 c = sc.xyz / sc.w;
        float vis = 1.0;
        if (sc.w > 0.0 && c.x > 0.0 && c.x < 1.0 && c.y > 0.0 && c.y < 1.0 && c.z < 1.0) vis = texture(uLShadow${i}, vec3(c.xy, c.z - 0.0004));
        float density = exp(-max(p.y - uFloorY, 0.0) * uHeightFall);
        sum += vec3(cone * vis * hg(dot(l, -rd)) * density);
      }
    }
    inscatter += uLCol${i} * sum * (span / (h * float(${steps})));
  }`,
    )
    .join('\n');
  return /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tAcc;
uniform float uWeight;
uniform mat4 uProjInv;
uniform mat4 uViewInv;
uniform vec3 uEye;
uniform float uJitter;
uniform float uDensity;
uniform float uG;
uniform float uMaxDist;
uniform float uHeightFall;
uniform float uFloorY;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
${decl}

float hg(float c) {
  float g = uG;
  float d = 1.0 + g * g - 2.0 * g * c;
  return (1.0 - g * g) / (12.566370614 * d * sqrt(d));
}

void main() {
  vec4 scene = texture(tScene, vUv);
  vec3 color = scene.rgb;
  ${
    lightCount > 0
      ? `
  float depth = texture(tDepth, vUv).r;
  vec4 ndc = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uProjInv * ndc;
  view /= view.w;
  vec3 world = (uViewInv * vec4(view.xyz, 1.0)).xyz;
  vec3 ray = world - uEye;
  float len = min(length(ray), uMaxDist);
  vec3 rd = normalize(ray);
  // The haze fills only its box: the ray's span inside it, clipped to the surface hit.
  vec3 inv = 1.0 / (rd + vec3(1e-9));
  vec3 t1 = (uBoxMin - uEye) * inv;
  vec3 t2 = (uBoxMax - uEye) * inv;
  vec3 tmin = min(t1, t2);
  vec3 tmax = max(t1, t2);
  float segA = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
  float segB = min(min(min(tmax.x, tmax.y), tmax.z), len);
  vec3 inscatter = vec3(0.0);
  if (segB > segA) {
  ${body}
  }
  color += inscatter * uDensity;`
      : ''
  }
  vec4 acc = texture(tAcc, vUv);
  gl_FragColor = vec4(mix(acc.rgb, color, uWeight), 1.0);
}
`;
}

const DOWN_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
void main() {
  vec2 o = uTexel;
  vec3 c = texture(tSrc, vUv).rgb * 4.0;
  c += texture(tSrc, vUv + vec2(-o.x, -o.y)).rgb;
  c += texture(tSrc, vUv + vec2(o.x, -o.y)).rgb;
  c += texture(tSrc, vUv + vec2(-o.x, o.y)).rgb;
  c += texture(tSrc, vUv + vec2(o.x, o.y)).rgb;
  gl_FragColor = vec4(c / 8.0, 1.0);
}
`;

const UP_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform sampler2D tAdd;
uniform vec2 uTexel;
void main() {
  vec2 o = uTexel;
  vec3 c = vec3(0.0);
  c += texture(tSrc, vUv + vec2(-2.0 * o.x, 0.0)).rgb;
  c += texture(tSrc, vUv + vec2(2.0 * o.x, 0.0)).rgb;
  c += texture(tSrc, vUv + vec2(0.0, -2.0 * o.y)).rgb;
  c += texture(tSrc, vUv + vec2(0.0, 2.0 * o.y)).rgb;
  c += texture(tSrc, vUv + vec2(-o.x, -o.y)).rgb * 2.0;
  c += texture(tSrc, vUv + vec2(o.x, -o.y)).rgb * 2.0;
  c += texture(tSrc, vUv + vec2(-o.x, o.y)).rgb * 2.0;
  c += texture(tSrc, vUv + vec2(o.x, o.y)).rgb * 2.0;
  gl_FragColor = vec4(c / 12.0 + texture(tAdd, vUv).rgb, 1.0);
}
`;

const OUTPUT_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tAcc;
uniform sampler2D tGlare;
uniform float uGlare;
uniform float uGlareLevels;
uniform float uVignette;
uniform vec3 uBalance;
uniform float uSaturation;
uniform float uLift;
uniform float uToe;
uniform vec2 uAspect;

// three prepends toneMapping() and linearToOutputTexel() to a tone-mapped ShaderMaterial.

// A static 8 x 8 Bayer pattern, +-0.5 LSB: below one code step, so it reads
// as smoothness, never as grain, and it holds still between frames.
float bayer(vec2 p) {
  ivec2 q = ivec2(mod(p, 8.0));
  int m[64] = int[64](0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21);
  return (float(m[q.y * 8 + q.x]) + 0.5) / 64.0 - 0.5;
}

void main() {
  vec3 c = texture(tAcc, vUv).rgb;
  vec3 glare = texture(tGlare, vUv).rgb / uGlareLevels;
  c = mix(c, glare, uGlare);
  vec2 v = (vUv - 0.5) * uAspect;
  c *= 1.0 - uVignette * smoothstep(0.2, 0.95, dot(v, v) * 2.0);
  c *= uBalance;
  // Toe: L / (L + toe) on luminance deepens the shadows toward black while
  // the light itself (pools, beams, emitters) keeps its level and hue.
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  if (uToe > 0.0) c *= lum / (lum + uToe);
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(luma), c, uSaturation), 0.0);
  c += uLift * vec3(1.0, 0.94, 0.86);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += bayer(gl_FragCoord.xy) / 255.0;
}
`;

function floatTarget(w, h, type = THREE.FloatType, filter = THREE.NearestFilter) {
  return new THREE.WebGLRenderTarget(w, h, { type, format: THREE.RGBAFormat, minFilter: filter, magFilter: filter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false });
}

export function createEngine(glCanvas, hudCanvas) {
  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  const hud = hudCanvas.getContext('2d');

  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  quadScene.add(quad);
  const pass = (material, target) => {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCam);
  };

  const s = { width: 0, height: 0, sceneRT: null, acc: [null, null], glare: [], glareUp: [], film: null, accMat: null, lights: [] };

  const downMat = new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: DOWN_FS, uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false, toneMapped: false });
  const upMat = new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: UP_FS, uniforms: { tSrc: { value: null }, tAdd: { value: null }, uTexel: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false, toneMapped: false });
  const outMat = new THREE.ShaderMaterial({
    vertexShader: QUAD_VS,
    fragmentShader: OUTPUT_FS,
    uniforms: {
      tAcc: { value: null },
      tGlare: { value: null },
      uGlare: { value: 0.04 },
      uGlareLevels: { value: 1 },
      uVignette: { value: 0.2 },
      uBalance: { value: new THREE.Vector3(1, 1, 1) },
      uSaturation: { value: 1 },
      uLift: { value: 0 },
      uToe: { value: 0 },
      uAspect: { value: new THREE.Vector2(1, 1) },
    },
    depthTest: false,
    depthWrite: false,
    toneMapped: true,
  });

  const GLARE_LEVELS = 6;

  function setSize(width, height) {
    if (width === s.width && height === s.height) return;
    s.width = width;
    s.height = height;
    renderer.setSize(width, height, false);
    glCanvas.style.width = `${width}px`;
    glCanvas.style.height = `${height}px`;
    hudCanvas.width = width;
    hudCanvas.height = height;
    hudCanvas.style.width = `${width}px`;
    hudCanvas.style.height = `${height}px`;
    document.getElementById('stage').style.width = `${width}px`;
    document.getElementById('stage').style.height = `${height}px`;
    s.sceneRT?.dispose();
    s.acc.forEach((t) => t?.dispose());
    s.glare.forEach((t) => t.dispose());
    s.glareUp.forEach((t) => t.dispose());
    const depthTexture = new THREE.DepthTexture(width, height, THREE.FloatType);
    s.sceneRT = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: false, depthTexture });
    s.acc = [floatTarget(width, height), floatTarget(width, height)];
    s.glare = [];
    s.glareUp = [];
    let w = width;
    let h = height;
    for (let i = 0; i < GLARE_LEVELS; i += 1) {
      w = Math.max(1, Math.round(w / 2));
      h = Math.max(1, Math.round(h / 2));
      s.glare.push(floatTarget(w, h, THREE.HalfFloatType, THREE.LinearFilter));
      s.glareUp.push(floatTarget(w, h, THREE.HalfFloatType, THREE.LinearFilter));
    }
  }

  /** Builds the resolve pass for a film's haze lights. */
  function prepare(film) {
    s.film = film;
    const lights = film.volume?.lights ?? [];
    s.lights = lights;
    const steps = film.volume?.steps ?? 24;
    const uniforms = {
      tScene: { value: null },
      tDepth: { value: null },
      tAcc: { value: null },
      uWeight: { value: 1 },
      uProjInv: { value: new THREE.Matrix4() },
      uViewInv: { value: new THREE.Matrix4() },
      uEye: { value: new THREE.Vector3() },
      uJitter: { value: 0.5 },
      uDensity: { value: film.volume?.density ?? 0 },
      uG: { value: film.volume?.g ?? 0.3 },
      uMaxDist: { value: film.volume?.maxDist ?? 40 },
      uHeightFall: { value: film.volume?.heightFall ?? 0 },
      uFloorY: { value: film.volume?.floorY ?? 0 },
      uBoxMin: { value: new THREE.Vector3(...(film.volume?.box?.[0] ?? [-1e4, -1e4, -1e4])) },
      uBoxMax: { value: new THREE.Vector3(...(film.volume?.box?.[1] ?? [1e4, 1e4, 1e4])) },
    };
    lights.forEach((light, i) => {
      uniforms[`uLPos${i}`] = { value: new THREE.Vector3() };
      uniforms[`uLDir${i}`] = { value: new THREE.Vector3() };
      uniforms[`uLCol${i}`] = { value: new THREE.Vector3() };
      uniforms[`uLCone${i}`] = { value: new THREE.Vector3() };
      uniforms[`uLShadowM${i}`] = { value: new THREE.Matrix4() };
      uniforms[`uLShadow${i}`] = { value: null };
    });
    s.accMat?.dispose();
    s.accMat = new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: accumulateShader(lights.length, steps), uniforms, depthTest: false, depthWrite: false, toneMapped: false });
    setSize(film.width, film.height);
  }

  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();

  /**
   * Off-axis projection for one sub-frame: (jx, jy) is the pixel jitter in
   * pixels, (ax, ay) the eye offset on the aperture in metres; the frustum
   * shears so the focal plane at `focus` stays where it was.
   */
  function jitterCamera(camera, base, jx, jy, ax, ay, focus) {
    const near = camera.near;
    const top = near * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const height = 2 * top;
    const width = camera.aspect * height;
    const left = -width / 2;
    const dx = (jx * width) / s.width - (ax * near) / focus;
    const dy = (jy * height) / s.height - (ay * near) / focus;
    camera.position.copy(base.position);
    camera.quaternion.copy(base.quaternion);
    if (ax !== 0 || ay !== 0) {
      right.set(1, 0, 0).applyQuaternion(base.quaternion);
      up.set(0, 1, 0).applyQuaternion(base.quaternion);
      camera.position.addScaledVector(right, ax).addScaledVector(up, ay);
    }
    camera.updateMatrixWorld(true);
    camera.projectionMatrix.makePerspective(left + dx, left + width + dx, top + dy, top - height + dy, near, camera.far);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }

  function resolveUniforms(camera, k, n, jitter) {
    const u = s.accMat.uniforms;
    u.tScene.value = s.sceneRT.texture;
    u.tDepth.value = s.sceneRT.depthTexture;
    u.uWeight.value = 1 / (k + 1);
    u.uProjInv.value.copy(camera.projectionMatrixInverse);
    u.uViewInv.value.copy(camera.matrixWorld);
    u.uEye.value.setFromMatrixPosition(camera.matrixWorld);
    u.uJitter.value = jitter;
    s.lights.forEach((light, i) => {
      light.getWorldPosition(tmpA);
      light.target.getWorldPosition(tmpB);
      u[`uLPos${i}`].value.copy(tmpA);
      u[`uLDir${i}`].value.copy(tmpB.sub(tmpA).normalize());
      const gain = light.userData.haze ?? 1;
      u[`uLCol${i}`].value.set(light.color.r, light.color.g, light.color.b).multiplyScalar(light.intensity * gain);
      const outer = Math.cos(light.angle);
      const inner = Math.cos(light.angle * (1 - light.penumbra));
      const r0 = light.userData.hazeRadius ?? 0.05;
      u[`uLCone${i}`].value.set(outer, Math.max(inner, outer + 1e-4), r0 * r0);
      if (light.castShadow && light.shadow.map) {
        u[`uLShadow${i}`].value = light.shadow.map.depthTexture;
        u[`uLShadowM${i}`].value.copy(light.shadow.matrix);
      } else {
        u[`uLShadow${i}`].value = null;
        // A matrix that maps everything off the map: the light is unshadowed.
        u[`uLShadowM${i}`].value.makeScale(0, 0, 0).setPosition(-1, -1, -1);
      }
    });
  }

  const base = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };

  /** Renders film time t into the canvas and draws the film's overlay over it. */
  function renderFrame(film, t, { samples, shutter: shutterOverride, density } = {}) {
    if (s.film !== film) prepare(film);
    const n = samples ?? film.samples ?? 64;
    const fps = film.fps ?? 60;
    // A poster frame is shot with the shutter closed: a still, not a smear.
    const shutter = shutterOverride ?? film.shutter ?? 0.5;
    s.accMat.uniforms.uDensity.value = density ?? film.volume?.density ?? 0;
    const camera = film.camera;
    const dof = film.dof ?? null;
    const pTime = shuffle(n, 0x51ed27);
    const pAperture = shuffle(n, 0xa5c3e1);
    const pLight = shuffle(n, 0x3b9f47);
    const pMarch = shuffle(n, 0xc0ffee);
    let cur = 0;
    for (let k = 0; k < n; k += 1) {
      const jx = halton(k + 1, 2) - 0.5;
      const jy = halton(k + 1, 3) - 0.5;
      const tau = ((pTime[k] + 0.5) / n - 0.5) * (shutter / fps);
      const lightIndex = pLight[k];
      const light = vogel(lightIndex, n);
      const line = ((lightIndex + 0.5) / n) * 2 - 1;
      const march = (pMarch[k] + 0.5) / n;
      film.pose(t + tau, { light, line, k, n });
      base.position.copy(camera.position);
      base.quaternion.copy(camera.quaternion);
      let ax = 0;
      let ay = 0;
      let focus = 1;
      if (dof) {
        const [px, py] = vogel(pAperture[k], n);
        const radius = dof.focalLength / (2 * dof.fstop);
        ax = px * radius;
        ay = py * radius;
        focus = typeof dof.focus === 'function' ? dof.focus(t + tau) : dof.focus;
      }
      jitterCamera(camera, base, jx, jy, ax, ay, focus);
      renderer.setRenderTarget(s.sceneRT);
      renderer.render(film.scene, camera);
      resolveUniforms(camera, k, n, march);
      s.accMat.uniforms.tAcc.value = s.acc[cur].texture;
      pass(s.accMat, s.acc[1 - cur]);
      cur = 1 - cur;
      camera.position.copy(base.position);
      camera.quaternion.copy(base.quaternion);
    }
    const acc = s.acc[cur];

    // Lens glare: a dual-filter pyramid summed back up, so the halo is wide and smooth.
    let src = acc;
    for (let i = 0; i < GLARE_LEVELS; i += 1) {
      downMat.uniforms.tSrc.value = src.texture;
      downMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      pass(downMat, s.glare[i]);
      src = s.glare[i];
    }
    let upSrc = s.glare[GLARE_LEVELS - 1];
    for (let i = GLARE_LEVELS - 2; i >= 0; i -= 1) {
      upMat.uniforms.tSrc.value = upSrc.texture;
      upMat.uniforms.tAdd.value = s.glare[i].texture;
      upMat.uniforms.uTexel.value.set(1 / upSrc.width, 1 / upSrc.height);
      pass(upMat, s.glareUp[i]);
      upSrc = s.glareUp[i];
    }

    const grade = film.grade ?? {};
    renderer.toneMappingExposure = grade.exposure ?? 1;
    const o = outMat.uniforms;
    o.tAcc.value = acc.texture;
    o.tGlare.value = upSrc.texture;
    o.uGlare.value = grade.glare ?? 0.04;
    o.uGlareLevels.value = GLARE_LEVELS;
    o.uVignette.value = grade.vignette ?? 0.2;
    o.uBalance.value.set(...(grade.balance ?? [1, 1, 1]));
    o.uSaturation.value = grade.saturation ?? 1;
    o.uLift.value = grade.lift ?? 0;
    o.uToe.value = grade.toe ?? 0;
    o.uAspect.value.set(Math.min(1, s.width / s.height), Math.min(1, s.height / s.width));
    pass(outMat, null);

    // The overlay reads the un-jittered camera at the frame's own instant.
    film.pose(t, { light: [0, 0], line: 0, k: -1, n });
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    hud.clearRect(0, 0, s.width, s.height);
    film.overlay?.(hud, t, viewOf(camera));
  }

  /** Projection helpers for an overlay: world point to canvas pixels. */
  function viewOf(camera) {
    const v = new THREE.Vector3();
    const project = (p) => {
      v.set(p[0], p[1], p[2]).applyMatrix4(camera.matrixWorldInverse);
      const depth = -v.z;
      if (depth <= camera.near) return null;
      v.applyMatrix4(camera.projectionMatrix);
      return [(v.x * 0.5 + 0.5) * s.width, (-v.y * 0.5 + 0.5) * s.height, depth];
    };
    return { project, width: s.width, height: s.height, camera };
  }

  return { renderer, setSize, renderFrame, prepare, get size() { return [s.width, s.height]; } };
}

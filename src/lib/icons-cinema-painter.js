import { breathe, cinemaCamera, cinemaLayers } from './icons-cinema.js';
import { easeInOutSine, grain, lerp, linear, pool, radial, rgba, seededRandom, vignette } from './paint-kit.js';

/*
 * Canvas 2D painter for the Meet our Icons loop. Each act paints an opaque
 * frame through its own macro camera; during a dissolve the incoming act is
 * painted into an offscreen buffer and laid over the outgoing one at its
 * weight. Scene units: 1 unit = 1/100 of the frame's short side (capped by
 * width on narrow phones), origin at the frame centre before the camera.
 */

const TAU = Math.PI * 2;
const HOT = [255, 243, 224];
const WARM = [255, 200, 136];
const AMBER = [255, 172, 96];

function unitOf(width, height) {
  return Math.min(height, width * 0.85) / 100;
}

function applyCamera(ctx, width, height, cam, u) {
  ctx.translate(width / 2, height / 2);
  ctx.rotate(cam.rot);
  ctx.scale(cam.scale, cam.scale);
  ctx.translate(cam.x * u, cam.y * u);
}

/** Half-size in scene units of a square that covers the frame under the camera. */
function coverUnits(width, height, cam, u) {
  return Math.hypot(width, height) / (2 * cam.scale * u) + 8;
}

function travertine(makeCanvas, width, height, seed) {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const random = seededRandom(seed);
  ctx.fillStyle = linear(ctx, 0, 0, 0, height, [
    [0, '#dccbae'],
    [0.5, '#d2bf9f'],
    [1, '#c9b591'],
  ]);
  ctx.fillRect(0, 0, width, height);
  // Sediment bands: long, slightly wavy horizontal veins in two tones.
  for (let i = 0; i < 54; i += 1) {
    const y = random() * height;
    const heavy = random() < 0.16;
    const tone = random() < 0.55 ? [168, 140, 104] : [240, 228, 206];
    const amp = 0.8 + random() * 3.4;
    const freq = 0.006 + random() * 0.012;
    const phase = random() * TAU;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 6) {
      const yy = y + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 2.7 + phase * 1.7) * amp * 0.35;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.strokeStyle = rgba(tone, 0.14 + random() * 0.3);
    ctx.lineWidth = heavy ? 3 + random() * 7 : 0.5 + random() * 1.8;
    ctx.stroke();
  }
  // Pores: the open travertine voids, stretched along the bedding.
  for (let i = 0; i < 300; i += 1) {
    const rx = 0.5 + random() * 3;
    ctx.beginPath();
    ctx.ellipse(random() * width, random() * height, rx, rx * (0.22 + random() * 0.3), 0, 0, TAU);
    ctx.fillStyle = rgba([104, 82, 58], 0.22 + random() * 0.42);
    ctx.fill();
  }
  return canvas;
}

function strokeVein(ctx, points, style, lineWidth) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
  ctx.strokeStyle = style;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

/**
 * Dark veined marble: a near-black warm ground with two broad, smooth tonal
 * sweeps and crisp veins. Each vein is a seeded random walk that keeps to a
 * shared diagonal, drawn as a faint halo under a sharp core, with a few
 * finer branches. No noise field: the stone reads through its veins.
 */
function marble(makeCanvas, width, height, seed) {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const random = seededRandom(seed);
  ctx.fillStyle = linear(ctx, 0, 0, width, height, [
    [0, '#1d1a17'],
    [0.45, '#13110f'],
    [1, '#1b1815'],
  ]);
  ctx.fillRect(0, 0, width, height);
  for (const [fx, fy, fr, alpha] of [
    [0.28, 0.32, 0.62, 0.09],
    [0.78, 0.72, 0.5, 0.07],
  ]) {
    ctx.fillStyle = radial(ctx, width * fx, height * fy, width * fr, [
      [0, `rgba(96, 84, 70, ${alpha})`],
      [1, 'rgba(96, 84, 70, 0)'],
    ]);
    ctx.fillRect(0, 0, width, height);
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const vein = (x0, y0, heading, length, lineWidth, tone, alpha, depth) => {
    const points = [[x0, y0]];
    let x = x0;
    let y = y0;
    let a = heading;
    for (let s = 0; s < length; s += 4) {
      a += (random() - 0.5) * 0.3 + (heading - a) * 0.06;
      x += Math.cos(a) * 4;
      y += Math.sin(a) * 4;
      points.push([x, y]);
    }
    strokeVein(ctx, points, rgba(tone, alpha * 0.16), lineWidth * 5);
    strokeVein(ctx, points, rgba(tone, alpha), lineWidth);
    if (depth >= 2) return;
    for (let b = 0; b < 2; b += 1) {
      if (random() < 0.62) {
        const [bx, by] = points[Math.floor(random() * points.length)];
        vein(bx, by, heading + (random() - 0.5) * 1.5, length * 0.34, lineWidth * 0.55, tone, alpha * 0.8, depth + 1);
      }
    }
  };
  for (let i = 0; i < 10; i += 1) {
    const tone = random() < 0.3 ? [196, 168, 118] : [206, 198, 184];
    vein(random() * width * 1.1 - width * 0.25, random() * height, 0.4 + (random() - 0.5) * 0.5, width * (0.6 + random() * 0.7), 0.6 + random() * 0.9, tone, 0.2 + random() * 0.24, 0);
  }
  for (let i = 0; i < 28; i += 1) {
    vein(random() * width, random() * height, 0.4 + (random() - 0.5) * 1.2, 40 + random() * 120, 0.4, [206, 198, 184], 0.1, 2);
  }
  return canvas;
}

/** Brushed aluminium: full-width horizontal hairlines, so the tile repeats seamlessly. */
function brushed(makeCanvas, width, height, seed) {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const random = seededRandom(seed);
  ctx.fillStyle = '#5f5c57';
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < height * 3; i += 1) {
    const light = random() < 0.5;
    const alpha = 0.04 + random() * 0.13;
    ctx.fillStyle = light ? `rgba(236, 232, 224, ${alpha.toFixed(3)})` : `rgba(10, 9, 8, ${alpha.toFixed(3)})`;
    ctx.fillRect(0, random() * height, width, 0.4 + random() * 0.8);
  }
  return canvas;
}

/**
 * Textures for all three acts, built once per mount. `makeCanvas` returns a
 * fresh offscreen canvas of the given size.
 */
export function createCinemaAssets(makeCanvas) {
  return {
    travertine: travertine(makeCanvas, 360, 520, 37),
    marble: marble(makeCanvas, 1280, 854, 23),
    brushed: brushed(makeCanvas, 256, 96, 19),
    carbon: grain(makeCanvas, 160, 41, 0.3),
    film: grain(makeCanvas, 256, 53, 0.5),
    patterns: new WeakMap(),
  };
}

function patternOf(ctx, assets, key) {
  let cache = assets.patterns.get(ctx);
  if (!cache) {
    cache = {};
    assets.patterns.set(ctx, cache);
  }
  if (!cache[key]) cache[key] = ctx.createPattern(assets[key], 'repeat');
  return cache[key];
}

function metalRing(ctx, x, y, radius, width, angle, tones) {
  const outer = radius + width / 2;
  const inner = Math.max(0, radius - width / 2);
  let style;
  if (typeof ctx.createConicGradient === 'function') {
    style = ctx.createConicGradient(angle, x, y);
    tones.forEach((tone, i) => style.addColorStop(i / (tones.length - 1), tone));
  } else {
    style = linear(ctx, x - outer, y - outer, x + outer, y + outer, tones.map((tone, i) => [i / (tones.length - 1), tone]));
  }
  ctx.beginPath();
  ctx.arc(x, y, outer, 0, TAU);
  ctx.arc(x, y, inner, 0, TAU, true);
  ctx.fillStyle = style;
  ctx.fill();
}

const ALUMINIUM = ['#5c5955', '#dedbd5', '#7f7c77', '#2b2927', '#c4c0b9', '#56534f', '#1d1c1a', '#a5a19a', '#5c5955'];
const BRASS = ['#6a5233', '#e9cf9c', '#8a6c42', '#3a2b18', '#d2b47e', '#6d5434', '#2e2214', '#b9996a', '#6a5233'];

/* ---------- Act I: Sculptural Obsidian Dome & Travertine Column ---------- */

function spherePoint(radius, lam, phi) {
  return [radius * Math.cos(phi) * Math.sin(lam), -radius * Math.sin(phi)];
}

function paintObsidian(ctx, width, height, cam, time, assets) {
  const u = unitOf(width, height);
  // The room: warm umber plaster falling to dusk at the floor.
  ctx.fillStyle = linear(ctx, 0, 0, 0, height, [
    [0, '#342c25'],
    [0.5, '#221d18'],
    [1, '#130f0c'],
  ]);
  ctx.fillRect(0, 0, width, height);
  // Window light on the back wall drifts slower than the subject: parallax.
  const drift = cam.sweep * width * 0.12;
  for (const [fx, alpha] of [
    [0.16, 0.08],
    [0.27, 0.05],
  ]) {
    const x = width * fx + drift;
    ctx.fillStyle = linear(ctx, x - width * 0.05, 0, x + width * 0.05, 0, [
      [0, 'rgba(255, 236, 210, 0)'],
      [0.5, `rgba(255, 236, 210, ${alpha})`],
      [1, 'rgba(255, 236, 210, 0)'],
    ]);
    ctx.fillRect(x - width * 0.05, 0, width * 0.1, height * 0.82);
  }
  pool(ctx, width * 0.52 - drift * 0.4, height * 0.36, Math.max(width, height) * 0.48, [196, 156, 112], 0.16);

  ctx.save();
  applyCamera(ctx, width, height, cam, u);
  const cover = coverUnits(width, height, cam, u);
  const bottom = (cover - cam.y) * u;

  // Travertine column under the lamp.
  const top = 25 * u;
  const rad = 25 * u;
  const capRy = 4.6 * u;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-rad, top);
  ctx.lineTo(-rad, bottom);
  ctx.lineTo(rad, bottom);
  ctx.lineTo(rad, top);
  ctx.ellipse(0, top, rad, capRy, 0, 0, Math.PI, false);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(assets.travertine, -rad, top - capRy, rad * 2, Math.max(1, bottom - top + capRy));
  // Cylindrical shading: dark flanks, a lit band left of centre.
  ctx.fillStyle = linear(ctx, -rad, 0, rad, 0, [
    [0, 'rgba(22, 15, 9, 0.84)'],
    [0.14, 'rgba(22, 15, 9, 0.46)'],
    [0.38, 'rgba(255, 232, 196, 0.08)'],
    [0.56, 'rgba(22, 15, 9, 0.1)'],
    [0.82, 'rgba(22, 15, 9, 0.52)'],
    [1, 'rgba(22, 15, 9, 0.86)'],
  ]);
  ctx.fillRect(-rad, top - capRy, rad * 2, bottom - top + capRy);
  // The lamp lights the column from above and lets it fall to dusk below.
  ctx.fillStyle = linear(ctx, 0, top, 0, top + 70 * u, [
    [0, rgba(WARM, 0.34)],
    [0.3, rgba(WARM, 0.08)],
    [1, 'rgba(12, 9, 6, 0.62)'],
  ]);
  ctx.fillRect(-rad, top - capRy, rad * 2, bottom - top + capRy);
  ctx.restore();

  // Top face: travertine in the downlight's hot spot.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, top, rad, capRy, 0, 0, TAU);
  ctx.clip();
  ctx.drawImage(assets.travertine, -rad, top - capRy * 4, rad * 2, capRy * 8);
  ctx.fillStyle = radial(ctx, 0, top, rad, [
    [0, 'rgba(255, 232, 198, 0.7)'],
    [0.5, 'rgba(226, 192, 148, 0.28)'],
    [1, 'rgba(70, 52, 34, 0.5)'],
  ]);
  ctx.fillRect(-rad, top - capRy, rad * 2, capRy * 2);
  ctx.restore();

  // Brass stem from the column to the shade.
  const domeY = 15.5 * u;
  const domeR = 37 * u;
  const mouthRy = 5 * u;
  ctx.fillStyle = linear(ctx, -0.9 * u, 0, 0.9 * u, 0, [
    [0, '#5a4630'],
    [0.45, '#e2c592'],
    [1, '#4a3a26'],
  ]);
  ctx.fillRect(-0.7 * u, domeY + mouthRy * 0.4, 1.4 * u, top - domeY - mouthRy * 0.4);

  // Light falling through the gap onto the column.
  pool(ctx, 0, top - 2 * u, 34 * u, [255, 214, 164], 0.42, 'screen');

  // The opening: from slightly below the warm inside of the dome shows.
  ctx.beginPath();
  ctx.ellipse(0, domeY, domeR, mouthRy, 0, 0, TAU);
  ctx.fillStyle = radial(ctx, 0, domeY, domeR, [
    [0, rgba(HOT, 1)],
    [0.26, 'rgba(255, 216, 164, 0.96)'],
    [0.68, rgba(AMBER, 0.62)],
    [1, 'rgba(110, 62, 26, 0.9)'],
  ]);
  ctx.fill();

  // The shell: glossy black enamel above the far rim of the opening.
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, domeY, domeR, Math.PI, 0, false);
  ctx.ellipse(0, domeY, domeR, mouthRy, 0, 0, Math.PI, true);
  ctx.closePath();
  ctx.fillStyle = radial(ctx, -domeR * 0.4, domeY - domeR * 0.5, domeR * 1.25, [
    [0, '#3b352f'],
    [0.22, '#15130f'],
    [0.66, '#070605'],
    [1, '#020202'],
  ]);
  ctx.fill();
  ctx.clip();

  // Fresnel: the enamel brightens toward its silhouette.
  ctx.fillStyle = radial(ctx, 0, domeY, domeR, [
    [0, 'rgba(255, 238, 214, 0)'],
    [0.84, 'rgba(255, 238, 214, 0)'],
    [0.97, 'rgba(255, 236, 210, 0.14)'],
    [1, 'rgba(255, 236, 210, 0.04)'],
  ]);
  ctx.fillRect(-domeR, domeY - domeR, domeR * 2, domeR);

  // A window grid reflected in the dome, sliding across as the camera pans.
  const lam0 = lerp(-1.3, -0.1, cam.sweep);
  const paneL = 0.23;
  const paneP = 0.3;
  const gap = 0.034;
  for (let c = 0; c < 3; c += 1) {
    for (let r = 0; r < 2; r += 1) {
      const l0 = lam0 + c * (paneL + gap);
      const l1 = l0 + paneL;
      const p0 = 0.3 + r * (paneP + gap);
      const p1 = p0 + paneP;
      const edge = [];
      for (let i = 0; i <= 6; i += 1) edge.push([lerp(l0, l1, i / 6), p0]);
      for (let i = 0; i <= 6; i += 1) edge.push([l1, lerp(p0, p1, i / 6)]);
      for (let i = 0; i <= 6; i += 1) edge.push([lerp(l1, l0, i / 6), p1]);
      for (let i = 0; i <= 6; i += 1) edge.push([l0, lerp(p1, p0, i / 6)]);
      const midL = (l0 + l1) / 2;
      const midP = (p0 + p1) / 2;
      if (Math.cos(midL) < 0.08) continue;
      const fresnel = 1 - Math.cos(midP) * Math.cos(midL);
      const alpha = 0.14 + 0.46 * fresnel;
      const pts = edge.map(([lam, phi]) => {
        const [x, y] = spherePoint(domeR, lam, phi);
        return [x, y + domeY];
      });
      const ys = pts.map((p) => p[1]);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fillStyle = linear(ctx, 0, Math.min(...ys), 0, Math.max(...ys), [
        [0, `rgba(255, 249, 238, ${alpha.toFixed(3)})`],
        [1, `rgba(255, 236, 214, ${(alpha * 0.22).toFixed(3)})`],
      ]);
      ctx.fill();
    }
  }
  // A broad softbox sheen riding over the crown.
  const sheenX = lerp(-domeR * 0.55, domeR * 0.15, cam.sweep);
  ctx.save();
  ctx.translate(sheenX, domeY - domeR * 0.7);
  ctx.scale(1, 0.42);
  pool(ctx, 0, 0, domeR * 0.62, [255, 250, 242], 0.16);
  ctx.restore();
  ctx.restore();

  // Rim lights: a hot specular line on the crown, a warm bounce on the right.
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, domeY, domeR * 0.985, Math.PI * 1.1, Math.PI * 1.36);
  ctx.strokeStyle = 'rgba(255, 250, 240, 0.6)';
  ctx.lineWidth = 0.45 * u;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, domeY, domeR * 0.99, Math.PI * 1.7, Math.PI * 1.97);
  ctx.strokeStyle = rgba(WARM, 0.42);
  ctx.lineWidth = 0.55 * u;
  ctx.stroke();
  // The rolled rim of the opening.
  ctx.beginPath();
  ctx.ellipse(0, domeY, domeR, mouthRy, 0, 0, TAU);
  ctx.strokeStyle = 'rgba(222, 194, 156, 0.72)';
  ctx.lineWidth = 0.32 * u;
  ctx.stroke();

  // Halation round the opening.
  pool(ctx, 0, domeY + 2 * u, 52 * u, WARM, 0.2, 'screen');
  ctx.restore();
}

/* ---------- Act II: Triple-Aperture Optical Diffuser Macro ---------- */

function paintLens(ctx, x, y, r, level, angle) {
  ctx.beginPath();
  ctx.arc(x, y, r * 1.2, 0, TAU);
  ctx.fillStyle = '#0a0908';
  ctx.fill();
  metalRing(ctx, x, y, r * 1.1, r * 0.13, angle, ALUMINIUM);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = radial(ctx, x - r * 0.06, y - r * 0.08, r, [
    [0, rgba(HOT, 1)],
    [0.2, 'rgba(255, 232, 190, 0.98)'],
    [0.48, rgba([255, 186, 108], 0.94 * level)],
    [0.8, 'rgba(194, 102, 38, 0.92)'],
    [1, 'rgba(70, 33, 12, 1)'],
  ]);
  ctx.fill();
  ctx.clip();
  // Fresnel prism rings of the diffuser.
  for (let k = 1; k < 10; k += 1) {
    ctx.beginPath();
    ctx.arc(x, y, (r * k) / 10, 0, TAU);
    ctx.strokeStyle = k % 2 ? 'rgba(255, 255, 255, 0.1)' : 'rgba(120, 52, 12, 0.12)';
    ctx.lineWidth = r * 0.032;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(x - r * 0.36, y - r * 0.4, r * 0.3, r * 0.1, -0.72, 0, TAU);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
  ctx.fill();
  ctx.restore();
}

function paintAperture(ctx, width, height, cam, time, assets) {
  const u = unitOf(width, height);
  ctx.fillStyle = '#171615';
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  applyCamera(ctx, width, height, cam, u);
  const cover = coverUnits(width, height, cam, u);
  const x0 = (-cover - cam.x) * u;
  const y0 = (-cover - cam.y) * u;
  const span = cover * 2 * u;

  // Matte carbon housing: a fine micro texture under a soft key light.
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = patternOf(ctx, assets, 'carbon');
  ctx.fillRect(x0, y0, span, span);
  ctx.restore();
  pool(ctx, -50 * u, -56 * u, 130 * u, [255, 238, 214], 0.07);

  // The highlight stays with the light while the housing rolls under it.
  const lightAngle = -2.3 - cam.rot;
  const ringR = 64 * u;
  metalRing(ctx, 0, 0, ringR, 3.4 * u, lightAngle, ALUMINIUM);
  ctx.beginPath();
  ctx.arc(0, 0, ringR - 1.7 * u, 0, TAU);
  ctx.fillStyle = radial(ctx, 0, 0, ringR, [
    [0, '#141312'],
    [0.82, '#1b1a18'],
    [0.95, '#0c0b0a'],
    [1, '#050505'],
  ]);
  ctx.fill();
  metalRing(ctx, 0, 0, 44 * u, 0.6 * u, lightAngle + 0.4, ALUMINIUM);

  // Three 2700K lenses warming up as the camera presses in.
  const level = 0.9 + 0.1 * cam.sweep;
  const lensR = 15 * u;
  const lenses = [0, 1, 2].map((k) => {
    const a = -Math.PI / 2 + (k * TAU) / 3;
    return [Math.cos(a) * 26 * u, Math.sin(a) * 26 * u];
  });
  for (const [lx, ly] of lenses) paintLens(ctx, lx, ly, lensR, level, lightAngle);
  for (const [lx, ly] of lenses) {
    pool(ctx, lx, ly, lensR * 3.8, [255, 166, 84], 0.36 * level, 'screen');
    pool(ctx, lx, ly, lensR * 1.8, [255, 214, 160], 0.34 * level, 'screen');
  }
  // Screen position of the cluster for the anamorphic streak.
  const centre = ctx.getTransform().transformPoint({ x: 0, y: 0 });
  ctx.restore();

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const s = ctx.canvas.width / width;
  ctx.translate(centre.x, centre.y);
  ctx.scale(1, 0.03);
  pool(ctx, 0, 0, width * 0.62 * s, [255, 190, 124], 0.2 * level, 'screen');
  ctx.restore();
}

/* ---------- Act III: Linear Anodized Track & Prismatic Brass Louver Glide ---------- */

// Set geometry in scene units. The track runs the width of the frame; the
// louver run sits on its left, the glass cylinder spot hangs right of centre.
const TRACK_TOP = -34;
const TRACK_FACE = 8.5;
const TRACK_UNDER = 4.2;
const LOUVER_RUN = [-132, -24];
const LOUVER_PITCH = 2.3;
const SPOT_X = 0;
const LEDGE_TOP = 33;
const LEDGE_FACE = 6.5;
const WALL_HIT = 28;

/** Spot aim (radians from straight down, positive to the right) at act progress p and clock t. */
function spotAim(p, time) {
  return lerp(0.95, -0.72, easeInOutSine(p)) + 0.03 * Math.sin(time * 0.9);
}

function paintTrackRail(ctx, u, x0, x1, sweep) {
  const top = TRACK_TOP * u;
  const face = TRACK_FACE * u;
  const under = TRACK_UNDER * u;
  // Front face: matte black anodizing, a cool catch light on the top arris
  // and a warm one along the lower arris where the spot's light grazes it.
  ctx.fillStyle = linear(ctx, 0, top, 0, top + face, [
    [0, '#2f2d2a'],
    [0.08, '#1c1b19'],
    [0.5, '#141312'],
    [0.9, '#0d0c0b'],
    [1, '#1b1a18'],
  ]);
  ctx.fillRect(x0, top, x1 - x0, face);
  ctx.fillStyle = 'rgba(214, 210, 202, 0.42)';
  ctx.fillRect(x0, top, x1 - x0, 0.28 * u);
  const glint = SPOT_X * u + lerp(-60, 40, sweep) * u;
  ctx.fillStyle = linear(ctx, glint - 120 * u, 0, glint + 120 * u, 0, [
    [0, 'rgba(255, 214, 160, 0)'],
    [0.5, 'rgba(255, 222, 176, 0.62)'],
    [1, 'rgba(255, 214, 160, 0)'],
  ]);
  ctx.fillRect(x0, top + face - 0.42 * u, x1 - x0, 0.42 * u);

  // The underside: the open slot with its two copper 24V conductors.
  const slotTop = top + face;
  ctx.fillStyle = '#080707';
  ctx.fillRect(x0, slotTop, x1 - x0, under);
  for (const [dy, alpha] of [
    [0.32, 0.55],
    [0.62, 0.42],
  ]) {
    ctx.fillStyle = `rgba(201, 138, 82, ${alpha})`;
    ctx.fillRect(x0, slotTop + under * dy, x1 - x0, 0.22 * u);
  }
  ctx.fillStyle = 'rgba(120, 116, 110, 0.5)';
  ctx.fillRect(x0, slotTop + under - 0.3 * u, x1 - x0, 0.3 * u);
}

function paintLouvers(ctx, u, sweep, time) {
  const top = (TRACK_TOP + TRACK_FACE) * u;
  const height = TRACK_UNDER * u;
  const [a, b] = LOUVER_RUN;
  // The LED module glows warm behind the blades.
  ctx.fillStyle = linear(ctx, 0, top, 0, top + height, [
    [0, 'rgba(255, 190, 118, 0.28)'],
    [1, 'rgba(255, 226, 180, 0.9)'],
  ]);
  ctx.fillRect(a * u, top, (b - a) * u, height);
  // Brushed brass blades: a specular glint travels along the run as the
  // camera glides, and each prism face throws a bright line.
  const glintX = lerp(a + 10, b - 6, sweep) + 4 * Math.sin(time * 0.8);
  for (let x = a + LOUVER_PITCH / 2; x < b; x += LOUVER_PITCH) {
    const near = Math.exp(-(((x - glintX) / 14) ** 2));
    ctx.fillStyle = linear(ctx, (x - 0.55) * u, 0, (x + 0.55) * u, 0, [
      [0, '#3c2c17'],
      [0.35, near > 0.2 ? '#f6dcaa' : '#c9a066'],
      [0.6, '#8a6a3c'],
      [1, '#2c2010'],
    ]);
    ctx.fillRect((x - 0.55) * u, top, 1.1 * u, height);
    if (near > 0.05) {
      ctx.fillStyle = `rgba(255, 246, 226, ${(0.85 * near).toFixed(3)})`;
      ctx.fillRect((x - 0.12) * u, top + height * 0.15, 0.24 * u, height * 0.7);
    }
  }
  // End caps of the louver module.
  ctx.fillStyle = '#26221c';
  ctx.fillRect((a - 0.8) * u, top, 0.8 * u, height);
  ctx.fillRect(b * u, top, 0.8 * u, height);
  // The module washes the marble below in a soft band of 2700K.
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = linear(ctx, 0, top + height, 0, top + height + 30 * u, [
    [0, 'rgba(255, 196, 126, 0.1)'],
    [1, 'rgba(255, 196, 126, 0)'],
  ]);
  ctx.beginPath();
  ctx.moveTo(a * u, top + height);
  ctx.lineTo(b * u, top + height);
  ctx.lineTo((b + 9) * u, top + height + 30 * u);
  ctx.lineTo((a - 9) * u, top + height + 30 * u);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

const SPOT_HEAD = 18;
const SPOT_NECK = 1.6;

/** Where the spot hangs and where its lens points, for head aim `aim`. */
function spotGeometry(u, aim) {
  const railBottom = (TRACK_TOP + TRACK_FACE + TRACK_UNDER) * u;
  const pivotY = railBottom + 6.4 * u;
  const lensDist = (SPOT_NECK + SPOT_HEAD) * u;
  const x = SPOT_X * u;
  return { railBottom, pivotY, x, lens: { x: x + Math.sin(aim) * lensDist, y: pivotY + Math.cos(aim) * lensDist } };
}

/** The glass cylinder spot on its adapter, its head turned to `aim`. */
function paintGlassSpot(ctx, u, aim) {
  const { railBottom, pivotY, x } = spotGeometry(u, aim);
  // Adapter in the slot and the pivot knuckle.
  ctx.fillStyle = linear(ctx, x - 4.5 * u, 0, x + 4.5 * u, 0, [
    [0, '#0e0d0c'],
    [0.3, '#34312d'],
    [1, '#0b0a09'],
  ]);
  ctx.fillRect(x - 4.5 * u, railBottom - 1.2 * u, 9 * u, 5.4 * u);
  ctx.fillStyle = '#1a1917';
  ctx.fillRect(x - 0.9 * u, railBottom + 4 * u, 1.8 * u, 2.4 * u);
  ctx.beginPath();
  ctx.arc(x, pivotY, 1.9 * u, 0, TAU);
  ctx.fillStyle = radial(ctx, x - 0.6 * u, pivotY - 0.6 * u, 2.2 * u, [
    [0, '#6a6660'],
    [0.5, '#24221f'],
    [1, '#0b0a09'],
  ]);
  ctx.fill();

  // The head turns about the knuckle: a glass cylinder round a black engine.
  const length = SPOT_HEAD * u;
  const radius = 5.4 * u;
  ctx.save();
  ctx.translate(x, pivotY);
  ctx.rotate(-aim);
  const top = SPOT_NECK * u;
  // Glass: barely there, a little darker than the marble behind it.
  ctx.fillStyle = 'rgba(14, 13, 12, 0.34)';
  ctx.fillRect(-radius, top, radius * 2, length);
  // The engine inside, with its brass heat-sink ring.
  ctx.fillStyle = linear(ctx, -radius * 0.55, 0, radius * 0.55, 0, [
    [0, '#090808'],
    [0.35, '#2b2926'],
    [1, '#070606'],
  ]);
  ctx.fillRect(-radius * 0.55, top, radius * 1.1, length * 0.78);
  ctx.fillStyle = linear(ctx, -radius * 0.6, 0, radius * 0.6, 0, BRASS.map((tone, i) => [i / (BRASS.length - 1), tone]));
  ctx.fillRect(-radius * 0.6, top + length * 0.5, radius * 1.2, 1.1 * u);
  // Refraction highlights: two crisp vertical lines down the glass walls.
  for (const [dx, alpha, w] of [
    [-radius + 0.5 * u, 0.7, 0.32],
    [-radius + 1.5 * u, 0.22, 0.6],
    [radius - 0.7 * u, 0.42, 0.26],
  ]) {
    ctx.fillStyle = `rgba(255, 250, 240, ${alpha})`;
    ctx.fillRect(dx, top + 0.6 * u, w * u, length - 1.2 * u);
  }
  // Glass rims top and bottom.
  ctx.strokeStyle = 'rgba(232, 226, 216, 0.55)';
  ctx.lineWidth = 0.3 * u;
  ctx.beginPath();
  ctx.ellipse(0, top, radius, radius * 0.22, 0, 0, TAU);
  ctx.stroke();
  // The lens: white-hot at the core, a 2700K rim.
  const lensY = top + length;
  ctx.beginPath();
  ctx.ellipse(0, lensY, radius * 0.92, radius * 0.24, 0, 0, TAU);
  ctx.fillStyle = radial(ctx, 0, lensY, radius, [
    [0, rgba(HOT, 1)],
    [0.55, 'rgba(255, 224, 176, 0.98)'],
    [1, 'rgba(214, 140, 70, 0.95)'],
  ]);
  ctx.fill();
  ctx.restore();
}

function paintTrack(ctx, width, height, cam, time, assets) {
  const u = unitOf(width, height);
  ctx.fillStyle = '#0f0e0d';
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  applyCamera(ctx, width, height, cam, u);
  const cover = coverUnits(width, height, cam, u);
  const x0 = (-cover - cam.x) * u;
  const x1 = (cover - cam.x) * u;
  const y0 = (-cover - cam.y) * u;
  const span = cover * 2 * u;

  // Dark veined marble behind the track, drifting at half the camera's pace.
  const marbleW = span * 1.3;
  const marbleH = marbleW * (assets.marble.height / assets.marble.width);
  const mx = -cam.x * u * 0.5 - marbleW / 2;
  const my = -cam.y * u * 0.5 - marbleH / 2;
  ctx.drawImage(assets.marble, mx, my, marbleW, Math.max(marbleH, span * 1.2));

  const aim = spotAim(cam.sweep, time);
  const glow = breathe(time, 4.6, 0.06);

  // The beam: a crisp 2700K cone from the lens to the marble just above the
  // brushed ledge, landing as a sharp-edged pool that sweeps as the head turns.
  const { lens } = spotGeometry(u, aim);
  const hitY = WALL_HIT * u;
  const hitX = lens.x + Math.tan(aim) * (hitY - lens.y);
  const reach = Math.hypot(hitX - lens.x, hitY - lens.y);
  const poolRx = 4.6 * u + reach * 0.2;
  const poolRy = poolRx * 0.62;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const nx = Math.cos(aim);
  const ny = -Math.sin(aim);
  const lensHalf = 4.6 * u;
  ctx.beginPath();
  ctx.moveTo(lens.x - nx * lensHalf, lens.y - ny * lensHalf);
  ctx.lineTo(lens.x + nx * lensHalf, lens.y + ny * lensHalf);
  ctx.lineTo(hitX + poolRx, hitY);
  ctx.lineTo(hitX - poolRx, hitY);
  ctx.closePath();
  ctx.fillStyle = linear(ctx, lens.x, lens.y, hitX, hitY, [
    [0, rgba([255, 236, 204], 0.5 * glow)],
    [0.5, rgba([255, 214, 160], 0.2 * glow)],
    [1, rgba([255, 200, 140], 0.12 * glow)],
  ]);
  ctx.fill();
  // Razor edges: the cone's two sides drawn as fine bright lines.
  ctx.strokeStyle = rgba([255, 226, 186], 0.22 * glow);
  ctx.lineWidth = 0.22 * u;
  ctx.beginPath();
  ctx.moveTo(lens.x - nx * lensHalf, lens.y - ny * lensHalf);
  ctx.lineTo(hitX - poolRx, hitY);
  ctx.moveTo(lens.x + nx * lensHalf, lens.y + ny * lensHalf);
  ctx.lineTo(hitX + poolRx, hitY);
  ctx.stroke();
  ctx.restore();

  // The pool: inside its hard edge the marble's veins light up.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(hitX, hitY, poolRx, poolRy, 0, 0, TAU);
  ctx.clip();
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = radial(ctx, hitX, hitY, poolRx, [
    [0, rgba(HOT, 0.82 * glow)],
    [0.45, rgba([255, 206, 142], 0.34 * glow)],
    [0.9, rgba([255, 178, 102], 0.2 * glow)],
    [1, rgba([255, 178, 102], 0.16 * glow)],
  ]);
  ctx.fillRect(hitX - poolRx, hitY - poolRy, poolRx * 2, poolRy * 2);
  // The veins inside the pool, lit three times over so they flash gold.
  for (let pass = 0; pass < 3; pass += 1) ctx.drawImage(assets.marble, mx, my, marbleW, Math.max(marbleH, span * 1.2));
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = rgba([255, 214, 168], 1);
  ctx.fillRect(hitX - poolRx, hitY - poolRy, poolRx * 2, poolRy * 2);
  ctx.restore();
  pool(ctx, hitX, hitY, poolRx * 2.2, [255, 200, 140], 0.14 * glow, 'screen');

  // Brushed metal ledge under the marble: fine horizontal grain, a lit arris,
  // and the beam's spill stretched into an anisotropic streak.
  const ledgeTop = LEDGE_TOP * u;
  const ledgeFace = LEDGE_FACE * u;
  ctx.save();
  ctx.fillStyle = patternOf(ctx, assets, 'brushed');
  ctx.fillRect(x0, ledgeTop, x1 - x0, ledgeFace);
  ctx.fillStyle = linear(ctx, 0, ledgeTop, 0, ledgeTop + ledgeFace, [
    [0, 'rgba(255, 250, 240, 0.12)'],
    [0.4, 'rgba(10, 9, 8, 0.2)'],
    [1, 'rgba(10, 9, 8, 0.62)'],
  ]);
  ctx.fillRect(x0, ledgeTop, x1 - x0, ledgeFace);
  ctx.fillStyle = 'rgba(240, 236, 228, 0.5)';
  ctx.fillRect(x0, ledgeTop, x1 - x0, 0.26 * u);
  ctx.restore();
  ctx.save();
  ctx.translate(hitX, ledgeTop + ledgeFace * 0.4);
  ctx.scale(1, 0.05);
  pool(ctx, 0, 0, poolRx * 3.4, [255, 226, 186], 0.75 * glow, 'screen');
  ctx.restore();
  ctx.fillStyle = linear(ctx, hitX - poolRx * 2, 0, hitX + poolRx * 2, 0, [
    [0, 'rgba(255, 236, 206, 0)'],
    [0.5, rgba([255, 240, 214], 0.9 * glow)],
    [1, 'rgba(255, 236, 206, 0)'],
  ]);
  ctx.fillRect(hitX - poolRx * 2, ledgeTop, poolRx * 4, 0.3 * u);
  // Below the ledge the marble falls into shadow.
  ctx.fillStyle = linear(ctx, 0, ledgeTop + ledgeFace, 0, ledgeTop + ledgeFace + 24 * u, [
    [0, 'rgba(6, 5, 4, 0.78)'],
    [1, 'rgba(6, 5, 4, 0.5)'],
  ]);
  ctx.fillRect(x0, ledgeTop + ledgeFace, x1 - x0, y0 + span - (ledgeTop + ledgeFace));

  // The track itself, then its louver run and the spot hanging from it.
  paintTrackRail(ctx, u, x0, x1, cam.sweep);
  paintLouvers(ctx, u, cam.sweep, time);
  paintGlassSpot(ctx, u, aim);
  pool(ctx, lens.x, lens.y, 9 * u, [255, 236, 204], 0.55 * glow, 'screen');
  pool(ctx, lens.x, lens.y, 24 * u, [255, 190, 124], 0.18 * glow, 'screen');
  const centre = ctx.getTransform().transformPoint({ x: lens.x, y: lens.y });
  ctx.restore();

  // A faint anamorphic streak through the lens, in screen space.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const s = ctx.canvas.width / width;
  ctx.translate(centre.x, centre.y);
  ctx.scale(1, 0.025);
  pool(ctx, 0, 0, width * 0.5 * s, [255, 200, 140], 0.16 * glow, 'screen');
  ctx.restore();
}

/* ---------- frame ---------- */

const ACT_PAINTERS = Object.freeze({ obsidian: paintObsidian, aperture: paintAperture, track: paintTrack });

function paintAct(ctx, layer, width, height, time, assets) {
  ctx.save();
  ACT_PAINTERS[layer.id](ctx, width, height, cinemaCamera(layer.id, layer.progress), time, assets);
  ctx.restore();
}

/** Deterministic per-frame offset for the film grain, so stills are stable. */
function grainOffset(time, size) {
  const n = Math.sin(time * 12.9898 + 78.233) * 43758.5453;
  return Math.floor((n - Math.floor(n)) * size);
}

/**
 * Paints one frame of the loop at clock `time` (seconds). `width` and
 * `height` are CSS pixels, `scale` the backing-store ratio. `buffer` is an
 * offscreen canvas the size of the backing store, used only during a dissolve.
 * Returns the layers it painted.
 */
export function paintCinemaFrame(ctx, { width, height, scale, time, assets, buffer }) {
  const layers = cinemaLayers(time);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  paintAct(ctx, layers[0], width, height, time, assets);
  if (layers.length > 1 && buffer) {
    const bctx = buffer.getContext('2d');
    bctx.setTransform(scale, 0, 0, scale, 0, 0);
    paintAct(bctx, layers[1], width, height, time, assets);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = layers[1].weight;
    ctx.drawImage(buffer, 0, 0);
    ctx.restore();
  }
  vignette(ctx, width, height, 0.62);
  ctx.save();
  const offset = grainOffset(time, 256);
  ctx.globalAlpha = 0.18;
  ctx.translate(-offset, -offset);
  ctx.fillStyle = patternOf(ctx, assets, 'film');
  ctx.fillRect(offset, offset, width, height);
  ctx.restore();
  return layers;
}

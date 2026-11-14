import { breathe, cinemaCamera, cinemaLayers } from './icons-cinema.js';
import {
  grain,
  hyperbolicWash,
  lerp,
  linear,
  mottle,
  pool,
  radial,
  rgba,
  seededRandom,
  valueNoise,
  vignette,
} from './paint-kit.js';

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
const UMBER = [30, 23, 17];

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

/**
 * Textures for all three acts, built once per mount. `makeCanvas` returns a
 * fresh offscreen canvas of the given size.
 */
export function createCinemaAssets(makeCanvas) {
  const plasterNoise = valueNoise(makeCanvas, 480, 300, 11, { cells: 4, octaves: 5 });
  return {
    plaster: mottle(makeCanvas, plasterNoise, { light: [255, 244, 226], dark: [52, 41, 30], strength: 0.5 }),
    travertine: travertine(makeCanvas, 360, 520, 37),
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

/* ---------- Act III: Dual Plaster Wall Sconce Wash ---------- */

function paintPanel(ctx, u, x0, x1, y0, y1) {
  const left = x0 * u;
  const right = x1 * u;
  const top = y0 * u;
  const bottom = y1 * u;
  const m = 3.4 * u;
  const field = 7.5 * u;
  // The reveal: a deep shadow gap where the panel meets the open wall.
  ctx.fillStyle = linear(ctx, right + 2 * u, 0, right + 6 * u, 0, [
    [0, 'rgba(18, 13, 9, 0.62)'],
    [1, 'rgba(18, 13, 9, 0)'],
  ]);
  ctx.fillRect(right + 2 * u, top - 40 * u, 4 * u, bottom - top + 80 * u);
  ctx.fillStyle = 'rgba(16, 11, 7, 0.7)';
  ctx.fillRect(right + 0.6 * u, top - 40 * u, 1.4 * u, bottom - top + 80 * u);
  // Molding shadow cast down and right.
  ctx.fillStyle = 'rgba(24, 18, 12, 0.22)';
  ctx.fillRect(left + 1.2 * u, top + 1.8 * u, right - left, bottom - top);
  // Molding face, then its bevels: lit top and left, shaded bottom and right.
  ctx.fillStyle = linear(ctx, left, top, right, bottom, [
    [0, '#968672'],
    [1, '#726452'],
  ]);
  ctx.fillRect(left, top, right - left, bottom - top);
  const bevel = (pts, style) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
  };
  bevel([[left, top], [right, top], [right - m, top + m], [left + m, top + m]], 'rgba(255, 240, 220, 0.2)');
  bevel([[left, top], [left + m, top + m], [left + m, bottom - m], [left, bottom]], 'rgba(255, 240, 220, 0.12)');
  bevel([[right, top], [right, bottom], [right - m, bottom - m], [right - m, top + m]], 'rgba(20, 14, 8, 0.32)');
  bevel([[left, bottom], [left + m, bottom - m], [right - m, bottom - m], [right, bottom]], 'rgba(20, 14, 8, 0.42)');
  // The recessed field.
  ctx.fillStyle = linear(ctx, 0, top + field, 0, bottom - field, [
    [0, '#7b6c59'],
    [1, '#64574a'],
  ]);
  ctx.fillRect(left + field, top + field, right - left - field * 2, bottom - top - field * 2);
  ctx.strokeStyle = 'rgba(20, 14, 8, 0.45)';
  ctx.lineWidth = 0.6 * u;
  ctx.strokeRect(left + field, top + field, right - left - field * 2, bottom - top - field * 2);
  ctx.strokeStyle = 'rgba(255, 240, 220, 0.16)';
  ctx.lineWidth = 0.4 * u;
  ctx.strokeRect(left + field + 0.8 * u, top + field + 0.8 * u, right - left - field * 2 - 1.6 * u, bottom - top - field * 2 - 1.6 * u);
}

function hyperbolicCone(ctx, x, y0, dir, u, swell, glow) {
  hyperbolicWash(ctx, x, y0, dir, { reach: 96 * u, width: 4.2 * u * swell, knee: 7.6 * u, glow, rgb: [255, 208, 150] });
}

function paintSconceBody(ctx, x, y, u, glow) {
  const hw = 4.6 * u;
  const hh = 11 * u;
  const lip = 2.2 * u;
  // Soft shadow of the shell on the plaster.
  ctx.save();
  ctx.translate(x + 1.6 * u, y + 2.4 * u);
  ctx.scale(0.55, 1);
  pool(ctx, 0, 0, 18 * u, UMBER, 0.34);
  ctx.restore();
  // Wall plate.
  ctx.fillStyle = linear(ctx, x - 1.6 * u, 0, x + 1.6 * u, 0, [
    [0, '#5e4a30'],
    [0.5, '#d9bd8a'],
    [1, '#4e3d27'],
  ]);
  ctx.fillRect(x - 1.6 * u, y - 3 * u, 3.2 * u, 6 * u);
  // The curved shell: lit on its front face, falling off round its flanks.
  ctx.beginPath();
  ctx.moveTo(x - hw, y - hh);
  ctx.quadraticCurveTo(x, y - hh - lip, x + hw, y - hh);
  ctx.lineTo(x + hw, y + hh);
  ctx.quadraticCurveTo(x, y + hh + lip, x - hw, y + hh);
  ctx.closePath();
  ctx.fillStyle = linear(ctx, x - hw, 0, x + hw, 0, [
    [0, '#9c8e7b'],
    [0.3, '#efe5d5'],
    [0.58, '#cdbfaa'],
    [1, '#7f7262'],
  ]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40, 30, 20, 0.35)';
  ctx.lineWidth = 0.3 * u;
  ctx.stroke();
  // Both openings glow: up and down light, each in a brass lip.
  for (const dir of [-1, 1]) {
    const cy = y + dir * (hh + lip * 0.4);
    ctx.beginPath();
    ctx.ellipse(x, cy, hw * 0.96, 1.25 * u, 0, 0, TAU);
    ctx.fillStyle = linear(ctx, x - hw, 0, x + hw, 0, [
      [0, '#6e5636'],
      [0.4, '#e3c792'],
      [1, '#5f4a2e'],
    ]);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x, cy, hw * 0.8, 0.85 * u, 0, 0, TAU);
    ctx.fillStyle = rgba(HOT, 0.96 * glow);
    ctx.fill();
  }
}

function paintSconce(ctx, width, height, cam, time, assets) {
  const u = unitOf(width, height);
  ctx.fillStyle = '#5d5145';
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  applyCamera(ctx, width, height, cam, u);
  const cover = coverUnits(width, height, cam, u);
  const x0 = (-cover - cam.x) * u;
  const y0 = (-cover - cam.y) * u;
  const span = cover * 2 * u;

  // Evening plaster: warm, mottled, darker toward the floor.
  ctx.fillStyle = linear(ctx, 0, -64 * u, 0, 64 * u, [
    [0, '#7d6e5c'],
    [0.5, '#6b5d4e'],
    [1, '#4a3f35'],
  ]);
  ctx.fillRect(x0, y0, span, span);
  ctx.drawImage(assets.plaster, -230 * u, -78 * u, 460 * u, 156 * u);
  // Skirting datum along the floor line.
  ctx.fillStyle = 'rgba(28, 21, 15, 0.5)';
  ctx.fillRect(x0, 60 * u, span, span);
  ctx.fillStyle = 'rgba(255, 236, 210, 0.08)';
  ctx.fillRect(x0, 60 * u, span, 0.5 * u);

  paintPanel(ctx, u, -152, -70, -56, 56);

  const swell = breathe(time, 5.6, 0.06);
  const glow = breathe(time, 4.2, 0.1);
  for (const sx of [0, 84]) {
    hyperbolicCone(ctx, sx * u, -4 * u - 11.8 * u, -1, u, swell, glow);
    hyperbolicCone(ctx, sx * u, -4 * u + 11.8 * u, 1, u, swell * 0.92, glow * 0.94);
  }
  for (const sx of [0, 84]) paintSconceBody(ctx, sx * u, -4 * u, u, glow);
  ctx.restore();
}

/* ---------- frame ---------- */

const ACT_PAINTERS = Object.freeze({ obsidian: paintObsidian, aperture: paintAperture, sconce: paintSconce });

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

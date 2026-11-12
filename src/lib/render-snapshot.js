import { clampNumber, sanitizeText } from '../security/sanitize.js';
import { objToken } from './obj-export.js';
import { CAMERA_MODE_LABELS } from './room-walkthrough.js';

/*
 * Studio render card: the live 3D frame over a specification strip, composed
 * on a 1600 x 1000 2D canvas and handed out as a PNG. The WebGL frame is read
 * in the same task it was rendered in, so the canvas needs no
 * preserveDrawingBuffer; when that read comes back blank (no WebGL, or a
 * software rasteriser that will not share its buffer) a drafted axonometric
 * of the envelope takes its place.
 */

export const SNAPSHOT_WIDTH = 1600;
export const SNAPSHOT_HEIGHT = 1000;
export const SNAPSHOT_FOOTER = 196;
export const SNAPSHOT_MIME = 'image/png';
export const SNAPSHOT_STAMP = 'LUMEN 3D SPATIAL STUDIO';

const FRAME_HEIGHT = SNAPSHOT_HEIGHT - SNAPSHOT_FOOTER;
const MARGIN = 64;
const PROJECT_MAX_CHARS = 48;
const PROBE = { width: 48, height: 30 };
// A frame counts as rendered once 1.5 percent of the probe carries paint.
const MIN_PAINTED_SHARE = 0.015;

const SANS = "'Inter Tight Variable', 'Inter Tight', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";
const INK = Object.freeze({
  ground: '#0c0b0a',
  strip: '#121110',
  hairline: 'rgba(242, 238, 231, 0.12)',
  label: '#8b8b90',
  value: '#ffffff',
  stamp: '#e5c799',
  muted: '#a1a1aa',
});

const ROOM_LIMITS = Object.freeze({ width: [100, 2000], depth: [100, 2000], height: [100, 800] });

export function snapshotFilename(projectName) {
  return `lumen-room-${objToken(projectName, 'room').toLowerCase()}.png`;
}

export function snapshotProjectName(projectName) {
  return sanitizeText(typeof projectName === 'string' ? projectName : '', { maxLength: PROJECT_MAX_CHARS }) || 'Room';
}

function roomSize(room) {
  const r = room !== null && typeof room === 'object' ? room : {};
  return {
    widthCm: Math.round(clampNumber(r.widthCm, ...ROOM_LIMITS.width, 320)),
    depthCm: Math.round(clampNumber(r.depthCm, ...ROOM_LIMITS.depth, 280)),
    heightCm: Math.round(clampNumber(r.heightCm, ...ROOM_LIMITS.height, 250)),
  };
}

/** The specification strip, as [label, value] rows. */
export function snapshotSpecRows({ room, summary, physics, cameraMode }) {
  const { widthCm, depthCm, heightCm } = roomSize(room);
  const lens = Object.hasOwn(CAMERA_MODE_LABELS, cameraMode) ? CAMERA_MODE_LABELS[cameraMode] : CAMERA_MODE_LABELS.orbit;
  const modules = Math.round(clampNumber(summary?.modules, 0, 9999, 0));
  const loadW = Math.round(clampNumber(summary?.loadW, 0, 1e6, 0));
  const lux = Math.round(clampNumber(physics?.avgFloorLux, 0, 1e6, 0));
  const rt60 = clampNumber(physics?.rt60Sec, 0, 99, 0);
  return [
    ['Room W x D x H', `${widthCm} x ${depthCm} x ${heightCm} cm`],
    ['Camera Lens', lens],
    ['Modules', String(modules).padStart(2, '0')],
    ['24V Load', `${loadW} W`],
    ['Illuminance', `${lux} lx`],
    ['RT60', `${rt60.toFixed(2)} s`],
  ];
}

/** True when the source canvas holds a rendered frame rather than a cleared buffer. */
export function hasPaintedFrame(sourceCanvas, doc = document) {
  if (!sourceCanvas || !(sourceCanvas.width > 0) || !(sourceCanvas.height > 0)) return false;
  try {
    const probe = doc.createElement('canvas');
    probe.width = PROBE.width;
    probe.height = PROBE.height;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(sourceCanvas, 0, 0, PROBE.width, PROBE.height);
    const { data } = ctx.getImageData(0, 0, PROBE.width, PROBE.height);
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 8) painted += 1;
    return painted / (PROBE.width * PROBE.height) >= MIN_PAINTED_SHARE;
  } catch {
    return false;
  }
}

function paintGround(ctx) {
  ctx.fillStyle = INK.ground;
  ctx.fillRect(0, 0, SNAPSHOT_WIDTH, SNAPSHOT_HEIGHT);
  const glow = ctx.createRadialGradient(SNAPSHOT_WIDTH / 2, FRAME_HEIGHT * 0.42, 0, SNAPSHOT_WIDTH / 2, FRAME_HEIGHT * 0.42, SNAPSHOT_WIDTH * 0.55);
  glow.addColorStop(0, 'rgba(232, 168, 92, 0.16)');
  glow.addColorStop(0.5, 'rgba(46, 39, 32, 0.3)');
  glow.addColorStop(1, 'rgba(12, 11, 10, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SNAPSHOT_WIDTH, FRAME_HEIGHT);
}

/** Contain-fits the live frame into the image area, centred. */
function paintSourceFrame(ctx, source) {
  const scale = Math.min(SNAPSHOT_WIDTH / source.width, FRAME_HEIGHT / source.height);
  const w = source.width * scale;
  const h = source.height * scale;
  ctx.drawImage(source, (SNAPSHOT_WIDTH - w) / 2, (FRAME_HEIGHT - h) / 2, w, h);
}

/**
 * The fallback frame: the envelope as a 30 deg axonometric, two back walls
 * washed, a 50 cm floor grid and the corners inked, all fitted to the image area.
 */
function paintProceduralFrame(ctx, room) {
  const { widthCm: W, depthCm: D, heightCm: H } = roomSize(room);
  const cos = Math.cos(Math.PI / 6);
  const sin = Math.sin(Math.PI / 6);
  const iso = (x, y, z) => [(x - z) * cos, (x + z) * sin - y];
  const corners = [];
  for (const x of [0, W]) for (const y of [0, H]) for (const z of [0, D]) corners.push(iso(x, y, z));
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const scale = Math.min((SNAPSHOT_WIDTH * 0.62) / spanX, (FRAME_HEIGHT * 0.7) / spanY);
  const ox = SNAPSHOT_WIDTH / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * scale;
  const oy = FRAME_HEIGHT / 2 - ((Math.max(...ys) + Math.min(...ys)) / 2) * scale;
  const at = (x, y, z) => {
    const [px, py] = iso(x, y, z);
    return [ox + px * scale, oy + py * scale];
  };
  const polygon = (points, fill, stroke) => {
    ctx.beginPath();
    points.forEach(([x, y, z], i) => {
      const [px, py] = at(x, y, z);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  };
  const line = (a, b) => {
    ctx.beginPath();
    ctx.moveTo(...at(...a));
    ctx.lineTo(...at(...b));
    ctx.stroke();
  };

  ctx.lineWidth = 1.5;
  polygon([[0, 0, 0], [W, 0, 0], [W, 0, D], [0, 0, D]], 'rgba(58, 48, 38, 0.55)', null);
  polygon([[0, 0, 0], [W, 0, 0], [W, H, 0], [0, H, 0]], 'rgba(232, 168, 92, 0.1)', null);
  polygon([[0, 0, 0], [0, 0, D], [0, H, D], [0, H, 0]], 'rgba(232, 168, 92, 0.06)', null);

  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(242, 238, 231, 0.08)';
  for (let x = 50; x < W; x += 50) line([x, 0, 0], [x, 0, D]);
  for (let z = 50; z < D; z += 50) line([0, 0, z], [W, 0, z]);

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(242, 238, 231, 0.55)';
  line([0, 0, 0], [W, 0, 0]);
  line([0, 0, 0], [0, 0, D]);
  line([0, 0, 0], [0, H, 0]);
  line([W, 0, 0], [W, H, 0]);
  line([0, 0, D], [0, H, D]);
  line([0, H, 0], [W, H, 0]);
  line([0, H, 0], [0, H, D]);
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = 'rgba(242, 238, 231, 0.28)';
  line([W, 0, 0], [W, 0, D]);
  line([0, 0, D], [W, 0, D]);
  ctx.setLineDash([]);

  const [labelX, labelY] = at(W / 2, 0, D);
  ctx.font = `500 13px ${MONO}`;
  ctx.fillStyle = INK.muted;
  ctx.textAlign = 'center';
  ctx.fillText(`${W} x ${D} x ${H} CM`, labelX, labelY + 40);
  ctx.textAlign = 'left';
}

function paintRegistration(ctx) {
  const inset = 28;
  const arm = 18;
  ctx.strokeStyle = 'rgba(242, 238, 231, 0.32)';
  ctx.lineWidth = 1;
  const marks = [
    [inset, inset, 1, 1],
    [SNAPSHOT_WIDTH - inset, inset, -1, 1],
    [inset, FRAME_HEIGHT - inset, 1, -1],
    [SNAPSHOT_WIDTH - inset, FRAME_HEIGHT - inset, -1, -1],
  ];
  ctx.beginPath();
  for (const [x, y, dx, dy] of marks) {
    ctx.moveTo(x + 0.5, y + dy * arm + 0.5);
    ctx.lineTo(x + 0.5, y + 0.5);
    ctx.lineTo(x + dx * arm + 0.5, y + 0.5);
  }
  ctx.stroke();
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}...`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}...`;
}

function paintStrip(ctx, { name, rows, lens }) {
  ctx.fillStyle = INK.strip;
  ctx.fillRect(0, FRAME_HEIGHT, SNAPSHOT_WIDTH, SNAPSHOT_FOOTER);
  ctx.fillStyle = INK.hairline;
  ctx.fillRect(0, FRAME_HEIGHT, SNAPSHOT_WIDTH, 1);

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `500 13px ${MONO}`;
  ctx.fillStyle = INK.stamp;
  ctx.letterSpacing = '2px';
  ctx.fillText(SNAPSHOT_STAMP, MARGIN, FRAME_HEIGHT + 58);
  ctx.letterSpacing = '0px';

  ctx.font = `600 40px ${SANS}`;
  ctx.fillStyle = INK.value;
  ctx.fillText(fitText(ctx, name, 520), MARGIN, FRAME_HEIGHT + 112);

  ctx.font = `500 13px ${MONO}`;
  ctx.fillStyle = INK.label;
  ctx.fillText(`STUDIO RENDER / ${lens.toUpperCase()}`, MARGIN, FRAME_HEIGHT + 148);

  const gridX = 680;
  const colW = (SNAPSHOT_WIDTH - MARGIN - gridX) / 3;
  rows.forEach(([label, value], i) => {
    const x = gridX + (i % 3) * colW;
    const y = FRAME_HEIGHT + 52 + Math.floor(i / 3) * 76;
    ctx.fillStyle = INK.hairline;
    ctx.fillRect(x, y - 24, colW - 24, 1);
    ctx.font = `500 12px ${MONO}`;
    ctx.fillStyle = INK.label;
    ctx.fillText(label.toUpperCase(), x, y);
    ctx.font = `600 24px ${SANS}`;
    ctx.fillStyle = INK.value;
    ctx.fillText(fitText(ctx, value, colW - 32), x, y + 32);
  });
}

/**
 * Composes the studio render card. Returns the 1600 x 1000 canvas; its
 * `data-frame` reads `webgl` when the live frame was used and `procedural`
 * when the drafted fallback stood in.
 */
export function composeRoomSnapshotCanvas({ sourceCanvas, projectName, room, summary, physics, cameraMode, doc = document }) {
  const canvas = doc.createElement('canvas');
  canvas.width = SNAPSHOT_WIDTH;
  canvas.height = SNAPSHOT_HEIGHT;
  const ctx = canvas.getContext('2d');
  const rows = snapshotSpecRows({ room, summary, physics, cameraMode });
  const live = hasPaintedFrame(sourceCanvas, doc);

  paintGround(ctx);
  if (live) paintSourceFrame(ctx, sourceCanvas);
  else paintProceduralFrame(ctx, room);
  paintRegistration(ctx);
  paintStrip(ctx, { name: snapshotProjectName(projectName), rows, lens: rows[1][1] });

  canvas.dataset.frame = live ? 'webgl' : 'procedural';
  return canvas;
}

/** PNG bytes of a composed card. */
export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encode failed'))), SNAPSHOT_MIME);
  });
}

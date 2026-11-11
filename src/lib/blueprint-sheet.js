import { getFinish, getProduct } from '../data/products.js';
import { sanitizeText } from '../security/sanitize.js';
import { computeBusTopology, formatBusTelemetry } from './bus-topology.js';
import { PROJECT_NAME_MAX, PROJECT_NAMES } from './project-library.js';
import { anchorPoints, DEFAULT_WALL, SLOPE_CM, summarizeWall } from './wall-studio.js';

export const BLUEPRINT_ISSUER = Object.freeze({
  name: 'Lumen Spatial Studio Kft.',
  address: '1052 Budapest, Fenyiv utca 14, Hungary',
});
export const DRAWING_NUMBER = 'LMN-BP-01';
export const BLUEPRINT_SCALE = 20;
export const BLUEPRINT_SCALE_LABEL = '1:20';
export const SVG_MIME = 'image/svg+xml';

// ISO 5457 A3 landscape, in paper millimetres. At 1:20 one wall centimetre
// is half a paper millimetre.
export const PAPER = Object.freeze({ widthMm: 420, heightMm: 297 });
export const MM_PER_CM = 10 / BLUEPRINT_SCALE;
const FRAME = Object.freeze({ x: 20, y: 10, w: 390, h: 277 });
const COLUMN_X = 290;
const TITLE_BLOCK = Object.freeze({ x: COLUMN_X, y: 225, w: FRAME.x + FRAME.w - COLUMN_X, h: 62 });
const SCHEDULE = Object.freeze({ x: COLUMN_X, y: FRAME.y, w: TITLE_BLOCK.w, h: TITLE_BLOCK.y - FRAME.y });
const DRAWING = Object.freeze({ x: FRAME.x + 30, y: FRAME.y + 22, w: COLUMN_X - FRAME.x - 44, h: 210 });
const SCHEDULE_HEAD_MM = 13;
const SCHEDULE_ROW_MM = 3.6;
export const SCHEDULE_ROWS = Math.floor((SCHEDULE.h - SCHEDULE_HEAD_MM - 2) / SCHEDULE_ROW_MM);

const REVISION_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,5}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MIN_CHAIN_LABEL_MM = 5;

// Fixing hardware per catalog shape, matched to the load each part puts on the substrate.
const HARDWARE = Object.freeze({
  shelf: 'M8 x 100 cleat anchor',
  cube: 'M8 x 80 frame anchor',
  sideboard: 'M10 x 100 frame anchor',
  lightbar: 'M5 x 40 nylon plug',
  column: 'M6 x 60 tip restraint',
  spot: 'M6 x 60 ceiling anchor',
  frame: 'M6 x 50 Z-clip plug',
  track: 'M5 x 40 plaster-in clip',
  pendant: 'M8 ceiling hook anchor',
  baffle: 'M6 x 50 Z-clip plug',
  sconce: 'M6 x 60 nylon plug',
  hub: 'M5 x 40 flush box screw',
});
const DEFAULT_HARDWARE = 'M6 x 60 nylon plug';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function round(value, places = 1) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function uidRank(uid) {
  const n = Number(String(uid).slice(1));
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function cleanRevision(value) {
  const token = sanitizeText(typeof value === 'string' ? value : '', { maxLength: 6 }).toUpperCase();
  return REVISION_PATTERN.test(token) ? token : 'A';
}

function cleanDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return todayIso();
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? todayIso() : value;
}

function cleanWall(input) {
  const wall = isRecord(input) ? input : {};
  const dim = (value, fallback) => (isFiniteNumber(value) && value > 0 && value <= 2000 ? value : fallback);
  return {
    widthCm: dim(wall.widthCm, DEFAULT_WALL.widthCm),
    heightCm: dim(wall.heightCm, DEFAULT_WALL.heightCm),
    slope: wall.slope === true,
  };
}

/** Wall boundary, counter-clockwise from the datum. The slope trims the top-right corner. */
function wallOutline({ widthCm: w, heightCm: h, slope }) {
  if (!slope) {
    return [
      { xCm: 0, yCm: 0 },
      { xCm: w, yCm: 0 },
      { xCm: w, yCm: h },
      { xCm: 0, yCm: h },
    ];
  }
  return [
    { xCm: 0, yCm: 0 },
    { xCm: w, yCm: 0 },
    { xCm: w, yCm: h - SLOPE_CM },
    { xCm: w - SLOPE_CM, yCm: h },
    { xCm: 0, yCm: h },
  ];
}

/** Running dimension chain: every distinct module edge between the two wall faces. */
function chain(edges, total) {
  const stops = [...new Set([0, total, ...edges.map((v) => round(Math.min(total, Math.max(0, v))))])].sort(
    (a, b) => a - b,
  );
  const spans = [];
  for (let i = 1; i < stops.length; i += 1) {
    spans.push({ fromCm: stops[i - 1], toCm: stops[i], valueCm: round(stops[i] - stops[i - 1]) });
  }
  return spans;
}

function sheetFrame(wall) {
  const wMm = wall.widthCm * MM_PER_CM;
  const hMm = wall.heightCm * MM_PER_CM;
  const fit = Math.min(1, DRAWING.w / wMm, DRAWING.h / hMm);
  const mmPerCm = MM_PER_CM * fit;
  const drawnW = wall.widthCm * mmPerCm;
  const drawnH = wall.heightCm * mmPerCm;
  return {
    widthMm: PAPER.widthMm,
    heightMm: PAPER.heightMm,
    frame: FRAME,
    drawing: DRAWING,
    schedule: SCHEDULE,
    titleBlock: TITLE_BLOCK,
    mmPerCm,
    // Paper position of the wall datum (bottom-left corner at FFL).
    origin: {
      xMm: round(DRAWING.x + (DRAWING.w - drawnW) / 2, 2),
      yMm: round(DRAWING.y + (DRAWING.h - drawnH) / 2 + drawnH, 2),
    },
  };
}

/** Wall centimetres to paper millimetres on the compiled sheet (y down on paper). */
export function toPaper(sheet, xCm, yCm) {
  const { origin, mmPerCm } = sheet.paper;
  return { xMm: origin.xMm + xCm * mmPerCm, yMm: origin.yMm - yCm * mmPerCm };
}

/** Paper millimetres back to model centimetres, so sheet furniture lands in the DXF at true size. */
export function paperToModel(sheet, xMm, yMm) {
  const { origin, mmPerCm } = sheet.paper;
  const cmPerMm = 1 / mmPerCm;
  return { xCm: round((xMm - origin.xMm) * cmPerMm, 3), yCm: round((origin.yMm - yMm) * cmPerMm, 3) };
}

/** One-line project name, length-capped, falling back to the wall default. */
export function cleanProjectName(value) {
  return sanitizeText(typeof value === 'string' ? value : '', { maxLength: PROJECT_NAME_MAX }) || PROJECT_NAMES.wall;
}

export function projectSlug(projectName) {
  const slug = cleanProjectName(projectName)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || 'wall';
}

export function blueprintFilename(projectName, extension) {
  return `${projectSlug(projectName)}-blueprint.${extension === 'dxf' ? 'dxf' : 'svg'}`;
}

export function hardwareFor(product) {
  return HARDWARE[product.shape] ?? DEFAULT_HARDWARE;
}

/**
 * Deterministic drawing model for a wall layout ({ wall, items }). Modules are
 * numbered in reading order (left to right, then bottom to top, then uid);
 * anchors follow their module and run left to right, then bottom to top.
 * Every coordinate is absolute wall cm from the bottom-left datum at FFL.
 */
export function compileBlueprintSheet(layout, options = {}) {
  const opts = isRecord(options) ? options : {};
  const wall = cleanWall(layout?.wall);
  const rawItems = Array.isArray(layout?.items) ? layout.items : [];

  const placed = [];
  for (const item of rawItems) {
    if (!isRecord(item) || !isFiniteNumber(item.xCm) || !isFiniteNumber(item.yCm)) continue;
    const product = getProduct(item.productId);
    if (!product) continue;
    placed.push({ item, product });
  }
  placed.sort(
    (a, b) =>
      a.item.xCm - b.item.xCm || a.item.yCm - b.item.yCm || uidRank(a.item.uid) - uidRank(b.item.uid),
  );

  const modules = placed.map(({ item, product }, i) => ({
    index: `M${pad2(i + 1)}`,
    uid: typeof item.uid === 'string' ? item.uid : `m${i + 1}`,
    productId: product.id,
    sku: product.sku,
    name: product.name,
    mount: product.mount,
    finish: getFinish(item.finish)?.label ?? getFinish(product.defaultFinish)?.label ?? '',
    xCm: round(item.xCm),
    yCm: round(item.yCm),
    w: product.dimsCm.w,
    h: product.dimsCm.h,
    watts: product.watts,
    lit: product.watts > 0 && item.led !== false,
  }));

  const anchors = [];
  placed.forEach(({ item, product }, i) => {
    const points = anchorPoints({ ...item, productId: product.id })
      .slice()
      .sort((a, b) => a.xCm - b.xCm || a.yCm - b.yCm);
    for (const point of points) {
      anchors.push({
        anchorId: '',
        moduleIndex: modules[i].index,
        uid: modules[i].uid,
        sku: product.sku,
        xCm: point.xCm,
        yCm: point.yCm,
        surface: product.mount === 'ceiling' ? 'ceiling' : 'wall',
        hardware: hardwareFor(product),
      });
    }
  });
  anchors.forEach((anchor, i) => {
    anchor.anchorId = `A${pad2(i + 1)}`;
  });

  const topologyInput = { wall, items: placed.map(({ item }) => item) };
  const topology = computeBusTopology(topologyInput);
  const summary = summarizeWall({ wall, items: placed.map(({ item, product }) => ({ ...item, productId: product.id })) });

  const projectName = cleanProjectName(opts.projectName);
  const revision = cleanRevision(opts.revision);
  const dateIso = cleanDate(opts.dateIso);

  const dimensions = {
    width: { axis: 'x', fromCm: 0, toCm: wall.widthCm, valueCm: wall.widthCm },
    height: { axis: 'y', fromCm: 0, toCm: wall.heightCm, valueCm: wall.heightCm },
    chainX: chain(
      modules.flatMap((m) => [m.xCm, m.xCm + m.w]),
      wall.widthCm,
    ),
    chainY: chain(
      modules.flatMap((m) => [m.yCm, m.yCm + m.h]),
      wall.heightCm,
    ),
    slope: wall.slope ? { runCm: SLOPE_CM, riseCm: SLOPE_CM } : null,
  };

  const sheet = {
    format: 'lumen.blueprint',
    version: 1,
    scale: BLUEPRINT_SCALE,
    scaleLabel: BLUEPRINT_SCALE_LABEL,
    units: 'cm',
    datum: 'Bottom-left wall corner at FFL',
    wall: {
      ...wall,
      outline: wallOutline(wall),
      slopeCut: wall.slope
        ? { x1: wall.widthCm - SLOPE_CM, y1: wall.heightCm, x2: wall.widthCm, y2: wall.heightCm - SLOPE_CM }
        : null,
    },
    dimensions,
    modules,
    anchors,
    bus: {
      origin: { xCm: topology.origin.xCm, yCm: topology.origin.yCm, kind: topology.origin.kind, label: 'PSU 24V FEED' },
      segments: topology.segments.map((s) => ({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, order: s.order })),
      nodes: topology.nodes.map((n) => ({ label: n.label, uid: n.uid, xCm: n.xCm, yCm: n.yCm, watts: n.watts })),
      totalRunM: topology.totalRunM,
      currentA: topology.currentA,
      voltageDropV: topology.voltageDropV,
      voltageDropPct: topology.voltageDropPct,
      withinSpec: topology.withinSpec,
      limitPct: topology.limitPct,
      conductor: topology.conductor,
      busVoltage: topology.busVoltage,
      activeWatts: topology.activeWatts,
      telemetry: formatBusTelemetry(topology),
    },
    titleBlock: {
      issuer: BLUEPRINT_ISSUER.name,
      address: BLUEPRINT_ISSUER.address,
      projectName,
      drawingNumber: DRAWING_NUMBER,
      title: 'Wall elevation - installation and drilling',
      scale: BLUEPRINT_SCALE_LABEL,
      revision,
      dateIso,
      sheet: '1/1',
      paper: 'ISO A3',
      moduleCount: modules.length,
      anchorCount: anchors.length,
      loadW: summary.loadW,
      psu: summary.psu.label,
    },
  };
  sheet.paper = sheetFrame(wall);
  return sheet;
}

/* SVG */

const INK = '#e8e4dc';
const LINE = '#b8b8b8';
const MUTED = '#7c7c80';
const AMBER = '#e8923a';
const PAPER_FILL = '#0d0c0b';
const MODULE_FILL = '#1a1916';
const FONT = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace";

// XML 1.0 forbids C0 controls other than tab, LF and CR, and the two non-characters.
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\ufffe\uffff]/g;
const XML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

export function escapeXml(value) {
  return String(value ?? '')
    .replace(XML_INVALID, '')
    .replace(/[&<>"']/g, (ch) => XML_ENTITIES[ch]);
}

function n(value) {
  return isFiniteNumber(value) ? String(round(value, 2)) : '0';
}

function cm(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function text(x, y, body, { size = 1.8, fill = LINE, anchor = 'start', weight, rotate, spacing } = {}) {
  const attrs = [`x="${n(x)}"`, `y="${n(y)}"`, `font-size="${n(size)}"`, `fill="${fill}"`];
  if (anchor !== 'start') attrs.push(`text-anchor="${anchor}"`);
  if (weight) attrs.push(`font-weight="${weight}"`);
  if (spacing) attrs.push(`letter-spacing="${spacing}"`);
  if (rotate) attrs.push(`transform="rotate(${rotate} ${n(x)} ${n(y)})"`);
  return `<text ${attrs.join(' ')}>${escapeXml(body)}</text>`;
}

function line(x1, y1, x2, y2, stroke = LINE, width = 0.18, extra = '') {
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${stroke}" stroke-width="${n(width)}"${extra}/>`;
}

function rect(x, y, w, h, { stroke = LINE, width = 0.18, fill = 'none' } = {}) {
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${fill}" stroke="${stroke}" stroke-width="${n(width)}"/>`;
}

/** Architectural tick: a 45 degree slash through the dimension line at each witness. */
function tick(x, y) {
  return line(x - 0.9, y + 0.9, x + 0.9, y - 0.9, INK, 0.25);
}

function horizontalDim(x1, x2, y, label, witnessFrom) {
  const out = [line(x1, y, x2, y, LINE, 0.13)];
  if (witnessFrom !== undefined) {
    out.push(line(x1, witnessFrom + 1, x1, y + 1.2, MUTED, 0.1), line(x2, witnessFrom + 1, x2, y + 1.2, MUTED, 0.1));
  }
  out.push(tick(x1, y), tick(x2, y));
  if (label) out.push(text((x1 + x2) / 2, y - 0.8, label, { size: 1.8, fill: INK, anchor: 'middle' }));
  return out.join('');
}

function verticalDim(x, y1, y2, label, witnessFrom) {
  const out = [line(x, y1, x, y2, LINE, 0.13)];
  if (witnessFrom !== undefined) {
    out.push(line(witnessFrom - 1, y1, x - 1.2, y1, MUTED, 0.1), line(witnessFrom - 1, y2, x - 1.2, y2, MUTED, 0.1));
  }
  out.push(tick(x, y1), tick(x, y2));
  if (label) out.push(text(x - 0.8, (y1 + y2) / 2, label, { size: 1.8, fill: INK, anchor: 'middle', rotate: -90 }));
  return out.join('');
}

function drawWall(sheet) {
  const pts = sheet.wall.outline.map((p) => toPaper(sheet, p.xCm, p.yCm));
  const path = pts.map((p) => `${n(p.xMm)},${n(p.yMm)}`).join(' ');
  const out = [`<polygon points="${path}" fill="none" stroke="${INK}" stroke-width="0.5"/>`];
  const floorL = toPaper(sheet, 0, 0);
  const floorR = toPaper(sheet, sheet.wall.widthCm, 0);
  out.push(line(floorL.xMm - 6, floorL.yMm, floorR.xMm + 6, floorR.yMm, INK, 0.35));
  for (let x = floorL.xMm - 6; x < floorR.xMm + 6; x += 2.5) {
    out.push(line(x, floorL.yMm + 1.6, x + 1.6, floorL.yMm, MUTED, 0.1));
  }
  out.push(text(floorR.xMm + 7, floorR.yMm + 0.6, 'FFL +0', { size: 1.6, fill: MUTED }));
  out.push(text(floorL.xMm + 1, floorL.yMm - 1.2, 'DATUM 0,0', { size: 1.4, fill: MUTED }));

  if (sheet.wall.slopeCut) {
    const { x1, y1, x2, y2 } = sheet.wall.slopeCut;
    const a = toPaper(sheet, x1, y1);
    const b = toPaper(sheet, x2, y2);
    const corner = toPaper(sheet, sheet.wall.widthCm, sheet.wall.heightCm);
    out.push(line(a.xMm, a.yMm, corner.xMm, corner.yMm, MUTED, 0.12, ' stroke-dasharray="0.8 0.8"'));
    out.push(line(corner.xMm, corner.yMm, b.xMm, b.yMm, MUTED, 0.12, ' stroke-dasharray="0.8 0.8"'));
    out.push(
      text((a.xMm + b.xMm) / 2 - 1, (a.yMm + b.yMm) / 2 - 1, `SLOPE ${SLOPE_CM} x ${SLOPE_CM}`, {
        size: 1.6,
        fill: MUTED,
        anchor: 'end',
      }),
    );
  }
  return `<g id="wall">${out.join('')}</g>`;
}

function drawDimensions(sheet) {
  const { dimensions, wall } = sheet;
  const bl = toPaper(sheet, 0, 0);
  const tr = toPaper(sheet, wall.widthCm, wall.heightCm);
  const scale = sheet.paper.mmPerCm;
  const out = [];

  const chainY = bl.yMm + 7;
  for (const span of dimensions.chainX) {
    const a = toPaper(sheet, span.fromCm, 0).xMm;
    const b = toPaper(sheet, span.toCm, 0).xMm;
    out.push(horizontalDim(a, b, chainY, span.valueCm * scale >= MIN_CHAIN_LABEL_MM ? cm(span.valueCm) : '', bl.yMm));
  }
  out.push(horizontalDim(bl.xMm, tr.xMm, bl.yMm + 14, `${cm(wall.widthCm)} OVERALL`, bl.yMm));

  const chainX = bl.xMm - 7;
  for (const span of dimensions.chainY) {
    const a = toPaper(sheet, 0, span.fromCm).yMm;
    const b = toPaper(sheet, 0, span.toCm).yMm;
    out.push(verticalDim(chainX, a, b, span.valueCm * scale >= MIN_CHAIN_LABEL_MM ? cm(span.valueCm) : '', bl.xMm));
  }
  out.push(verticalDim(bl.xMm - 14, bl.yMm, tr.yMm, `${cm(wall.heightCm)} OVERALL`, bl.xMm));
  return `<g id="dimensions">${out.join('')}</g>`;
}

function drawModules(sheet) {
  const out = sheet.modules.map((m) => {
    const p = toPaper(sheet, m.xCm, m.yCm + m.h);
    const w = m.w * sheet.paper.mmPerCm;
    const h = m.h * sheet.paper.mmPerCm;
    const labelY = h >= 3 ? p.yMm + Math.min(h / 2, 2.4) + 0.6 : p.yMm - 0.8;
    return [
      `<g data-module="${escapeXml(m.index)}">`,
      rect(p.xMm, p.yMm, w, h, { stroke: INK, width: 0.25, fill: MODULE_FILL }),
      text(p.xMm + w / 2, labelY, m.index, { size: 1.6, fill: INK, anchor: 'middle', weight: 600 }),
      w >= 18 && h >= 6 ? text(p.xMm + w / 2, labelY + 2, m.sku, { size: 1.2, fill: MUTED, anchor: 'middle' }) : '',
      '</g>',
    ].join('');
  });
  return `<g id="modules">${out.join('')}</g>`;
}

function drawBus(sheet) {
  const { bus } = sheet;
  const out = bus.segments.map((s) => {
    const a = toPaper(sheet, s.x1, s.y1);
    const b = toPaper(sheet, s.x2, s.y2);
    return line(a.xMm, a.yMm, b.xMm, b.yMm, AMBER, 0.3, ' stroke-dasharray="1.6 0.8"');
  });
  const o = toPaper(sheet, bus.origin.xCm, bus.origin.yCm);
  out.push(rect(o.xMm - 1.1, o.yMm - 1.1, 2.2, 2.2, { stroke: AMBER, width: 0.3, fill: PAPER_FILL }));
  out.push(text(o.xMm + 1.8, o.yMm + 3.2, bus.origin.label, { size: 1.4, fill: AMBER, weight: 600 }));
  for (const node of bus.nodes) {
    const p = toPaper(sheet, node.xCm, node.yCm);
    out.push(rect(p.xMm - 0.5, p.yMm - 0.5, 1, 1, { stroke: AMBER, width: 0.15, fill: AMBER }));
  }
  return `<g id="bus-24v">${out.join('')}</g>`;
}

function drawAnchors(sheet) {
  const out = sheet.anchors.map((a) => {
    const p = toPaper(sheet, a.xCm, a.yCm);
    return [
      `<g data-anchor="${escapeXml(a.anchorId)}">`,
      `<circle cx="${n(p.xMm)}" cy="${n(p.yMm)}" r="0.85" fill="none" stroke="${AMBER}" stroke-width="0.18"/>`,
      line(p.xMm - 1.6, p.yMm, p.xMm + 1.6, p.yMm, AMBER, 0.12),
      line(p.xMm, p.yMm - 1.6, p.xMm, p.yMm + 1.6, AMBER, 0.12),
      text(p.xMm + 1.1, p.yMm - 1.1, a.anchorId, { size: 1.2, fill: AMBER }),
      '</g>',
    ].join('');
  });
  return `<g id="anchors">${out.join('')}</g>`;
}

function drawNotes(sheet) {
  const { bus } = sheet;
  const x = FRAME.x + 6;
  const y = FRAME.y + FRAME.h - 16;
  const status = bus.withinSpec ? `WITHIN ${bus.limitPct}% LIMIT` : `EXCEEDS ${bus.limitPct}% LIMIT`;
  return [
    '<g id="notes">',
    text(FRAME.x + 6, FRAME.y + 9, `ELEVATION A - ${sheet.scaleLabel}`, { size: 3.2, fill: INK, weight: 600, spacing: '0.1' }),
    text(FRAME.x + 6, FRAME.y + 13, `WALL ${cm(sheet.wall.widthCm)} x ${cm(sheet.wall.heightCm)} CM${sheet.wall.slope ? ' / ATTIC SLOPE' : ''}`, {
      size: 1.8,
      fill: MUTED,
    }),
    text(x, y, `24V BUS  ${bus.telemetry.toUpperCase()}  ${bus.conductor.toUpperCase()}  ${status}`, { size: 1.6, fill: AMBER }),
    text(x, y + 3.6, 'ALL DIMENSIONS IN CM. DATUM: BOTTOM-LEFT WALL CORNER AT FFL.', { size: 1.6, fill: LINE }),
    text(x, y + 7.2, 'VERIFY SERVICES AND SUBSTRATE ON SITE BEFORE DRILLING. DO NOT SCALE FROM PRINT.', { size: 1.6, fill: MUTED }),
    '</g>',
  ].join('');
}

const SCHEDULE_COLUMNS = Object.freeze([
  { key: 'anchorId', label: 'ID', w: 11 },
  { key: 'moduleIndex', label: 'MOD', w: 11 },
  { key: 'sku', label: 'SKU', w: 22 },
  { key: 'xCm', label: 'X CM', w: 15, align: 'end' },
  { key: 'yCm', label: 'Y CM', w: 15, align: 'end' },
  { key: 'hardware', label: 'FIXING', w: 46 },
]);

function drawSchedule(sheet) {
  const { x, y, w } = SCHEDULE;
  const out = [rect(x, y, w, SCHEDULE.h, { stroke: INK, width: 0.35 })];
  out.push(text(x + 3, y + 6, 'DRILLING AND ANCHOR SCHEDULE', { size: 2.4, fill: INK, weight: 600, spacing: '0.08' }));
  out.push(line(x, y + 8.5, x + w, y + 8.5, LINE, 0.15));

  const colX = [];
  let cursor = x + 2;
  for (const col of SCHEDULE_COLUMNS) {
    colX.push(cursor);
    cursor += col.w;
  }
  const cell = (i, rowY, value, fill) => {
    const col = SCHEDULE_COLUMNS[i];
    const cx = col.align === 'end' ? colX[i] + col.w - 3 : colX[i];
    return text(cx, rowY, value, { size: 1.6, fill, anchor: col.align === 'end' ? 'end' : 'start' });
  };
  SCHEDULE_COLUMNS.forEach((col, i) => out.push(cell(i, y + 11.6, col.label, MUTED)));
  out.push(line(x, y + SCHEDULE_HEAD_MM, x + w, y + SCHEDULE_HEAD_MM, LINE, 0.15));

  const overflow = sheet.anchors.length > SCHEDULE_ROWS;
  const shown = overflow ? sheet.anchors.slice(0, SCHEDULE_ROWS - 1) : sheet.anchors;
  shown.forEach((a, row) => {
    const rowY = y + SCHEDULE_HEAD_MM + (row + 1) * SCHEDULE_ROW_MM - 0.9;
    SCHEDULE_COLUMNS.forEach((col, i) => {
      const value = col.key === 'xCm' || col.key === 'yCm' ? a[col.key].toFixed(1) : a[col.key];
      out.push(cell(i, rowY, value, i === 0 ? AMBER : LINE));
    });
  });
  if (overflow) {
    const rowY = y + SCHEDULE_HEAD_MM + SCHEDULE_ROWS * SCHEDULE_ROW_MM - 0.9;
    const rest = sheet.anchors.length - shown.length;
    out.push(text(x + 2, rowY, `+ ${rest} FURTHER ANCHORS - FULL SCHEDULE IN ${DRAWING_NUMBER}.DXF`, { size: 1.6, fill: MUTED }));
  }
  if (sheet.anchors.length === 0) {
    out.push(text(x + 2, y + SCHEDULE_HEAD_MM + SCHEDULE_ROW_MM - 0.9, 'NO MODULES MOUNTED', { size: 1.6, fill: MUTED }));
  }
  return `<g id="drilling-schedule">${out.join('')}</g>`;
}

/** ISO 7200 data fields: identification zone at the bottom, issuer at the top. */
function titleBlockRows(sheet) {
  const t = sheet.titleBlock;
  return [
    { h: 12, cells: [{ label: 'LEGAL OWNER', value: t.issuer, sub: t.address, size: 2.6 }] },
    { h: 11, cells: [{ label: 'TITLE', value: t.projectName, sub: t.title.toUpperCase(), size: 3 }] },
    {
      h: 9,
      cells: [
        { label: 'DRAWING NO.', value: t.drawingNumber, w: 36 },
        { label: 'REV', value: t.revision, w: 14 },
        { label: 'SCALE', value: t.scale, w: 20 },
        { label: 'DATE OF ISSUE', value: t.dateIso, w: 30 },
        { label: 'SHEET', value: t.sheet },
      ],
    },
    {
      h: 9,
      cells: [
        { label: 'MODULES', value: String(t.moduleCount), w: 25 },
        { label: 'ANCHORS', value: String(t.anchorCount), w: 25 },
        { label: '24V LOAD', value: `${t.loadW} W`, w: 25 },
        { label: 'PAPER', value: t.paper },
      ],
    },
    { h: 11, cells: [{ label: 'RECOMMENDED PSU DRIVER', value: t.psu, sub: `${sheet.bus.conductor} / SELV 24V DC` }] },
    { h: 10, cells: [{ label: 'STANDARDS', value: 'ISO 7200 / ISO 5457 / ISO 128', sub: 'UNITS CM / FIRST ANGLE' }] },
  ];
}

function drawTitleBlock(sheet) {
  const { x, y, w, h } = TITLE_BLOCK;
  const out = [rect(x, y, w, h, { stroke: INK, width: 0.5 })];
  let rowY = y;
  for (const row of titleBlockRows(sheet)) {
    if (rowY > y) out.push(line(x, rowY, x + w, rowY, LINE, 0.15));
    let cellX = x;
    row.cells.forEach((c, i) => {
      const cw = c.w ?? x + w - cellX;
      if (i > 0) out.push(line(cellX, rowY, cellX, rowY + row.h, LINE, 0.15));
      out.push(text(cellX + 1.5, rowY + 2.6, c.label, { size: 1.3, fill: MUTED, spacing: '0.06' }));
      out.push(text(cellX + 1.5, rowY + (c.sub ? 6.2 : 6.6), c.value, { size: c.size ?? 2, fill: INK, weight: 600 }));
      if (c.sub) out.push(text(cellX + 1.5, rowY + row.h - 1.6, c.sub, { size: 1.4, fill: LINE }));
      cellX += cw;
    });
    rowY += row.h;
  }
  return `<g id="title-block">${out.join('')}</g>`;
}

/** Self-contained A3 sheet. Every text node and attribute value from the model is XML-escaped. */
export function buildBlueprintSvg(sheet) {
  const t = sheet.titleBlock;
  const title = `${t.projectName} - ${t.drawingNumber} rev ${t.revision} - ${t.scale}`;
  const desc =
    `Wall elevation ${cm(sheet.wall.widthCm)} x ${cm(sheet.wall.heightCm)} cm at ${t.scale}, ` +
    `${t.moduleCount} modules, ${t.anchorCount} drilling anchors, 24V bus ${sheet.bus.totalRunM} m. ` +
    `Issued by ${t.issuer}, ${t.address}.`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAPER.widthMm} ${PAPER.heightMm}" width="${PAPER.widthMm}mm" height="${PAPER.heightMm}mm" role="img" aria-labelledby="lumen-bp-title lumen-bp-desc" font-family="${escapeXml(FONT)}">`,
    `<title id="lumen-bp-title">${escapeXml(title)}</title>`,
    `<desc id="lumen-bp-desc">${escapeXml(desc)}</desc>`,
    `<rect x="0" y="0" width="${PAPER.widthMm}" height="${PAPER.heightMm}" fill="${PAPER_FILL}"/>`,
    rect(FRAME.x, FRAME.y, FRAME.w, FRAME.h, { stroke: INK, width: 0.5 }),
    drawWall(sheet),
    drawDimensions(sheet),
    drawModules(sheet),
    drawBus(sheet),
    drawAnchors(sheet),
    drawNotes(sheet),
    drawSchedule(sheet),
    drawTitleBlock(sheet),
    '</svg>\n',
  ].join('');
}

/** Same sheet without the XML prolog, for inline preview in the document. */
export function buildBlueprintSvgMarkup(sheet) {
  return buildBlueprintSvg(sheet).replace(/^<\?xml[^>]*\?>\n/, '');
}

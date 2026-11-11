import { DRAWING_NUMBER, paperToModel } from './blueprint-sheet.js';

export const DXF_MIME = 'application/dxf';

// AutoCAD Color Index: 7 white/black, 8 dark grey, 9 light grey, 30 amber, 40 orange.
export const DXF_LAYERS = Object.freeze([
  Object.freeze({ name: 'LUMEN_WALL', color: 7, linetype: 'CONTINUOUS' }),
  Object.freeze({ name: 'LUMEN_MODULES', color: 9, linetype: 'CONTINUOUS' }),
  Object.freeze({ name: 'LUMEN_ANCHORS', color: 30, linetype: 'CONTINUOUS' }),
  Object.freeze({ name: 'LUMEN_24V_BUS', color: 40, linetype: 'DASHED' }),
  Object.freeze({ name: 'LUMEN_DIMS', color: 8, linetype: 'CONTINUOUS' }),
  Object.freeze({ name: 'LUMEN_TITLEBLOCK', color: 7, linetype: 'CONTINUOUS' }),
]);

const ANCHOR_RADIUS_CM = 1.5;
const CROSS_CM = 3;
const TEXT_CM = 2.5;

/**
 * Collapses any string to one printable ASCII line. With no CR or LF left a
 * value can never close its group and smuggle in a group code; "%%" control
 * sequences and caret escapes are neutralised so labels render literally.
 */
export function dxfText(value, maxLength = 120) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]+/g, ' ')
    .replace(/%%/g, '%')
    .replace(/\^/g, '^ ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function num(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0.0';
  const fixed = (Math.round(value * 10000) / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0');
  return fixed === '-0.0' ? '0.0' : fixed;
}

function createWriter() {
  const lines = [];
  const pair = (code, value) => {
    lines.push(String(code).padStart(3, ' '), String(value));
  };
  return { lines, pair };
}

/**
 * ASCII DXF, AutoCAD R12 (AC1009). One model unit is one centimetre, origin at
 * the bottom-left wall datum on FFL, y up. Sheet furniture (border, schedule,
 * title block) is placed at true size, so plotting the model at 1:20 on A3
 * reproduces the SVG sheet.
 */
export function buildBlueprintDxf(sheet) {
  const { lines, pair } = createWriter();

  const lineEntity = (layer, x1, y1, x2, y2) => {
    pair(0, 'LINE');
    pair(8, layer);
    pair(10, num(x1));
    pair(20, num(y1));
    pair(30, '0.0');
    pair(11, num(x2));
    pair(21, num(y2));
    pair(31, '0.0');
  };
  const circle = (layer, x, y, r) => {
    pair(0, 'CIRCLE');
    pair(8, layer);
    pair(10, num(x));
    pair(20, num(y));
    pair(30, '0.0');
    pair(40, num(r));
  };
  const textEntity = (layer, x, y, height, value, rotation = 0) => {
    const body = dxfText(value);
    if (!body) return;
    pair(0, 'TEXT');
    pair(8, layer);
    pair(10, num(x));
    pair(20, num(y));
    pair(30, '0.0');
    pair(40, num(height));
    pair(1, body);
    if (rotation) pair(50, num(rotation));
  };
  const box = (layer, x, y, w, h) => {
    lineEntity(layer, x, y, x + w, y);
    lineEntity(layer, x + w, y, x + w, y + h);
    lineEntity(layer, x + w, y + h, x, y + h);
    lineEntity(layer, x, y + h, x, y);
  };
  // Sheet furniture is laid out in paper mm; convert to model cm about the datum.
  const paperBox = (layer, rect) => {
    const a = paperToModel(sheet, rect.x, rect.y + rect.h);
    const b = paperToModel(sheet, rect.x + rect.w, rect.y);
    box(layer, a.xCm, a.yCm, b.xCm - a.xCm, b.yCm - a.yCm);
    return { left: a.xCm, bottom: a.yCm, right: b.xCm, top: b.yCm };
  };

  const { wall, paper } = sheet;
  const sheetMin = paperToModel(sheet, 0, paper.heightMm);
  const sheetMax = paperToModel(sheet, paper.widthMm, 0);

  pair(0, 'SECTION');
  pair(2, 'HEADER');
  pair(9, '$ACADVER');
  pair(1, 'AC1009');
  pair(9, '$INSBASE');
  pair(10, '0.0');
  pair(20, '0.0');
  pair(30, '0.0');
  pair(9, '$EXTMIN');
  pair(10, num(sheetMin.xCm));
  pair(20, num(sheetMin.yCm));
  pair(30, '0.0');
  pair(9, '$EXTMAX');
  pair(10, num(sheetMax.xCm));
  pair(20, num(sheetMax.yCm));
  pair(30, '0.0');
  pair(9, '$LIMMIN');
  pair(10, num(sheetMin.xCm));
  pair(20, num(sheetMin.yCm));
  pair(9, '$LIMMAX');
  pair(10, num(sheetMax.xCm));
  pair(20, num(sheetMax.yCm));
  pair(9, '$LUNITS');
  pair(70, 2);
  pair(9, '$LUPREC');
  pair(70, 1);
  pair(0, 'ENDSEC');

  pair(0, 'SECTION');
  pair(2, 'TABLES');
  pair(0, 'TABLE');
  pair(2, 'LTYPE');
  pair(70, 2);
  pair(0, 'LTYPE');
  pair(2, 'CONTINUOUS');
  pair(70, 0);
  pair(3, 'Solid line');
  pair(72, 65);
  pair(73, 0);
  pair(40, '0.0');
  pair(0, 'LTYPE');
  pair(2, 'DASHED');
  pair(70, 0);
  pair(3, 'Dashed __ __ __');
  pair(72, 65);
  pair(73, 2);
  pair(40, '6.0');
  pair(49, '4.0');
  pair(49, '-2.0');
  pair(0, 'ENDTAB');
  pair(0, 'TABLE');
  pair(2, 'LAYER');
  pair(70, DXF_LAYERS.length);
  for (const layer of DXF_LAYERS) {
    pair(0, 'LAYER');
    pair(2, layer.name);
    pair(70, 0);
    pair(62, layer.color);
    pair(6, layer.linetype);
  }
  pair(0, 'ENDTAB');
  pair(0, 'TABLE');
  pair(2, 'STYLE');
  pair(70, 1);
  pair(0, 'STYLE');
  pair(2, 'STANDARD');
  pair(70, 0);
  pair(40, '0.0');
  pair(41, '1.0');
  pair(50, '0.0');
  pair(71, 0);
  pair(42, num(TEXT_CM));
  pair(3, 'txt');
  pair(4, '');
  pair(0, 'ENDTAB');
  pair(0, 'ENDSEC');

  pair(0, 'SECTION');
  pair(2, 'ENTITIES');

  // LUMEN_WALL
  const outline = wall.outline;
  outline.forEach((p, i) => {
    const q = outline[(i + 1) % outline.length];
    lineEntity('LUMEN_WALL', p.xCm, p.yCm, q.xCm, q.yCm);
  });
  if (wall.slopeCut) {
    const { x1, y1, x2, y2 } = wall.slopeCut;
    textEntity('LUMEN_WALL', (x1 + x2) / 2 - 30, (y1 + y2) / 2 - 6, TEXT_CM, 'ATTIC SLOPE 90 x 90');
  }
  lineEntity('LUMEN_WALL', -12, 0, wall.widthCm + 12, 0);
  textEntity('LUMEN_WALL', wall.widthCm + 14, -1, TEXT_CM, 'FFL +0');

  // LUMEN_MODULES
  for (const m of sheet.modules) {
    box('LUMEN_MODULES', m.xCm, m.yCm, m.w, m.h);
    textEntity('LUMEN_MODULES', m.xCm + 1, m.yCm + m.h + 1, TEXT_CM, `${m.index} ${m.sku}`);
  }

  // LUMEN_ANCHORS
  for (const a of sheet.anchors) {
    circle('LUMEN_ANCHORS', a.xCm, a.yCm, ANCHOR_RADIUS_CM);
    lineEntity('LUMEN_ANCHORS', a.xCm - CROSS_CM, a.yCm, a.xCm + CROSS_CM, a.yCm);
    lineEntity('LUMEN_ANCHORS', a.xCm, a.yCm - CROSS_CM, a.xCm, a.yCm + CROSS_CM);
    textEntity('LUMEN_ANCHORS', a.xCm + 2, a.yCm + 2, 2, a.anchorId);
  }

  // LUMEN_24V_BUS
  const { bus } = sheet;
  for (const s of bus.segments) lineEntity('LUMEN_24V_BUS', s.x1, s.y1, s.x2, s.y2);
  box('LUMEN_24V_BUS', bus.origin.xCm - 2, bus.origin.yCm - 2, 4, 4);
  textEntity('LUMEN_24V_BUS', bus.origin.xCm + 4, bus.origin.yCm - 6, TEXT_CM, bus.origin.label);
  textEntity('LUMEN_24V_BUS', 0, -48, TEXT_CM, `24V BUS ${bus.telemetry} ${bus.conductor}`);

  // LUMEN_DIMS
  const dimLine = (x1, y1, x2, y2, label, vertical) => {
    lineEntity('LUMEN_DIMS', x1, y1, x2, y2);
    const t = 1.8;
    lineEntity('LUMEN_DIMS', x1 - t, y1 - t, x1 + t, y1 + t);
    lineEntity('LUMEN_DIMS', x2 - t, y2 - t, x2 + t, y2 + t);
    if (vertical) textEntity('LUMEN_DIMS', x1 - 2, (y1 + y2) / 2, TEXT_CM, label, 90);
    else textEntity('LUMEN_DIMS', (x1 + x2) / 2, y1 + 1.5, TEXT_CM, label);
  };
  const W = wall.widthCm;
  const H = wall.heightCm;
  lineEntity('LUMEN_DIMS', 0, -2, 0, -30);
  lineEntity('LUMEN_DIMS', W, -2, W, -30);
  dimLine(0, -28, W, -28, `${W} OVERALL`, false);
  lineEntity('LUMEN_DIMS', -2, 0, -30, 0);
  lineEntity('LUMEN_DIMS', -2, H, -30, H);
  dimLine(-28, 0, -28, H, `${H} OVERALL`, true);
  for (const span of sheet.dimensions.chainX) dimLine(span.fromCm, -14, span.toCm, -14, String(span.valueCm), false);
  for (const span of sheet.dimensions.chainY) dimLine(-14, span.fromCm, -14, span.toCm, String(span.valueCm), true);

  // LUMEN_TITLEBLOCK
  paperBox('LUMEN_TITLEBLOCK', paper.frame);
  const schedule = paperBox('LUMEN_TITLEBLOCK', paper.schedule);
  const tb = paperBox('LUMEN_TITLEBLOCK', paper.titleBlock);
  const t = sheet.titleBlock;
  const rows = [
    `LEGAL OWNER ${t.issuer}`,
    t.address,
    `TITLE ${t.projectName}`,
    t.title,
    `DRAWING NO ${t.drawingNumber}  REV ${t.revision}  SCALE ${t.scale}  DATE ${t.dateIso}  SHEET ${t.sheet}`,
    `MODULES ${t.moduleCount}  ANCHORS ${t.anchorCount}  24V LOAD ${t.loadW} W  ${t.paper}`,
    `PSU ${t.psu}`,
    'ISO 7200 / ISO 5457 / ISO 128  UNITS CM  DATUM BOTTOM-LEFT AT FFL',
  ];
  const rowStep = (tb.top - tb.bottom) / (rows.length + 1);
  rows.forEach((row, i) => textEntity('LUMEN_TITLEBLOCK', tb.left + 4, tb.top - rowStep * (i + 1), TEXT_CM, row));

  textEntity('LUMEN_TITLEBLOCK', schedule.left + 4, schedule.top - 10, 4, 'DRILLING AND ANCHOR SCHEDULE');
  const scheduleStep = Math.min(7, (schedule.top - schedule.bottom - 24) / Math.max(1, sheet.anchors.length + 1));
  textEntity('LUMEN_TITLEBLOCK', schedule.left + 4, schedule.top - 20, 2, 'ID  MOD  SKU  X CM  Y CM  FIXING');
  sheet.anchors.forEach((a, i) => {
    textEntity(
      'LUMEN_TITLEBLOCK',
      schedule.left + 4,
      schedule.top - 20 - scheduleStep * (i + 1),
      Math.min(2, scheduleStep * 0.7),
      `${a.anchorId}  ${a.moduleIndex}  ${a.sku}  ${a.xCm.toFixed(1)}  ${a.yCm.toFixed(1)}  ${a.hardware}`,
    );
  });
  textEntity('LUMEN_TITLEBLOCK', paperToModel(sheet, paper.frame.x + 6, paper.frame.y + 9).xCm, paperToModel(sheet, 0, paper.frame.y + 9).yCm, 6, `ELEVATION A - ${sheet.scaleLabel} - ${DRAWING_NUMBER}`);

  pair(0, 'ENDSEC');
  pair(0, 'EOF');
  return `${lines.join('\r\n')}\r\n`;
}

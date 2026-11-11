import { getProduct } from '../data/products.js';
import { sanitizeText } from '../security/sanitize.js';
import { furnitureLayout, moduleBox } from './room-3d.js';

/*
 * Wavefront OBJ export of the 3D room. Units are centimetres in the room
 * frame: x along the main wall, y up from the floor, z into the room, which
 * is the right-handed Y-up frame most CAD and DCC tools import by default.
 * Every face winds counter-clockwise seen from the side its normal points to.
 */

export const OBJ_MIME = 'model/obj';
const OBJECT_NAME_MAX = 64;

// The six axis normals, written once and shared by every face.
const NORMALS = Object.freeze({ px: 1, nx: 2, py: 3, ny: 4, pz: 5, nz: 6 });
const NORMAL_VECTORS = ['1 0 0', '-1 0 0', '0 1 0', '0 -1 0', '0 0 1', '0 0 -1'];

/** A single OBJ token: ASCII letters, digits, "_" and "-" only, never empty. */
export function objToken(value, fallback = 'object') {
  const token = sanitizeText(String(value ?? ''), { maxLength: 256 })
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, OBJECT_NAME_MAX)
    .replace(/[_-]+$/, '');
  return token || fallback;
}

/** Comment-safe text: one line, printable ASCII only. */
function asciiLine(value, maxLength) {
  return sanitizeText(String(value ?? ''), { maxLength })
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '?');
}

function num(value) {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function createWriter() {
  const lines = [];
  let vertexCount = 0;

  const vertices = (points) => {
    const base = vertexCount;
    for (const [x, y, z] of points) lines.push(`v ${num(x)} ${num(y)} ${num(z)}`);
    vertexCount += points.length;
    return base;
  };

  const face = (base, corners, normal) => {
    lines.push(`f ${corners.map((corner) => `${base + corner}//${normal}`).join(' ')}`);
  };

  const object = (name, comment) => {
    lines.push('', `o ${name}`);
    if (comment) lines.push(`# ${asciiLine(comment, 160)}`);
  };

  return { lines, vertices, face, object };
}

/** Axis-aligned box with outward normals. Corners 1-4 sit on z0, 5-8 on z1. */
function writeBox(writer, { x0, x1, y0, y1, z0, z1 }) {
  const base = writer.vertices([
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ]);
  writer.face(base, [1, 4, 3, 2], NORMALS.nz);
  writer.face(base, [5, 6, 7, 8], NORMALS.pz);
  writer.face(base, [1, 5, 8, 4], NORMALS.nx);
  writer.face(base, [2, 3, 7, 6], NORMALS.px);
  writer.face(base, [1, 2, 6, 5], NORMALS.ny);
  writer.face(base, [4, 8, 7, 3], NORMALS.py);
}

/** Floor and three walls as single-sided quads facing into the room. The fourth side stays open to the viewer. */
function writeEnvelope(writer, { widthCm: w, depthCm: d, heightCm: h }) {
  const quad = (points, normal) => writer.face(writer.vertices(points), [1, 2, 3, 4], normal);
  quad(
    [
      [0, 0, 0],
      [0, 0, d],
      [w, 0, d],
      [w, 0, 0],
    ],
    NORMALS.py,
  );
  quad(
    [
      [0, 0, 0],
      [w, 0, 0],
      [w, h, 0],
      [0, h, 0],
    ],
    NORMALS.pz,
  );
  quad(
    [
      [0, 0, 0],
      [0, h, 0],
      [0, h, d],
      [0, 0, d],
    ],
    NORMALS.px,
  );
  quad(
    [
      [w, 0, 0],
      [w, 0, d],
      [w, h, d],
      [w, h, 0],
    ],
    NORMALS.nx,
  );
}

/**
 * Serializes a room state into an ASCII Wavefront OBJ string: the envelope,
 * each part of the reference furniture, then every mounted module as its
 * product box at its wall position. Object names are single sanitized tokens;
 * free text only reaches comment lines, reduced to one line of printable ASCII.
 */
export function buildRoomObj(state, projectName) {
  const { room, items } = state;
  const title = asciiLine(projectName, 48) || 'Room';
  const writer = createWriter();
  const { lines } = writer;

  lines.push(
    '# Lumen 3D Export',
    `# Project: ${title}`,
    `# Room: ${room.widthCm} x ${room.depthCm} x ${room.heightCm} cm (W x D x H)`,
    '# Units: cm. Frame: x along the main wall, y up, z into the room.',
    `# Modules: ${items.length}`,
    '',
    ...NORMAL_VECTORS.map((vector) => `vn ${vector}`),
  );

  writer.object('room_envelope', 'Floor and three walls, open to the viewer');
  writeEnvelope(writer, room);

  const furniture = furnitureLayout(room);
  if (furniture) {
    const group = objToken(furniture.id, 'furniture');
    for (const part of furniture.parts) {
      writer.object(`furniture_${group}_${objToken(part.id, 'part')}`, furniture.label);
      writeBox(writer, part.box);
    }
  }

  items.forEach((item, index) => {
    const product = getProduct(item.productId);
    const { w, h, d } = product.dimsCm;
    const order = String(index + 1).padStart(2, '0');
    writer.object(
      `module_${order}_${objToken(product.sku, 'module')}_${objToken(product.id, 'part')}`,
      `${product.name}, ${item.finish}, ${w} x ${h} x ${d} cm at x ${item.xCm}, y ${item.yCm}`,
    );
    writeBox(writer, moduleBox(item));
  });

  return `${lines.join('\n')}\n`;
}

export function countObjObjects(text) {
  return (text.match(/^o /gm) ?? []).length;
}

export function objFilename(projectName) {
  return `lumen-room-${objToken(projectName, 'room').toLowerCase()}.obj`;
}

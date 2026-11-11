import { FINISH_IDS } from '../data/products.js';
import { hasForbiddenKey, isOneOf, safeJsonParse } from '../security/sanitize.js';
import { sanitizeProjectName } from './project-library.js';
import { DIM_RANGE, sanitizeDimPct } from './dimming.js';
import { ROOM_FORMAT, ROOM_VERSION, sanitizeRoomState } from './room-3d.js';
import { DEFAULT_ROOM_WALL, wallOf } from './room-walls.js';
import { LAYOUT_FORMAT, LAYOUT_VERSION, MAX_WALL_ITEMS, sanitizeLayout } from './wall-studio.js';

export const SCENE_PARAM = 'scene';
export const SCENE_MAX_LENGTH = 4096;
export const SCENE_VERSION = 1;
export const SCENE_KINDS = Object.freeze(['wall', 'room']);

const KIND_TAG = Object.freeze({ wall: 'w', room: 'r' });
// One letter per room wall. North is never written: a room tuple carries
// the code only for a module on another wall.
const WALL_CODE = Object.freeze({ north: 'n', east: 'e', south: 's', west: 'w' });
const WALL_BY_CODE = new Map(Object.entries(WALL_CODE).map(([wall, code]) => [code, wall]));
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const STRING_LITERAL = /"(?:[^"\\]|\\.)*"/g;
const MAX_DEPTH = 4;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(param) {
  const padded = param.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (param.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/**
 * safeJsonParse strips __proto__, constructor and prototype silently. A share
 * link never carries them, so their presence marks a crafted payload and the
 * whole link is refused. Valid JSON has no quotes outside string literals,
 * so consuming every literal in order keeps the scan aligned; a literal
 * followed by ':' is a key, and is decoded so \u escapes cannot hide it.
 */
function hasForbiddenJsonKey(text) {
  for (const match of text.matchAll(STRING_LITERAL)) {
    const rest = text.slice(match.index + match[0].length).trimStart();
    if (rest[0] !== ':') continue;
    if (hasForbiddenKey(safeJsonParse(match[0], { fallback: '' }))) return true;
  }
  return false;
}

const bit = (flag) => (flag ? 1 : 0);

// Undimmed modules keep the legacy tuple, so links made before dimming and
// links for undimmed scenes encode byte for byte as they always have. A
// dimmed module appends its level as the 7th element.
function withDim(tuple, item, legacyLength) {
  const dimPct = sanitizeDimPct(item.dimPct);
  if (dimPct === DIM_RANGE.initial) return tuple;
  return [...tuple, ...Array(Math.max(0, 6 - legacyLength)).fill(0), dimPct];
}

function packWall(layout) {
  const { wall, items } = layout;
  return {
    w: [wall.widthCm, wall.heightCm, bit(wall.slope), bit(wall.snap), wall.surface],
    i: items.map((item) =>
      withDim([item.productId, item.finish, item.xCm, item.yCm, bit(item.led !== false), bit(item.locked)], item, 6),
    ),
  };
}

// A module off the north wall appends its wall code as the 8th element,
// padding the lock slot with 0 and the level with 100 when undimmed.
function withWallCode(tuple, item) {
  const wall = wallOf(item);
  if (wall === DEFAULT_ROOM_WALL) return tuple;
  const padded = [...tuple, ...Array(Math.max(0, 6 - tuple.length)).fill(0)];
  if (padded.length < 7) padded.push(DIM_RANGE.initial);
  return [...padded, WALL_CODE[wall]];
}

function packRoom(state) {
  const { room, camera, items } = state;
  return {
    w: [room.widthCm, room.depthCm, room.heightCm, room.furniture, room.lighting],
    c: [camera.yaw, camera.pitch, camera.zoom],
    i: items.map((item) =>
      withWallCode(withDim([item.productId, item.finish, item.xCm, item.yCm, bit(item.led !== false)], item, 5), item),
    ),
  };
}

function unpackItem(entry, maxLength) {
  if (!Array.isArray(entry) || entry.length < 4 || entry.length > maxLength) return null;
  const [productId, finish, xCm, yCm, led = 1, locked = 0, dimPct = DIM_RANGE.initial, code = WALL_CODE.north] = entry;
  if (!isOneOf(finish, FINISH_IDS)) return null;
  if (typeof dimPct !== 'number' || !Number.isFinite(dimPct)) return null;
  const wall = typeof code === 'string' ? WALL_BY_CODE.get(code) : undefined;
  if (!wall) return null;
  return {
    productId,
    finish,
    xCm,
    yCm,
    led: led !== 0,
    locked: locked === 1,
    dimPct: sanitizeDimPct(dimPct),
    ...(wall === DEFAULT_ROOM_WALL ? {} : { wall }),
  };
}

function unpackWall(payload) {
  const [widthCm, heightCm, slope, snap, surface] = payload.w;
  return {
    format: LAYOUT_FORMAT,
    version: LAYOUT_VERSION,
    wall: { widthCm, heightCm, slope: slope === 1, snap: snap === 1, surface },
    items: payload.i.map((entry) => unpackItem(entry, 7)),
  };
}

function unpackRoom(payload) {
  const [widthCm, depthCm, heightCm, furniture, lighting] = payload.w;
  const [yaw, pitch, zoom] = Array.isArray(payload.c) ? payload.c : [];
  return {
    format: ROOM_FORMAT,
    version: ROOM_VERSION,
    room: { widthCm, depthCm, heightCm, furniture, lighting },
    camera: { yaw, pitch, zoom },
    items: payload.i.map((entry) => unpackItem(entry, 8)),
  };
}

/**
 * Packs a wall layout or 3D room plus its project name into a Base64URL
 * string for `?scene=`. Returns null when the kind is unknown or the result
 * would exceed 4096 characters.
 */
export function encodeSceneParam(kind, state, name) {
  if (!isOneOf(kind, SCENE_KINDS) || !isRecord(state) || !Array.isArray(state.items)) return null;
  const body = kind === 'wall' ? packWall(state) : packRoom(state);
  const payload = { v: SCENE_VERSION, k: KIND_TAG[kind], n: sanitizeProjectName(name, kind), ...body };
  const encoded = toBase64Url(JSON.stringify(payload));
  return encoded.length <= SCENE_MAX_LENGTH ? encoded : null;
}

/**
 * Decodes an untrusted `?scene=` value. Never throws. Returns
 * { kind, state, name } only when the link is well formed, of the expected
 * kind, and every module in it survives sanitizing; anything else is null.
 */
export function decodeSceneParam(expectedKind, rawParam) {
  if (!isOneOf(expectedKind, SCENE_KINDS)) return null;
  if (typeof rawParam !== 'string' || rawParam.length === 0 || rawParam.length > SCENE_MAX_LENGTH) return null;
  if (!BASE64URL.test(rawParam) || rawParam.length % 4 === 1) return null;

  let text;
  try {
    text = fromBase64Url(rawParam);
  } catch {
    return null;
  }
  if (hasForbiddenJsonKey(text)) return null;

  const payload = safeJsonParse(text, { fallback: null, maxLength: SCENE_MAX_LENGTH, maxDepth: MAX_DEPTH });
  if (!isRecord(payload) || payload.v !== SCENE_VERSION || payload.k !== KIND_TAG[expectedKind]) return null;
  if (!Array.isArray(payload.w) || payload.w.length !== 5) return null;
  if (!Array.isArray(payload.i) || payload.i.length > MAX_WALL_ITEMS) return null;
  if (payload.n !== undefined && typeof payload.n !== 'string') return null;

  const envelope = expectedKind === 'wall' ? unpackWall(payload) : unpackRoom(payload);
  if (envelope.items.some((item) => item === null)) return null;

  const state = expectedKind === 'wall' ? sanitizeLayout(envelope) : sanitizeRoomState(envelope);
  if (!state || state.items.length !== envelope.items.length) return null;

  return { kind: expectedKind, state, name: sanitizeProjectName(payload.n, expectedKind) };
}

/** Removes `scene` from a search string, keeping every other parameter. */
export function stripSceneParam(search) {
  const params = new URLSearchParams(search);
  params.delete(SCENE_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

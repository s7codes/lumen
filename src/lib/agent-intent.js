import { productHasFinish } from '../data/products.js';
import { matchCatalogProducts, normalizeQuestion } from './concierge-engine.js';
import { ROOM_DEPTH, ROOM_HEIGHT, ROOM_WIDTH } from './room-3d.js';
import { WALL_HEIGHT, WALL_WIDTH } from './wall-studio.js';

/**
 * Agentic command parser for the deterministic MCP orchestrator. Turns an
 * imperative request ("Mount a Floating Shelf 110 in Walnut on the East
 * Wall", "Set my 3D room to Grand Loft and apply the Evening scene", "Add 2
 * Linear Lightbar 60 in Obsidian to my cart") into the arguments of one MCP
 * mutation tool. Questions ("How do I mount a shelf?") are never commands:
 * they stay with the concierge engine. Pure and deterministic.
 *
 * Returns `{ tool, arguments }` or null.
 */

const LEAD =
  /^(?:(?:hey|hi|ok|okay|lumen|ai|please|kindly|now|then|also|so|just|go ahead and|can you|could you|would you|will you|i want you to|i would like you to|i d like you to|i need you to|let s|lets|let us|help me)\s+)+/;
const QUESTION = /^(?:how|what|why|where|which|when|who|whats|is|are|does|do|did|can i|could i|should i|may i|will it|would it|i cannot|cannot)\b/;
const VERB =
  /^(mount|hang|place|put|install|attach|add|insert|set|switch|change|make|apply|recall|use|turn|go|resize|scale|show|face|look|clear|empty|strip|remove|delete|take|sync|push|send|copy|transfer|enter|walk|step|load|activate|enable|disable|toggle)\b/;
const MOUNT_VERB = /^(mount|hang|place|put|install|attach|add|insert)\b/;
const REMOVE_VERB = /^(remove|delete|take (?:down|off|away|out))\b/;

const COUNT_WORDS = Object.freeze({ a: 1, an: 1, one: 1, single: 1, two: 2, pair: 2, three: 3, four: 4, five: 5, six: 6 });
const CARDINAL = '(north|east|south|west)';
const MOUNT_WALL = new RegExp(`\\b(?:on|onto|to|at|along|against)\\s+(?:the\\s+|my\\s+)?${CARDINAL}(?:\\s+wall)?\\b`);
const ANY_WALL = new RegExp(`\\b${CARDINAL}(?:\\s+wall)?\\b`);
const FACE_WALL = new RegExp(`\\b(?:face|facing|look at|look toward|turn to|go to|switch to|show|view|open|focus on|focus)\\s+(?:the\\s+|my\\s+)?${CARDINAL}(?:\\s+wall)?\\b`);

const FINISH_WORDS = Object.freeze([
  ['walnut', /\bwalnut\b/],
  ['oak', /\b(?:white\s+)?oak\b/],
  ['obsidian', /\b(?:obsidian|aluminum|aluminium|anodi[sz]ed|black)\b/],
  ['chalk', /\b(?:chalk|matte white|white(?!\s+oak))\b/],
]);

const SCENES = Object.freeze([
  ['night', /\bnight (?:gallery|scene|preset)\b|\bgallery scene\b/],
  ['evening', /\bevening(?: lounge)?\b/],
  ['morning', /\bmorning(?: focus)?\b/],
  ['full', /\bfull (?:output|scene|preset|power|brightness)\b|\b100% output\b/],
]);

const SCALES = Object.freeze([
  ['loft', /\bgrand loft\b|\b(?:to|as|into|a|an|the)\s+loft\b|\bloft (?:preset|size|envelope|scale)\b/],
  ['gallery', /\b(?:to|as|into)\s+(?:a\s+|the\s+)?gallery\b|\bgallery (?:preset|size|envelope|scale)\b/],
  ['living', /\b(?:to|as|into)\s+(?:a\s+|the\s+)?living\b|\bliving (?:preset|size|envelope|scale)\b/],
  ['compact', /\b(?:to|as|into)\s+(?:a\s+|the\s+)?compact\b|\bcompact (?:preset|size|envelope|scale|room)\b/],
]);

const FURNITURE_WORDS = Object.freeze({ bed: 'bed-160', desk: 'desk-140', sofa: 'sofa-200', couch: 'sofa-200' });
const FURNITURE_ADD =
  /\b(?:add|place|put|set|use|with|show|switch to|change to)\s+(?:in\s+)?(?:a |an |the )?(?:(?:low|platform|architect|architects|modular|reference)\s+)*(bed|desk|sofa|couch)\b/;
const FURNITURE_REMOVE = /\b(?:remove|delete|hide|clear|take away|no|without)\b(?:\s+the|\s+all)?\s+(?:reference\s+)?(?:furniture|bed|desk|sofa|couch)\b/;

const LENS_CUE = /\b(lens|view|camera|walkthrough|perspective|eye ?level|first ?person)\b/;
const INSIDE = /\b(inside|interior|walkthrough|eye ?level|first ?person|165 ?cm)\b/;
const CART = /\b(cart|bag|basket)\b/;
const PLANNER_2D = /\b(2d|wall studio|elevation studio)\b/;
const PLANNER_3D = /\b(3d|room|north|east|south|west|loft|lens|walkthrough|inside|orbit)\b/;
const SYNC_SOURCE = /\b(room|wall|design|layout|composition|modules|everything|planner|studio|scene)\b/;
const SWITCH_ON = /\b(on|add|enable|show|turn on|activate)\b/;
const SWITCH_OFF = /\b(off|remove|disable|hide|turn off|no|without)\b/;

function clampInt(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function finishIn(norm) {
  return FINISH_WORDS.find(([, re]) => re.test(norm))?.[0] ?? null;
}

function sceneIn(norm) {
  return SCENES.find(([, re]) => re.test(norm))?.[0] ?? null;
}

function quantityAfterVerb(command) {
  const match = /^\S+\s+(?:in\s+)?(?:a\s+pair\s+of|(\d{1,2})|(a|an|one|single|two|pair|three|four|five|six))\b/.exec(command);
  if (!match) return 1;
  if (match[0].endsWith('pair of')) return 2;
  if (match[1]) return Number(match[1]);
  return COUNT_WORDS[match[2]] ?? 1;
}

function dimIn(norm) {
  const match = /\b(?:at|to)\s+(\d{1,3})\s*(?:%|percent)/.exec(norm);
  return match ? clampInt(Number(match[1]), 10, 100) : undefined;
}

function toggle(norm, word) {
  if (!word.test(norm)) return undefined;
  if (SWITCH_OFF.test(norm)) return false;
  if (SWITCH_ON.test(norm)) return true;
  return undefined;
}

/**
 * The finish a request names, for one part. A single named part keeps it even
 * when it does not ship in it, so the tool refuses honestly instead of
 * swapping in the default; with several parts it applies where offered.
 */
function finishFor(product, finish, single) {
  return finish && (single || productHasFinish(product, finish)) ? { finish } : {};
}

/** One mount entry per named part. */
function mountEntries(products, { qty, finish, wall, dimPct, maxQty }) {
  return products.map((product, i) => ({
    productId: product.id,
    ...finishFor(product, finish, products.length === 1),
    ...(wall ? { wall } : {}),
    ...(dimPct !== undefined && product.watts > 0 ? { dimPct } : {}),
    ...(i === 0 && qty > 1 ? { qty: Math.min(maxQty, qty) } : {}),
  }));
}

function withMounts(args, entries) {
  if (entries.length === 1) args.mount = entries[0];
  else if (entries.length > 1) args.mounts = entries;
}

function cartIntent(command, norm, products, route) {
  const finish = finishIn(norm);
  if (/^(clear|empty)\b/.test(command) && products.length === 0) return { tool: 'manage_cart_bag', arguments: { clear: true } };
  if (REMOVE_VERB.test(command)) {
    if (products.length === 0) return /\b(all|everything)\b/.test(norm) ? { tool: 'manage_cart_bag', arguments: { clear: true } } : null;
    const product = products[0];
    return {
      tool: 'manage_cart_bag',
      arguments: { remove: { productId: product.id, ...finishFor(product, finish, true) } },
    };
  }
  if (products.length > 0 && /^(add|put|place|insert|sync|push|send|copy|transfer)\b/.test(command)) {
    const product = products[0];
    const qty = clampInt(quantityAfterVerb(command), 1, 99);
    return {
      tool: 'manage_cart_bag',
      arguments: {
        add: { productId: product.id, ...finishFor(product, finish, true), ...(qty > 1 ? { qty } : {}) },
      },
    };
  }
  if (products.length === 0 && /^(sync|push|send|copy|transfer|add|move|put)\b/.test(command) && SYNC_SOURCE.test(norm)) {
    const wall = PLANNER_2D.test(norm) || (/\bwall\b/.test(norm) && !/\b(room|3d)\b/.test(norm));
    const room = /\b(room|3d)\b/.test(norm);
    const syncFrom = wall ? 'wall' : room ? 'room' : route === '/studio-2d' ? 'wall' : 'room';
    return { tool: 'manage_cart_bag', arguments: { syncFrom } };
  }
  return null;
}

function roomIntent(command, norm, products) {
  const args = {};
  const scene = sceneIn(norm);
  // Scene names such as "Night Gallery" must not read as an envelope preset.
  const rest = SCENES.reduce((text, [, re]) => text.replace(re, ' '), norm);

  const scale = SCALES.find(([, re]) => re.test(rest))?.[0];
  if (scale) args.scalePreset = scale;
  const dims = /\b(\d{3})\s*(?:x|by)\s*(\d{3})\s*(?:x|by)\s*(\d{3})\b/.exec(rest);
  if (dims && !scale) {
    args.dimensions = {
      widthCm: clampInt(Number(dims[1]), ROOM_WIDTH.min, ROOM_WIDTH.max),
      depthCm: clampInt(Number(dims[2]), ROOM_DEPTH.min, ROOM_DEPTH.max),
      heightCm: clampInt(Number(dims[3]), ROOM_HEIGHT.min, ROOM_HEIGHT.max),
    };
  }
  if (scene) args.lightingScene = scene;
  if (/\bdaylight\b/.test(rest) && scene !== 'morning') args.lightingMode = 'daylight';
  else if (/\bnight (?:mode|ambient|lighting|rig)\b|\b2700 ?k\b/.test(rest)) args.lightingMode = 'night';

  if (FURNITURE_REMOVE.test(norm)) args.furniture = 'none';
  else {
    const furniture = FURNITURE_ADD.exec(norm);
    if (furniture) args.furniture = FURNITURE_WORDS[furniture[1]];
  }

  if (/\borbit\b/.test(norm)) args.cameraLens = 'orbit';
  else if ((INSIDE.test(norm) && LENS_CUE.test(norm)) || /^(walk|enter|step)\b.*\b(inside|in|into)\b/.test(command)) args.cameraLens = 'inside';
  else if (/\belevation\b/.test(norm) && LENS_CUE.test(norm) && !PLANNER_2D.test(norm)) args.cameraLens = 'elevation';

  const faced = FACE_WALL.exec(norm)?.[1];
  const named = (MOUNT_WALL.exec(norm) ?? (/\bmain wall\b/.test(norm) ? [null, 'north'] : null))?.[1] ?? null;

  if (/^(clear|empty|strip)\b/.test(command) || /^remove (?:all|every|everything)\b/.test(command)) {
    const wall = ANY_WALL.exec(norm)?.[1];
    if (wall) args.clearWall = wall;
    else if (/\b(room|all walls|every wall|everything|all modules|all)\b/.test(norm)) args.clearWall = 'all';
  } else if (REMOVE_VERB.test(command) && products.length > 0 && !args.furniture) {
    args.removeProduct = { productId: products[0].id, ...(named || ANY_WALL.exec(norm) ? { wall: named ?? ANY_WALL.exec(norm)[1] } : {}) };
  } else if (MOUNT_VERB.test(command) && products.length > 0) {
    withMounts(args, mountEntries(products, { qty: quantityAfterVerb(command), finish: finishIn(norm), wall: named, dimPct: dimIn(norm), maxQty: 6 }));
  }

  if (faced && faced !== named) args.activeWall = faced;
  return Object.keys(args).length > 0 ? { tool: 'mutate_3d_room', arguments: args } : null;
}

function wallIntent(command, norm, products) {
  const args = {};
  const scene = sceneIn(norm);
  if (scene) args.lightingScene = scene;
  const dims = /\b(\d{3})\s*(?:x|by)\s*(\d{3})\b/.exec(norm);
  if (dims && /^(set|resize|make|change|scale)\b/.test(command)) {
    args.dimensions = {
      widthCm: clampInt(Number(dims[1]), WALL_WIDTH.min, WALL_WIDTH.max),
      heightCm: clampInt(Number(dims[2]), WALL_HEIGHT.min, WALL_HEIGHT.max),
    };
  }
  const slope = toggle(norm, /\b(?:attic )?slope\b/);
  if (slope !== undefined) args.slope = slope;
  const snap = toggle(norm, /\b(?:grid )?snap(?:ping)?\b/);
  if (snap !== undefined) args.snap = snap;
  if (/\bdaylight\b/.test(norm) && !scene) args.surface = 'daylight';
  else if (/\bambient\b/.test(norm) && !scene) args.surface = 'ambient';

  if (/^(clear|empty|strip)\b/.test(command) || /^remove (?:all|every|everything)\b/.test(command)) args.clear = true;
  else if (REMOVE_VERB.test(command) && products.length > 0) args.removeProduct = { productId: products[0].id };
  else if (MOUNT_VERB.test(command) && products.length > 0) {
    withMounts(args, mountEntries(products, { qty: quantityAfterVerb(command), finish: finishIn(norm), wall: null, dimPct: dimIn(norm), maxQty: 6 }));
  }
  return Object.keys(args).length > 0 ? { tool: 'mutate_2d_wall', arguments: args } : null;
}

/**
 * `route` breaks the tie for a request that names neither planner: on the
 * 2D Wall Studio a bare "mount a shelf" lands on the 2D wall, elsewhere in
 * the 3D room.
 */
export function parseAgentIntent(question, route = '/') {
  const norm = normalizeQuestion(question);
  const command = norm.trim().replace(LEAD, '');
  if (!command || QUESTION.test(command) || !VERB.test(command) || /\?\s*$/.test(String(question))) return null;
  const products = matchCatalogProducts(question);

  if (CART.test(norm)) return cartIntent(command, norm, products, route);
  const wall2d = PLANNER_2D.test(norm) || (route === '/studio-2d' && !PLANNER_3D.test(norm));
  return wall2d ? wallIntent(command, norm, products) : roomIntent(command, norm, products);
}

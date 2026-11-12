import { CATEGORIES, FINISHES, getProduct, PRODUCTS, STOCK_LABELS } from '../data/products.js';
import { clampNumber, isOneOf, isSafeInternalPath, sanitizeMultilineText, sanitizeText } from '../security/sanitize.js';
import { PASSWORD_MIN, sanitizeEmail } from './auth.js';
import { sanitizeBagItems } from './bag.js';
import { computeBusTopology, CONDUCTOR_LABEL, DROP_LIMIT_PCT } from './bus-topology.js';
import {
  ESCALATION_REASONS,
  MAX_STORED_PROJECTS,
  MAX_STORED_QUOTES,
  MAX_STORED_TICKETS,
  sanitizeTicketMessage,
  sanitizeTicketSubject,
  TICKET_LIMITS,
} from './cloud-records.js';
import { DIM_RANGE } from './dimming.js';
import { DRIVERS } from './drivers.js';
import { BUS_RATED_W, BUS_VOLTAGE, LOOP_OHM_PER_M, maxRunM } from './electrical.js';
import { launchHref } from './launch-presets.js';
import { ACCENT_SHAPES, LIGHTING_SCENES, TASK_SHAPES } from './lighting-scenes.js';
import {
  CRATE_TYPES,
  FREIGHT_CLASSES,
  FULFILMENT_LABELS,
  LONG_SPAN_CM,
  PALLET_MIN_KG,
  PARCEL_MAX_KG,
  PARCEL_MAX_LENGTH_CM,
  STOCK_MAX_WEEKS,
} from './logistics.js';
import { buildQuote, CURRENCY_CODES, formatMoney, getCurrency, PROMOS, toMinor, VAT_RATE_PCT } from './quote.js';
import {
  CAMERA_PITCH,
  CAMERA_ZOOM,
  findRoomConflicts,
  getFurniture,
  ROOM_DEPTH,
  ROOM_HEIGHT,
  ROOM_WALLS,
  ROOM_WIDTH,
  roomSizePreset,
  ROOM_SIZE_PRESETS,
  sanitizeRoomState,
  unrolledRoom,
  WALL_LABELS,
  wallCounts,
} from './room-3d.js';
import { OCTAVE_ALPHA, OCTAVE_BANDS, OCTAVE_LABELS, STI_GRADES, TASK_TARGET_LUX, computeEnvironmentalPhysics } from './room-physics.js';
import { AXIS_LOCK_LABELS } from './room-raycast.js';
import { CAMERA_MODE_LABELS, EYE_HEIGHT_CM, INSIDE_FOV, INSIDE_FOV_DEG } from './room-walkthrough.js';
import {
  EYE_DATUM_CM,
  findConflicts,
  GRID_STEP_CM,
  HISTORY_LIMIT,
  MAX_WALL_ITEMS,
  sanitizeLayout,
  summarizeWall,
  WALL_HEIGHT,
  WALL_WIDTH,
} from './wall-studio.js';

/**
 * Lumen Spec Concierge. A deterministic retrieval engine over the 12-part
 * catalog, the platform's own engines and the visitor's live workspace (2D
 * wall, 3D room, cart). Pure and framework-free: the browser falls back to it
 * offline, and server/app.js runs the same code for POST /api/concierge/ask
 * and to verify escalation transcripts. Same input, same reply, every time.
 *
 * Resolution is decided from the question text alone, never from workspace
 * content, so the server can replay a transcript turn without the visitor's
 * drafts and reach the same verdict the visitor saw.
 */

export const QUESTION_MAX = 500;
export const ANSWER_MAX = 3200;
export const RESOLVED_CONFIDENCE = 0.65;
export const UNRESOLVED_CONFIDENCE = 0.45;
export const DRIVER_HEADROOM_PCT = 20;
export const REPLY_ID_PATTERN = /^LMN-C-[0-9A-F]{8}$/;

export const ESCALATION_NOTICE =
  'This inquiry requires direct review by a Lumen studio engineer. I have unlocked the Studio Engineering Contact channel below so you can transmit your brief and live workspace specs.';
export const CONTACT_GATE_REPLY =
  'I handle all product, 24V electrical, acoustic, 3D planner, and order inquiries directly. Describe the specific issue you need help with - if I cannot resolve it, I will unlock direct studio engineering contact for you.';
export const FOLLOW_UP_NOTICE =
  'I have unlocked the Studio Engineering Contact channel below so a Lumen studio engineer can review your exact case with your live workspace specs attached.';
const GATE_NOTE =
  'If this does not settle it, choose "Did not resolve my issue" and I will unlock direct studio engineering contact.';
const SCOPE_LINE =
  'I resolve the 12-part catalog, 24V SELV driver sizing and voltage drop, DALI-2 dimming and scenes, Sabine acoustics and illuminance, the 2D Wall Studio and 3D Spatial Studio, CAD exports, pricing, VAT, fulfilment and Lumen Cloud, and I read your live 2D wall, 3D room and cart.';

export const CONCIERGE_CATEGORIES = Object.freeze({
  catalog: 'Catalog & Part Specs',
  workspace: 'Live Workspace Audit',
  guide: 'Studio Guide & Troubleshooting',
  electrical: '24V Bus, Drivers & DALI-2',
  physics: 'Acoustics & Photometry',
  spatial: '3D Spatial Studio & CAD',
  commerce: 'Pricing, Fulfilment & Cloud',
  gatekeeper: 'Support Gatekeeper',
  concierge: 'Studio Concierge',
  engineering: 'Studio Engineering Review',
  unrecognized: 'Outside Automated Scope',
});
const CATEGORY_IDS = Object.keys(CONCIERGE_CATEGORIES);
// Replies that answer the inquiry itself; only these can be marked as not resolving it.
const SUBSTANTIVE = new Set(['catalog', 'workspace', 'guide', 'electrical', 'physics', 'spatial', 'commerce']);

export const WORKSPACE_ROUTES = Object.freeze({
  '/': 'Overview',
  '/catalog': 'Catalog',
  '/checkout': 'Checkout Spec',
  '/room-3d': '3D Room Planner',
  '/studio-2d': '2D Wall Studio',
  '/account': 'Account',
});

const MAX_METRICS = 8;
const MAX_CITATIONS = 6;
const MAX_ACTIONS = 3;
const MAX_CONTEXT_BAG_LINES = 64;
// Quotes are dated for their id only; the concierge never shows it, so a fixed date keeps replies pure.
const QUOTE_DATE = new Date(Date.UTC(2026, 0, 1));
const INTEGER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/* Formatting */

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function round(value, places) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function int(value) {
  return INTEGER.format(Number.isFinite(value) ? Math.round(value) : 0);
}

function wattsLabel(value) {
  const w = round(Number.isFinite(value) ? value : 0, 1);
  return `${Number.isInteger(w) ? w : w.toFixed(1)} W`;
}

function dimsLabel(product) {
  const { w, h, d } = product.dimsCm;
  return `${w} x ${h} x ${d} cm`;
}

function priceLabel(priceUsd, currency) {
  return formatMoney(toMinor(priceUsd, currency), currency);
}

function weeksLabel([min, max]) {
  return min === max ? `${min} week${min === 1 ? '' : 's'}` : `${min}-${max} weeks`;
}

function plural(count, word, many = `${word}s`) {
  return `${count} ${count === 1 ? word : many}`;
}

function listLabel(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function replyId(question, answer) {
  return `LMN-C-${fnv1a(`${question}\n${answer}`).toString(16).toUpperCase().padStart(8, '0')}`;
}

/* Untrusted input */

/** One line, no control characters, at most 500 characters. Empty when nothing is left. */
export function sanitizeQuestion(value) {
  return sanitizeText(value, { maxLength: QUESTION_MAX });
}

const EMPTY_CONTEXT = Object.freeze({ route: '/', currency: 'USD', wallDraft: null, roomDraft: null, bagItems: [] });

function sanitizeRoute(value) {
  if (typeof value !== 'string' || !isSafeInternalPath(value, { maxLength: 256 })) return '/';
  return new URL(value, 'https://lumen.invalid').pathname;
}

/**
 * Lenient snapshot of the visitor's workspace: every field is rebuilt through
 * its canonical sanitizer and anything unusable reads as absent.
 */
export function sanitizeWorkspaceContext(input) {
  if (!isRecord(input)) return EMPTY_CONTEXT;
  return {
    route: sanitizeRoute(input.route),
    currency: isOneOf(input.currency, CURRENCY_CODES) ? input.currency : 'USD',
    wallDraft: isRecord(input.wallDraft) ? sanitizeLayout(input.wallDraft) : null,
    roomDraft: isRecord(input.roomDraft) ? sanitizeRoomState(input.roomDraft) : null,
    bagItems: Array.isArray(input.bagItems) ? sanitizeBagItems(input.bagItems.slice(0, MAX_CONTEXT_BAG_LINES)) : [],
  };
}

/**
 * Strict form for the API boundary: a field that is present must survive its
 * sanitizer whole, or the request is refused with the reason.
 */
export function validateWorkspaceContext(input) {
  if (input === undefined || input === null) return { context: EMPTY_CONTEXT, error: null };
  if (!isRecord(input)) return { context: null, error: 'workspaceContext must be an object.' };
  const fail = (error) => ({ context: null, error });
  if (input.route !== undefined && !(typeof input.route === 'string' && isSafeInternalPath(input.route, { maxLength: 256 }))) {
    return fail('workspaceContext.route must be a same-origin path.');
  }
  if (input.currency !== undefined && !isOneOf(input.currency, CURRENCY_CODES)) {
    return fail(`workspaceContext.currency must be one of ${CURRENCY_CODES.join(', ')}.`);
  }
  if (input.wallDraft !== undefined && input.wallDraft !== null) {
    const layout = sanitizeLayout(input.wallDraft);
    if (!layout || layout.items.length !== input.wallDraft.items.length) {
      return fail('workspaceContext.wallDraft is not a valid Lumen wall layout.');
    }
  }
  if (input.roomDraft !== undefined && input.roomDraft !== null) {
    const room = sanitizeRoomState(input.roomDraft);
    if (!room || room.items.length !== input.roomDraft.items.length) {
      return fail('workspaceContext.roomDraft is not a valid Lumen 3D room.');
    }
  }
  if (input.bagItems !== undefined && input.bagItems !== null) {
    if (!Array.isArray(input.bagItems) || input.bagItems.length > MAX_CONTEXT_BAG_LINES) {
      return fail(`workspaceContext.bagItems must be an array of at most ${MAX_CONTEXT_BAG_LINES} lines.`);
    }
    if (sanitizeBagItems(input.bagItems).length !== input.bagItems.length) {
      return fail('workspaceContext.bagItems references unknown products, finishes or quantities.');
    }
  }
  return { context: sanitizeWorkspaceContext(input), error: null };
}

/* Text analysis */

// Everyday phrasing, folded before matching: contractions with or without the
// apostrophe (straight or typographic), common misspellings, and the many
// names visitors give the two planners. Applied to lower-cased text.
const APOSTROPHE = "['\u2019]";
const PHRASING = Object.freeze([
  [new RegExp(`\\bcan${APOSTROPHE}?t\\b|\\bcan not\\b`, 'g'), 'cannot'],
  [new RegExp(`\\bwon${APOSTROPHE}?t\\b`, 'g'), 'will not'],
  [new RegExp(`\\b(do|does|did|is|are|was|were|has|have|had|could|would|should)n${APOSTROPHE}?t\\b`, 'g'), '$1 not'],
  [new RegExp(`\\b(what|where|how|who|why|when|there|it)${APOSTROPHE}s\\b`, 'g'), '$1 is'],
  [/\b(what|where|how)s\b/g, '$1 is'],
  [new RegExp(`\\bi${APOSTROPHE}?m\\b`, 'g'), 'i am'],
  [new RegExp(`\\bi${APOSTROPHE}ve\\b`, 'g'), 'i have'],
  [/\b(?:3-d|3 d|three[ -]d(?:imensional)?)\b/g, '3d'],
  [/\b(?:2-d|2 d|two[ -]d(?:imensional)?)\b/g, '2d'],
  [/\b(?:desinger|desginer|designr|desiger)\b/g, 'designer'],
  [/\b(?:planer|planr|plannr)\b/g, 'planner'],
  [/\b(?:furnature|furnitre|furnitur|furnitures)\b/g, 'furniture'],
  [/\bwalk[ -]?thr(?:ough|u)\b/g, 'walkthrough'],
  [/\b(?:short ?cuts?|shorcuts?|shotcuts?)\b/g, 'shortcuts'],
  [/\b(?:pls|plz)\b/g, 'please'],
  [/\bu(?![-/])\b/g, 'you'],
  [/\bur\b/g, 'your'],
]);

function normalize(text) {
  let lower = text.toLowerCase().replace(/(\d),(?=\d{3}\b)/g, '$1');
  for (const [re, to] of PHRASING) lower = lower.replace(re, to);
  return ` ${lower
    .replace(/[^a-z0-9.%+/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

// Catalog phrases that would otherwise read as bespoke or onsite requests.
const KNOWN_PHRASES =
  /\b(custom millwork (and )?luminaires|millwork crates?|made[ -]to[ -]order|fabricated parts|cut\b[^.]{0,30}?\bon[ -]?site|cut to length)\b/g;
// Phrases where a product word means something else.
const PRODUCT_NOISE =
  /\b(time ?frame|frame rate|track (my|the|an?|your|our) (orders?|shipments?|deliver(y|ies)|parcels?|packages?|quotes?|requisitions?))\b/g;
// Software and planner vocabulary that would otherwise read as freight damage
// or bespoke sizing: "the 3D designer is broken", "a custom room size".
const UI_NOUNS =
  '(page|site|website|app|button|link|viewport|canvas|planner|designer|modell?er|studio|editor|workstation|panel|menu|navbar|search|palette|tool|widget|chat|assistant|screen|3d|2d|webgl|gizmo|camera|preview|showcase|cart|checkout)';
const PLANNER_PHRASES = new RegExp(
  [
    `\\b${UI_NOUNS}( is| seems| looks| keeps| got| went| was)?( totally| completely| still| just)? (broken|crash\\w*|faulty|defective|bugged|buggy|glitch\\w*)\\b`,
    '\\bcustom (room )?(sizes?|sized|dimensions?)( for| of)?( the| my| a| your)? (rooms?|envelopes?|spaces?)\\b',
    '\\b(rooms?|envelopes?|spaces?) (to |in |at )?(a )?custom (sizes?|dimensions?)\\b',
    '\\b(search|palette|query) (returns?|returned)\\b',
  ].join('|'),
  'g',
);

const ESCALATION_TOPICS = Object.freeze([
  {
    id: 'bespoke',
    label: 'Bespoke fabrication outside the 12-part catalog',
    re: /\b(bespoke|made to measure|non-?standard|one-?off|special order|fabricate|fabrication|machined|milled|milling|weld|welded|welding|curved|bent|marble|granite|stone|concrete|terrazzo|brass|bronze|leather|velvet|rattan|glass)\b|\bcustom[ -]?(made|milled|built|size[sd]?|lengths?|widths?|heights?|depths?|dimensions?|fabricat\w*|finish(es)?|colou?rs?|pieces?|parts?|shel(f|ves)|furniture|joinery|millwork|\d+)\b|\b(longer|wider|taller|deeper|larger|bigger|shorter|narrower) (than|version|size|one)\b|\bin (a )?(different|other) (size|length|width|height|colou?r)\b/,
  },
  {
    id: 'structural',
    label: 'Structural, masonry or wet-zone certification',
    re: /\b(structural\w*|load[ -]?bearing|masonry|brick|blockwork|stud wall|joists?|lintels?|certif\w*|wet[ -]?zones?|bathrooms?|showers?|sauna|steam|ip ?\d\d|ip rating|outdoors?|exterior|outside wall|garden|fire[ -]?rat\w*|seismic|building (code|regulations?)|permits?|ce mark\w*|ul[ -]?list\w*)\b/,
  },
  {
    id: 'installation',
    label: 'Onsite installation crew booking',
    re: /\b(installers?|install(ation)? (crew|team|service|services|appointment|booking|visit)|site (visit|survey)|on-?site|in[ -]person|come (out|to my|to our))\b|\b(book|hire|send|arrange|schedule)\b[^.]*\b(fitters?|electricians?|technicians?|installers?|crews?|engineers?|someone)\b/,
  },
  {
    id: 'freight',
    label: 'Freight damage, returns or warranty claims',
    re: /\b(damaged|damage|broken|cracked|dented|scratched|defective|defects?|faulty|missing (parts?|pieces?|items?|screws?|crates?)|lost (parcels?|packages?|shipments?|orders?|crates?)|claims?|insurance|refunds?|returns?|returning|rma|warrant(y|ies)|guarantee)\b/,
  },
  {
    id: 'invoicing',
    label: 'Custom B2B invoicing and credit terms',
    re: /\b(invoices?|invoicing|b2b|enterprise|purchase orders?|po number|net ?(30|60|90)|credit (terms|account|line)|payment terms|account manager|vat (number|id)|tax (id|exempt\w*)|reverse charge|wire transfer|bank transfer|pro ?forma|volume pricing|bulk (pricing|discount|order)|wholesale|tender)\b/,
  },
]);

const CONTACT =
  /\b(contact|talk|speak|chat|e-?mail|mail|call|phone|ring|reach|message|connect)\b[^.?!]*\b(support|human|agent|person|someone|somebody|engineers?|staff|team|representative|rep|customer service|operator|sales)\b|\b(human (agent|support|being)|real person|live (agent|person|chat)|customer (service|support|care)|support (team|ticket|agent|desk)|(open|raise|file) a ticket|escalat\w*|help ?desk)\b/;
const SMALLTALK =
  /^ (hi|hello|hey|hiya|greetings|good (morning|afternoon|evening|day)|thanks|thank you|thx|cheers|ok|okay|cool|great|help|test)( there| you| again)?[.!]* $|\b(what can you (do|answer|help with)|who are you|what are you|how does this work|help me)\b/;
const THANKS = /^ (thanks|thank you|thx|cheers|great|cool|perfect|nice|awesome)( a lot| so much| very much| again)?[.!]* $/;
const OVERVIEW =
  /\b(what (is|are) lumen|what does lumen|what lumen (is|does)|tell me (about|more about) (lumen|this (site|platform|app|website|place|tool))|about lumen|who (is|are|made|built) lumen|what is this (site|website|platform|app|place|tool|page|about)|what (site|website|platform|app) is this|how (is|was) (lumen|this|it|the)( (site|platform|app|system|website|product))? (architected|built|made|designed|structured|engineered|organi[sz]ed|put together)|(lumen|platform|system|site|product) architecture|how does (lumen|this|it|the (site|platform|app|website|system)) work|what (can|do) (you|lumen) (do|offer|sell|make|help with)|what can i do (here|on this|with (this|lumen))|getting started|get started|where (do|should) i (start|begin)|first time|new here|introduc\w*|give me (a )?tour|show me around)\b/;
const ARCHITECTURE = /\b(architect\w*|engineered|structured|under the hood|built)\b/;

/* Studio guide vocabulary: navigation, workflows and troubleshooting */

// Question forms that ask how, where or why something in the app works.
const ASKS_HOW =
  /\b(how (do|can|should|would|could|to|does|is)|where (is|are|can|do|does|did|would)|why (cannot|will not|does not|do not|is not|is|does|did|are|am)|is there (a|any) way|is it possible|can (i|you|we)|could (i|you|we)|help me|show me|tell me (how|where)|explain|walk me through|i (cannot|am unable to|am not able to|do not know how|do not see|want to|would like to|need to|tried))\b/;
const ASKS_WHERE =
  /\b(where (is|are|can|do|does|did|would)|how (do|can|could) (i|we|you) (get|go|find|reach|open|launch|start|enter|access|see|switch)|how to (get|go|find|reach|open|launch|start|enter|access|see|switch)|(cannot|could not|do not|did not) (find|see|locate))\b/;
const TROUBLE =
  /\b(cannot|unable|not able|will not|would not|does not|do not|did not|is not|are not|keeps? (failing|crashing|freezing|loading)|not (working|loading|opening|showing|responding|starting|launching|appearing|rendering|displaying|clickable|visible)|broken|stuck|frozen|freez\w*|blank|black screen|white screen|empty screen|nothing (happens|shows|loads|appears)|no response|crash\w*|errors?|fail\w*|bugs?|bugged|buggy|glitch\w*|laggy|lagging|slow|disappear\w*|vanish\w*|gr[ae]yed out|disabled|issues?|problems?|trouble)\b|\b(is|went|goes|stays|turns) (black|white|blank|empty|grey|gray)\b/;
// Verbs that ask for another feature than opening a tool: those belong to that feature.
const OTHER_FEATURE =
  /\b(export\w*|download\w*|share|sharing|sav(e|es|ed|ing)|print\w*|captur\w*|compar\w*|import\w*|sync\w*|buy\w*|order\w*|quot(e|es|ed|ing)|price\w*|cost\w*|audit\w*|check(ing)?|wattage|watts?|rt60|lux)\b/;

const ROOM_TOOL =
  /\b3d( spatial)?( room)? (designer|design tool|modell?er|planner|editor|studio|workstation|tool|app|view|viewer|mode|room|space|scene|model|builder|configurator|visuali[sz]er|page|section|preview)\b|\b(room|spatial) (designer|planner|editor|studio|builder|configurator|modell?er|visuali[sz]er|tool)\b|\bspatial (studio|workstation)\b|\broom-3d\b/;
const OPEN_3D_LOOSE = /\b(open\w*|launch\w*|enter\w*|access\w*|get into|go into|switch to)( up)?( the| a| my| your| in)? 3d\b/;
const WALL_TOOL =
  /\b2d( wall)? (designer|planner|editor|studio|tool|elevation|view|mode|builder|page)\b|\bwall (studio|designer|planner|editor|builder|configurator|tool)\b|\belevation (studio|planner|editor|designer)\b|\bstudio-2d\b/;
const OPEN_VERB =
  /\b(open\w*|launch\w*|start\w*|enter\w*|access\w*|load\w*|run|running|find|locate|get (in|into|to|inside)|go (in|into|to|inside)|navigate to|reach|switch to|bring up|pull up|use|using|explain|walk me through|tour)\b/;
// Verbs that name the tool's entrance itself; "use" or a fault alone is a weaker signal.
const OPEN_STRICT = /\b(open\w*|launch\w*|start\w*|enter\w*|access\w*|find|locate|get (in|into|to|inside)|go (in|into|to|inside)|navigate to|reach|switch to)\b/;

const MOVE_STRONG = /\b(mov(e|es|ed|ing)|drag\w*|reposition\w*|rearrang\w*|arrang\w*|slid(e|es|ing)|nudg\w*|relocat\w*)\b/;
const MOVE_AROUND = /\bmov(e|es|ing) (around|about|through|inside)\b/;
const MOVE_PLACE = /\b(plac(e|es|ed|ing)|position(ing)?|put|putting|add|adding|insert\w*|align\w*|snap\w*|stack\w*|space (them|it|out|evenly))\b/;
const MOVE_MOUNT = /\b(mount|mounting|hang|hanging|attach\w*)\b/;
const MOVE_OBJECT =
  /\b(furniture|modules?|parts?|pieces?|items?|objects?|products?|components?|assets?|shel(f|ves)|lights?|lamps?|luminaires?|fixtures?|frames?|panels?|baffles?|sconces?|pendants?|cubes?|sideboards?|columns?|spots?|spotlights?|lightbars?|tracks?|hubs?|things|stuff|elements?|selection)\b/;
const MOVE_PRONOUN = /\b(it|them)\b/;
const MOVE_GENERIC = /\b(furniture|modules?|parts?|components?|assets?|items?|pieces?|objects?)\b/;
const PLANNER_STRONG = /\b(3d|2d|planners?|studio|designer|editor|modell?er|viewport|canvas|scene|asset shelf|layout|elevation|gizmo)\b/;
const PLANNER_LOOSE = /\b(3d|2d|planners?|studio|designer|editor|modell?er|viewport|canvas|scene|asset shelf|layout|elevation|gizmo|grid|rooms?|walls?|north|east|south|west|corner)\b/;
const GIZMO = /\b(gizmo|transform (handles?|tool|controls?)|x\/y handles?|axis locks?|lock (x|y)|free xy|grab (mode|key))\b/;

const WALK =
  /\b(walk(ing|s)? (around|inside|in|through|into|about)|walkthrough|stroll\w*|wander\w*|look(ing)? around|move around|go inside|step inside|stand inside|get inside|first[ -]person|eye[ -]?level|eye height|wasd|w a s d|inside (lens|view|room))\b|\bhow (do|can) (i|we|you) walk\b/;
const ROTATE =
  /\b(rotat\w*|spin\w*|orbit\w*|circle|swivel\w*|pivot\w*) (the |my |a )?(room|view|camera|scene|model|space|around|360)\b|\borbit\w*\b|\b360\b|\bturn (around|the (room|view|camera|scene))\b|\btilt (the )?(camera|view)\b|\b(zoom\w*|pan|panning|camera\w*|field of view|fov|lens|lenses|perspective|viewing angle|view ?points?|top view|plan view|birds? eye|look (up|down))\b/;
const RESIZE =
  /\b(room|envelope|space) (size|sizes|dimensions?|width|depth|height|footprint|scale)\b|\bceiling (height|size)\b|\b(resiz\w*|enlarg\w*|shrink\w*)\b|\bmake (the |my |a )?(room|space|envelope|wall) (bigger|smaller|larger|wider|deeper|taller|higher|lower|narrower|shorter)\b|\b(bigger|smaller|larger) (room|space|envelope)\b|\b(change|set|adjust|edit|increase|decrease|alter|modify)\b[^.?!]{0,28}\b(room|envelope|space|ceiling|wall)\b[^.?!]{0,16}\b(size|dimensions?|width|depth|height)\b|\b(change|set|adjust|edit|increase|decrease|alter|modify)\b[^.?!]{0,16}\b(size|dimensions?|width|depth|height)\b[^.?!]{0,16}\b(room|envelope|space|ceiling)\b|\b(compact|living|gallery|grand loft|loft) (preset|room|size|scale)\b|\b(room|size|scale) presets?\b/;
const ROOM_WORDS = /\b(room|envelope|space|ceiling)\b/;

const MODES =
  /\bvisual (vs|versus|or|and) specs?\b|\bspecs? (vs|versus|or|and) visual\b|\b(visual|specs?) (mode|view|toggle|switch|button|setting)s?\b|\b(display|technical|architectural|presentation|engineering) (mode|view|layer)s?\b|\bmode (switch|toggle|button|selector)\b|\b(switch|toggle|change) (the )?modes?\b/;
const SHORTCUTS =
  /\b(keyboard( shortcuts?| keys| controls?)?|shortcuts?|hot ?keys?|key ?bindings?|key ?commands?|keystrokes?|command palette|undo|redo|zen( mode)?|full ?screen|maximi[sz]e|hide (the )?(docks?|panels?|sidebars?)|docks?)\b|\b(ctrl|cmd|command|control) ?\+ ?[a-z]\b|\b(ctrl|cmd) ?[a-z]\b/;
const CHROME =
  /\b(top ?bar|nav ?bar|navigation (bar|menu|links?)|nav links?|menu ?bar|header|tool ?bar|top menu|main menu|menu|buttons? (at|on|in) the top|top (right|left)( corner)?)\b/;
const ASKS_WHAT = /\b(what|which) (is|are|does|do)\b/;

const CART_NOUN = /\b(cart|bag|basket|checkout|check out)\b/;
const CART_VERB =
  /\b(add\w*|put|putting|send\w*|sync\w*|mov(e|ing)|transfer\w*|get|bring|remov\w*|delet\w*|empt\w*|clear\w*|updat\w*|change|edit\w*|open\w*|find|see|view|where|go)\b/;
const CHECKOUT_HOW = /\bhow (do|can|could) (i|we) (check ?out|checkout|order|buy|purchase|pay)\b/;
const COUNTING = /\bhow (many|much)\b/;
const SAVE_VERB = /\b(sav(e|es|ed|ing)|reopen\w*|re-open\w*|restor\w*|recover\w*|lost my|load (my|a) (saved|previous|old))\b/;
const ACCOUNT =
  /\b(sign(ing)? ?(in|up|out)|log(ging)? ?(in|out)|login|logout|register\w*|(create|make|open) (an |my )?account|my account|account page|passwords?|forgot)\b/;
const SEARCH =
  /\b(search\w*|command palette|look ?up|quick find|find (a |the |any )?(part|product|page|command|setting|feature|tool))\b|\b(ctrl|cmd|command|control) ?\+? ?k\b/;
const REMOVE =
  /\b(remov\w*|delet\w*|get rid of|take (it |them )?(off|out|away)|clear (the |my )?(wall|room|layout|scene)|unmount\w*)\b/;
const SITE = /\b(page|site|website|app|screen|everything|nothing|interface|buttons?|links?|it|loading|load|blank)\b/;

// In priority order: the first three found are answered.
const GUIDE_ORDER = Object.freeze(['open3d', 'wallOpen', 'move', 'navigate', 'remove', 'save', 'cart', 'account', 'search', 'modes', 'shortcuts', 'chrome']);
// Intents concrete enough to answer even when the visitor also asks for a human.
const CONTACT_SAFE = new Set(['open3d', 'wallOpen', 'move', 'navigate', 'remove', 'save', 'cart']);

/**
 * How-to, navigation and troubleshooting intents in a question, read from
 * the text alone like every verdict. `fallback` marks a fault report about
 * the site that names no tool (answered only when no topic claims it).
 */
function detectGuide(norm, products) {
  const asks = ASKS_HOW.test(norm);
  const where = ASKS_WHERE.test(norm);
  const troubled = TROUBLE.test(norm);
  const cart = CART_NOUN.test(norm);
  const other = OTHER_FEATURE.test(norm);
  const found = new Set();

  const roomTool = ROOM_TOOL.test(norm) || OPEN_3D_LOOSE.test(norm);
  const opens = OPEN_VERB.test(norm) || where;
  const openStrict = OPEN_STRICT.test(norm) || where;
  if (roomTool && (opens || troubled) && !other) found.add('open3d');
  if (WALL_TOOL.test(norm) && (opens || troubled) && !other) found.add('wallOpen');

  const objects = MOVE_OBJECT.test(norm) || MOVE_PRONOUN.test(norm);
  const strongMove = MOVE_STRONG.test(norm) && !(MOVE_AROUND.test(norm) && !MOVE_OBJECT.test(norm));
  const placed = asks && MOVE_PLACE.test(norm) && MOVE_OBJECT.test(norm) && (PLANNER_LOOSE.test(norm) || MOVE_GENERIC.test(norm));
  const mounted = asks && MOVE_MOUNT.test(norm) && PLANNER_STRONG.test(norm);
  if (!cart && (GIZMO.test(norm) || (strongMove && (objects || PLANNER_LOOSE.test(norm))) || placed || mounted)) found.add('move');

  const resize = RESIZE.test(norm) && (products.length === 0 || ROOM_WORDS.test(norm));
  const walk = WALK.test(norm);
  const rotate = ROTATE.test(norm);
  if (walk || rotate || resize) found.add('navigate');

  if (REMOVE.test(norm) && (asks || troubled) && (MOVE_OBJECT.test(norm) || PLANNER_LOOSE.test(norm)) && !cart) found.add('remove');
  if (SAVE_VERB.test(norm) && (asks || troubled || where)) found.add('save');
  if ((cart && CART_VERB.test(norm) && (asks || troubled || where) && !COUNTING.test(norm)) || CHECKOUT_HOW.test(norm)) found.add('cart');
  if (ACCOUNT.test(norm) && (asks || troubled || where || /\bforgot\b/.test(norm))) found.add('account');
  if (SEARCH.test(norm) && (asks || troubled || where || /\bsearch\b/.test(norm))) found.add('search');
  if (MODES.test(norm)) found.add('modes');
  if (SHORTCUTS.test(norm)) found.add('shortcuts');
  if (CHROME.test(norm) && (asks || where || ASKS_WHAT.test(norm))) found.add('chrome');

  // "Why can't I use the 3D room" with a walk or move question is about that action.
  const weakOpen = found.has('open3d') && !openStrict;
  if (weakOpen && found.size > 1) found.delete('open3d');

  const intents = GUIDE_ORDER.filter((id) => found.has(id));
  return {
    intents,
    asks,
    troubled,
    strong: intents.length > 0 && !(intents[0] === 'open3d' && weakOpen),
    contactSafe: intents.some((id) => CONTACT_SAFE.has(id)) && (asks || troubled),
    walk,
    rotate,
    resize,
    fallback: intents.length === 0 && troubled && SITE.test(norm),
  };
}

const POSSESSIVE = /\b(my|mine|our|ours|current|currently|this|live)\b/;
const WORKSPACE_NOUN =
  /\b(walls?|rooms?|designs?|layouts?|projects?|cart|bag|basket|orders?|plans?|setup|scheme|scene|workspace|elevation|drafts?|space)\b/;
const AUDIT = /\b(audit|check|review|analy[sz]e|inspect|diagnose|summari[sz]e|evaluate|assess|report)\b/;
const NEED = /\b(do i need|should i (use|get|buy|specify)|will i need|i need|do we need|does (it|this) need)\b/;
// "Export my room" asks how to use a feature, not for an audit of the room.
const FEATURE_VERBS = /\b(export\w*|download\w*|share|sharing|save|saving|print\w*|capture|import\w*|sync\w*|walk|navigate|open)\b/;
const HOW_TO_TOPICS = Object.freeze({ spatial: ['exports', 'share', 'compare', 'lenses'], commerce: ['cloud'] });

const TARGETS = [
  ['room', /\b(rooms?|3d|three d|3-d|four walls|4 walls|north|east|south|west)\b/],
  ['cart', /\b(cart|bag|basket|checkout|orders?|quotes?|crates?|ship\w*|dispatch|freight|deliver\w*)\b/],
  ['wall', /\b(walls?|2d|elevation|wall studio)\b/],
];

const WORKSPACE_FACETS = Object.freeze({
  electrical:
    /\b(watts?|wattage|power|load|draw|drivers?|psus?|supply|amps?|current|volts?|voltage|drop|bus|24 ?v|cables?|cabling|wiring|run)\b/,
  acoustic: /\b(rt60|reverb\w*|echo\w*|acoustic\w*|sabine|sti|speech|intelligib\w*|absorption|octaves?|sound|noise)\b/,
  lighting: /\b(lux|lx|illuminance|bright\w*|light level|lighting level|lumens|dark|task light\w*)\b/,
  conflicts: /\b(conflicts?|overlap\w*|collision\w*|collid\w*|clash\w*|intersect\w*)\b/,
  cost: /\b(costs?|prices?|pricing|total|budget|how much|expensive|cheap)\b/,
  logistics: /\b(crates?|ship|shipping|shipment|dispatch|deliver\w*|freight|pallet|parcel|waves?|weight|weigh|kg)\b/,
});

const FACETS = Object.freeze([
  ['dimensions', /\b(dimensions?|sizes?|how (big|wide|tall|deep|long)|width|height|depth|length|measure\w*|w x h)\b/],
  ['weight', /\b(weight|weighs?|kg|heavy|mass)\b/],
  ['power', /\b(watts?|wattage|power draw|draw|consum\w*|\d+ ?w)\b/],
  // Singular "lumen" is the brand ("What is Lumen?"); the unit reads as plural or with a figure.
  ['lumens', /\b(lumens|\d+ ?lumen|lumen (output|rating|value|count|level)|lm|output|flux|brightness)\b/],
  ['kelvin', /\b(kelvin|cct|colou?r temperature|2700 ?k|3000 ?k|warm|cool)\b/],
  ['cri', /\b(cri|colou?r rendering)\b/],
  ['nrc', /\b(nrc|absorption|absorb\w*|felt|sound)\b/],
  ['mounting', /\b(anchors?|mount|mounting|mounted|fixings?|screws?|brackets?|cleat|install|installing|hang|hung|drill\w*)\b/],
  ['finishes', /\b(finish|finishes|colou?rs?|materials?|timber|wood|aluminium|aluminum|powder)\b/],
  ['finishName', /\b(walnut|oak|obsidian|chalk)\b/],
  ['lead', /\b(lead ?times?|lead|in stock|stock|made to order|availab\w*|how long)\b/],
  ['price', /\b(prices?|costs?|how much|usd|eur|huf|euros?|forint|dollars?)\b/],
  ['efficacy', /\b(efficacy|efficien\w*|lm ?\/ ?w|lm per w)\b/],
  ['spec', /\b(specs?|specifications?|datasheet|details|tell me about)\b/],
]);
const FACET_WEIGHT = Object.freeze({ finishes: 2, finishName: 2, lead: 2, spec: 2 });

const SUPERLATIVES = Object.freeze([
  ['brightest', /\b(brightest|most lumens|highest (output|lumens))\b/],
  ['efficient', /\b(most efficient|best efficacy|highest efficacy)\b/],
  ['lightest', /\b(lightest|lowest (mass|weight))\b/],
  ['heaviest', /\b(heaviest|highest (mass|weight))\b/],
  ['cheapest', /\b(cheapest|least expensive|lowest price|most affordable)\b/],
  ['priciest', /\b(most expensive|priciest|highest price)\b/],
  ['longest', /\b(longest|widest|largest|biggest)\b/],
]);

const TOPIC_SIGNALS = Object.freeze({
  catalog: [
    ['overview', /\b(products?|catalog|catalogue|range|collection|line-?up|parts|modules|skus?|everything you (sell|make))\b/, 1],
    ['category', /\b(shelving|lighting|luminaires?|surfaces|hardware|acoustic panels?|furniture)\b/, 1],
  ],
  electrical: [
    ['selv', /\b(24 ?v|24 ?volts?|24-volt|selv|class 2|class ii|low voltage)\b/, 2],
    ['drivers', /\b(drivers?|psus?|power suppl(y|ies)|transformers?)\b/, 2],
    ['driverSizes', /\b(60 ?w|150 ?w|100 ?w)\b/, 1],
    ['drop', /\b(voltage drop|volt drop|drop|voltage|volts?)\b/, 2],
    ['dali', /\b(dali|dali-2|dimm\w*|dim|arc level)\b/, 2],
    ['scenes', /\b(scenes?|circadian|morning focus|evening lounge|night gallery|full output)\b/, 2],
    ['wiring', /\b(wires?|wiring|cables?|cabling|conductors?|copper|mm2|gauge|awg)\b/, 1],
    ['bus', /\b(bus|daisy|daisy-chain|chain|topology|feed)\b/, 1],
    ['load', /\b(watts?|wattage|load|amps?|ampere|current|power draw|consumption|headroom|utili[sz]ation|overload\w*|electric\w*|power)\b/, 1],
  ],
  physics: [
    ['acoustics', /\b(rt60|reverb\w*|echo\w*|acoustics?|sabine|sti|speech|intelligib\w*|absorption|octaves?|sound|noise|nrc|decay)\b/, 2],
    ['illuminance', /\b(lux|lx|illuminance|light level|lighting level|iso-?lux|photometr\w*|candela|polar|heat ?map|glare|uniformity|lumen method)\b/, 2],
    ['brightness', /\b(bright|brightness|dark|darker)\b/, 1],
  ],
  spatial: [
    ['planner', /\b(3d|three d|3-d|spatial studio|room planner|planners?|webgl)\b/, 2],
    ['lenses', /\b(orbit\w*|cutaway|walkthrough|walk(ing)? (inside|around|in the room|through the room)|inside room|inside lens|eye level|eye height|165 ?cm|wasd|fov|field of view|lens|lenses|wall elevation|camera|wireframe|compass)\b/, 2],
    ['gizmo', /\b(gizmo|raycast|ray-cast|drag|dragging|move|moving|nudge|axis|lock x|lock y|snap|snapping|grid|grab)\b/, 1],
    ['exports', /\b(svg|dxf|autocad|cad|blueprints?|obj|wavefront|png|render|snapshot|screenshot|exports?|exporting|download|drawings?|drilling schedule)\b/, 2],
    ['compare', /\b(compare|comparison|diff|a\/b|a-b|revisions?|undo|redo|history)\b/, 1],
    ['share', /\b(share|sharing|scene link|deep link|url|link)\b/, 1],
    ['wallStudio', /\b(wall studio|2d|marquee|align\w*|distribut\w*|smart guides?|guides)\b/, 2],
  ],
  commerce: [
    ['pricing', /\b(prices?|pricing|costs?|how much|usd|eur|huf|currenc(y|ies)|euros?|forint|dollars?)\b/, 1],
    ['promo', /\b(trade15|lumen10|studio20|trade|discounts?|promo\w*|coupons?|vouchers?|codes?)\b/, 2],
    ['vat', /\b(vat|tax|taxes|gross|net)\b/, 2],
    ['shipping', /\b(ship|ships|shipping|shipment|deliver|delivery|deliveries|freight|courier|pallet|parcel|logistics)\b/, 2],
    ['fulfilment', /\b(dispatch|waves?|rough-?in|rough in|split|consolidated|fulfil+ment)\b/, 2],
    ['crates', /\b(crates?|crating|packing|packed)\b/, 2],
    ['quote', /\b(quotes?|quotation|requisitions?|checkout|orders?|ordering|buy|purchase|cart|bag|basket)\b/, 1],
    ['cloud', /\b(cloud|sync|syncing|save|saved|saving|library|libraries|account|sign in|sign-in|login|offline)\b/, 2],
  ],
});
const TOPIC_ORDER = Object.freeze(['catalog', 'electrical', 'physics', 'spatial', 'commerce']);

const PRODUCT_ALIASES = Object.freeze({
  'floating-shelf-110': ['floating shelf 110', 'floating shelf', 'shelf 110', 'shelves', 'shelf'],
  'modular-cube-36': ['modular cube 36', 'modular cube', 'cube 36', 'cube'],
  'compact-sideboard-75': ['compact sideboard 75', 'compact sideboard', 'sideboard 75', 'sideboard', 'cabinet'],
  'linear-lightbar-60': ['linear lightbar 60', 'linear lightbar', 'lightbar 60', 'light bar', 'lightbar'],
  'corner-floor-column-140': ['corner floor column 140', 'corner floor column', 'floor column', 'column 140', 'column', 'floor lamp'],
  'directional-spot-monopoint': ['directional spot monopoint', 'directional spot', 'monopoint', 'spotlight', 'spot light', 'spot'],
  'acoustic-art-frame-50x70': ['acoustic art frame 50x70', 'acoustic art frame', 'art frame', 'acoustic frame', '50x70', '50 x 70', 'frame'],
  'track-bus-200': ['recessed 24v track bus 200', 'track bus 200', 'track bus', 'recessed track', 'track'],
  'linear-pendant-150': ['linear suspension pendant 150', 'linear suspension pendant', 'suspension pendant', 'linear pendant', 'pendant 150', 'pendant'],
  'acoustic-baffle-120': ['acoustic wall baffle 120', 'acoustic wall baffle', 'acoustic baffle', 'wall baffle', 'baffle 120', 'baffle'],
  'wall-sconce-80': ['vertical architectural sconce 80', 'vertical architectural sconce', 'architectural sconce', 'wall sconce', 'sconce 80', 'sconce'],
  'power-hub-dali': ['recessed 24v dali-2 bus hub', 'dali-2 bus hub', 'dali bus hub', 'dali hub', 'bus hub', 'power hub', 'hub'],
});

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

const PRODUCT_MATCHERS = PRODUCTS.map((product) => ({
  product,
  sku: new RegExp(`\\b${escapeRegex(product.sku.toLowerCase())}\\b|\\b${escapeRegex(product.id)}\\b`),
  aliases: (PRODUCT_ALIASES[product.id] ?? []).map((alias) => ({
    re: new RegExp(`\\b${escapeRegex(alias)}(s|es)?\\b`),
    weight: /[\s\d]/.test(alias) ? 3 : 2,
  })),
}));

function matchProducts(norm) {
  const text = norm.replace(PRODUCT_NOISE, ' ');
  const hits = [];
  for (const { product, sku, aliases } of PRODUCT_MATCHERS) {
    let weight = sku.test(text) ? 4 : 0;
    for (const alias of aliases) if (alias.re.test(text)) weight = Math.max(weight, alias.weight);
    if (weight > 0) hits.push({ product, weight, at: firstIndex(text, product) });
  }
  // A specific alias outranks a generic word ("floating shelf" over a bare "shelf" elsewhere).
  const best = Math.max(0, ...hits.map((hit) => hit.weight));
  return hits
    .filter((hit) => hit.weight >= Math.min(best, 3) || hits.length <= 3)
    .sort((a, b) => a.at - b.at || b.weight - a.weight)
    .map((hit) => hit.product)
    .slice(0, 3);
}

function firstIndex(text, product) {
  let at = Infinity;
  for (const alias of PRODUCT_ALIASES[product.id] ?? []) {
    const i = text.indexOf(alias);
    if (i !== -1) at = Math.min(at, i);
  }
  const sku = text.indexOf(product.sku.toLowerCase());
  return sku !== -1 ? Math.min(at, sku) : at;
}

function routeProduct(route) {
  const match = /^\/catalog\/([a-z0-9-]{1,64})$/.exec(route);
  return match ? getProduct(match[1]) : null;
}

function analyze(text) {
  const norm = normalize(text);
  const scan = norm.replace(KNOWN_PHRASES, ' ').replace(PLANNER_PHRASES, ' ');
  const escalations = ESCALATION_TOPICS.filter((topic) => topic.re.test(scan));
  const products = matchProducts(norm);
  const facets = FACETS.filter(([, re]) => re.test(norm)).map(([id]) => id);
  const superlative = SUPERLATIVES.find(([, re]) => re.test(norm))?.[0] ?? null;

  const scores = Object.fromEntries(TOPIC_ORDER.map((topic) => [topic, 0]));
  const subtopics = Object.fromEntries(TOPIC_ORDER.map((topic) => [topic, []]));
  for (const topic of TOPIC_ORDER) {
    for (const [id, re, weight] of TOPIC_SIGNALS[topic]) {
      if (!re.test(norm)) continue;
      scores[topic] += weight;
      subtopics[topic].push(id);
    }
  }
  scores.catalog += Math.min(6, products.reduce((sum) => sum + 3, 0));
  scores.catalog += Math.min(4, facets.reduce((sum, id) => sum + (FACET_WEIGHT[id] ?? 1), 0));
  if (superlative) scores.catalog += 2;

  const possessive = POSSESSIVE.test(norm) && WORKSPACE_NOUN.test(norm);
  const audit = AUDIT.test(norm) && WORKSPACE_NOUN.test(norm);
  const need = NEED.test(norm) && products.length === 0 && (subtopics.electrical.length > 0 || facets.includes('mounting'));
  const howTo =
    FEATURE_VERBS.test(norm) &&
    Object.entries(HOW_TO_TOPICS).some(([topic, ids]) => subtopics[topic].some((id) => ids.includes(id)));
  const workspaceFacets = Object.entries(WORKSPACE_FACETS)
    .filter(([, re]) => re.test(norm))
    .map(([id]) => id);

  return {
    norm,
    escalations,
    products,
    facets,
    superlative,
    scores,
    subtopics,
    contact: CONTACT.test(norm),
    smalltalk: SMALLTALK.test(norm),
    overview: OVERVIEW.test(norm),
    thanks: THANKS.test(norm),
    guide: detectGuide(norm, products),
    workspace: {
      intent: (possessive || audit || need) && !howTo,
      audit: AUDIT.test(norm),
      target: TARGETS.find(([, re]) => re.test(norm))?.[0] ?? null,
      explicit2d: /\b(2d|wall studio)\b/.test(norm),
      facets: workspaceFacets,
    },
  };
}

/** Topic ranking: highest score first; ties fall back to TOPIC_ORDER. */
function rankTopics(scores) {
  return TOPIC_ORDER.filter((topic) => scores[topic] > 0).sort(
    (a, b) => scores[b] - scores[a] || TOPIC_ORDER.indexOf(a) - TOPIC_ORDER.indexOf(b),
  );
}

/**
 * The verdict for a question: category, resolution and confidence. Depends on
 * the text alone, so a replay without workspace context agrees with it.
 */
function classify(analysis) {
  const ranked = rankTopics(analysis.scores);
  const top = ranked[0] ?? null;
  const topScore = top ? analysis.scores[top] : 0;

  if (analysis.escalations.length > 0) {
    const confidence = Math.max(0.08, 0.38 - 0.07 * (analysis.escalations.length - 1) - (topScore > 0 ? 0 : 0.04));
    return { category: 'engineering', resolved: false, confidence: round(confidence, 2), ranked };
  }
  // A how-to, navigation or fault question about the app itself outranks the
  // topic words it mentions ("why can't I open my 3D room" is not an audit).
  const { guide } = analysis;
  if (guide.intents.length > 0 && (!analysis.contact || guide.contactSafe)) {
    const strength = 3 + guide.intents.length + (guide.asks ? 1 : 0) + (guide.troubled ? 1 : 0) + (guide.strong ? 1 : 0);
    return { category: 'guide', resolved: true, confidence: scoreConfidence(strength), ranked };
  }
  if (analysis.workspace.intent) {
    const strength = 3 + analysis.workspace.facets.length + (analysis.workspace.target ? 1 : 0);
    return { category: 'workspace', resolved: true, confidence: scoreConfidence(strength), ranked };
  }
  if (top) return { category: top, resolved: true, confidence: scoreConfidence(topScore), ranked };
  if (analysis.contact) return { category: 'gatekeeper', resolved: true, confidence: 0.7, ranked };
  if (guide.fallback) return { category: 'guide', resolved: true, confidence: scoreConfidence(4), ranked };
  if (analysis.overview) return { category: 'concierge', resolved: true, confidence: 0.9, ranked };
  if (analysis.smalltalk) return { category: 'concierge', resolved: true, confidence: 0.85, ranked };
  return { category: 'unrecognized', resolved: false, confidence: analysis.norm.trim().length < 4 ? 0.1 : 0.18, ranked };
}

function scoreConfidence(score) {
  return round(Math.min(0.97, RESOLVED_CONFIDENCE + 0.05 * Math.max(0, score - 1)), 2);
}

/* Reply sections */

function section(paragraphs, { metrics = [], citations = [], actions = [] } = {}) {
  return { paragraphs: paragraphs.filter(Boolean), metrics, citations, actions };
}

const CITE = Object.freeze({
  catalog: { id: 'catalog:products', label: 'Lumen Catalog / 12 Canonical Parts' },
  drivers: { id: 'engine:drivers', label: '24V SELV Driver Schedule' },
  bus: { id: 'engine:bus-topology', label: '24V Bus Topology Engine' },
  dimming: { id: 'engine:dali-2', label: 'DALI-2 Dimming & Scene Engine' },
  physics: { id: 'engine:room-physics', label: 'Sabine 6-Octave RT60 & STI Engine' },
  lux: { id: 'engine:illuminance', label: 'Lumen Method Illuminance Engine' },
  quote: { id: 'engine:quote', label: 'Server-Verified Quote Engine' },
  logistics: { id: 'engine:logistics', label: 'FFD Crate Packing & Dispatch Waves' },
  spatial: { id: 'manual:spatial-studio', label: '3D Spatial Studio Manual' },
  cad: { id: 'manual:cad-exports', label: 'CAD Export Schedule' },
  cloud: { id: 'manual:lumen-cloud', label: 'Lumen Cloud Library Rules' },
  navigation: { id: 'manual:navigation', label: 'Lumen Navigation Guide' },
  controls: { id: 'manual:controls', label: 'Keyboard & Display Mode Reference' },
  wallStudio: { id: 'manual:wall-studio', label: '2D Wall Studio Manual' },
  troubleshooting: { id: 'manual:troubleshooting', label: 'Studio Troubleshooting Notes' },
  wall: { id: 'workspace:wall', label: 'Live 2D Wall Draft' },
  room: { id: 'workspace:room', label: 'Live 3D Room Draft' },
  cart: { id: 'workspace:cart', label: 'Live Cart' },
});

const ACTIONS = Object.freeze({
  room: { label: 'Open 3D Spatial Studio', to: '/room-3d' },
  inside: { label: 'Walk Inside at 165 cm', to: launchHref({ lens: 'inside' }) },
  wall: { label: 'Open Wall Studio', to: '/studio-2d' },
  checkout: { label: 'Open Checkout Spec', to: '/checkout' },
  catalog: { label: 'Browse Catalog', to: '/catalog' },
  launch: { label: 'Launch 3D Spatial Studio', to: '/room-3d' },
  walkthrough: { label: 'Launch 165 cm Walkthrough', to: launchHref({ lens: 'inside' }) },
  loft: { label: 'Open the Grand Loft', to: launchHref({ scale: 'loft', lens: 'orbit' }) },
  account: { label: 'Open Account', to: '/account' },
});

function productAction(product) {
  return { label: `View ${product.name}`, to: `/catalog/${product.id}` };
}

function productCite(product) {
  return { id: `catalog:${product.id}`, label: `Catalog / ${product.sku} ${product.name}` };
}

/* Catalog knowledge */

const FELT_ALPHA = Object.freeze({ frame: 'felt', baffle: 'baffle' });
const FELT_CORE_MM = Object.freeze({ frame: 30, baffle: 50 });
const MOUNT_LABELS = Object.freeze({
  wall: 'wall-hung',
  floor: 'floor-standing with a wall tie',
  ceiling: 'ceiling canopy',
  recessed: 'plaster-in recessed',
});

/** NRC as ISO 354 defines it: the 250 Hz to 2 kHz mean, to the nearest 0.05. */
export function noiseReductionCoefficient(product) {
  const key = FELT_ALPHA[product?.shape];
  if (!key) return null;
  const bands = OCTAVE_ALPHA[key].slice(1, 5);
  return Math.round((bands.reduce((sum, a) => sum + a, 0) / bands.length) * 20) / 20;
}

function stockLine(product) {
  return `${STOCK_LABELS[product.stock]}, ships in ${weeksLabel(product.leadWeeks)}`;
}

function finishList(product) {
  return product.finishes.map((id) => FINISHES.find((finish) => finish.id === id).label);
}

function facetLine(product, facet, currency) {
  const nrc = noiseReductionCoefficient(product);
  switch (facet) {
    case 'dimensions':
      return `Dimensions: ${dimsLabel(product)} (w x h x d).`;
    case 'weight':
      return `Mass: ${product.weightKg} kg per unit.`;
    case 'power':
      return product.watts > 0
        ? `24V load: ${product.watts} W per unit (${(product.watts / BUS_VOLTAGE).toFixed(2)} A at ${BUS_VOLTAGE} V).`
        : `Passive part: no 24V load of its own${product.mount === 'recessed' ? '; it carries the bus to the parts downstream' : ''}.`;
    case 'lumens':
    case 'efficacy':
      return product.lumens > 0
        ? `Output: ${int(product.lumens)} lm at ${product.watts} W (${Math.round(product.lumens / product.watts)} lm/W).`
        : 'No light output: this part is unlit.';
    case 'kelvin':
      return product.kelvin ? `Colour temperature: ${product.kelvin}K.` : 'Unlit part: no colour temperature.';
    case 'cri':
      return product.cri ? `Colour rendering: CRI ${product.cri}.` : 'Unlit part: no CRI rating.';
    case 'nrc':
      return nrc !== null
        ? `Acoustic: ${FELT_CORE_MM[product.shape]} mm PET felt core, NRC ${nrc.toFixed(2)}.`
        : 'No acoustic absorber in this part; the Acoustic Art Frame 50x70 (NRC 0.70) and Acoustic Wall Baffle 120 (NRC 0.85) carry the felt.';
    case 'mounting':
      return `Mounting: ${plural(product.mountingPoints, 'anchor point')} per unit, ${MOUNT_LABELS[product.mount]}. The Wall Studio Blueprint dimensions every anchor in its 1:20 drilling schedule.`;
    case 'finishes':
    case 'finishName':
      return `Finishes: ${finishList(product).join(', ')} (default ${FINISHES.find((f) => f.id === product.defaultFinish).label}).`;
    case 'lead':
      return `Availability: ${stockLine(product)}.`;
    case 'price':
      return `List price: ${priceLabel(product.priceUsd, currency)} per unit, before VAT.`;
    default:
      return null;
  }
}

const SHEET_FACETS = Object.freeze(['dimensions', 'weight', 'power', 'lumens', 'kelvin', 'cri', 'nrc', 'mounting', 'finishes', 'lead', 'price']);

function productMetrics(product, currency) {
  const nrc = noiseReductionCoefficient(product);
  const metrics = [
    { label: 'Size', value: dimsLabel(product) },
    { label: 'Mass', value: `${product.weightKg} kg` },
    { label: 'Load', value: product.watts > 0 ? `${product.watts} W` : 'Passive' },
  ];
  if (product.lumens > 0) {
    metrics.push({ label: 'Output', value: `${int(product.lumens)} lm` });
    metrics.push({ label: 'CCT', value: `${product.kelvin}K` });
    metrics.push({ label: 'CRI', value: String(product.cri) });
  }
  if (nrc !== null) metrics.push({ label: 'NRC', value: nrc.toFixed(2) });
  metrics.push({ label: 'Anchors', value: String(product.mountingPoints) });
  metrics.push({ label: 'Lead', value: weeksLabel(product.leadWeeks) });
  metrics.push({ label: 'Price', value: priceLabel(product.priceUsd, currency) });
  return metrics.slice(0, MAX_METRICS);
}

function productSheet(product, facets, currency) {
  const category = CATEGORIES.find((entry) => entry.id === product.category).label;
  // "Specs" asks for the whole sheet; a named facet alone narrows it.
  const wanted = facets.includes('spec') || facets.length === 0 ? SHEET_FACETS : facets;
  const lines = wanted.map((facet) => facetLine(product, facet, currency)).filter(Boolean);
  const unique = [...new Set(lines)];
  return [`${product.name} (${product.sku}, ${category}). ${product.summary}`, unique.map((line) => `- ${line}`).join('\n')];
}

function catalogSuperlative(kind, currency) {
  const lit = PRODUCTS.filter((product) => product.lumens > 0);
  const pick = {
    brightest: () => [...lit].sort((a, b) => b.lumens - a.lumens)[0],
    efficient: () => [...lit].sort((a, b) => b.lumens / b.watts - a.lumens / a.watts)[0],
    lightest: () => [...PRODUCTS].sort((a, b) => a.weightKg - b.weightKg)[0],
    heaviest: () => [...PRODUCTS].sort((a, b) => b.weightKg - a.weightKg)[0],
    cheapest: () => [...PRODUCTS].sort((a, b) => a.priceUsd - b.priceUsd)[0],
    priciest: () => [...PRODUCTS].sort((a, b) => b.priceUsd - a.priceUsd)[0],
    longest: () => [...PRODUCTS].sort((a, b) => b.dimsCm.w - a.dimsCm.w)[0],
  }[kind]();
  const facts = {
    brightest: `${int(pick.lumens)} lm at ${pick.watts} W`,
    efficient: `${Math.round(pick.lumens / pick.watts)} lm/W (${int(pick.lumens)} lm at ${pick.watts} W)`,
    lightest: `${pick.weightKg} kg`,
    heaviest: `${pick.weightKg} kg`,
    cheapest: `${priceLabel(pick.priceUsd, currency)} list`,
    priciest: `${priceLabel(pick.priceUsd, currency)} list`,
    longest: `${pick.dimsCm.w} cm wide (${dimsLabel(pick)})`,
  }[kind];
  return { product: pick, line: `${pick.name} (${pick.sku}) leads the 12-part range here: ${facts}.` };
}

function catalogFacetOverview(facets, norm, currency) {
  const paragraphs = [];
  const lit = PRODUCTS.filter((product) => product.lumens > 0);
  for (const facet of facets) {
    if (paragraphs.length >= 2) break;
    if (facet === 'finishes' || facet === 'finishName') {
      const named = FINISHES.filter((finish) => new RegExp(`\\b${finish.id}\\b`).test(norm));
      const shown = named.length > 0 ? named : FINISHES;
      paragraphs.push(
        shown
          .map((finish) => {
            const parts = PRODUCTS.filter((product) => product.finishes.includes(finish.id));
            const all = parts.length === PRODUCTS.length;
            return `- ${finish.label}: ${finish.name}, ${finish.surface}. ${all ? 'Every part ships in it.' : `${parts.length} parts: ${parts.map((p) => p.name).join(', ')}.`}`;
          })
          .join('\n'),
      );
      const metalOnly = PRODUCTS.filter((product) => product.finishes.length === 2).map((product) => product.name);
      if (named.length === 0) paragraphs.push(`Metal-only parts ship in Obsidian and Chalk: ${listLabel(metalOnly)}.`);
    } else if (facet === 'kelvin') {
      const odd = lit.filter((product) => product.kelvin !== 2700);
      paragraphs.push(`Every lit part runs at 2700K except ${listLabel(odd.map((p) => `the ${p.name} at ${p.kelvin}K`))}.`);
    } else if (facet === 'cri') {
      const odd = lit.filter((product) => product.cri !== 97);
      paragraphs.push(`Lit parts render at CRI 97, except ${listLabel(odd.map((p) => `the ${p.name} at CRI ${p.cri}`))}.`);
    } else if (facet === 'nrc') {
      const felt = PRODUCTS.filter((product) => noiseReductionCoefficient(product) !== null);
      paragraphs.push(
        `Acoustic parts: ${listLabel(felt.map((p) => `${p.name} (${FELT_CORE_MM[p.shape]} mm PET felt, NRC ${noiseReductionCoefficient(p).toFixed(2)})`))}. Every other part is a hard surface and barely changes RT60.`,
      );
    } else if (facet === 'lead') {
      const made = PRODUCTS.filter((product) => product.stock === 'made-to-order');
      paragraphs.push(
        `Made to order: ${made.map((p) => `${p.name} ${weeksLabel(p.leadWeeks)}`).join(', ')}. Every other part is in stock and ships in 1-2 weeks.`,
      );
    } else if (facet === 'weight') {
      paragraphs.push(PRODUCTS.map((p) => `- ${p.name}: ${p.weightKg} kg`).join('\n'));
    } else if (facet === 'dimensions') {
      paragraphs.push(PRODUCTS.map((p) => `- ${p.name}: ${dimsLabel(p)}`).join('\n'));
    } else if (facet === 'power' || facet === 'lumens' || facet === 'efficacy') {
      paragraphs.push(lit.map((p) => `- ${p.name}: ${p.watts} W, ${int(p.lumens)} lm, ${Math.round(p.lumens / p.watts)} lm/W`).join('\n'));
    } else if (facet === 'price') {
      paragraphs.push(PRODUCTS.map((p) => `- ${p.name}: ${priceLabel(p.priceUsd, currency)}`).join('\n'));
    } else if (facet === 'mounting') {
      paragraphs.push(PRODUCTS.map((p) => `- ${p.name}: ${plural(p.mountingPoints, 'anchor')}, ${MOUNT_LABELS[p.mount]}`).join('\n'));
    }
  }
  return [...new Set(paragraphs)];
}

function composeCatalog(analysis, ctx) {
  const currency = getCurrency(ctx.currency);
  const facets = analysis.facets;
  const fromRoute = routeProduct(ctx.route);
  const products = analysis.products.length > 0 ? analysis.products : fromRoute && facets.length > 0 ? [fromRoute] : [];

  if (products.length >= 2) {
    const paragraphs = products.map((product) => {
      const wanted = facets.filter((facet) => facet !== 'spec');
      const lines = (wanted.length > 0 ? wanted : ['dimensions', 'power', 'lumens', 'mounting', 'price'])
        .map((facet) => facetLine(product, facet, currency))
        .filter(Boolean);
      return `${product.name} (${product.sku}): ${[...new Set(lines)].join(' ')}`;
    });
    return section(paragraphs, {
      metrics: products.map((product) => ({ label: product.sku, value: priceLabel(product.priceUsd, currency) })),
      citations: products.map(productCite),
      actions: products.map(productAction),
    });
  }
  if (products.length === 1) {
    const [product] = products;
    return section(productSheet(product, facets, currency), {
      metrics: productMetrics(product, currency),
      citations: [productCite(product)],
      actions: [productAction(product), product.mount === 'ceiling' || product.mount === 'floor' ? ACTIONS.room : ACTIONS.wall],
    });
  }
  if (analysis.superlative) {
    const { product, line } = catalogSuperlative(analysis.superlative, currency);
    return section([line, product.summary], {
      metrics: productMetrics(product, currency).slice(0, 4),
      citations: [productCite(product), CITE.catalog],
      actions: [productAction(product), ACTIONS.catalog],
    });
  }
  const overview = catalogFacetOverview(facets, analysis.norm, currency);
  if (overview.length > 0) return section(overview, { citations: [CITE.catalog], actions: [ACTIONS.catalog] });

  const category = CATEGORIES.find((entry) => new RegExp(`\\b${entry.id}\\b|\\b${entry.label.toLowerCase()}\\b`).test(analysis.norm));
  const groups = (category ? [category] : CATEGORIES).map((entry) => {
    const parts = PRODUCTS.filter((product) => product.category === entry.id);
    return `- ${entry.label}: ${parts.map((p) => `${p.name} ${priceLabel(p.priceUsd, currency)}`).join(', ')}`;
  });
  return section(
    [
      category
        ? `${category.label} in the Lumen range, list prices before VAT:`
        : 'The Lumen range is 12 canonical parts, every one wired for the 24V DC bus or passive. List prices before VAT:',
      groups.join('\n'),
    ],
    { metrics: [{ label: 'Parts', value: String(PRODUCTS.length) }, { label: 'Finishes', value: String(FINISHES.length) }], citations: [CITE.catalog], actions: [ACTIONS.catalog] },
  );
}

/* Electrical knowledge */

function driverParagraphs(currency) {
  const d60 = DRIVERS['driver-60'];
  const d150 = DRIVERS['driver-150'];
  const keep = (w) => Math.round(w * (1 - DRIVER_HEADROOM_PCT / 100));
  return [
    `${d60.name} (${d60.sku}): ${priceLabel(d60.priceUsd, currency)}, carries up to 60 W of connected load (2.50 A at ${BUS_VOLTAGE} V), ${d60.weightKg} kg boxed. ${d150.name} (${d150.sku}): ${priceLabel(d150.priceUsd, currency)}, up to 150 W (6.25 A), ${d150.weightKg} kg boxed.`,
    `Sizing follows the rated connected load, since any channel can be raised to 100%: up to 60 W runs on one 60W driver, up to 150 W on one 150W driver, and above 150 W the load splits across a multi-bus array of 150W drivers, one per 24V run. Headroom rule: keep the continuous draw at or below ${100 - DRIVER_HEADROOM_PCT}% of the rating (${keep(60)} W on the 60W, ${keep(150)} W on the 150W), a ${DRIVER_HEADROOM_PCT}% margin for inrush and ageing; past that line, step up to the 150W driver or split the bus.`,
  ];
}

function dropParagraph() {
  const runs = [60, 100, 150].map((w) => `${w} W ${maxRunM(w).toFixed(1)} m`).join(', ');
  return `The ${BUS_VOLTAGE}V bus is a Class 2 SELV circuit rated ${BUS_RATED_W} W per run. Voltage drop is held under ${DROP_LIMIT_PCT}% (${((DROP_LIMIT_PCT / 100) * BUS_VOLTAGE).toFixed(2)} V) over a ${CONDUCTOR_LABEL} copper loop at ${LOOP_OHM_PER_M.toFixed(4)} ohm per metre of run. Longest end-fed run inside the limit: ${runs}.`;
}

function daliParagraph() {
  return `DALI-2 gives every powered module its own arc level from ${DIM_RANGE.min}% to ${DIM_RANGE.max}% in ${DIM_RANGE.step}% steps. Flux and active bus draw scale linearly with the level; driver sizing keeps the rated load. The Recessed 24V DALI-2 Bus Hub carries the DALI-2 pair on the same terminal block as the 24V feed.`;
}

const SHAPE_PLURALS = Object.freeze({
  shelf: 'shelves',
  lightbar: 'lightbars',
  pendant: 'pendants',
  spot: 'spots',
  cube: 'cubes',
  frame: 'art frames',
  sconce: 'sconces',
  column: 'columns',
  sideboard: 'sideboards',
});

function scenesParagraph() {
  const scenes = LIGHTING_SCENES.map(
    (scene) => `${scene.label}: task ${scene.task}% / accent ${scene.accent}%${scene.surface ? `, ${scene.surface} surface` : ''}`,
  ).join('; ');
  const shapes = (list) => listLabel(list.map((shape) => SHAPE_PLURALS[shape] ?? shape));
  return `The four circadian scenes are ${scenes}. Task channels are the ${shapes(TASK_SHAPES)}; accent channels are the ${shapes(ACCENT_SHAPES)}. Passive parts are never touched.`;
}

function busParagraph() {
  return 'Routing is a Manhattan daisy-chain from the feed: the first mounted track bus or DALI-2 hub, otherwise the utility datum 20 cm from the left corner and 30 cm above the floor. Each hop carries the current of every node downstream, so the worst-case drop is the sum of hop drops at the last node.';
}

function composeElectrical(analysis, ctx) {
  const currency = getCurrency(ctx.currency);
  const subs = new Set(analysis.subtopics.electrical);
  const paragraphs = [];
  const citations = [];
  if (subs.has('drivers') || subs.has('driverSizes') || subs.has('load')) {
    paragraphs.push(...driverParagraphs(currency));
    citations.push(CITE.drivers);
  }
  if (subs.has('drop') || subs.has('wiring') || subs.has('selv')) {
    paragraphs.push(dropParagraph());
    citations.push(CITE.bus);
  }
  if (subs.has('dali')) {
    paragraphs.push(daliParagraph());
    citations.push(CITE.dimming);
  }
  if (subs.has('scenes')) {
    paragraphs.push(scenesParagraph());
    citations.push(CITE.dimming);
  }
  if (subs.has('bus') && paragraphs.length < 3) {
    paragraphs.push(busParagraph());
    citations.push(CITE.bus);
  }
  if (paragraphs.length === 0) {
    paragraphs.push(dropParagraph(), driverParagraphs(currency)[1]);
    citations.push(CITE.bus, CITE.drivers);
  }
  return section(paragraphs.slice(0, 4), {
    metrics: [
      { label: 'Bus', value: `${BUS_VOLTAGE} V SELV` },
      { label: '60W Driver', value: priceLabel(DRIVERS['driver-60'].priceUsd, currency) },
      { label: '150W Driver', value: priceLabel(DRIVERS['driver-150'].priceUsd, currency) },
      { label: 'Drop Limit', value: `<${DROP_LIMIT_PCT}%` },
      { label: 'Conductor', value: CONDUCTOR_LABEL },
      { label: 'Dimming', value: `${DIM_RANGE.min}-${DIM_RANGE.max}%` },
    ],
    citations,
    actions: [ACTIONS.wall, ACTIONS.room],
  });
}

/* Acoustics and photometry */

function acousticsParagraph() {
  const grades = STI_GRADES.map((grade, i) => {
    const next = STI_GRADES[i + 1];
    return next ? `${grade.label} ${grade.min.toFixed(2)}-${next.min.toFixed(2)}` : `${grade.label} from ${grade.min.toFixed(2)}`;
  }).join(', ');
  return `Reverberation follows Sabine, RT60 = 0.161 V / (A + 4mV), in six octave bands from 125 Hz to 4 kHz; the headline figure is the 500 Hz band. The Acoustic Art Frame 50x70 (NRC 0.70) and Acoustic Wall Baffle 120 (NRC 0.85) add felt absorption in place of the wall they cover. Speech intelligibility is the reverberation-only STI: ${grades}.`;
}

function illuminanceParagraph() {
  return `Illuminance follows the lumen method: each lit module sends a share of its flux, scaled by its DALI-2 level, straight to the floor, and all flux inter-reflects as an integrating sphere with a 0.8 maintenance factor. The task target is ${TASK_TARGET_LUX} lx (EN 12464-1); grades are Ambient Lounge under 100 lx, Residential Balanced 100-250 lx and Studio Task above 250 lx. The Floor Lux Grid draws point-by-point iso-lux contours.`;
}

function composePhysics(analysis, ctx) {
  const subs = new Set(analysis.subtopics.physics);
  const paragraphs = [];
  const citations = [];
  if (subs.has('acoustics') || !(subs.has('illuminance') || subs.has('brightness'))) {
    paragraphs.push(acousticsParagraph());
    citations.push(CITE.physics);
  }
  if (subs.has('illuminance') || subs.has('brightness')) {
    paragraphs.push(illuminanceParagraph());
    citations.push(CITE.lux);
  }
  const live = liveFigures(ctx);
  const subject = live.room ?? live.wall;
  if (subject) {
    const { physics } = subject;
    paragraphs.push(
      `Live check on your ${subject.label}: RT60 ${physics.rt60Sec.toFixed(2)} s at 500 Hz, STI ${physics.stiScore.toFixed(2)} (${physics.stiGrade}), average floor ${int(physics.avgFloorLux)} lx (${physics.lightingGrade}).`,
    );
    citations.push(subject.cite);
  }
  return section(paragraphs, {
    metrics: subject
      ? [
          { label: 'RT60', value: `${subject.physics.rt60Sec.toFixed(2)} s` },
          { label: 'STI', value: subject.physics.stiScore.toFixed(2) },
          { label: 'Floor Lux', value: `${int(subject.physics.avgFloorLux)} lx` },
        ]
      : [
          { label: 'Bands', value: '125 Hz-4 kHz' },
          { label: 'Task Target', value: `${TASK_TARGET_LUX} lx` },
        ],
    citations,
    actions: [ACTIONS.room, ACTIONS.wall],
  });
}

/* Spatial studio */

function composeSpatial(analysis) {
  const subs = new Set(analysis.subtopics.spatial);
  const paragraphs = [];
  const actions = [];
  const citations = [CITE.spatial];
  if (subs.has('lenses') || subs.has('planner')) {
    paragraphs.push(
      `Open the 3D Spatial Studio and pick a lens in its header: ${CAMERA_MODE_LABELS.orbit} (drag for a full 360-degree orbit, pitch ${CAMERA_PITCH.min} to ${CAMERA_PITCH.max} deg, wheel zoom ${CAMERA_ZOOM.min}x to ${CAMERA_ZOOM.max}x), ${CAMERA_MODE_LABELS.inside} (eye height ${EYE_HEIGHT_CM} cm; walk with W A S D or the arrow keys, and the mouse wheel sets the field of view from ${INSIDE_FOV.min} to ${INSIDE_FOV.max} deg, default ${INSIDE_FOV_DEG} deg) and ${CAMERA_MODE_LABELS.elevation} (square-on view of the active wall). The North / East / South / West switcher picks the active wall.`,
    );
    actions.push(ACTIONS.inside, ACTIONS.room);
  }
  if (subs.has('gizmo')) {
    paragraphs.push(
      `Select a module and drag it in the 3D view: the pointer ray is intersected with the wall plane, so the part slides in true wall centimetres and one release commits one undoable step. The inspector axis lock sets ${Object.values(AXIS_LOCK_LABELS).join(', ')}; press G to grab with the keyboard, the arrow keys to nudge, Enter to commit and Escape to cancel.`,
    );
    actions.push(ACTIONS.room);
  }
  if (subs.has('exports')) {
    paragraphs.push(
      'Wall Studio > Blueprint opens the 1:20 ISO 5457 / 7200 A3 sheet with its drilling schedule, downloadable as .SVG or AutoCAD R12 .DXF. The 3D Room Planner exports Wavefront .OBJ in cm units, and Capture .PNG renders a 1600 x 1000 studio card with the room specification.',
    );
    citations.push(CITE.cad);
    actions.push(ACTIONS.wall, ACTIONS.room);
  }
  if (subs.has('compare')) {
    paragraphs.push(
      `Compare Changes in either planner diffs the live draft against its last saved cloud revision: modules, 24V load, driver, RT60 and illuminance side by side. On Account, Compare Projects diffs any two saved projects. Undo and redo keep ${HISTORY_LIMIT} steps.`,
    );
  }
  if (subs.has('share')) {
    paragraphs.push(
      'Share Link copies a ?scene= URL: the wall or room is encoded as Base64URL in the link and rebuilt through the same sanitizers when it opens, so nothing is stored on a server.',
    );
  }
  if (subs.has('wallStudio') && paragraphs.length < 3) {
    paragraphs.push(
      `The 2D Wall Studio composes one elevation up to ${WALL_WIDTH.max} x ${WALL_HEIGHT.max} cm with up to ${MAX_WALL_ITEMS} modules: marquee and shift-click selection, align and distribute, smart guides to the ${EYE_DATUM_CM} cm eye datum, ${GRID_STEP_CM} cm grid snap and live 24V bus routing.`,
    );
    actions.push(ACTIONS.wall);
  }
  if (paragraphs.length === 0) {
    paragraphs.push(
      `The 3D Spatial Studio plans all four walls of a room up to ${ROOM_WIDTH.max} x ${ROOM_DEPTH.max} x ${ROOM_HEIGHT.max} cm, with ${CAMERA_MODE_LABELS.orbit}, ${CAMERA_MODE_LABELS.inside} and ${CAMERA_MODE_LABELS.elevation} lenses, direct wall-plane dragging, conflict checks against furniture, .OBJ and .PNG export. The 2D Wall Studio adds the 1:20 .SVG / .DXF blueprint.`,
    );
    actions.push(ACTIONS.room, ACTIONS.wall);
  }
  return section(paragraphs.slice(0, 3), {
    metrics: [
      { label: 'Eye Height', value: `${EYE_HEIGHT_CM} cm` },
      { label: 'Inside FOV', value: `${INSIDE_FOV.min}-${INSIDE_FOV.max} deg` },
      { label: 'Blueprint', value: '1:20 A3' },
    ],
    citations,
    actions,
  });
}

/* Commerce */

function promoParagraph() {
  const codes = PROMOS.map((promo) => `${promo.code} ${promo.pct}% (${promo.label})`).join(', ');
  return `Promo codes apply at checkout to the net before VAT: ${codes}. TRADE15 is the 15% trade programme discount.`;
}

function vatParagraph() {
  return `VAT is ${VAT_RATE_PCT}% on the discounted net. The quote works in integer minor units: discount and VAT are each rounded once, half up, and gross = net - discount + VAT exactly, in USD, EUR and HUF alike. The server re-prices every requisition and refuses a stale total.`;
}

function fulfilmentParagraph() {
  return `${FULFILMENT_LABELS.consolidated} ships everything as one wave once the longest-lead part is ready. ${FULFILMENT_LABELS.split} sends Wave 01, Rough-In & In-Stock Dispatch, with the 24V driver and every part with a lead of ${STOCK_MAX_WEEKS} weeks or less (usually 1-2 weeks), so the electrician can rough in the wall; Wave 02, Custom Millwork & Luminaires, follows with the made-to-order parts.`;
}

function cratesParagraph() {
  const crates = CRATE_TYPES.map((type) => `${type.label} (${type.capacityKg} kg)`).join(', ');
  return `Parts are packed first-fit decreasing by mass into ${crates}, numbered CRT-01, CRT-02 and on; anything ${LONG_SPAN_CM} cm or longer rides in a long-span tube. Freight class follows gross mass and the longest crate: ${FREIGHT_CLASSES.parcel} under ${PARCEL_MAX_KG} kg and ${PARCEL_MAX_LENGTH_CM} cm, ${FREIGHT_CLASSES.pallet} from ${PALLET_MIN_KG} kg, otherwise ${FREIGHT_CLASSES.van}.`;
}

function cloudParagraph() {
  return `Lumen Cloud keeps ${MAX_STORED_PROJECTS} projects, ${MAX_STORED_QUOTES} quotes and ${MAX_STORED_TICKETS} engineering tickets per library: this browser profile when signed out, your account when signed in, and a sign-in moves the profile library into the account. Saves made offline stay on the device and sync when the API is reachable.`;
}

function pricingParagraph(currency) {
  const rate = (code) => {
    const entry = getCurrency(code);
    return `${code} ${entry.num / entry.den}`;
  };
  return `List prices are set in USD and converted at fixed ratios: ${rate('EUR')} and ${rate('HUF')} per USD. Your active currency is ${currency.code} (${currency.label}); switch it in the bag or at checkout.`;
}

function composeCommerce(analysis, ctx) {
  const currency = getCurrency(ctx.currency);
  const subs = new Set(analysis.subtopics.commerce);
  const paragraphs = [];
  const citations = [];
  const actions = [ACTIONS.checkout];
  if (subs.has('promo')) paragraphs.push(promoParagraph());
  if (subs.has('vat')) paragraphs.push(vatParagraph());
  if (subs.has('fulfilment') || subs.has('shipping')) {
    paragraphs.push(fulfilmentParagraph());
    citations.push(CITE.logistics);
  }
  if (subs.has('crates') || (subs.has('shipping') && !subs.has('fulfilment'))) {
    paragraphs.push(cratesParagraph());
    citations.push(CITE.logistics);
  }
  if (subs.has('cloud')) {
    paragraphs.push(cloudParagraph());
    citations.push(CITE.cloud);
  }
  if (subs.has('pricing') && paragraphs.length < 2) paragraphs.push(pricingParagraph(currency));
  if (subs.has('quote') && paragraphs.length < 2) {
    paragraphs.push(
      'Checkout builds the quote sheet from the cart with the sized 24V driver line; Submit Requisition sends it to Lumen Cloud, which prices it again from the catalog and issues an LMN-R reference you can track under Account.',
    );
  }
  if (paragraphs.length === 0) paragraphs.push(pricingParagraph(currency), promoParagraph());
  if (citations.length === 0) citations.push(CITE.quote);

  const metrics = [];
  if (subs.has('promo') || subs.has('pricing')) {
    metrics.push(...PROMOS.map((promo) => ({ label: promo.code, value: `${promo.pct}% off` })));
  }
  if (subs.has('vat') || subs.has('promo')) metrics.push({ label: 'VAT', value: `${VAT_RATE_PCT}%` });
  if (subs.has('fulfilment') || subs.has('shipping') || subs.has('crates')) {
    metrics.push({ label: 'Wave 01', value: `Stock, <=${STOCK_MAX_WEEKS} wk` }, { label: 'Crate Types', value: String(CRATE_TYPES.length) });
  }
  if (subs.has('cloud')) {
    metrics.push(
      { label: 'Projects', value: String(MAX_STORED_PROJECTS) },
      { label: 'Quotes', value: String(MAX_STORED_QUOTES) },
      { label: 'Tickets', value: String(MAX_STORED_TICKETS) },
    );
    actions.splice(0, actions.length, ACTIONS.wall, ACTIONS.room);
  }
  const cart = ctx.bagItems.length > 0 ? cartFigures(ctx) : null;
  if (cart && (subs.has('fulfilment') || subs.has('shipping') || subs.has('crates') || subs.has('quote') || subs.has('vat'))) {
    paragraphs.push(cartLogisticsLine(cart));
    metrics.push(...cartMetrics(cart));
    citations.push(CITE.cart);
  }
  return section(paragraphs.slice(0, 4), { metrics, citations: [...citations, CITE.quote], actions });
}

/* Live workspace */

function wallFigures(layout) {
  return {
    kind: 'wall',
    label: '2D wall',
    cite: CITE.wall,
    action: ACTIONS.wall,
    envelope: `${layout.wall.widthCm} x ${layout.wall.heightCm} cm`,
    summary: summarizeWall(layout),
    bus: computeBusTopology(layout),
    physics: computeEnvironmentalPhysics(layout),
    conflicts: findConflicts(layout).size,
    counts: null,
  };
}

function roomFigures(state) {
  const preset = ROOM_SIZE_PRESETS.find((entry) => entry.id === roomSizePreset(state.room));
  const furniture = getFurniture(state.room.furniture);
  return {
    kind: 'room',
    label: '3D room',
    cite: CITE.room,
    action: ACTIONS.room,
    envelope: `${state.room.widthCm} x ${state.room.depthCm} x ${state.room.heightCm} cm${preset ? `, ${preset.label}` : ''}${furniture && furniture.id !== 'none' ? `, ${furniture.label}` : ''}`,
    summary: summarizeWall(state),
    bus: computeBusTopology(unrolledRoom(state)),
    physics: computeEnvironmentalPhysics(state),
    conflicts: findRoomConflicts(state).size,
    counts: wallCounts(state.items),
  };
}

function cartFigures(ctx) {
  const consolidated = buildQuote({ items: ctx.bagItems, currencyCode: ctx.currency, date: QUOTE_DATE });
  const split = buildQuote({ items: ctx.bagItems, currencyCode: ctx.currency, date: QUOTE_DATE, fulfilmentMode: 'split' });
  return { quote: consolidated, split: split.logistics };
}

/** Every non-empty live workspace, computed with the same engines the planners and checkout use. */
function liveFigures(ctx) {
  return {
    wall: ctx.wallDraft && ctx.wallDraft.items.length > 0 ? wallFigures(ctx.wallDraft) : null,
    room: ctx.roomDraft && ctx.roomDraft.items.length > 0 ? roomFigures(ctx.roomDraft) : null,
  };
}

function wallSplit(counts) {
  return ROOM_WALLS.map((wall) => `${WALL_LABELS[wall].split(' ')[0]} ${counts[wall]}`).join(' / ');
}

function driverVerdict(summary) {
  const { psu, loadW } = summary;
  if (psu.drivers === 0) return 'No lit modules: no driver required.';
  const pctUsed = Math.round(psu.utilisation * 100);
  const line = `${psu.label} at ${pctUsed}% utilisation`;
  if (psu.id === 'driver-60' && pctUsed > 100 - DRIVER_HEADROOM_PCT) {
    return `${line}, above the ${100 - DRIVER_HEADROOM_PCT}% headroom line: specify the Lumen 150W 24V Driver for margin.`;
  }
  if (psu.id === 'driver-array') return `${line}: ${loadW} W rated splits across ${psu.drivers} bus runs, one 150W driver each.`;
  return `${line}, inside the ${DRIVER_HEADROOM_PCT}% headroom rule.`;
}

function electricalLine(fig) {
  const { summary, bus } = fig;
  const drop = `${bus.voltageDropPct.toFixed(2)}% (${bus.voltageDropV.toFixed(2)} V)`;
  return `Rated 24V load ${wattsLabel(summary.loadW)} (${wattsLabel(summary.activeW)} active at the current DALI-2 levels${summary.dimmed > 0 ? `, ${plural(summary.dimmed, 'channel')} dimmed` : ''}). Driver: ${driverVerdict(summary)} The bus runs ${bus.totalRunM.toFixed(2)} m from the ${bus.origin.kind === 'datum' ? 'utility datum' : bus.origin.kind === 'hub' ? 'DALI-2 hub' : 'track bus'} through ${plural(bus.nodes.length, 'node')}, ${drop} drop, ${bus.withinSpec ? `within the ${DROP_LIMIT_PCT}% limit` : `over the ${DROP_LIMIT_PCT}% limit: add a feed or split the run`} on ${CONDUCTOR_LABEL} copper.`;
}

function acousticLine(fig) {
  const { physics } = fig;
  const delta = physics.acousticDeltaSec < 0 ? `, ${Math.abs(physics.acousticDeltaSec).toFixed(2)} s below the bare-room ${physics.baselineRt60Sec.toFixed(2)} s` : ', no added absorption yet';
  return `Sabine RT60 is ${physics.rt60Sec.toFixed(2)} s at 500 Hz${delta}; STI ${physics.stiScore.toFixed(2)} (${physics.stiGrade}).`;
}

function lightingLine(fig) {
  const { physics, summary } = fig;
  return `Average floor illuminance ${int(physics.avgFloorLux)} lx (${physics.lightingGrade}, ${physics.taskCoveragePct}% of the ${TASK_TARGET_LUX} lx task target) from ${int(summary.lumens)} lm of lit output.`;
}

function conflictLine(fig) {
  return fig.conflicts === 0
    ? 'No placement conflicts.'
    : `${plural(fig.conflicts, 'module')} in conflict (overlap, out of bounds${fig.kind === 'room' ? ' or furniture clash' : ''}): fix ${fig.conflicts === 1 ? 'it' : 'them'} before quoting.`;
}

function workspaceMetrics(fig) {
  return [
    { label: 'Modules', value: String(fig.summary.modules) },
    { label: 'Rated Load', value: wattsLabel(fig.summary.loadW) },
    { label: 'Active', value: wattsLabel(fig.summary.activeW) },
    { label: 'Driver', value: fig.summary.psu.drivers === 0 ? 'None' : fig.summary.psu.id === 'driver-60' ? '60W' : fig.summary.psu.id === 'driver-150' ? '150W' : `${fig.summary.psu.drivers}x 150W` },
    { label: 'Drop', value: `${fig.bus.voltageDropPct.toFixed(2)}%` },
    { label: 'RT60', value: `${fig.physics.rt60Sec.toFixed(2)} s` },
    { label: 'STI', value: fig.physics.stiScore.toFixed(2) },
    { label: 'Floor Lux', value: `${int(fig.physics.avgFloorLux)} lx` },
  ];
}

function cartLogisticsLine({ quote, split }) {
  const { logistics } = quote;
  const crates = logistics.crates.map((crate) => `${crate.code} ${crate.label} ${crate.grossWeightKg} kg`).join(', ');
  const waves = split.waves.map((wave) => `${wave.code} ${wave.label} (${wave.window}, ${plural(wave.itemCount, 'piece')})`).join('; ');
  return `Your cart ships in ${plural(logistics.crates.length, 'crate')}: ${crates}. Gross ${logistics.grossWeightKg} kg, ${logistics.totalVolumeM3} m3, ${logistics.freightClass}. ${FULFILMENT_LABELS.consolidated}: ${logistics.windowLabel}. ${FULFILMENT_LABELS.split}: ${waves}.`;
}

function cartMetrics({ quote }) {
  return [
    { label: 'Crates', value: String(quote.logistics.crates.length) },
    { label: 'Gross Mass', value: `${quote.logistics.grossWeightKg} kg` },
    { label: 'Total', value: formatMoney(quote.totals.gross, quote.currency) },
  ];
}

function cartParagraphs(ctx, facets) {
  const cart = cartFigures(ctx);
  const { quote } = cart;
  const pieces = quote.lines.filter((line) => !line.driver).reduce((sum, line) => sum + line.qty, 0);
  const paragraphs = [
    `Your cart holds ${plural(pieces, 'part')} on ${plural(quote.lines.filter((line) => !line.driver).length, 'line')}: net ${formatMoney(quote.totals.net, quote.currency)}, ${VAT_RATE_PCT}% VAT ${formatMoney(quote.totals.vat, quote.currency)}, gross ${formatMoney(quote.totals.gross, quote.currency)}. The 24V load is ${wattsLabel(quote.electrical.loadW)}: ${quote.electrical.psu.drivers === 0 ? 'no driver required' : `${quote.electrical.psu.label} is added to the quote`}.`,
  ];
  if (facets.length === 0 || facets.includes('logistics') || facets.includes('cost')) paragraphs.push(cartLogisticsLine(cart));
  return { paragraphs, metrics: cartMetrics(cart), cart };
}

function figureParagraph(fig, facets, audit, currency) {
  const head =
    fig.kind === 'room'
      ? `Your 3D room (${fig.envelope}) carries ${plural(fig.summary.modules, 'module')}: ${wallSplit(fig.counts)}.`
      : `Your 2D wall (${fig.envelope}) carries ${plural(fig.summary.modules, 'module')}.`;
  const all = audit || facets.length === 0;
  const lines = [head];
  if (all || facets.includes('electrical')) lines.push(electricalLine(fig));
  if (all || facets.includes('acoustic')) lines.push(acousticLine(fig));
  if (all || facets.includes('lighting')) lines.push(lightingLine(fig));
  if (all || facets.includes('conflicts')) lines.push(conflictLine(fig));
  if (facets.includes('cost')) lines.push(`List price of the mounted parts: ${priceLabel(fig.summary.priceUsd, currency)} before VAT and driver.`);
  return lines.join(' ');
}

function emptyWorkspaceLine(target) {
  if (target === 'room') return 'Your 3D room has no modules mounted yet. Open the 3D Spatial Studio, mount parts from the Asset Shelf, then ask again for a live audit.';
  if (target === 'wall') return 'Your 2D wall is empty. Load a preset or mount parts in the Wall Studio, then ask again for a live audit.';
  if (target === 'cart') return 'Your cart is empty. Add parts from the Catalog or send a planner layout to the bag, then ask again for crates, waves and totals.';
  return 'Your 2D wall, 3D room and cart are all empty, so there is nothing live to audit yet. Mount parts in a planner or add them to the cart and ask again.';
}

function resolveTarget(analysis, ctx) {
  const { target, explicit2d } = analysis.workspace;
  if (ctx.route === '/room-3d' && target === 'wall' && !explicit2d) return 'room';
  if (target) return target;
  if (ctx.route === '/room-3d') return 'room';
  if (ctx.route === '/studio-2d') return 'wall';
  if (ctx.route === '/checkout') return 'cart';
  return 'auto';
}

function composeWorkspace(analysis, ctx) {
  const { facets, audit } = analysis.workspace;
  const live = liveFigures(ctx);
  const target = resolveTarget(analysis, ctx);
  const currency = getCurrency(ctx.currency);
  const paragraphs = [];
  const citations = [];
  const actions = [];
  let metrics = [];

  if (target === 'cart') {
    if (ctx.bagItems.length === 0) return section([emptyWorkspaceLine('cart')], { citations: [CITE.cart], actions: [ACTIONS.catalog] });
    const cart = cartParagraphs({ ...ctx, currency: currency.code }, facets);
    return section(cart.paragraphs, { metrics: cart.metrics, citations: [CITE.cart, CITE.quote, CITE.logistics], actions: [ACTIONS.checkout] });
  }

  const order = target === 'auto' ? ['room', 'wall'] : [target];
  for (const kind of order) {
    const fig = live[kind];
    if (!fig) continue;
    paragraphs.push(figureParagraph(fig, facets, audit, currency));
    citations.push(fig.cite, CITE.bus, CITE.physics);
    actions.push(fig.action);
    if (metrics.length === 0) metrics = workspaceMetrics(fig);
  }
  if (target === 'auto' && ctx.bagItems.length > 0 && (paragraphs.length === 0 || facets.includes('logistics'))) {
    const cart = cartParagraphs({ ...ctx, currency: currency.code }, facets);
    paragraphs.push(...cart.paragraphs);
    if (metrics.length === 0) metrics = cart.metrics;
    citations.push(CITE.cart);
    actions.push(ACTIONS.checkout);
  }
  if (paragraphs.length === 0) {
    paragraphs.push(emptyWorkspaceLine(target));
    if (analysis.subtopics.electrical.length > 0) paragraphs.push(driverParagraphs(currency)[1]);
    actions.push(target === 'wall' ? ACTIONS.wall : ACTIONS.room);
    citations.push(target === 'wall' ? CITE.wall : CITE.room);
  }
  return section(paragraphs, { metrics, citations, actions });
}

/* Studio guide: how the site, the planners and their controls work */

const LENS_SHORT = Object.freeze({ orbit: 'Orbit', inside: `Inside ${EYE_HEIGHT_CM} cm`, elevation: 'Elevation' });
const LENS_LIST = `${LENS_SHORT.orbit}, ${LENS_SHORT.inside} and ${LENS_SHORT.elevation}`;
const MAX_ROOM_LABEL = `${ROOM_WIDTH.max} x ${ROOM_DEPTH.max} x ${ROOM_HEIGHT.max} cm`;

function presetList() {
  return listLabel(ROOM_SIZE_PRESETS.map((preset) => `${preset.label} ${preset.widthCm} x ${preset.depthCm}`));
}

function ceilingRange() {
  const heights = ROOM_SIZE_PRESETS.map((preset) => preset.heightCm);
  return `${Math.min(...heights)} to ${Math.max(...heights)} cm`;
}

function mentions2d(analysis, ctx) {
  return /\b(2d|wall studio|elevation)\b/.test(analysis.norm) || ctx.route === '/studio-2d';
}

const GUIDE_SECTIONS = Object.freeze({
  open3d(analysis, ctx) {
    const inside = ctx.route === '/room-3d';
    const fault = analysis.guide.troubled || inside;
    const nav =
      `Clicking 3D Room in the top navigation bar scrolls to the interactive 3D Spatial Studio preview on the Overview page, so you can preview its four camera and physics acts first: the 360-degree orbit, the ${EYE_HEIGHT_CM} cm eye-level walkthrough, the transform gizmo and the iso-lux field. To enter the full-screen 3D editor (/room-3d), click Launch 3D Spatial Studio in that section, or use the direct launch button right below this message.`;
    const checks = `three things cover almost every case. The editor draws with WebGL 2, so switch on hardware acceleration in your browser settings or use a current Chrome, Edge, Firefox or Safari; without WebGL the page says so and keeps the scene, inspector and 2D bridge live. The first launch downloads the 3D engine, so give the boot overlay a few seconds on a slow connection. And a reload is always safe: your last room is kept on this device and reopens exactly as you left it.`;
    const quickStart = `Once inside, pick the active wall (North, East, South or West) in the header, click any part in the left Asset Shelf to mount it there, and switch lenses between ${LENS_LIST}.`;
    let paragraphs;
    if (inside) paragraphs = [`You are already in the 3D Spatial Studio (/room-3d). If the viewport stays empty, ${checks}`, nav];
    else if (fault) paragraphs = [nav, `If the studio still does not open, ${checks}`];
    else paragraphs = [nav, quickStart];
    return {
      paragraphs,
      metrics: [
        { label: 'Editor', value: '/room-3d' },
        { label: 'Lenses', value: `${LENS_SHORT.orbit} / Inside / ${LENS_SHORT.elevation}` },
        { label: 'Renderer', value: 'WebGL 2' },
      ],
      actions: [ACTIONS.launch, ACTIONS.walkthrough],
      citations: [CITE.navigation, CITE.spatial, ...(fault ? [CITE.troubleshooting] : [])],
    };
  },

  wallOpen(analysis) {
    const paragraphs = [
      `Wall Studio in the top navigation bar opens the 2D Wall Studio (/studio-2d) directly, with no preview step. It composes one elevation up to ${WALL_WIDTH.max} x ${WALL_HEIGHT.max} cm with up to ${MAX_WALL_ITEMS} modules: start from a Wall Preset or click parts under Components, then drag, align and distribute them on the ${GRID_STEP_CM} cm grid. Blueprint in the toolbar opens the 1:20 sheet with its drilling schedule, ready to download as .SVG or AutoCAD .DXF.`,
    ];
    if (analysis.guide.troubled) {
      paragraphs.push('If it does not load, reload the page: the wall is kept on this device. The 2D studio is drawn in plain HTML and SVG, so it needs no WebGL.');
    }
    return {
      paragraphs,
      metrics: [
        { label: 'Wall Max', value: `${WALL_WIDTH.max} x ${WALL_HEIGHT.max} cm` },
        { label: 'Modules', value: String(MAX_WALL_ITEMS) },
        { label: 'Grid', value: `${GRID_STEP_CM} cm` },
      ],
      actions: [ACTIONS.wall],
      citations: [CITE.navigation, CITE.wallStudio],
    };
  },

  move(analysis, ctx) {
    const [product] = analysis.products;
    const room = `In the 3D Spatial Studio, choose the active wall (North, East, South or West) in the header, then click any part in the left Asset Shelf: one click mounts it on that wall${product ? `, and the ${product.name} sits there with the other parts` : ''}. Click a mounted module in the 3D view to select it and reveal the X/Y Transform Gizmo, then drag the module or a handle straight across the wall. The pointer ray is solved against the wall plane, so the part slides in true wall centimetres, and each release is one undoable step.`;
    const keys = `From the keyboard, press G to grab the selected module, nudge it with the arrow keys, then Enter (or G again) to drop it or Escape to cancel. Grid Snap in the header holds moves to 5 cm (switch it off for 1 cm free moves), and the inspector's Transform panel offers ${listLabel(Object.values(AXIS_LOCK_LABELS))}. Overlaps, parts past the wall edge and clashes with the reference furniture are flagged as conflicts.`;
    const wall = `In the 2D Wall Studio, click a part under Components to mount it, drag modules directly on the elevation, Shift + Click or drag a marquee across empty wall to select several, and use Align & Distribute in the inspector. The arrow keys nudge by one grid step (Shift for ten) and Delete removes the selection.`;
    return {
      paragraphs: mentions2d(analysis, ctx) && !/\b3d\b/.test(analysis.norm) ? [wall, room, keys] : [room, keys, wall],
      metrics: [
        { label: 'Grid Snap', value: '5 cm' },
        { label: 'Free Move', value: '1 cm' },
        { label: 'Axis Locks', value: 'X / Y' },
      ],
      actions: [ACTIONS.launch, ACTIONS.wall],
      citations: [CITE.spatial, CITE.wallStudio],
    };
  },

  navigate(analysis, ctx) {
    const { walk, rotate, resize } = analysis.guide;
    const lenses = `The 3D Spatial Studio has three camera lenses in its header. ${LENS_SHORT.orbit} is the default: drag to circle the room a full 360 degrees, tilt from ${CAMERA_PITCH.min} to ${CAMERA_PITCH.max} deg and zoom with the mouse wheel (${CAMERA_ZOOM.min}x to ${CAMERA_ZOOM.max}x); the arrow keys step the camera and Home or 0 resets it. ${LENS_SHORT.inside} puts you on your feet at eye height: walk with W A S D or the arrow keys, turn with Q and E, drag to look around, and the mouse wheel or + and - set the field of view from ${INSIDE_FOV.min} to ${INSIDE_FOV.max} deg. ${LENS_SHORT.elevation} shows the active wall square-on.`;
    const size = `Room size lives in the Envelope & Lighting panel on the left: the Room scale presets set ${presetList()} (ceilings ${ceilingRange()}), and the width, depth and ceiling fields take any size from ${ROOM_WIDTH.min} x ${ROOM_DEPTH.min} x ${ROOM_HEIGHT.min} cm up to ${MAX_ROOM_LABEL}. The 24V bus, RT60 and floor lux recalculate as the envelope changes.`;
    const wall = `In the 2D Wall Studio, Wall Setup sets the elevation from ${WALL_WIDTH.min} x ${WALL_HEIGHT.min} cm up to ${WALL_WIDTH.max} x ${WALL_HEIGHT.max} cm.`;
    const sizeFirst = resize && !walk && !rotate;
    const paragraphs = sizeFirst ? [size, lenses] : [lenses, size];
    if (resize && mentions2d(analysis, ctx)) paragraphs.splice(sizeFirst ? 1 : 2, 0, wall);
    return {
      paragraphs,
      metrics: [
        { label: 'Orbit Pitch', value: `${CAMERA_PITCH.min}-${CAMERA_PITCH.max} deg` },
        { label: 'Inside FOV', value: `${INSIDE_FOV.min}-${INSIDE_FOV.max} deg` },
        { label: 'Eye Height', value: `${EYE_HEIGHT_CM} cm` },
        { label: 'Max Room', value: MAX_ROOM_LABEL },
      ],
      actions: sizeFirst ? [ACTIONS.launch, ACTIONS.loft] : [ACTIONS.walkthrough, ACTIONS.launch, ACTIONS.loft],
      citations: [CITE.spatial],
    };
  },

  remove() {
    return {
      paragraphs: [
        `In the 3D Spatial Studio, select the module (click it in the view or in the Modules outliner) and press Remove under Actions in the inspector. In the 2D Wall Studio, select one or more modules and press Delete or Backspace, or use Remove in the inspector. Ctrl+Z (Cmd+Z on a Mac) brings anything back, up to ${HISTORY_LIMIT} steps.`,
      ],
      metrics: [
        { label: 'Undo', value: 'Ctrl+Z' },
        { label: 'History', value: `${HISTORY_LIMIT} steps` },
      ],
      actions: [ACTIONS.launch, ACTIONS.wall],
      citations: [CITE.controls],
    };
  },

  save() {
    return {
      paragraphs: [
        `Your working draft is kept on this device automatically after every change. Save to Cloud, in the summary under each planner, adds a named copy to your library: it needs at least one mounted module, and Lumen Cloud keeps ${MAX_STORED_PROJECTS} projects per library, this browser profile while you are signed out and your account once you sign in.`,
        'Saving under an existing name adds a revision; once the library is full, a new name is refused until you delete a project on the Account page, where every saved project is listed. With the API unreachable, a save stays on this device and syncs when the connection returns.',
      ],
      metrics: [
        { label: 'Projects', value: String(MAX_STORED_PROJECTS) },
        { label: 'Drafts', value: 'Kept on this device' },
      ],
      actions: [ACTIONS.account],
      citations: [CITE.cloud],
    };
  },

  cart(analysis) {
    const paragraphs = [
      'Add parts from any Catalog card or product page with Add to Cart once the finish is chosen. From a planner, Sync Room to Cart or Sync Wall to Cart sends every mounted module in one step. Cart, at the top right, opens the drawer with your lines, the 24V load and the subtotal; Configure Quote & Checkout builds the quote sheet with the sized 24V driver, crates and dispatch waves, and Submit Requisition sends it to Lumen Cloud for an LMN-R reference.',
    ];
    if (analysis.guide.troubled || /\bempt\w*\b/.test(analysis.norm)) {
      paragraphs.push('The cart is kept per browser profile, so another browser or a private window starts with an empty cart.');
    }
    return { paragraphs, metrics: [{ label: 'VAT', value: `${VAT_RATE_PCT}%` }], actions: [ACTIONS.catalog, ACTIONS.checkout], citations: [CITE.quote] };
  },

  account() {
    return {
      paragraphs: [
        `Sign In at the top right opens a dialog: enter your email and a password of at least ${PASSWORD_MIN} characters. There is no separate registration, so the first sign-in with an address opens its account library, and Lumen Cloud moves this browser's saved projects, quotes and tickets into it, ready on any device signed in with the same address. Once signed in, the button reads Account and lists your projects, requisitions and engineering tickets.`,
      ],
      metrics: [{ label: 'Password', value: `${PASSWORD_MIN}+ characters` }],
      actions: [ACTIONS.account],
      citations: [CITE.cloud],
    };
  },

  search() {
    return {
      paragraphs: [
        `Search, the first control in the top bar, opens the command palette, and Ctrl+K (Cmd+K on a Mac) opens it from any page. Type a part, a workspace or a command and press Enter to jump straight there. The Catalog lists all ${PRODUCTS.length} parts with their specs and prices.`,
      ],
      metrics: [{ label: 'Shortcut', value: 'Ctrl+K / Cmd+K' }],
      actions: [ACTIONS.catalog],
      citations: [CITE.controls],
    };
  },

  modes() {
    return {
      paragraphs: [
        'Visual and Specs, the switch in the top bar, set how much engineering the whole site shows. Visual is the clean presentation view. Specs reveals the technical layer: the 24V bus wiring in the Wall Studio, dimension guides, rulers, SKU tags and clearance callouts in the planners, module coordinates, the six-band octave RT60 spectrum and the engineering telemetry. Your choice is remembered on this device.',
      ],
      metrics: [
        { label: 'Visual', value: 'Presentation' },
        { label: 'Specs', value: 'Engineering layer' },
      ],
      actions: [ACTIONS.wall, ACTIONS.launch],
      citations: [CITE.controls],
    };
  },

  shortcuts(analysis) {
    const zen = 'Zen, at the right of the 3D studio header, collapses the side docks for a full-viewport view; Docks brings them back.';
    const keys = `Keyboard shortcuts: Ctrl+K (Cmd+K on a Mac) opens the command palette anywhere, and Ctrl+Z undoes while Ctrl+Y or Ctrl+Shift+Z redoes in both planners (${HISTORY_LIMIT} steps). In the 3D Spatial Studio, G grabs the selected module, the arrow keys nudge it, Enter drops it and Escape cancels; in the ${LENS_SHORT.inside} lens, W A S D walk and Q and E turn. In the 2D Wall Studio, Ctrl+A selects every module, the arrow keys nudge (Shift for ten steps) and Delete removes the selection.`;
    const zenFirst = /\b(zen|full ?screen|maximi[sz]e|docks?|hide)\b/.test(analysis.norm) && !/\b(keyboard|shortcuts?|hot ?keys?|ctrl|cmd)\b/.test(analysis.norm);
    return {
      paragraphs: zenFirst ? [zen, keys] : [`${keys} ${zen}`],
      metrics: [
        { label: 'Palette', value: 'Ctrl+K / Cmd+K' },
        { label: 'Undo', value: 'Ctrl+Z' },
        { label: 'Redo', value: 'Ctrl+Y' },
      ],
      actions: [ACTIONS.launch, ACTIONS.wall],
      citations: [CITE.controls],
    };
  },

  chrome() {
    return {
      paragraphs: [
        'The top bar, left to right: the Lumen mark returns to the Overview; Overview, 3D Room (it scrolls to the 3D Spatial Studio preview, whose launch key opens the editor), Catalog and Wall Studio; then Search (Ctrl+K), the Visual / Specs switch, Sign In or Account, and Cart with its live item count. Below 1200 px wide the page links move to a second row.',
      ],
      metrics: [{ label: 'Pages', value: 'Overview / 3D Room / Catalog / Wall Studio' }],
      actions: [ACTIONS.launch, ACTIONS.catalog],
      citations: [CITE.navigation],
    };
  },

  trouble() {
    return {
      paragraphs: [
        'A few checks clear most issues. Reload the page: your 2D wall, 3D room and cart are kept on this device, so nothing is lost. Keep hardware acceleration switched on so the 3D Spatial Studio can use WebGL 2. And if Lumen Cloud is unreachable, the planners and this assistant keep working on the device and saves wait there until the connection returns; only requisitions need the connection.',
        'Tell me which page or button misbehaves, for example "the 3D room will not open" or "I cannot move a shelf", and I will walk you through it.',
      ],
      metrics: [],
      actions: [ACTIONS.launch, ACTIONS.wall],
      citations: [CITE.troubleshooting],
    };
  },
});

function composeGuide(analysis, ctx) {
  const ids = analysis.guide.intents.length > 0 ? analysis.guide.intents.slice(0, 3) : ['trouble'];
  const parts = ids.map((id) => GUIDE_SECTIONS[id](analysis, ctx));
  // The leading intent keeps its whole answer; the others add their first two paragraphs.
  const paragraphs = parts.flatMap((part, i) => (i === 0 ? part.paragraphs : part.paragraphs.slice(0, 2))).slice(0, 5);
  const [product] = analysis.products;
  return section(paragraphs, {
    metrics: uniqueBy(parts.flatMap((part) => part.metrics), 'label', 4),
    citations: parts.flatMap((part) => part.citations),
    actions: [...parts.flatMap((part) => part.actions), ...(product ? [productAction(product)] : [])],
  });
}

/* Unresolved and gatekeeper replies */

function composeEngineering(analysis) {
  const topics = analysis.escalations.map((topic) => topic.label);
  const lower = (label) => label[0].toLowerCase() + label.slice(1);
  const lead =
    topics.length === 1
      ? `${topics[0]} sits outside what the automated spec engine can settle.`
      : `This inquiry spans ${topics.slice(0, -1).map(lower).join('; ')}; and ${lower(topics.at(-1))}. These sit outside what the automated spec engine can settle.`;
  const paragraphs = [`${lead} ${SCOPE_LINE}`];
  const [nearest] = analysis.products;
  if (nearest) {
    paragraphs.push(
      `For reference, the closest catalog part is the ${nearest.name} (${nearest.sku}): ${dimsLabel(nearest)}, ${nearest.weightKg} kg, ${plural(nearest.mountingPoints, 'anchor point')}, ${finishList(nearest).join(' / ')}.`,
    );
  }
  paragraphs.push(ESCALATION_NOTICE);
  return section(paragraphs, {
    metrics: [{ label: 'Route', value: 'Studio Engineering' }],
    citations: nearest ? [productCite(nearest)] : [],
    actions: nearest ? [productAction(nearest)] : [],
  });
}

function composeUnrecognized() {
  return section(
    [`I could not match this to a Lumen part, the 24V electrical system, acoustics, lighting, the planners or ordering. ${SCOPE_LINE}`, ESCALATION_NOTICE],
    { metrics: [{ label: 'Route', value: 'Studio Engineering' }] },
  );
}

function composeGatekeeper() {
  return section([CONTACT_GATE_REPLY]);
}

/** Greetings and "what is Lumen": a short, warm tour of the platform and of what to ask. */
function composeConcierge(analysis) {
  if (analysis?.thanks) {
    return section(['You are welcome. Ask whenever you need a spec, a driver size or a hand with either planner.']);
  }
  const overview = Boolean(analysis?.overview);
  return section(
    [
      `${overview ? '' : 'Hello, I am Lumen AI, the studio assistant built into this workspace. '}Lumen is a Scandinavian system of architectural lighting, acoustic surfaces and modular furniture: ${PRODUCTS.length} canonical parts on one ${BUS_VOLTAGE}V DC SELV spine, so every shelf, light bar, pendant and sconce plugs into the same low-voltage bus, sized with a 60W or 150W driver and dimmed per module over DALI-2 from ${DIM_RANGE.min} to ${DIM_RANGE.max}%.`,
      `You plan in two places. The 3D Spatial Studio is a full-screen editor for all four walls of a room up to ${ROOM_WIDTH.max / 100} x ${ROOM_DEPTH.max / 100} m: orbit it 360 degrees, walk it at ${EYE_HEIGHT_CM} cm eye level and drag parts straight across the walls. The 2D Wall Studio composes one elevation and exports a 1:20 blueprint as .SVG or .DXF. Both recalculate the 24V driver and voltage drop, Sabine RT60 and STI across six octaves, and floor lux as you work, and Checkout turns the layout into a server-verified quote with crates and dispatch waves.`,
      overview && ARCHITECTURE.test(analysis.norm)
        ? 'Under the hood, every figure comes from the same pure, deterministic engines in your browser and on the Lumen Cloud API: the server re-prices every requisition, and I answer the same way online or offline.'
        : null,
      'Ask me anything in plain words: how to open or use a tool, the size or price of a part, driver sizing, acoustics or shipping. Say "audit my room" and I will read your live 2D wall, 3D room and cart.',
    ],
    {
      metrics: [
        { label: 'Parts', value: String(PRODUCTS.length) },
        { label: 'Bus', value: `${BUS_VOLTAGE} V SELV` },
        { label: 'Dimming', value: `${DIM_RANGE.min}-${DIM_RANGE.max}%` },
        { label: 'Planners', value: '2D + 3D' },
      ],
      citations: [CITE.catalog, CITE.navigation],
      actions: [ACTIONS.launch, ACTIONS.wall, ACTIONS.catalog],
    },
  );
}

const COMPOSERS = Object.freeze({
  catalog: composeCatalog,
  workspace: composeWorkspace,
  guide: composeGuide,
  electrical: composeElectrical,
  physics: composePhysics,
  spatial: composeSpatial,
  commerce: composeCommerce,
  gatekeeper: composeGatekeeper,
  concierge: composeConcierge,
  engineering: composeEngineering,
  unrecognized: composeUnrecognized,
});

function uniqueBy(list, key, max) {
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const k = entry[key];
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(entry);
    if (out.length >= max) break;
  }
  return out;
}

function assemble(text, verdict, sections, { gateNote = false } = {}) {
  const paragraphs = sections.flatMap((entry) => entry.paragraphs);
  if (gateNote) paragraphs.push(GATE_NOTE);
  let answer = paragraphs.join('\n\n');
  if (answer.length > ANSWER_MAX) answer = `${answer.slice(0, ANSWER_MAX - 3).trimEnd()}...`;
  return {
    id: replyId(text, answer),
    question: text,
    answer,
    confidence: verdict.confidence,
    category: verdict.category,
    resolved: verdict.resolved,
    citations: uniqueBy(sections.flatMap((entry) => entry.citations), 'id', MAX_CITATIONS),
    suggestedActions: uniqueBy(sections.flatMap((entry) => entry.actions), 'to', MAX_ACTIONS),
    metrics: uniqueBy(sections.flatMap((entry) => entry.metrics), 'label', MAX_METRICS),
  };
}

/**
 * Answers one question against the catalog, the platform engines and the
 * live workspace. Returns
 * `{ id, question, answer, confidence, category, resolved, citations, suggestedActions, metrics }`.
 * `resolved` is true at confidence 0.65 and above; unresolvable, bespoke or
 * off-topic inquiries score under 0.45 and carry the escalation notice.
 */
export function evaluateConciergeQuery(question, workspaceContext) {
  const text = sanitizeQuestion(question);
  const ctx = sanitizeWorkspaceContext(workspaceContext);
  if (!text) return assemble('', { category: 'concierge', resolved: true, confidence: 0.66 }, [composeConcierge()]);

  const analysis = analyze(text);
  const verdict = classify(analysis);
  const sections = [COMPOSERS[verdict.category](analysis, ctx)];
  // A second topic joins when it carries real weight of its own. A guide
  // answer stays on the task: a named part rides along as a link instead.
  if (SUBSTANTIVE.has(verdict.category) && verdict.category !== 'workspace' && verdict.category !== 'guide') {
    const second = verdict.ranked.find((topic) => topic !== verdict.category && analysis.scores[topic] >= 3);
    if (second) sections.push(COMPOSERS[second](analysis, ctx));
  }
  return assemble(text, verdict, sections, { gateNote: analysis.contact && SUBSTANTIVE.has(verdict.category) });
}

/** Only a resolved answer to the inquiry itself can be marked as not resolving it. */
export function canMarkUnhelpful(reply) {
  return Boolean(reply) && reply.resolved === true && SUBSTANTIVE.has(reply.category);
}

/* Deeper follow-up after "Did not resolve my issue" */

function busTable(fig) {
  const rows = fig.bus.nodes.slice(0, 6).map((node) => {
    const product = getProduct(node.productId);
    return `- ${node.label} ${product ? product.name : node.productId}: hop ${node.hopM.toFixed(2)} m, ${wattsLabel(node.watts)}, cumulative drop ${node.dropV.toFixed(3)} V`;
  });
  return rows.length > 0 ? `Hop-by-hop bus schedule for your ${fig.label}:\n${rows.join('\n')}` : null;
}

function octaveTable(fig) {
  const bands = OCTAVE_BANDS.map((hz, k) => `${OCTAVE_LABELS[k]} ${fig.physics.octaveRt60[hz].toFixed(2)} s`).join(', ');
  return `Octave RT60 for your ${fig.label}: ${bands}.`;
}

function deeperDetail(analysis, verdict, ctx) {
  const live = liveFigures(ctx);
  const fig = live.room ?? live.wall;
  const currency = getCurrency(ctx.currency);
  switch (verdict.category) {
    case 'catalog': {
      const products = analysis.products.length > 0 ? analysis.products : [routeProduct(ctx.route)].filter(Boolean);
      if (products.length === 0) return ['Every part has a full datasheet on its Catalog page: dimensions, mass, anchors, finishes, lead time and the 1:20 elevation drawing.'];
      return products.flatMap((product) => productSheet(product, [], currency));
    }
    case 'electrical':
      return [
        `Engineering detail: dV = I x R x L per hop, with I = P / ${BUS_VOLTAGE} V and R = 2 x 0.0172 / 2.5 = ${LOOP_OHM_PER_M.toFixed(4)} ohm per metre (both conductors). Each hop carries every downstream node's current; the limit is ${DROP_LIMIT_PCT}% = ${((DROP_LIMIT_PCT / 100) * BUS_VOLTAGE).toFixed(2)} V at the last node.`,
        fig ? busTable(fig) : null,
      ].filter(Boolean);
    case 'physics':
      return [
        'Engineering detail: RT60 = 0.161 V / (A + 4mV) per octave band, where A sums each surface area times its band coefficient (timber floor 0.10, plasterboard ceiling 0.05, painted plaster 0.03 at 500 Hz) plus furniture sabins, and 4mV is the air term above 500 Hz. STI maps m(F) = 1 / sqrt(1 + (2 pi F T / 13.8)^2) over 14 modulation frequencies to an apparent SNR clipped at +/-15 dB.',
        fig ? octaveTable(fig) : null,
      ].filter(Boolean);
    case 'workspace': {
      const target = resolveTarget(analysis, ctx);
      const subject = target === 'wall' ? live.wall : target === 'room' ? live.room : fig;
      if (!subject) return ['There is no live module data to break down further yet.'];
      return [busTable(subject), octaveTable(subject)].filter(Boolean);
    }
    case 'spatial':
      return [
        'Keyboard map: G grabs the selected module, the arrow keys nudge it, Enter commits and Escape cancels; Home or 0 resets the orbit camera; in the Inside Room lens W A S D or the arrows walk and the wheel sets the field of view.',
      ];
    case 'guide':
      return [
        `Full keyboard map: Ctrl+K or Cmd+K opens the command palette; Ctrl+Z undoes, Ctrl+Y or Ctrl+Shift+Z redoes (${HISTORY_LIMIT} steps). 3D Spatial Studio: G grabs, the arrow keys nudge, Enter drops, Escape cancels, Home or 0 resets the orbit; in the ${LENS_SHORT.inside} lens W A S D walk, Q and E turn, + and - set the lens. 2D Wall Studio: Ctrl+A selects all, the arrow keys nudge (Shift for ten), Delete removes.`,
        'Troubleshooting checklist: reload the page (drafts and the cart are kept on this device); switch on hardware acceleration so WebGL 2 can run the 3D Spatial Studio; allow site data for this address so drafts survive between visits, since a private window starts with an empty workspace; and when Lumen Cloud is unreachable, saves stay on the device and sync later.',
      ];
    case 'commerce':
      return [
        'Engineering detail: unit prices convert as round(USD x minor units x rate) per line; discount and VAT are rounded once each, half up, on the totals. Crates pack first-fit decreasing by mass with an 18% tare (0.8 kg minimum), split across crates by largest remainder so net + tare = gross exactly.',
      ];
    default:
      return [];
  }
}

/**
 * The follow-up turn after a visitor marks an answer as not resolving their
 * issue: the deepest detail the engines hold for that question, then the
 * escalation notice. Deterministic, like every reply.
 */
export function composeFollowUp(question, workspaceContext) {
  const text = sanitizeQuestion(question);
  const ctx = sanitizeWorkspaceContext(workspaceContext);
  const analysis = analyze(text);
  const verdict = classify(analysis);
  const detail = deeperDetail(analysis, verdict, ctx);
  const paragraphs = ['Understood - that answer did not settle your case. Here is the deeper technical detail I hold for it.', ...detail, FOLLOW_UP_NOTICE];
  return assemble(text, { category: verdict.category, resolved: true, confidence: verdict.confidence }, [
    section(paragraphs, { actions: [] }),
  ]);
}

/* Reply boundary (client side) */

const METRIC_LABEL_MAX = 32;
const METRIC_VALUE_MAX = 64;
const CITATION_ID = /^[a-z]+:[a-z0-9-]{1,64}$/;

/** Rebuilds a reply from an untrusted response. Returns null unless every required field is sound. */
export function sanitizeConciergeReply(input) {
  if (!isRecord(input)) return null;
  const question = sanitizeQuestion(input.question);
  const answer = sanitizeMultilineText(input.answer, { maxLength: ANSWER_MAX });
  const id = typeof input.id === 'string' && REPLY_ID_PATTERN.test(input.id) ? input.id : null;
  if (!id || !answer || !isOneOf(input.category, CATEGORY_IDS) || typeof input.resolved !== 'boolean') return null;
  const list = (value, max, map) => (Array.isArray(value) ? value.slice(0, max).map(map).filter(Boolean) : []);
  return {
    id,
    question,
    answer,
    confidence: round(clampNumber(input.confidence, 0, 1, 0), 2),
    category: input.category,
    resolved: input.resolved,
    citations: list(input.citations, MAX_CITATIONS, (entry) => {
      if (!isRecord(entry) || typeof entry.id !== 'string' || !CITATION_ID.test(entry.id)) return null;
      const label = sanitizeText(entry.label, { maxLength: 96 });
      return label ? { id: entry.id, label } : null;
    }),
    suggestedActions: list(input.suggestedActions, MAX_ACTIONS, (entry) => {
      if (!isRecord(entry) || !isSafeInternalPath(entry.to, { maxLength: 160 })) return null;
      const label = sanitizeText(entry.label, { maxLength: 48 });
      return label ? { label, to: entry.to } : null;
    }),
    metrics: list(input.metrics, MAX_METRICS, (entry) => {
      if (!isRecord(entry)) return null;
      const label = sanitizeText(entry.label, { maxLength: METRIC_LABEL_MAX });
      const value = sanitizeText(entry.value, { maxLength: METRIC_VALUE_MAX });
      return label && value ? { label, value } : null;
    }),
  };
}

/* Quick prompts and workspace summary */

const QUICK_PROMPTS = Object.freeze({
  default: ['How do I open the 3D room designer?', 'Audit my live 3D room & RT60', 'Compare 60W vs 150W 24V drivers', 'Floating Shelf 110 specs & anchors'],
  '/room-3d': ['Audit my live 3D room & RT60', 'How do I move a module in 3D?', 'How do I walk inside at 165 cm?', 'Which PSU driver do I need?'],
  '/studio-2d': ['How many watts is my wall using?', 'Check my wall voltage drop', 'Export a 1:20 DXF blueprint', 'Compare 60W vs 150W 24V drivers'],
  '/catalog': ['Floating Shelf 110 specs & anchors', 'Which finishes ship in Obsidian?', 'Lead times for made-to-order parts', 'Compare 60W vs 150W 24V drivers'],
  '/checkout': ['How many crates will my cart ship in?', 'Explain Split Rough-In shipping', 'How do TRADE15 and 27% VAT apply?', 'Which PSU driver do I need?'],
  '/account': ['How does Lumen Cloud sync my projects?', 'Audit my live 3D room & RT60', 'Explain Split Rough-In shipping', 'Compare 60W vs 150W 24V drivers'],
});

/** Four route-aware starter questions. On a product page the first one names that part. */
export function quickPromptsFor(route) {
  const path = sanitizeRoute(route);
  const product = routeProduct(path);
  if (product) return [`${product.name} specs & anchors`, ...QUICK_PROMPTS['/catalog'].slice(1)];
  if (path.startsWith('/catalog/')) return [...QUICK_PROMPTS['/catalog']];
  return [...(QUICK_PROMPTS[path] ?? QUICK_PROMPTS.default)];
}

/** Human label for the route the visitor asked from. */
export function routeLabel(route) {
  const path = sanitizeRoute(route);
  const product = routeProduct(path);
  if (product) return `Catalog / ${product.name}`;
  return WORKSPACE_ROUTES[path] ?? 'Lumen';
}

/**
 * Plain-text digest of the live workspace, attached to an engineering ticket
 * so the studio sees the visitor's exact figures. At most 600 characters.
 */
export function describeWorkspace(workspaceContext) {
  const ctx = sanitizeWorkspaceContext(workspaceContext);
  const live = liveFigures(ctx);
  const parts = [`Asked from ${routeLabel(ctx.route)} (${ctx.route}).`];
  if (live.room) {
    const f = live.room;
    parts.push(
      `3D room ${f.envelope}: ${plural(f.summary.modules, 'module')} (${wallSplit(f.counts)}), ${wattsLabel(f.summary.loadW)} rated, ${f.summary.psu.label}, drop ${f.bus.voltageDropPct.toFixed(2)}%, RT60 ${f.physics.rt60Sec.toFixed(2)} s, STI ${f.physics.stiScore.toFixed(2)}, ${int(f.physics.avgFloorLux)} lx, ${plural(f.conflicts, 'conflict')}.`,
    );
  }
  if (live.wall) {
    const f = live.wall;
    parts.push(
      `2D wall ${f.envelope}: ${plural(f.summary.modules, 'module')}, ${wattsLabel(f.summary.loadW)} rated, ${f.summary.psu.label}, drop ${f.bus.voltageDropPct.toFixed(2)}%, RT60 ${f.physics.rt60Sec.toFixed(2)} s, ${plural(f.conflicts, 'conflict')}.`,
    );
  }
  if (ctx.bagItems.length > 0) {
    const { quote } = cartFigures(ctx);
    parts.push(
      `Cart: ${plural(ctx.bagItems.length, 'line')}, gross ${formatMoney(quote.totals.gross, quote.currency)}, ${wattsLabel(quote.electrical.loadW)}, ${plural(quote.logistics.crates.length, 'crate')}.`,
    );
  }
  if (parts.length === 1) parts.push('No modules mounted and the cart is empty.');
  return sanitizeMultilineText(parts.join(' '), { maxLength: TICKET_LIMITS.summary });
}

/* Gatekeeper state machine */

export const ESCALATION_LOCKED = 'locked';
export const ESCALATION_UNLOCKED = 'unlocked';

export function createConciergeSession() {
  return { serial: 0, turns: [], pending: false, escalation: { unlocked: false, reason: null, turnId: null }, ticket: null, fault: null };
}

function nextId(state, prefix) {
  return { serial: state.serial + 1, id: `${prefix}${state.serial + 1}` };
}

/**
 * Support escalation gatekeeper. Human contact stays locked until either the
 * engine returns an unresolved reply (`unresolved_query`) or the visitor marks
 * a resolved answer as not resolving the issue (`marked_unhelpful`). Asking
 * for a human, by itself, never unlocks it. Once unlocked it stays unlocked
 * for the session.
 */
export function conciergeReducer(state, action) {
  switch (action?.type) {
    case 'ask': {
      const text = sanitizeQuestion(action.question);
      if (!text || state.pending) return state;
      const { serial, id } = nextId(state, 'q');
      return { ...state, serial, pending: true, fault: null, turns: [...state.turns, { id, role: 'user', text }] };
    }
    case 'reply': {
      if (!state.pending) return state;
      const reply = sanitizeConciergeReply(action.reply);
      if (!reply) return { ...state, pending: false, fault: 'The concierge sent an unreadable reply. Ask again.' };
      const { serial, id } = nextId(state, 'a');
      const turn = { id, role: 'assistant', kind: 'answer', reply, markedUnhelpful: false, transport: action.transport === 'local' ? 'local' : 'http' };
      const unlock = !reply.resolved && !state.escalation.unlocked;
      return {
        ...state,
        serial,
        pending: false,
        turns: [...state.turns, turn],
        escalation: unlock ? { unlocked: true, reason: 'unresolved_query', turnId: id } : state.escalation,
      };
    }
    case 'fail':
      return state.pending ? { ...state, pending: false, fault: sanitizeText(action.message, { maxLength: 240 }) || 'The concierge could not answer. Ask again.' } : state;
    case 'mark-unhelpful': {
      const index = state.turns.findIndex((turn) => turn.id === action.turnId);
      const turn = state.turns[index];
      if (!turn || turn.role !== 'assistant' || turn.kind !== 'answer' || turn.markedUnhelpful || !canMarkUnhelpful(turn.reply)) {
        return state;
      }
      const followUp = composeFollowUp(turn.reply.question, action.context);
      const { serial, id } = nextId(state, 'a');
      const turns = state.turns.map((entry, i) => (i === index ? { ...entry, markedUnhelpful: true } : entry));
      turns.push({ id, role: 'assistant', kind: 'followup', reply: followUp, markedUnhelpful: false, transport: 'local' });
      return {
        ...state,
        serial,
        turns,
        escalation: state.escalation.unlocked ? state.escalation : { unlocked: true, reason: 'marked_unhelpful', turnId: turn.id },
      };
    }
    case 'ticket':
      return state.escalation.unlocked && isRecord(action.ticket) ? { ...state, ticket: action.ticket } : state;
    case 'reset':
      return createConciergeSession();
    default:
      return state;
  }
}

/**
 * Transcript for the escalation request: one entry per answered question.
 * The turn that unlocked the gate is always kept, then the most recent turns
 * up to the 24-turn cap.
 */
export function escalationTranscript(state) {
  const answers = state.turns.filter((turn) => turn.role === 'assistant' && turn.kind === 'answer');
  const pinned = answers.find((turn) => turn.id === state.escalation.turnId);
  const rest = answers.filter((turn) => turn !== pinned).slice(-(TICKET_LIMITS.turns - (pinned ? 1 : 0)));
  return [...(pinned ? [pinned] : []), ...rest].map((turn) => ({
    question: turn.reply.question,
    resolved: turn.reply.resolved,
    markedUnhelpful: turn.markedUnhelpful,
    category: turn.reply.category,
    confidence: turn.reply.confidence,
  }));
}

/* Server-side escalation verification */

/**
 * Replays every transcript turn through the engine. A turn opens the gate
 * only when the replay agrees: a claimed `resolved: false` must replay as
 * unresolved, and a `markedUnhelpful` turn must replay as a substantive
 * resolved answer. Client flags the engine does not reproduce are ignored.
 */
export function verifyEscalationTranscript(transcript) {
  if (!Array.isArray(transcript) || transcript.length === 0 || transcript.length > TICKET_LIMITS.turns) {
    return { valid: false, reasons: [], inquiry: {}, turns: 0 };
  }
  const reasons = new Set();
  const inquiry = {};
  for (const entry of transcript) {
    if (!isRecord(entry)) return { valid: false, reasons: [], inquiry: {}, turns: 0 };
    const question = sanitizeQuestion(entry.question);
    if (!question) return { valid: false, reasons: [], inquiry: {}, turns: 0 };
    const replay = evaluateConciergeQuery(question);
    if (entry.resolved === false && !replay.resolved) {
      reasons.add('unresolved_query');
      inquiry.unresolved_query ??= question;
    }
    if (entry.markedUnhelpful === true && canMarkUnhelpful(replay)) {
      reasons.add('marked_unhelpful');
      inquiry.marked_unhelpful ??= question;
    }
  }
  return { valid: true, reasons: [...reasons], inquiry, turns: transcript.length };
}

/**
 * Validates POST /api/concierge/escalate. Returns
 * `{ ok: true, ticket }` with the sanitized ticket fields, or
 * `{ ok: false, code, message, fields? }` where code is `invalid` or
 * `gatekeeper_locked`.
 */
export const GATEKEEPER_LOCKED_MESSAGE = 'Consult the Studio AI first; human escalation requires an unresolved inquiry.';

export function validateEscalationRequest(body) {
  const fail = (code, message, fields) => ({ ok: false, code, message, ...(fields ? { fields } : {}) });
  if (!isRecord(body)) return fail('invalid', 'Send the escalation as a JSON object.');

  // The gate is checked first: without a verified turn, no field gets reviewed at all.
  const verdict = verifyEscalationTranscript(body.transcript);
  if (!verdict.valid || verdict.reasons.length === 0) return fail('gatekeeper_locked', GATEKEEPER_LOCKED_MESSAGE);

  const fields = {};
  const email = sanitizeEmail(body.email);
  if (!email) fields.email = 'Enter a reply address such as studio@lumen.com.';
  const subject = sanitizeTicketSubject(body.subject);
  if (!subject) fields.subject = `Subject needs ${TICKET_LIMITS.subject.min} to ${TICKET_LIMITS.subject.max} characters.`;
  const message = sanitizeTicketMessage(body.message);
  if (!message) fields.message = `Engineering brief needs ${TICKET_LIMITS.message.min} to ${TICKET_LIMITS.message.max} characters.`;
  if (Object.keys(fields).length > 0) return fail('invalid', Object.values(fields)[0], fields);
  if (!isOneOf(body.reason, ESCALATION_REASONS)) {
    return fail('invalid', `reason must be one of ${ESCALATION_REASONS.join(', ')}.`);
  }
  if (body.workspaceSummary !== undefined && typeof body.workspaceSummary !== 'string') {
    return fail('invalid', 'workspaceSummary must be text.');
  }
  if (!verdict.reasons.includes(body.reason)) {
    return fail('invalid', 'The escalation reason does not match the consultation transcript.');
  }
  return {
    ok: true,
    ticket: {
      email,
      subject,
      message,
      reason: body.reason,
      inquiry: verdict.inquiry[body.reason],
      turns: verdict.turns,
      workspaceSummary: sanitizeMultilineText(body.workspaceSummary, { maxLength: TICKET_LIMITS.summary }),
    },
  };
}

/** Validates POST /api/concierge/ask. Returns `{ question, context }` or `{ error }`. */
export function validateConciergeAsk(body) {
  if (!isRecord(body)) return { error: 'Send { question, workspaceContext }.' };
  if (typeof body.question !== 'string') return { error: 'question must be text.' };
  if (body.question.length > QUESTION_MAX * 4) return { error: `question is limited to ${QUESTION_MAX} characters.` };
  const question = sanitizeQuestion(body.question);
  if (!question) return { error: 'Ask a question first.' };
  const { context, error } = validateWorkspaceContext(body.workspaceContext);
  if (error) return { error };
  return { question, context };
}

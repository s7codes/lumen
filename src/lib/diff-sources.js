import { padIndex } from './format.js';
import { projectIdFor, sanitizeProjectName } from './project-library.js';
import { createRoomState, unrolledRoom } from './room-3d.js';
import { perimeterOffset } from './room-walls.js';
import { createLayout } from './wall-studio.js';

/**
 * Sources for the A/B compare dialog. Each is { id, label, group, kind,
 * name, caption, subject }, where `subject` is a cloud record or a live
 * state that compareProjectStates reads. Ids are namespaced by origin so a
 * cloud id never collides with a draft.
 */

export const SOURCE_GROUPS = Object.freeze({
  cloud: 'Lumen Cloud',
  draft: 'Live drafts',
  baseline: 'Baselines',
});

const KIND_LABELS = Object.freeze({ wall: 'Wall Elevation', room: 'Room Planner' });

function savedStamp(iso) {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function cloudSource(record) {
  return {
    id: `cloud:${record.id}`,
    label: `${record.name} / Rev ${padIndex(record.revision)}`,
    group: 'cloud',
    kind: record.kind,
    name: record.name,
    caption: `${KIND_LABELS[record.kind]} / Rev ${padIndex(record.revision)} / ${savedStamp(record.savedAt)}`,
    subject: record,
  };
}

export function draftSource(kind, state, name) {
  const clean = sanitizeProjectName(name, kind);
  return {
    id: `draft:${kind}`,
    label: `${KIND_LABELS[kind]} draft / ${clean}`,
    group: 'draft',
    kind,
    name: clean,
    caption: `${KIND_LABELS[kind]} / live workspace, unsaved`,
    subject: state,
  };
}

export function baselineSource(kind) {
  return {
    id: `baseline:${kind}`,
    label: `Clean ${kind} baseline`,
    group: 'baseline',
    kind,
    name: 'Clean baseline',
    caption: `${KIND_LABELS[kind]} / default envelope, no modules`,
    subject: kind === 'room' ? createRoomState() : createLayout(),
  };
}

/**
 * A planner compares its live draft (B) against the cloud revision of the
 * project it has open (A): the record under the current name, else the last
 * record this session saved, else a clean default baseline.
 */
export function plannerDiffSources(kind, draft, name, projects, lastSaved = null) {
  const records = (Array.isArray(projects) ? projects : []).filter((record) => record.kind === kind);
  const wanted = projectIdFor(kind, name);
  const base =
    records.find((record) => record.id === wanted) ??
    (lastSaved ? records.find((record) => record.id === lastSaved.id) : undefined) ??
    null;
  return {
    sources: [draftSource(kind, draft, name), ...records.map(cloudSource), baselineSource(kind)],
    baseId: base ? `cloud:${base.id}` : `baseline:${kind}`,
    targetId: `draft:${kind}`,
  };
}

/**
 * The account compares saved projects with each other and with both live
 * drafts. A focused card is A; B is the newest other project of the same
 * kind, then any other project, then that kind's draft. With no focus, the
 * two newest projects are compared, older as A. `drafts` is
 * { wall: { state, name }, room: { state, name } }.
 */
export function accountDiffSources(projects, drafts, focusId = null) {
  const records = Array.isArray(projects) ? projects : [];
  // A draft kind may be absent: the account leaves out an empty legacy wall draft.
  const draftSources = ['wall', 'room'].filter((kind) => drafts[kind]).map((kind) => draftSource(kind, drafts[kind].state, drafts[kind].name));
  const sources = [...records.map(cloudSource), ...draftSources];

  const focus = records.find((record) => record.id === focusId) ?? null;
  if (!focus) {
    if (records.length >= 2) return { sources, baseId: `cloud:${records[1].id}`, targetId: `cloud:${records[0].id}` };
    if (records.length === 1) return { sources, baseId: `cloud:${records[0].id}`, targetId: `draft:${records[0].kind}` };
    return { sources, baseId: drafts.wall ? 'draft:wall' : 'draft:room', targetId: 'draft:room' };
  }
  const others = records.filter((record) => record !== focus);
  const partner = others.find((record) => record.kind === focus.kind) ?? others[0] ?? null;
  return {
    sources,
    baseId: `cloud:${focus.id}`,
    targetId: partner ? `cloud:${partner.id}` : `draft:${focus.kind}`,
  };
}

/**
 * Elevation for a thumbnail: a wall as drawn, a room as its north wall, or
 * unrolled north-east-south-west when modules hang off north. `joints` are
 * the x positions of the room corners in the unrolled strip.
 */
export function elevationOf({ kind, state }) {
  if (kind === 'wall') {
    const { widthCm, heightCm, slope } = state.wall;
    return { widthCm, heightCm, slope, items: state.items, joints: [] };
  }
  const flat = unrolledRoom(state);
  const unrolled = flat !== state;
  return {
    widthCm: flat.room.widthCm,
    heightCm: flat.room.heightCm,
    slope: false,
    items: flat.items,
    joints: unrolled ? ['east', 'south', 'west'].map((wall) => perimeterOffset(state.room, wall)) : [],
  };
}

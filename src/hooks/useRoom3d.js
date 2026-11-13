import { useEffect, useMemo, useReducer } from 'react';
import { getFinish, getProduct } from '../data/products.js';
import {
  clearRoomWall,
  DEFAULT_ROOM_WALL,
  importFromWallStudio,
  isRoomWall,
  loadRoomState,
  mountInRoom,
  persistRoomState,
  removeRoomItem,
  sanitizeRoomState,
  serializeRoomState,
  updateCamera,
  updateRoom,
  updateRoomItem,
  WALL_LABELS,
  wallCounts,
  wallOf,
} from '../lib/room-3d.js';
import { applyLightingSceneToRoom, getLightingScene } from '../lib/lighting-scenes.js';
import { commitHistory, createHistory, MAX_WALL_ITEMS, redoHistory, undoHistory } from '../lib/wall-studio.js';
import { subscribeWorkspaceMutations } from '../lib/workspace-events.js';

function init() {
  return {
    history: createHistory(loadRoomState()),
    selectedUid: null,
    activeWall: DEFAULT_ROOM_WALL,
    notice: { text: '', tone: 'info', serial: 0 },
  };
}

function withNotice(store, text, tone = 'info') {
  return { ...store, notice: { text, tone, serial: store.notice.serial + 1 } };
}

function withState(store, state) {
  const history = commitHistory(store.history, state);
  return history === store.history ? store : { ...store, history };
}

// The camera is a view, not an edit: it never enters the history, and an
// undo or redo keeps the current view. The active wall is view state too.
function withCamera(store, state) {
  if (state === store.history.present) return store;
  return { ...store, history: { ...store.history, present: state } };
}

function travel(store, history, text) {
  if (history === store.history) return store;
  const camera = store.history.present.camera;
  return withNotice({ ...store, history: { ...history, present: { ...history.present, camera } } }, text);
}

// Content equality: an AI edit that only switches the lens or wall rebuilds an
// identical room, and must not leave an empty step in the undo history.
function sameRoom(a, b) {
  return JSON.stringify(serializeRoomState(a)) === JSON.stringify(serializeRoomState(b));
}

function plural(count, word) {
  return `${count} ${count === 1 ? word : `${word}s`}`;
}

// North keeps the original wording; the other walls name themselves.
function onWallText(wall) {
  return wall === DEFAULT_ROOM_WALL ? '' : ` on the ${WALL_LABELS[wall]}`;
}

function roomReducer(store, action) {
  const state = store.history.present;

  switch (action.type) {
    case 'select': {
      const uid = state.items.some((item) => item.uid === action.uid) ? action.uid : null;
      return store.selectedUid === uid ? store : { ...store, selectedUid: uid };
    }

    case 'wall':
      return isRoomWall(action.wall) && action.wall !== store.activeWall ? { ...store, activeWall: action.wall } : store;

    case 'room':
      return withState(store, updateRoom(state, action.patch));

    case 'camera':
      return withCamera(store, updateCamera(state, action.camera));

    case 'scene': {
      const scene = getLightingScene(action.sceneId);
      if (!scene) return store;
      const next = applyLightingSceneToRoom(state, action.sceneId);
      if (next === state) return withNotice(store, `${scene.label} already active.`);
      return withNotice(withState(store, next), `Recalled ${scene.label}: task ${scene.task}% / accent ${scene.accent}%.`);
    }

    case 'undo':
      return travel(store, undoHistory(store.history), 'Undo.');

    case 'redo':
      return travel(store, redoHistory(store.history), 'Redo.');

    case 'mount': {
      const product = getProduct(action.productId);
      if (!product) return store;
      const result = mountInRoom(state, action.productId, store.activeWall);
      if (!result) return withNotice(store, `Room wall holds ${MAX_WALL_ITEMS} modules at most.`, 'warn');
      const { item, clear, wall } = result;
      const next = { ...withState(store, result.state), selectedUid: item.uid };
      return clear
        ? withNotice(next, `Mounted ${product.name}${onWallText(wall)} at X ${item.xCm} / Y ${item.yCm} cm.`)
        : withNotice(next, `No clear position for ${product.name}${onWallText(wall)}. Placed with a conflict.`, 'warn');
    }

    case 'update': {
      const before = state.items.find((item) => item.uid === action.uid);
      const next = updateRoomItem(state, action.uid, action.patch);
      const after = next.items.find((item) => item.uid === action.uid);
      const moved = before && after && wallOf(before) !== wallOf(after);
      if (!moved) return withState(store, next);
      // The view follows a module onto its new wall.
      const wall = wallOf(after);
      return withNotice(
        { ...withState(store, next), activeWall: wall },
        `Moved ${getProduct(after.productId).name} to the ${WALL_LABELS[wall]} at X ${after.xCm} / Y ${after.yCm} cm.`,
      );
    }

    // One direct-manipulation commit (3D drag, keyboard grab or nudge): one history step.
    case 'move': {
      const next = updateRoomItem(state, action.uid, { xCm: action.xCm, yCm: action.yCm });
      if (next === state) return store;
      const after = next.items.find((item) => item.uid === action.uid);
      return withNotice(
        withState(store, next),
        `Moved ${getProduct(after.productId).name} to X ${after.xCm} / Y ${after.yCm} cm${onWallText(wallOf(after))}.`,
      );
    }

    // Focus in 3D: select the module and turn the view to its wall.
    case 'focus': {
      const item = state.items.find((entry) => entry.uid === action.uid);
      if (!item) return store;
      const wall = wallOf(item);
      if (store.selectedUid === item.uid && store.activeWall === wall) return store;
      return { ...store, selectedUid: item.uid, activeWall: wall };
    }

    case 'remove': {
      const item = state.items.find((entry) => entry.uid === action.uid);
      const next = removeRoomItem(state, action.uid);
      if (!item || next === state) return store;
      const finish = getFinish(item.finish);
      return withNotice(
        { ...withState(store, next), selectedUid: null },
        `Removed ${getProduct(item.productId).name}, ${finish.label}.`,
      );
    }

    case 'clear-wall': {
      const wall = store.activeWall;
      const count = wallCounts(state.items)[wall];
      const next = clearRoomWall(state, wall);
      if (next === state) return store;
      const selectedUid = next.items.some((item) => item.uid === store.selectedUid) ? store.selectedUid : null;
      return withNotice({ ...withState(store, next), selectedUid }, `Cleared ${plural(count, 'module')} from the ${WALL_LABELS[wall]}.`);
    }

    case 'import': {
      const wall = store.activeWall;
      const result = importFromWallStudio(state, wall);
      const { widthCm, depthCm, heightCm } = result.state.room;
      const span = wall === 'east' || wall === 'west' ? depthCm : widthCm;
      let text;
      if (wall === DEFAULT_ROOM_WALL) {
        text = result.fromPreset
          ? `Wall Studio is empty. Loaded the default composition: ${plural(result.count, 'module')}.`
          : `Loaded ${plural(result.count, 'module')} from Wall Studio. Main wall ${widthCm} x ${heightCm} cm.`;
      } else {
        text = result.fromPreset
          ? `Wall Studio is empty. Loaded the default composition onto the ${WALL_LABELS[wall]}: ${plural(result.count, 'module')}.`
          : `Loaded ${plural(result.count, 'module')} from Wall Studio onto the ${WALL_LABELS[wall]}, ${span} x ${heightCm} cm.`;
      }
      if (result.slope) text += ' Attic slope is not modelled in 3D.';
      return withNotice({ ...withState(store, result.state), selectedUid: null }, text);
    }

    // A shared scene, or a Lumen AI edit: one history step, so Ctrl+Z reverses it whole.
    // An AI edit keeps the current camera and may turn to a wall and select its new module.
    case 'replace': {
      const next = action.keepCamera ? { ...action.state, camera: state.camera } : action.state;
      const committed = action.keepCamera && sameRoom(next, state) ? store : withState(store, next);
      const room = committed.history.present;
      const selectUid = action.selectUid ?? (action.keepCamera ? store.selectedUid : null);
      const selectedUid = selectUid && room.items.some((item) => item.uid === selectUid) ? selectUid : null;
      const activeWall = isRoomWall(action.activeWall) ? action.activeWall : store.activeWall;
      return withNotice({ ...committed, selectedUid, activeWall }, action.text);
    }

    case 'notice':
      return withNotice(store, action.text, action.tone);

    default:
      return store;
  }
}

export function useRoom3d() {
  const [store, dispatch] = useReducer(roomReducer, undefined, init);
  const { history, selectedUid, activeWall, notice } = store;
  const state = history.present;

  // Writing on mount also replaces a tampered payload with the sanitized room.
  useEffect(() => {
    persistRoomState(state);
  }, [state]);

  // Lumen AI mutations land live, as one undoable step.
  useEffect(
    () =>
      subscribeWorkspaceMutations(
        (action) => {
          const next = sanitizeRoomState(action.state);
          if (!next) return;
          dispatch({ type: 'replace', state: next, text: action.notice, activeWall: action.activeWall, selectUid: action.selectUid, keepCamera: true });
        },
        ['apply_room_state'],
      ),
    [],
  );

  const actions = useMemo(
    () => ({
      select: (uid) => dispatch({ type: 'select', uid }),
      setWall: (wall) => dispatch({ type: 'wall', wall }),
      setRoom: (patch) => dispatch({ type: 'room', patch }),
      setCamera: (camera) => dispatch({ type: 'camera', camera }),
      mount: (productId) => dispatch({ type: 'mount', productId }),
      update: (uid, patch) => dispatch({ type: 'update', uid, patch }),
      move: (uid, { xCm, yCm }) => dispatch({ type: 'move', uid, xCm, yCm }),
      focus: (uid) => dispatch({ type: 'focus', uid }),
      remove: (uid) => dispatch({ type: 'remove', uid }),
      clearWall: () => dispatch({ type: 'clear-wall' }),
      importWall: () => dispatch({ type: 'import' }),
      replace: (state, text) => dispatch({ type: 'replace', state, text }),
      announce: (text, tone) => dispatch({ type: 'notice', text, tone }),
      applyScene: (sceneId) => dispatch({ type: 'scene', sceneId }),
      undo: () => dispatch({ type: 'undo' }),
      redo: () => dispatch({ type: 'redo' }),
    }),
    [],
  );

  const selected = useMemo(
    () => state.items.find((item) => item.uid === selectedUid) ?? null,
    [state.items, selectedUid],
  );
  const counts = useMemo(() => wallCounts(state.items), [state.items]);

  return {
    state,
    selected,
    activeWall,
    counts,
    notice,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    actions,
  };
}

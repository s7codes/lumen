import { useEffect, useMemo, useReducer } from 'react';
import { getFinish, getProduct } from '../data/products.js';
import {
  importFromWallStudio,
  loadRoomState,
  mountInRoom,
  persistRoomState,
  removeRoomItem,
  updateCamera,
  updateRoom,
  updateRoomItem,
} from '../lib/room-3d.js';
import { applyLightingSceneToRoom, getLightingScene } from '../lib/lighting-scenes.js';
import { commitHistory, createHistory, MAX_WALL_ITEMS, redoHistory, undoHistory } from '../lib/wall-studio.js';

function init() {
  return { history: createHistory(loadRoomState()), selectedUid: null, notice: { text: '', tone: 'info', serial: 0 } };
}

function withNotice(store, text, tone = 'info') {
  return { ...store, notice: { text, tone, serial: store.notice.serial + 1 } };
}

function withState(store, state) {
  const history = commitHistory(store.history, state);
  return history === store.history ? store : { ...store, history };
}

// The camera is a view, not an edit: it never enters the history, and an
// undo or redo keeps the current view.
function withCamera(store, state) {
  if (state === store.history.present) return store;
  return { ...store, history: { ...store.history, present: state } };
}

function travel(store, history, text) {
  if (history === store.history) return store;
  const camera = store.history.present.camera;
  return withNotice({ ...store, history: { ...history, present: { ...history.present, camera } } }, text);
}

function plural(count, word) {
  return `${count} ${count === 1 ? word : `${word}s`}`;
}

function roomReducer(store, action) {
  const state = store.history.present;

  switch (action.type) {
    case 'select': {
      const uid = state.items.some((item) => item.uid === action.uid) ? action.uid : null;
      return store.selectedUid === uid ? store : { ...store, selectedUid: uid };
    }

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
      const result = mountInRoom(state, action.productId);
      if (!result) return withNotice(store, `Room wall holds ${MAX_WALL_ITEMS} modules at most.`, 'warn');
      const { item, clear } = result;
      const next = { ...withState(store, result.state), selectedUid: item.uid };
      return clear
        ? withNotice(next, `Mounted ${product.name} at X ${item.xCm} / Y ${item.yCm} cm.`)
        : withNotice(next, `No clear position for ${product.name}. Placed with a conflict.`, 'warn');
    }

    case 'update':
      return withState(store, updateRoomItem(state, action.uid, action.patch));

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

    case 'import': {
      const result = importFromWallStudio(state);
      const { widthCm, heightCm } = result.state.room;
      let text = result.fromPreset
        ? `Wall Studio is empty. Loaded the default composition: ${plural(result.count, 'module')}.`
        : `Loaded ${plural(result.count, 'module')} from Wall Studio. Main wall ${widthCm} x ${heightCm} cm.`;
      if (result.slope) text += ' Attic slope is not modelled in 3D.';
      return withNotice({ ...withState(store, result.state), selectedUid: null }, text);
    }

    case 'replace':
      return withNotice({ ...withState(store, action.state), selectedUid: null }, action.text);

    case 'notice':
      return withNotice(store, action.text, action.tone);

    default:
      return store;
  }
}

export function useRoom3d() {
  const [store, dispatch] = useReducer(roomReducer, undefined, init);
  const { history, selectedUid, notice } = store;
  const state = history.present;

  // Writing on mount also replaces a tampered payload with the sanitized room.
  useEffect(() => {
    persistRoomState(state);
  }, [state]);

  const actions = useMemo(
    () => ({
      select: (uid) => dispatch({ type: 'select', uid }),
      setRoom: (patch) => dispatch({ type: 'room', patch }),
      setCamera: (camera) => dispatch({ type: 'camera', camera }),
      mount: (productId) => dispatch({ type: 'mount', productId }),
      update: (uid, patch) => dispatch({ type: 'update', uid, patch }),
      remove: (uid) => dispatch({ type: 'remove', uid }),
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

  return {
    state,
    selected,
    notice,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    actions,
  };
}

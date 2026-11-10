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
import { MAX_WALL_ITEMS } from '../lib/wall-studio.js';

function init() {
  return { state: loadRoomState(), selectedUid: null, notice: { text: '', tone: 'info', serial: 0 } };
}

function withNotice(store, text, tone = 'info') {
  return { ...store, notice: { text, tone, serial: store.notice.serial + 1 } };
}

function withState(store, state) {
  return state === store.state ? store : { ...store, state };
}

function plural(count, word) {
  return `${count} ${count === 1 ? word : `${word}s`}`;
}

function roomReducer(store, action) {
  const { state } = store;

  switch (action.type) {
    case 'select': {
      const uid = state.items.some((item) => item.uid === action.uid) ? action.uid : null;
      return store.selectedUid === uid ? store : { ...store, selectedUid: uid };
    }

    case 'room':
      return withState(store, updateRoom(state, action.patch));

    case 'camera':
      return withState(store, updateCamera(state, action.camera));

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

    case 'notice':
      return withNotice(store, action.text, action.tone);

    default:
      return store;
  }
}

export function useRoom3d() {
  const [store, dispatch] = useReducer(roomReducer, undefined, init);
  const { state, selectedUid, notice } = store;

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
      announce: (text, tone) => dispatch({ type: 'notice', text, tone }),
    }),
    [],
  );

  const selected = useMemo(
    () => state.items.find((item) => item.uid === selectedUid) ?? null,
    [state.items, selectedUid],
  );

  return { state, selected, notice, actions };
}

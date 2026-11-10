import { useEffect, useMemo, useReducer } from 'react';
import { getFinish, getProduct } from '../data/products.js';
import { getWallPreset } from '../data/wall-presets.js';
import {
  commitHistory,
  createHistory,
  createLayout,
  duplicateItem,
  layoutFromPreset,
  loadLayout,
  MAX_WALL_ITEMS,
  mountProduct,
  persistLayout,
  redoHistory,
  removeItem,
  undoHistory,
  updateItem,
  updateWall,
} from '../lib/wall-studio.js';

function init() {
  return { history: createHistory(loadLayout()), selectedUid: null, notice: { text: '', tone: 'info', serial: 0 } };
}

function withNotice(state, text, tone = 'info') {
  return { ...state, notice: { text, tone, serial: state.notice.serial + 1 } };
}

function commit(state, layout) {
  const history = commitHistory(state.history, layout);
  return history === state.history ? state : { ...state, history };
}

function describe(item) {
  return `${getProduct(item.productId).name}, ${getFinish(item.finish).label}`;
}

function studioReducer(state, action) {
  const layout = state.history.present;

  switch (action.type) {
    case 'select':
      return state.selectedUid === action.uid ? state : { ...state, selectedUid: action.uid ?? null };

    case 'mount': {
      const product = getProduct(action.productId);
      if (!product) return state;
      if (layout.items.length >= MAX_WALL_ITEMS) {
        return withNotice(state, `Wall holds ${MAX_WALL_ITEMS} modules at most.`, 'warn');
      }
      const result = mountProduct(layout, action.productId);
      if (!result) return withNotice(state, `${product.name} is wider or taller than this wall.`, 'warn');
      const { item, clear } = result;
      const next = { ...commit(state, result.layout), selectedUid: item.uid };
      return clear
        ? withNotice(next, `Mounted ${product.name} at X ${item.xCm} / Y ${item.yCm} cm.`)
        : withNotice(next, `No clear position for ${product.name}. Placed with a conflict.`, 'warn');
    }

    case 'duplicate': {
      const result = duplicateItem(layout, action.uid);
      if (!result) return withNotice(state, 'No room to duplicate this module.', 'warn');
      const next = { ...commit(state, result.layout), selectedUid: result.item.uid };
      return withNotice(next, `Duplicated ${describe(result.item)}.`);
    }

    case 'update':
      return commit(state, updateItem(layout, action.uid, action.patch));

    case 'remove': {
      const item = layout.items.find((entry) => entry.uid === action.uid);
      const next = removeItem(layout, action.uid);
      if (!item || next === layout) return state;
      return withNotice({ ...commit(state, next), selectedUid: null }, `Removed ${describe(item)}.`);
    }

    case 'wall':
      return commit(state, updateWall(layout, action.patch));

    case 'preset': {
      const preset = getWallPreset(action.presetId);
      const next = layoutFromPreset(action.presetId, layout.wall);
      if (!next) return state;
      return withNotice({ ...commit(state, next), selectedUid: null }, `Loaded ${preset.name}.`);
    }

    case 'clear':
      if (layout.items.length === 0) return state;
      return withNotice(
        { ...commit(state, createLayout(layout.wall, [])), selectedUid: null },
        'Wall cleared.',
      );

    case 'import':
      return withNotice({ ...commit(state, action.layout), selectedUid: null }, action.message);

    case 'notice':
      return withNotice(state, action.text, action.tone);

    case 'undo': {
      const history = undoHistory(state.history);
      return history === state.history ? state : withNotice({ ...state, history }, 'Undo.');
    }

    case 'redo': {
      const history = redoHistory(state.history);
      return history === state.history ? state : withNotice({ ...state, history }, 'Redo.');
    }

    default:
      return state;
  }
}

export function useWallStudio() {
  const [state, dispatch] = useReducer(studioReducer, undefined, init);
  const { history, selectedUid, notice } = state;
  const layout = history.present;

  // Writing on mount also replaces a tampered payload with the sanitized layout.
  useEffect(() => {
    persistLayout(layout);
  }, [layout]);

  const actions = useMemo(
    () => ({
      select: (uid) => dispatch({ type: 'select', uid }),
      mount: (productId) => dispatch({ type: 'mount', productId }),
      duplicate: (uid) => dispatch({ type: 'duplicate', uid }),
      update: (uid, patch) => dispatch({ type: 'update', uid, patch }),
      remove: (uid) => dispatch({ type: 'remove', uid }),
      setWall: (patch) => dispatch({ type: 'wall', patch }),
      loadPreset: (presetId) => dispatch({ type: 'preset', presetId }),
      clear: () => dispatch({ type: 'clear' }),
      importLayout: (next, message) => dispatch({ type: 'import', layout: next, message }),
      announce: (text, tone) => dispatch({ type: 'notice', text, tone }),
      undo: () => dispatch({ type: 'undo' }),
      redo: () => dispatch({ type: 'redo' }),
    }),
    [],
  );

  const selected = useMemo(
    () => layout.items.find((item) => item.uid === selectedUid) ?? null,
    [layout, selectedUid],
  );

  return {
    layout,
    selected,
    notice,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    actions,
  };
}

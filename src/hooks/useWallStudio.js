import { useEffect, useMemo, useReducer } from 'react';
import { getFinish, getProduct } from '../data/products.js';
import { getWallPreset } from '../data/wall-presets.js';
import {
  alignModules,
  commitHistory,
  createHistory,
  createLayout,
  distributeModules,
  duplicateItem,
  layoutFromPreset,
  loadLayout,
  MAX_WALL_ITEMS,
  mountProduct,
  moveModules,
  persistLayout,
  redoHistory,
  removeItem,
  removeModules,
  undoHistory,
  updateItem,
  updateModules,
  updateWall,
} from '../lib/wall-studio.js';

function init() {
  return { history: createHistory(loadLayout()), selectedUids: [], notice: { text: '', tone: 'info', serial: 0 } };
}

function withNotice(state, text, tone = 'info') {
  return { ...state, notice: { text, tone, serial: state.notice.serial + 1 } };
}

function commit(state, layout) {
  const history = commitHistory(state.history, layout);
  return history === state.history ? state : { ...state, history };
}

function sameList(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function withSelection(state, uids) {
  return sameList(state.selectedUids, uids) ? state : { ...state, selectedUids: uids };
}

function plural(n) {
  return `${n} ${n === 1 ? 'module' : 'modules'}`;
}

const ALIGN_LABELS = {
  left: 'left edges',
  'center-x': 'vertical centrelines',
  right: 'right edges',
  top: 'top edges',
  'center-y': 'horizontal centrelines',
  bottom: 'bottom edges',
};

function describe(item) {
  return `${getProduct(item.productId).name}, ${getFinish(item.finish).label}`;
}

function studioReducer(state, action) {
  const layout = state.history.present;

  switch (action.type) {
    case 'select':
      return withSelection(state, action.uid ? [action.uid] : []);

    case 'toggle-select': {
      if (!layout.items.some((item) => item.uid === action.uid)) return state;
      const has = state.selectedUids.includes(action.uid);
      return withSelection(
        state,
        has ? state.selectedUids.filter((uid) => uid !== action.uid) : [...state.selectedUids, action.uid],
      );
    }

    case 'select-many': {
      const wanted = new Set(Array.isArray(action.uids) ? action.uids : []);
      const hits = layout.items.filter((item) => wanted.has(item.uid)).map((item) => item.uid);
      if (!action.additive) return withSelection(state, hits);
      return withSelection(state, [...state.selectedUids, ...hits.filter((uid) => !state.selectedUids.includes(uid))]);
    }

    case 'select-all':
      return withSelection(
        state,
        layout.items.filter((item) => !item.locked).map((item) => item.uid),
      );

    case 'move-group':
      return commit(state, moveModules(layout, action.uids, action.dx, action.dy));

    case 'remove-many': {
      const next = removeModules(layout, action.uids);
      if (next === layout) return state;
      const removed = layout.items.length - next.items.length;
      const kept = state.selectedUids.filter((uid) => next.items.some((item) => item.uid === uid));
      return withNotice({ ...commit(state, next), selectedUids: kept }, `Removed ${plural(removed)}.`);
    }

    case 'update-many':
      return commit(state, updateModules(layout, action.uids, action.patch));

    case 'align': {
      const next = alignModules(layout, action.uids, action.mode);
      if (next === layout) return withNotice(state, 'Selection already aligned.');
      return withNotice(commit(state, next), `Aligned ${ALIGN_LABELS[action.mode]}.`);
    }

    case 'distribute': {
      const next = distributeModules(layout, action.uids, action.axis);
      if (next === layout) return withNotice(state, 'Distribute needs 3 unlocked modules out of line.', 'warn');
      return withNotice(commit(state, next), `Distributed ${action.axis}ly.`);
    }

    case 'mount': {
      const product = getProduct(action.productId);
      if (!product) return state;
      if (layout.items.length >= MAX_WALL_ITEMS) {
        return withNotice(state, `Wall holds ${MAX_WALL_ITEMS} modules at most.`, 'warn');
      }
      const result = mountProduct(layout, action.productId);
      if (!result) return withNotice(state, `${product.name} is wider or taller than this wall.`, 'warn');
      const { item, clear } = result;
      const next = { ...commit(state, result.layout), selectedUids: [item.uid] };
      return clear
        ? withNotice(next, `Mounted ${product.name} at X ${item.xCm} / Y ${item.yCm} cm.`)
        : withNotice(next, `No clear position for ${product.name}. Placed with a conflict.`, 'warn');
    }

    case 'duplicate': {
      const result = duplicateItem(layout, action.uid);
      if (!result) return withNotice(state, 'No room to duplicate this module.', 'warn');
      const next = { ...commit(state, result.layout), selectedUids: [result.item.uid] };
      return withNotice(next, `Duplicated ${describe(result.item)}.`);
    }

    case 'update':
      return commit(state, updateItem(layout, action.uid, action.patch));

    case 'remove': {
      const item = layout.items.find((entry) => entry.uid === action.uid);
      const next = removeItem(layout, action.uid);
      if (!item || next === layout) return state;
      return withNotice({ ...commit(state, next), selectedUids: [] }, `Removed ${describe(item)}.`);
    }

    case 'wall':
      return commit(state, updateWall(layout, action.patch));

    case 'preset': {
      const preset = getWallPreset(action.presetId);
      const next = layoutFromPreset(action.presetId, layout.wall);
      if (!next) return state;
      return withNotice({ ...commit(state, next), selectedUids: [] }, `Loaded ${preset.name}.`);
    }

    case 'clear':
      if (layout.items.length === 0) return state;
      return withNotice(
        { ...commit(state, createLayout(layout.wall, [])), selectedUids: [] },
        'Wall cleared.',
      );

    case 'import':
      return withNotice({ ...commit(state, action.layout), selectedUids: [] }, action.message);

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
  const { history, notice } = state;
  const layout = history.present;

  // Writing on mount also replaces a tampered payload with the sanitized layout.
  useEffect(() => {
    persistLayout(layout);
  }, [layout]);

  const actions = useMemo(
    () => ({
      select: (uid) => dispatch({ type: 'select', uid }),
      toggleSelect: (uid) => dispatch({ type: 'toggle-select', uid }),
      selectMany: (uids, additive = false) => dispatch({ type: 'select-many', uids, additive }),
      selectAll: () => dispatch({ type: 'select-all' }),
      moveGroup: (uids, dx, dy) => dispatch({ type: 'move-group', uids, dx, dy }),
      removeMany: (uids) => dispatch({ type: 'remove-many', uids }),
      updateMany: (uids, patch) => dispatch({ type: 'update-many', uids, patch }),
      align: (uids, mode) => dispatch({ type: 'align', uids, mode }),
      distribute: (uids, axis) => dispatch({ type: 'distribute', uids, axis }),
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

  // Undo can retire a selected uid; only uids still on the wall count.
  const selectedUids = useMemo(() => {
    const present = new Set(layout.items.map((item) => item.uid));
    return state.selectedUids.filter((uid) => present.has(uid));
  }, [layout, state.selectedUids]);

  const selected = useMemo(
    () => layout.items.find((item) => item.uid === selectedUids[0]) ?? null,
    [layout, selectedUids],
  );

  return {
    layout,
    selected,
    selectedUids,
    notice,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    actions,
  };
}

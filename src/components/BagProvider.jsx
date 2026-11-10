import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { useToast } from '../contexts/ToastContext.jsx';
import { getFinish, getProduct } from '../data/products.js';
import { BagContext, BagDrawerContext } from '../hooks/useBag.js';
import { BAG_STORAGE_KEY, bagReducer, loadBag, persistBag, summarizeBag } from '../lib/bag.js';

export function BagProvider({ children }) {
  const [items, dispatch] = useReducer(bagReducer, undefined, loadBag);
  const { addToast } = useToast();
  const [drawer, setDrawer] = useState({ open: false, returnFocus: null });

  // Writing on mount also replaces a tampered payload with the sanitized lines.
  useEffect(() => {
    persistBag(items);
  }, [items]);

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== null && !event.key.endsWith(BAG_STORAGE_KEY)) return;
      dispatch({ type: 'hydrate', items: loadBag() });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const announce = useCallback((text) => addToast(text, 'success'), [addToast]);

  const add = useCallback(
    (id, finish, qty = 1) => {
      dispatch({ type: 'add', id, finish, qty });
      const product = getProduct(id);
      const finishData = getFinish(finish);
      if (product && finishData) announce(`${product.name}, ${finishData.label} added to bag.`);
    },
    [announce],
  );

  const addMany = useCallback(
    (lines, label = 'Items') => {
      if (!Array.isArray(lines) || lines.length === 0) return;
      dispatch({ type: 'merge', lines });
      const count = lines.reduce((sum, line) => sum + (Number.isInteger(line?.qty) ? line.qty : 0), 0);
      announce(`${label}: ${count} ${count === 1 ? 'item' : 'items'} added to bag.`);
    },
    [announce],
  );

  const step = useCallback((id, finish, delta) => dispatch({ type: 'step', id, finish, delta }), []);
  const remove = useCallback((id, finish) => dispatch({ type: 'remove', id, finish }), []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);

  const value = useMemo(() => {
    const quantityOf = (id, finish) =>
      items.find((line) => line.id === id && line.finish === finish)?.qty ?? 0;
    return { items, ...summarizeBag(items), quantityOf, add, addMany, step, remove, clear };
  }, [items, add, addMany, step, remove, clear]);

  // Drawer state lives in its own context so opening it does not re-render
  // every catalog card that reads the bag.
  const openBag = useCallback((returnFocus = null) => setDrawer({ open: true, returnFocus }), []);
  const closeBag = useCallback(() => setDrawer((prev) => (prev.open ? { ...prev, open: false } : prev)), []);
  const drawerValue = useMemo(
    () => ({ open: drawer.open, returnFocus: drawer.returnFocus, openBag, closeBag }),
    [drawer, openBag, closeBag],
  );

  return (
    <BagContext.Provider value={value}>
      <BagDrawerContext.Provider value={drawerValue}>
        {children}
      </BagDrawerContext.Provider>
    </BagContext.Provider>
  );
}

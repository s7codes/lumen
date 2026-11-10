import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { getFinish, getProduct } from '../data/products.js';
import { BagContext } from '../hooks/useBag.js';
import { BAG_STORAGE_KEY, bagReducer, loadBag, persistBag, summarizeBag } from '../lib/bag.js';

export function BagProvider({ children }) {
  const [items, dispatch] = useReducer(bagReducer, undefined, loadBag);
  const [notice, setNotice] = useState({ text: '', serial: 0 });

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

  const add = useCallback((id, finish, qty = 1) => {
    dispatch({ type: 'add', id, finish, qty });
    const product = getProduct(id);
    const finishData = getFinish(finish);
    if (product && finishData) {
      setNotice((prev) => ({
        text: `${product.name}, ${finishData.label} added to bag.`,
        serial: prev.serial + 1,
      }));
    }
  }, []);

  const step = useCallback((id, finish, delta) => dispatch({ type: 'step', id, finish, delta }), []);
  const remove = useCallback((id, finish) => dispatch({ type: 'remove', id, finish }), []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);

  const value = useMemo(() => {
    const quantityOf = (id, finish) =>
      items.find((line) => line.id === id && line.finish === finish)?.qty ?? 0;
    return { items, ...summarizeBag(items), quantityOf, add, step, remove, clear };
  }, [items, add, step, remove, clear]);

  return (
    <BagContext.Provider value={value}>
      {children}
      <div className="visually-hidden" role="status" aria-live="polite">
        <span key={notice.serial}>{notice.text}</span>
      </div>
    </BagContext.Provider>
  );
}

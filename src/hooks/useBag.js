import { createContext, useContext } from 'react';

export const BagContext = createContext(null);

export function useBag() {
  const bag = useContext(BagContext);
  if (!bag) throw new Error('useBag must be called inside <BagProvider>.');
  return bag;
}

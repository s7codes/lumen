import { createContext, useContext } from 'react';

export const BagContext = createContext(null);
export const BagDrawerContext = createContext(null);

export function useBag() {
  const bag = useContext(BagContext);
  if (!bag) throw new Error('useBag must be called inside <BagProvider>.');
  return bag;
}

export function useBagDrawer() {
  const drawer = useContext(BagDrawerContext);
  if (!drawer) throw new Error('useBagDrawer must be called inside <BagProvider>.');
  return drawer;
}

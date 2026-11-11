import { createContext, useContext } from 'react';

export const CommandPaletteContext = createContext(null);

export function useCommandPalette() {
  const palette = useContext(CommandPaletteContext);
  if (!palette) throw new Error('useCommandPalette must be called inside <CommandPaletteProvider>.');
  return palette;
}

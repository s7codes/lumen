import { useEffect } from 'react';

const TEXT_ENTRY = 'textarea, select, [contenteditable="true"], input:not([type="radio"]):not([type="checkbox"]):not([type="range"])';

/** Ctrl/Cmd+Z undo, Ctrl/Cmd+Y or Shift+Z redo, outside text entry and dialogs. */
export function useHistoryShortcuts(actions) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(`${TEXT_ENTRY}, [role="dialog"]`)) return;

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        actions.undo();
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        actions.redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions]);
}

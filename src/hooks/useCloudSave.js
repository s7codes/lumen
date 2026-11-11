import { useCallback, useEffect, useRef, useState } from 'react';
import { saveProject } from '../api/client.js';
import { useToast } from '../contexts/ToastContext.jsx';
import { padIndex } from '../lib/format.js';

export const SAVED_HOLD_MS = 2400;

/**
 * Save-to-cloud state for one project kind: idle -> saving -> saved (held
 * briefly) -> idle, or error. A second call while a save is in flight is
 * ignored, so a double click never commits two revisions.
 */
export function useCloudSave(kind) {
  const { addToast } = useToast();
  const [status, setStatus] = useState('idle');
  const [record, setRecord] = useState(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const holdTimer = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(holdTimer.current);
    };
  }, []);

  const save = useCallback(
    async (data, name) => {
      if (inFlight.current) return null;
      inFlight.current = true;
      window.clearTimeout(holdTimer.current);
      setStatus('saving');
      try {
        const saved = await saveProject(kind, data, { name });
        addToast(`${saved.name} saved to Lumen Cloud. Revision ${padIndex(saved.revision)}.`, 'success');
        if (mounted.current) {
          setRecord(saved);
          setStatus('saved');
          holdTimer.current = window.setTimeout(() => setStatus('idle'), SAVED_HOLD_MS);
        }
        return saved;
      } catch (error) {
        addToast(error?.name === 'ApiError' ? error.message : 'Save failed. Try again.', 'error');
        if (mounted.current) setStatus('error');
        return null;
      } finally {
        inFlight.current = false;
      }
    },
    [kind, addToast],
  );

  return { status, record, save };
}

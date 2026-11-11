import { useCallback, useRef, useState } from 'react';
import { loadProjects } from '../api/client.js';

/**
 * Open / close state for a planner's draft compare. Opening fetches the
 * cloud library; `projects` stays null until it arrives. A response that
 * lands after the dialog closed, or after it was reopened, is dropped.
 */
export function useDraftDiff() {
  const [session, setSession] = useState(null);
  const ticket = useRef(0);

  const open = useCallback((trigger) => {
    ticket.current += 1;
    const current = ticket.current;
    setSession({ trigger, projects: null });
    const settle = (projects) => {
      if (ticket.current !== current) return;
      setSession((prev) => (prev ? { ...prev, projects } : prev));
    };
    loadProjects().then(settle, () => settle([]));
  }, []);

  const close = useCallback(() => {
    ticket.current += 1;
    setSession(null);
  }, []);

  return { session, open, close };
}

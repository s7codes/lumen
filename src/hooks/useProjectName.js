import { useCallback, useState } from 'react';
import { loadProjectName, persistProjectName, PROJECT_NAME_MAX, sanitizeProjectName } from '../lib/project-library.js';

/**
 * The planner's active project name. Raw keystrokes stay in state so typing
 * feels native; storage and cloud saves only ever see the sanitized name.
 */
export function useProjectName(kind) {
  const [name, setName] = useState(() => loadProjectName(kind));

  const change = useCallback(
    (value) => {
      const next = String(value).slice(0, PROJECT_NAME_MAX);
      setName(next);
      persistProjectName(kind, next);
    },
    [kind],
  );

  const commit = useCallback(() => {
    const clean = sanitizeProjectName(name, kind);
    setName(clean);
    persistProjectName(kind, clean);
    return clean;
  }, [name, kind]);

  return { name, change, commit };
}

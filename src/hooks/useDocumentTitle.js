import { useEffect } from 'react';

const BASE_TITLE = 'Lumen - Architectural Lighting & Modular Systems';

export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} - Lumen` : BASE_TITLE;
  }, [title]);
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext.jsx';
import { copyText } from '../lib/clipboard.js';
import { decodeSceneParam, encodeSceneParam, SCENE_PARAM, stripSceneParam } from '../lib/scene-codec.js';

/**
 * Consumes `?scene=` once on arrival. A valid link replaces the workspace
 * through `apply`; a broken one leaves the draft alone. Either way the
 * parameter is dropped from the address bar so a reload never re-applies it.
 * `kinds` lists the scene kinds the workspace accepts, first match wins; the
 * decoded scene carries its `kind` so the workspace can adapt it.
 */
export function useSharedSceneLoader(kinds, apply) {
  const location = useLocation();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const handled = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has(SCENE_PARAM)) {
      handled.current = null;
      return;
    }
    const raw = params.get(SCENE_PARAM);
    // StrictMode re-runs the effect before the replace lands.
    if (handled.current === raw) return;
    handled.current = raw;

    const accepted = Array.isArray(kinds) ? kinds : [kinds];
    const decoded = accepted.map((kind) => decodeSceneParam(kind, raw)).find(Boolean) ?? null;
    navigate(
      { pathname: location.pathname, search: stripSceneParam(location.search), hash: location.hash },
      { replace: true, state: location.state, preventScrollReset: true },
    );
    if (decoded) {
      apply(decoded);
      addToast(`Loaded shared scene: ${decoded.name}.`, 'info');
    } else {
      addToast('Shared scene link is invalid.', 'error');
    }
  }, [location.search]);
}

/** Builds the share URL for the current workspace, copies it and keeps it for inspection. */
export function useShareLink(kind) {
  const { addToast } = useToast();
  const [shareUrl, setShareUrl] = useState('');

  const share = useCallback(
    async (state, name) => {
      const encoded = encodeSceneParam(kind, state, name);
      if (!encoded) {
        addToast('Scene too large to share as a link.', 'error');
        return null;
      }
      const url = `${window.location.origin}${window.location.pathname}?${SCENE_PARAM}=${encoded}`;
      setShareUrl(url);
      const copied = await copyText(url);
      if (copied) addToast('Shareable scene link copied.', 'success');
      else addToast('Clipboard blocked. Link held on the Share Link button.', 'warn');
      return url;
    },
    [kind, addToast],
  );

  return { shareUrl, share };
}

import { useCallback, useEffect, useRef } from 'react';
import { createViewportVideo } from '../lib/viewport-video.js';

/**
 * Plays a film only while it is on screen (and, in 'hover' mode, while the
 * pointer or focus holds it). Returns stable `engage` / `release` handlers
 * for the host's pointer and focus events. React never re-renders for
 * playback: the controller writes data-video on the host for CSS.
 */
export function useViewportVideo(videoRef, hostRef, { mode = 'auto', rewindOnRelease = false } = {}) {
  const controller = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    const host = hostRef?.current ?? video;
    if (!video || !host || typeof IntersectionObserver === 'undefined') return undefined;
    const c = createViewportVideo(video, { host, mode, rewindOnRelease });
    controller.current = c;
    return () => {
      c.destroy();
      if (controller.current === c) controller.current = null;
    };
  }, [videoRef, hostRef, mode, rewindOnRelease]);

  const engage = useCallback(() => controller.current?.engage(), []);
  const release = useCallback(() => controller.current?.release(), []);
  return { engage, release };
}

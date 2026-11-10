import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { sanitizeText } from '../security/sanitize.js';

export const TOAST_DURATION_MS = 4000;
const EXIT_MS = 220;
const MAX_TOASTS = 4;
const MAX_MESSAGE = 240;

export const TOAST_TONES = Object.freeze({
  success: 'OK',
  info: 'Note',
  warn: 'Check',
  error: 'Fault',
});

const ToastContext = createContext(null);

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function DismissGlyph() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.25" fill="none" />
    </svg>
  );
}

/**
 * App-wide notifications. Messages are plain text (sanitized, rendered as a
 * React text node), stack bottom-right, and leave after four seconds. The
 * list is one polite live region, so screen readers hear each addition once.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const serial = useRef(0);
  const timers = useRef(new Map());

  const clearTimer = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const dismiss = useCallback(
    (id) => {
      clearTimer(id);
      setToasts((list) => list.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)));
      const timer = setTimeout(
        () => {
          timers.current.delete(id);
          setToasts((list) => list.filter((toast) => toast.id !== id));
        },
        prefersReducedMotion() ? 0 : EXIT_MS,
      );
      timers.current.set(id, timer);
    },
    [clearTimer],
  );

  const addToast = useCallback(
    (message, tone = 'info') => {
      const text = sanitizeText(message, { maxLength: MAX_MESSAGE });
      if (!text) return null;
      serial.current += 1;
      const id = serial.current;
      const entry = { id, message: text, tone: Object.hasOwn(TOAST_TONES, tone) ? tone : 'info', leaving: false };
      setToasts((list) => {
        const kept = list.slice(-(MAX_TOASTS - 1));
        for (const dropped of list.slice(0, list.length - kept.length)) clearTimer(dropped.id);
        return [...kept, entry];
      });
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TOAST_DURATION_MS),
      );
      return id;
    },
    [dismiss, clearTimer],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ addToast, dismissToast: dismiss }), [addToast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <section className="toast-region" aria-label="Notifications">
        <ol className="toast-stack" role="status" aria-live="polite" aria-relevant="additions text">
          {toasts.map((toast) => (
            <li
              key={toast.id}
              className="toast"
              data-testid="toast"
              data-tone={toast.tone}
              data-leaving={toast.leaving || undefined}
            >
              <span className="toast__tone mono">{TOAST_TONES[toast.tone]}</span>
              <p className="toast__message" data-testid="toast-message">
                {toast.message}
              </p>
              <button
                type="button"
                className="toast__dismiss"
                aria-label="Dismiss notification"
                onClick={() => dismiss(toast.id)}
              >
                <DismissGlyph />
              </button>
              <span className="toast__timer" aria-hidden="true" />
            </li>
          ))}
        </ol>
      </section>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error('useToast must be called inside <ToastProvider>.');
  return toast;
}

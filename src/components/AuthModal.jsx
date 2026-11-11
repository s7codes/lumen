import { useCallback, useId, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { useModalDialog } from '../hooks/useModalDialog.js';
import { EMAIL_MAX, PASSWORD_MAX, PASSWORD_MIN } from '../lib/auth.js';
import { ArrowRight } from './icons.jsx';

const EMPTY = { email: '', password: '' };

function countOf(n, word) {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}

/** Sentence for what sign-in moved from this browser profile into the account library. */
function claimNote(claimed) {
  if (!claimed) return '';
  const parts = [];
  if (claimed.projects > 0) parts.push(countOf(claimed.projects, 'project'));
  if (claimed.quotes > 0) parts.push(countOf(claimed.quotes, 'requisition'));
  return parts.length > 0 ? ` ${parts.join(' and ')} from this browser moved into your account library.` : '';
}

/**
 * Sign-in dialog. The form validates locally, then opens a signed session on
 * the Lumen Cloud API; the password lives only in component state and in the
 * one request body, and is cleared on submit.
 */
export function AuthModal({ open, onClose, onSignedIn, returnFocus }) {
  const panelRef = useRef(null);
  const emailRef = useRef(null);
  const uid = useId();
  const { signIn } = useAuth();
  const { addToast } = useToast();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [pending, setPending] = useState(false);

  // Stable, so the modal effect does not re-run (and refocus) on every keystroke.
  const close = useCallback(() => {
    setForm(EMPTY);
    setErrors({});
    onClose();
  }, [onClose]);

  useModalDialog({ open, panelRef, initialFocusRef: emailRef, returnFocus, onClose: close });

  if (!open) return null;

  const update = (key, limit) => (event) => {
    const value = event.target.value.slice(0, limit);
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    const result = await signIn(form);
    setPending(false);
    if (!result.ok) {
      setErrors(result.errors);
      document.getElementById(`${uid}-${result.errors.email ? 'email' : 'password'}`)?.focus();
      return;
    }
    setForm(EMPTY);
    setErrors({});
    addToast(
      result.offline
        ? `Signed in as ${result.user.email} on this device. Lumen Cloud is unreachable.`
        : `Signed in as ${result.user.email}.${claimNote(result.claimed)}`,
      'success',
    );
    onSignedIn(result.user);
  };

  return (
    <div className="modal-root">
      <div className="modal-scrim" onClick={close} aria-hidden="true" />
      <div
        ref={panelRef}
        className="auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
        aria-describedby={`${uid}-note`}
        data-testid="auth-modal"
      >
        <header className="auth-modal__header">
          <div>
            <p className="index-label">
              <span className="index-label__num">06</span> / Account
            </p>
            <h2 id={`${uid}-title`} className="auth-modal__title">
              Sign in
            </h2>
          </div>
          <button type="button" className="drawer__close" onClick={close}>
            Close
          </button>
        </header>

        <form className="auth-modal__form" noValidate onSubmit={submit}>
          <div className="field auth-field" data-invalid={errors.email ? 'true' : undefined}>
            <label className="field__label" htmlFor={`${uid}-email`}>
              Email
            </label>
            <input
              ref={emailRef}
              id={`${uid}-email`}
              className="field__input auth-field__input"
              type="email"
              name="email"
              inputMode="email"
              autoComplete="email"
              spellCheck={false}
              maxLength={EMAIL_MAX}
              value={form.email}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? `${uid}-email-error` : undefined}
              data-testid="auth-email"
              onChange={update('email', EMAIL_MAX)}
            />
            {errors.email && (
              <p id={`${uid}-email-error`} className="auth-field__error mono">
                {errors.email}
              </p>
            )}
          </div>

          <div className="field auth-field" data-invalid={errors.password ? 'true' : undefined}>
            <label className="field__label" htmlFor={`${uid}-password`}>
              Password
            </label>
            <input
              id={`${uid}-password`}
              className="field__input auth-field__input"
              type="password"
              name="password"
              autoComplete="current-password"
              minLength={PASSWORD_MIN}
              maxLength={PASSWORD_MAX}
              value={form.password}
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? `${uid}-password-error` : `${uid}-password-hint`}
              data-testid="auth-password"
              onChange={update('password', PASSWORD_MAX)}
            />
            {errors.password ? (
              <p id={`${uid}-password-error`} className="auth-field__error mono">
                {errors.password}
              </p>
            ) : (
              <p id={`${uid}-password-hint`} className="auth-field__hint mono">
                {PASSWORD_MIN} characters minimum
              </p>
            )}
          </div>

          <button
            type="submit"
            className="button button--primary auth-modal__submit"
            data-testid="auth-submit"
            disabled={pending}
            aria-busy={pending || undefined}
          >
            {pending ? 'Signing In...' : 'Sign In'}
            <ArrowRight />
          </button>

          <p id={`${uid}-note`} className="auth-modal__note mono">
            Sessions are signed by the Lumen Cloud API. The server checks the password length and discards it;
            this browser keeps the display name, the address and the session token.
          </p>
        </form>
      </div>
    </div>
  );
}

import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { useConcierge } from '../hooks/useConcierge.js';
import { sanitizeEmail } from '../lib/auth.js';
import { sanitizeTicketMessage, sanitizeTicketSubject, TICKET_LIMITS, TICKET_QUEUED } from '../lib/cloud-records.js';
import { canMarkUnhelpful, CONCIERGE_CATEGORIES, QUESTION_MAX, routeLabel } from '../lib/concierge-engine.js';
import { isSafeInternalPath } from '../security/sanitize.js';
import { ApertureGlyph } from './icons.jsx';

const LOCKED_COPY = 'Direct engineering contact is locked while Studio AI handles your questions.';
const UNLOCKED_COPY = Object.freeze({
  unresolved_query: 'Studio Engineering Contact unlocked: Studio AI could not resolve your inquiry.',
  marked_unhelpful: 'Studio Engineering Contact unlocked: you marked an answer as not resolving your issue.',
});

function DismissGlyph() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.25" fill="none" />
    </svg>
  );
}

function LockGlyph({ open }) {
  return (
    <svg viewBox="0 0 14 16" width="12" height="14" aria-hidden="true" focusable="false" className="concierge-gate__glyph">
      <rect x="1.5" y="7" width="11" height="7.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d={open ? 'M4 7V4.5a3 3 0 0 1 5.8-1.1' : 'M4 7V4.5a3 3 0 0 1 6 0V7'} fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 10v1.8" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/** Answer text: blank lines split blocks, and lines that start with "- " become a list. */
function AnswerBody({ text }) {
  return text.split('\n\n').map((block, b) => {
    const nodes = [];
    let items = [];
    const flush = () => {
      if (items.length === 0) return;
      nodes.push(
        <ul key={`l${nodes.length}`} className="concierge-msg__list">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>,
      );
      items = [];
    };
    for (const line of block.split('\n')) {
      if (line.startsWith('- ')) {
        items.push(line.slice(2));
      } else {
        flush();
        nodes.push(<p key={`p${nodes.length}`}>{line}</p>);
      }
    }
    flush();
    return <Fragment key={b}>{nodes}</Fragment>;
  });
}

function ReplyTurn({ turn, pathname, onUnhelpful, onNavigate, latestRef }) {
  const { reply, kind, markedUnhelpful } = turn;
  const pct = Math.round(reply.confidence * 100);
  // A chip back to the page the visitor is on would only close the panel.
  const actions = reply.suggestedActions.filter((action) => isSafeInternalPath(action.to) && action.to !== pathname);
  return (
    <li
      ref={latestRef}
      className="concierge-msg concierge-msg--ai"
      data-testid="concierge-reply"
      data-kind={kind}
      data-reply-id={reply.id}
      data-category={reply.category}
      data-resolved={String(reply.resolved)}
      data-confidence={reply.confidence.toFixed(2)}
      data-transport={turn.transport}
      data-marked-unhelpful={markedUnhelpful || undefined}
    >
      <p className="concierge-msg__meta mono">
        <span className="concierge-msg__category">
          {kind === 'followup' ? 'Engineering Follow-Up' : CONCIERGE_CATEGORIES[reply.category]}
        </span>
        {kind === 'answer' && (
          <span className="concierge-msg__confidence" data-testid="concierge-confidence" data-resolved={String(reply.resolved)}>
            {reply.resolved ? 'Resolved' : 'Needs Engineer'} {pct}%
          </span>
        )}
      </p>
      <div className="concierge-msg__body">
        <AnswerBody text={reply.answer} />
      </div>
      {reply.metrics.length > 0 && (
        <dl className="concierge-metrics" data-testid="concierge-metrics">
          {reply.metrics.map((metric) => (
            <div key={metric.label} className="concierge-metric">
              <dt>{metric.label}</dt>
              <dd>{metric.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {actions.length > 0 && (
        <nav className="concierge-actions" aria-label="Suggested next steps">
          {actions.map((action) => (
            <Link key={action.to} to={action.to} className="concierge-action" data-testid="concierge-action" onClick={onNavigate}>
              {action.label}
            </Link>
          ))}
        </nav>
      )}
      {reply.citations.length > 0 && (
        <p className="concierge-cites mono" data-testid="concierge-citations">
          Sources: {reply.citations.map((citation) => citation.label).join(' / ')}
        </p>
      )}
      {kind === 'answer' &&
        canMarkUnhelpful(reply) &&
        (markedUnhelpful ? (
          <p className="concierge-msg__flag mono" data-testid="concierge-marked-unhelpful">
            Marked as not resolving your issue
          </p>
        ) : (
          <button
            type="button"
            className="concierge-msg__unhelpful"
            data-testid="concierge-mark-unhelpful"
            onClick={() => onUnhelpful(turn.id)}
          >
            Did not resolve my issue
          </button>
        ))}
    </li>
  );
}

function TicketConfirmation({ ticket, email, signedIn, onNavigate }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const local = ticket.transport === 'local';
  return (
    <div
      ref={ref}
      className="concierge-confirm"
      data-testid="concierge-ticket-confirmation"
      data-ticket-ref={ticket.ref}
      data-transport={ticket.transport}
      role="status"
      tabIndex={-1}
    >
      <p className="concierge-confirm__label mono">Engineering Ticket Issued</p>
      <p className="concierge-confirm__ref mono" data-testid="concierge-ticket-ref">
        {ticket.ref}
      </p>
      <p className="concierge-confirm__status">{TICKET_QUEUED}</p>
      <p className="concierge-confirm__note">
        {local
          ? 'Lumen Cloud is unreachable, so the ticket is stored on this device and transmits when the API is back.'
          : `A Lumen studio engineer replies to ${email} with the transcript and your live workspace specs in hand.`}
      </p>
      {signedIn && (
        <Link to="/account" className="concierge-action" onClick={onNavigate}>
          View in Account
        </Link>
      )}
    </div>
  );
}

function EscalationForm({ concierge, user, onSent }) {
  const uid = useId();
  const [values, setValues] = useState(() => ({
    email: user?.email ?? '',
    subject: concierge.inquiry ? `Engineering review - ${concierge.inquiry}`.slice(0, TICKET_LIMITS.subject.max).trim() : '',
    message: '',
  }));
  const [errors, setErrors] = useState({});
  const [fault, setFault] = useState('');
  const [sending, setSending] = useState(false);
  const fieldRefs = { email: useRef(null), subject: useRef(null), message: useRef(null) };

  // Signing in while the form is open fills a still-blank reply address.
  const signedInEmail = user?.email ?? '';
  useEffect(() => {
    if (signedInEmail) setValues((prev) => (prev.email ? prev : { ...prev, email: signedInEmail }));
  }, [signedInEmail]);

  const set = (key) => (event) => {
    const { value } = event.target;
    setValues((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (sending) return;
    const next = {};
    if (!sanitizeEmail(values.email)) next.email = 'Enter a reply address such as studio@lumen.com.';
    if (!sanitizeTicketSubject(values.subject)) next.subject = `Subject needs ${TICKET_LIMITS.subject.min} to ${TICKET_LIMITS.subject.max} characters.`;
    if (!sanitizeTicketMessage(values.message)) {
      next.message = `Engineering brief needs ${TICKET_LIMITS.message.min} to ${TICKET_LIMITS.message.max} characters.`;
    }
    setErrors(next);
    const first = ['email', 'subject', 'message'].find((key) => next[key]);
    if (first) {
      fieldRefs[first].current?.focus();
      return;
    }
    setFault('');
    setSending(true);
    try {
      const result = await concierge.submitTicket(values);
      onSent(result, values.email);
    } catch (error) {
      setFault(error?.name === 'ApiError' ? error.message : 'The ticket could not be sent. Try again.');
      setSending(false);
    }
  };

  const field = (key, label, control) => (
    <div className="concierge-field" data-invalid={errors[key] ? 'true' : undefined}>
      <label className="concierge-field__label" htmlFor={`${uid}-${key}`}>
        {label}
      </label>
      {control}
      {errors[key] && (
        <p className="concierge-field__error" id={`${uid}-${key}-error`} data-testid={`concierge-ticket-${key}-error`}>
          {errors[key]}
        </p>
      )}
    </div>
  );
  const describedBy = (key) => (errors[key] ? `${uid}-${key}-error` : undefined);

  return (
    <form
      className="concierge-ticket"
      data-testid="concierge-escalation-form"
      aria-labelledby={`${uid}-title`}
      aria-busy={sending || undefined}
      noValidate
      onSubmit={submit}
    >
      <h3 id={`${uid}-title`} className="concierge-ticket__title">
        Contact Studio Engineering
      </h3>
      <p className="concierge-ticket__lede">
        Your brief travels with the consultation transcript and your live workspace specs.
      </p>
      {field(
        'email',
        'Email',
        <input
          ref={fieldRefs.email}
          id={`${uid}-email`}
          className="concierge-input"
          type="email"
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          value={values.email}
          onChange={set('email')}
          aria-invalid={errors.email ? 'true' : undefined}
          aria-describedby={describedBy('email')}
          data-testid="concierge-ticket-email"
        />,
      )}
      {field(
        'subject',
        'Subject',
        <input
          ref={fieldRefs.subject}
          id={`${uid}-subject`}
          className="concierge-input"
          type="text"
          maxLength={TICKET_LIMITS.subject.max}
          value={values.subject}
          onChange={set('subject')}
          aria-invalid={errors.subject ? 'true' : undefined}
          aria-describedby={describedBy('subject')}
          data-testid="concierge-ticket-subject"
        />,
      )}
      {field(
        'message',
        'Engineering Brief',
        <textarea
          ref={fieldRefs.message}
          id={`${uid}-message`}
          className="concierge-input concierge-input--area"
          rows={4}
          maxLength={TICKET_LIMITS.message.max}
          placeholder="Site conditions, sizes, substrate and what the automated answer did not cover."
          value={values.message}
          onChange={set('message')}
          aria-invalid={errors.message ? 'true' : undefined}
          aria-describedby={describedBy('message')}
          data-testid="concierge-ticket-message"
        />,
      )}
      <details className="concierge-ticket__specs">
        <summary>Attached Workspace Specs</summary>
        <p className="mono" data-testid="concierge-ticket-summary">
          {concierge.workspaceSummary}
        </p>
      </details>
      {fault && (
        <p className="concierge-ticket__fault" role="alert" data-testid="concierge-ticket-error">
          {fault}
        </p>
      )}
      <button type="submit" className="concierge-ticket__submit" data-testid="concierge-ticket-submit" disabled={sending}>
        {sending ? 'Transmitting...' : 'Transmit Engineering Ticket'}
      </button>
    </form>
  );
}

/**
 * Lumen Studio AI concierge panel. A non-modal dialog: the page stays usable
 * while it is open. Escape (from inside) and the close key hand focus back
 * to the trigger.
 */
export default function ConciergePanel({ open, onClose, panelId }) {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { addToast } = useToast();
  const concierge = useConcierge(pathname);
  const [draft, setDraft] = useState('');
  const [sentTo, setSentTo] = useState('');
  const inputRef = useRef(null);
  const bodyRef = useRef(null);
  const latestRef = useRef(null);
  const unlocked = concierge.escalation === 'unlocked';
  const { turns, pending, ticket } = concierge;

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // A new reply scrolls into view from its first line (the body is the
  // offset parent); the question and the pending row pin the stream to the bottom.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const last = turns.at(-1);
    if (last?.role === 'assistant' && latestRef.current) {
      body.scrollTop = Math.max(0, latestRef.current.offsetTop - 8);
    } else {
      body.scrollTop = body.scrollHeight;
    }
  }, [turns, pending]);

  // The send key and the prompt chips disable while a reply is pending, which
  // would drop focus to the page; the composer keeps it, so Escape still closes.
  const send = (question) => {
    concierge.ask(question);
    inputRef.current?.focus();
  };

  const onSubmit = (event) => {
    event.preventDefault();
    if (pending || draft.trim() === '') return;
    send(draft);
    setDraft('');
  };

  const onSent = ({ ticket: issued, transport }, email) => {
    setSentTo(email);
    addToast(
      transport === 'local'
        ? `Ticket ${issued.ref} stored on this device. It transmits when Lumen Cloud is reachable.`
        : `Engineering ticket ${issued.ref} transmitted. ${TICKET_QUEUED}.`,
      'success',
    );
  };

  const onPanelKeyDown = (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onClose();
  };

  const lastAssistant = turns.findLastIndex((turn) => turn.role === 'assistant');

  return (
    <section
      id={panelId}
      className="concierge-panel"
      role="dialog"
      aria-label="Lumen Studio AI Concierge"
      data-testid="concierge-panel"
      data-escalation={concierge.escalation}
      data-escalation-reason={concierge.escalationReason ?? undefined}
      data-state={pending ? 'pending' : 'idle'}
      data-turns={turns.length}
      hidden={!open}
      onKeyDown={onPanelKeyDown}
    >
      <header className="concierge-panel__head">
        <span className="concierge-panel__mark">
          <ApertureGlyph size={16} />
        </span>
        <div className="concierge-panel__heading">
          <p className="concierge-panel__status mono">LUMEN SPEC CONCIERGE // LIVE WORKSPACE RAG</p>
          <h2 className="concierge-panel__title">Studio AI Concierge</h2>
          <p className="concierge-panel__context mono" data-testid="concierge-context">
            Context: {routeLabel(pathname)}
          </p>
        </div>
        <button type="button" className="concierge-panel__close" aria-label="Close Studio AI" data-testid="concierge-close" onClick={onClose}>
          <DismissGlyph />
        </button>
      </header>

      <div ref={bodyRef} className="concierge-panel__body">
        <div className="concierge-intro" data-testid="concierge-quick-prompts">
          {turns.length === 0 && (
            <p className="concierge-intro__lede">
              Ask about any part, 24V driver sizing, acoustics or lighting. I read your live 2D wall, 3D room and cart.
            </p>
          )}
          <div className="concierge-prompts" role="group" aria-label="Suggested questions">
            {concierge.quickPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="concierge-prompt"
                data-testid="concierge-quick-prompt"
                disabled={pending}
                onClick={() => send(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        <ol className="concierge-messages" data-testid="concierge-messages" role="log" aria-live="polite" aria-label="Conversation">
          {turns.map((turn, i) =>
            turn.role === 'user' ? (
              <li key={turn.id} className="concierge-msg concierge-msg--user" data-testid="concierge-question">
                <p>{turn.text}</p>
              </li>
            ) : (
              <ReplyTurn
                key={turn.id}
                turn={turn}
                pathname={pathname}
                latestRef={i === lastAssistant ? latestRef : undefined}
                onUnhelpful={concierge.markUnhelpful}
                onNavigate={onClose}
              />
            ),
          )}
          {pending && (
            <li className="concierge-msg concierge-msg--pending" data-testid="concierge-pending">
              <span className="concierge-pending__bar" aria-hidden="true" />
              <p className="mono">Consulting the catalog and your live workspace...</p>
            </li>
          )}
        </ol>

        {concierge.fault && (
          <p className="concierge-fault" role="alert" data-testid="concierge-fault">
            {concierge.fault}
          </p>
        )}

        {unlocked &&
          (ticket ? (
            <TicketConfirmation ticket={ticket} email={sentTo} signedIn={Boolean(user)} onNavigate={onClose} />
          ) : (
            <EscalationForm concierge={concierge} user={user} onSent={onSent} />
          ))}
      </div>

      <div
        className="concierge-gate"
        data-testid="concierge-gatekeeper-status"
        data-escalation={concierge.escalation}
        role="status"
      >
        <LockGlyph open={unlocked} />
        <p>{unlocked ? UNLOCKED_COPY[concierge.escalationReason] : LOCKED_COPY}</p>
      </div>

      <form className="concierge-composer" onSubmit={onSubmit}>
        <label className="visually-hidden" htmlFor={`${panelId}-input`}>
          Ask Studio AI
        </label>
        <input
          ref={inputRef}
          id={`${panelId}-input`}
          className="concierge-composer__input"
          type="text"
          autoComplete="off"
          maxLength={QUESTION_MAX}
          placeholder="Ask about parts, 24V sizing, acoustics or your live room"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          data-testid="concierge-input"
        />
        <button type="submit" className="concierge-composer__send" data-testid="concierge-send" disabled={pending || draft.trim() === ''}>
          Ask
        </button>
      </form>
    </section>
  );
}

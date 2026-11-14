import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { useConcierge } from '../hooks/useConcierge.js';
import { sanitizeEmail } from '../lib/auth.js';
import { sanitizeTicketMessage, sanitizeTicketSubject, TICKET_LIMITS, TICKET_QUEUED } from '../lib/cloud-records.js';
import { canMarkUnhelpful, CONCIERGE_CATEGORIES, MCP_PROTOCOL, QUESTION_MAX, routeLabel } from '../lib/concierge-engine.js';
import { isSafeInternalPath } from '../security/sanitize.js';
import { ArrowRight, LumenMark } from './icons.jsx';

// Read by assistive technology and the gatekeeper specs; never painted while locked.
const LOCKED_COPY = 'Direct engineering contact is locked while Studio AI handles your questions.';
const UNLOCKED_COPY = Object.freeze({
  unresolved_query: 'Studio Engineering Contact unlocked: Studio AI could not resolve your inquiry.',
  marked_unhelpful: 'Studio Engineering Contact unlocked: you marked an answer as not resolving your issue.',
});
const UNHELPFUL_COPY = 'Did not resolve my issue - request engineer';

function DismissGlyph() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.25" fill="none" />
    </svg>
  );
}

function SendGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true" focusable="false">
      <path d="M8 13V3.5M3.75 7.5 8 3.25l4.25 4.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}

// A pencil over a square: start a new conversation.
function NewChatGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true" focusable="false">
      <path d="M7 2.75H3.25a.5.5 0 0 0-.5.5v9.5a.5.5 0 0 0 .5.5h9.5a.5.5 0 0 0 .5-.5V9" stroke="currentColor" strokeWidth="1.25" />
      <path d="M11.6 2.4 13.6 4.4 8.4 9.6 6 10l.4-2.4z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    </svg>
  );
}

// Up to 48 characters before the first ": " read as the bullet's label.
const BULLET_LABEL = /^([^:]{1,48}): (.+)$/;
const MAX_PILLS = 4;

function Bullet({ text }) {
  const match = BULLET_LABEL.exec(text);
  if (!match) return <li>{text}</li>;
  return (
    <li>
      <strong className="concierge-msg__label">{match[1]}</strong>: {match[2]}
    </li>
  );
}

/**
 * Answer text: the first line is the lead, lines that start with "- " become
 * a list with bold labels, and later blank-line blocks read as notes.
 */
function AnswerBody({ text }) {
  return text.split('\n\n').map((block, b) => {
    const nodes = [];
    let items = [];
    const flush = () => {
      if (items.length === 0) return;
      nodes.push(
        <ul key={`l${nodes.length}`} className="concierge-msg__list">
          {items.map((item, i) => (
            <Bullet key={i} text={item} />
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
        const role = b > 0 ? 'concierge-msg__note' : nodes.length === 0 ? 'concierge-msg__lead' : undefined;
        nodes.push(
          <p key={`p${nodes.length}`} className={role}>
            {line}
          </p>,
        );
      }
    }
    flush();
    return <Fragment key={b}>{nodes}</Fragment>;
  });
}

/**
 * The MCP tools Lumen AI ran for this answer, in order: one flat chip per
 * call, "MCP // tool: what it did". A refused edit reads in amber.
 */
function ToolTrace({ calls }) {
  return (
    <ol className="concierge-tools" data-testid="concierge-tool-calls" aria-label="MCP tool calls">
      {calls.map((call, i) => (
        <li
          key={`${call.name}-${i}`}
          className="concierge-tool"
          data-testid="concierge-tool-call"
          data-tool-name={call.name}
          data-status={call.status}
          title={call.summary || call.name}
        >
          <span className="concierge-tool__proto" aria-hidden="true">
            MCP //
          </span>
          <span className="visually-hidden">MCP tool </span>
          <span className="concierge-tool__name">{call.name}</span>
          {call.summary && <span className="concierge-tool__summary">: {call.summary}</span>}
        </li>
      ))}
    </ol>
  );
}

// The body streams in once, top to bottom; the flag lands on the element
// itself (never through React state), so reopening the panel never replays it.
function markRevealed(event) {
  if (event.target instanceof Element && event.target.classList.contains('concierge-msg__body')) {
    event.currentTarget.dataset.revealed = 'true';
  }
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
      data-client-actions={reply.clientActions?.length || undefined}
      data-reply-id={reply.id}
      data-category={reply.category}
      data-resolved={String(reply.resolved)}
      data-confidence={reply.confidence.toFixed(2)}
      data-transport={turn.transport}
      data-marked-unhelpful={markedUnhelpful || undefined}
      onAnimationEnd={markRevealed}
    >
      <span className="concierge-avatar" aria-hidden="true" data-testid="concierge-avatar">
        <LumenMark size={12} />
      </span>
      <div className="concierge-msg__content">
        <p className="concierge-msg__meta">
          <span className="concierge-msg__category">
            {kind === 'followup' ? 'Engineering Follow-Up' : CONCIERGE_CATEGORIES[reply.category]}
          </span>
          {kind === 'answer' && (
            <span
              className="concierge-msg__confidence tech-only mono"
              data-testid="concierge-confidence"
              data-resolved={String(reply.resolved)}
            >
              {reply.resolved ? 'Resolved' : 'Needs Engineer'} {pct}%
            </span>
          )}
        </p>
        {reply.toolCalls?.length > 0 && <ToolTrace calls={reply.toolCalls} />}
        <div className="concierge-msg__body">
          <AnswerBody text={reply.answer} />
        </div>
        {reply.metrics.length > 0 && (
          <dl className="concierge-metrics" data-testid="concierge-metrics">
            {reply.metrics.slice(0, MAX_PILLS).map((metric) => (
              <div key={metric.label} className="concierge-metric">
                <dt>{metric.label}</dt>
                <dd>{metric.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {actions.length > 0 && (
          <nav className="concierge-actions" aria-label="Suggested next steps">
            {actions.map((action, i) => (
              <Link
                key={action.to}
                to={action.to}
                className="concierge-action"
                data-primary={i === 0 || undefined}
                data-testid="concierge-action"
                onClick={onNavigate}
              >
                {action.label}
                <ArrowRight className="concierge-action__arrow" />
              </Link>
            ))}
          </nav>
        )}
        {reply.citations.length > 0 && (
          <p className="concierge-cites tech-only mono" data-testid="concierge-citations">
            Sources: {reply.citations.map((citation) => citation.label).join(' / ')}
          </p>
        )}
        {kind === 'answer' &&
          canMarkUnhelpful(reply) &&
          (markedUnhelpful ? (
            <p className="concierge-msg__flag" data-testid="concierge-marked-unhelpful">
              Marked as not resolving your issue
            </p>
          ) : (
            <button
              type="button"
              className="concierge-msg__unhelpful"
              data-testid="concierge-mark-unhelpful"
              onClick={() => onUnhelpful(turn.id)}
            >
              {UNHELPFUL_COPY}
            </button>
          ))}
      </div>
    </li>
  );
}

/**
 * Starter questions. Before the first message they are the welcome cards;
 * once the thread starts they fold into one scrolling row of chips docked
 * over the composer, so the conversation keeps the panel.
 */
function QuickPrompts({ prompts, layout, disabled, onAsk }) {
  return (
    <div
      className={`concierge-prompts concierge-prompts--${layout}`}
      data-testid="concierge-quick-prompts"
      data-layout={layout}
      role="group"
      aria-label="Suggested questions"
    >
      {prompts.map((prompt) => (
        <button
          key={prompt}
          type="button"
          className="concierge-prompt"
          data-testid="concierge-quick-prompt"
          disabled={disabled}
          onClick={() => onAsk(prompt)}
        >
          <span className="concierge-prompt__text">{prompt}</span>
          {layout === 'cards' && <ArrowRight className="concierge-prompt__arrow" />}
        </button>
      ))}
    </div>
  );
}

function Welcome({ prompts, disabled, onAsk }) {
  return (
    <div className="concierge-welcome" data-testid="concierge-welcome">
      <span className="concierge-welcome__mark" aria-hidden="true">
        <LumenMark size={20} />
      </span>
      <h3 className="concierge-welcome__title">How can I help with your space?</h3>
      <p className="concierge-welcome__lede">Ask about any part, 24V wiring, or audit your live 3D room.</p>
      <QuickPrompts prompts={prompts} layout="cards" disabled={disabled} onAsk={onAsk} />
    </div>
  );
}

function TicketConfirmation({ ticket, email }) {
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
      <p className="concierge-confirm__label">Engineering Ticket Issued</p>
      <p className="concierge-confirm__ref mono" data-testid="concierge-ticket-ref">
        {ticket.ref}
      </p>
      <p className="concierge-confirm__status">{TICKET_QUEUED}</p>
      <p className="concierge-confirm__note">
        {local
          ? 'Lumen Cloud is unreachable, so the ticket is stored on this device and transmits when the API is back.'
          : `A Lumen studio engineer replies to ${email} with the transcript and your live workspace specs in hand.`}
      </p>
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
 * Lumen AI panel. A non-modal dialog: the page stays usable while it is
 * open. Escape (from inside) and the close key hand focus back to the
 * trigger. The escalation gatekeeper runs silently: while locked it is a
 * screen-reader status only, and it surfaces once contact unlocks.
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

  const newChat = () => {
    concierge.reset();
    setDraft('');
    setSentTo('');
    inputRef.current?.focus();
  };

  const lastAssistant = turns.findLastIndex((turn) => turn.role === 'assistant');
  const active = turns.length > 0;

  return (
    <section
      id={panelId}
      className="concierge-panel"
      role="dialog"
      aria-label="Lumen Studio AI Concierge"
      data-testid="concierge-panel"
      data-mcp={MCP_PROTOCOL}
      data-escalation={concierge.escalation}
      data-escalation-reason={concierge.escalationReason ?? undefined}
      data-state={pending ? 'pending' : 'idle'}
      data-thread={active ? 'active' : 'welcome'}
      data-turns={turns.length}
      hidden={!open}
      onKeyDown={onPanelKeyDown}
    >
      <header className="concierge-panel__head">
        <span className="concierge-panel__mark" aria-hidden="true">
          <LumenMark size={14} />
        </span>
        <div className="concierge-panel__heading">
          <div className="concierge-panel__title-row">
            <h2 className="concierge-panel__title">Lumen AI</h2>
            <span className="concierge-panel__badge" data-testid="concierge-badge">
              Workspace Aware
            </span>
          </div>
          <p className="concierge-panel__context" data-testid="concierge-context">
            <span className="visually-hidden">Context: </span>
            {routeLabel(pathname)}
          </p>
        </div>
        <div className="concierge-panel__keys">
          {active && (
            <button
              type="button"
              className="concierge-panel__key"
              aria-label="New chat"
              title="New chat"
              data-testid="concierge-reset"
              onClick={newChat}
            >
              <NewChatGlyph />
            </button>
          )}
          <button
            type="button"
            className="concierge-panel__key"
            aria-label="Close Studio AI"
            data-testid="concierge-close"
            onClick={onClose}
          >
            <DismissGlyph />
          </button>
        </div>
      </header>

      <div ref={bodyRef} className="concierge-panel__body">
        {!active && <Welcome prompts={concierge.quickPrompts} disabled={pending} onAsk={send} />}

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
              <span className="concierge-avatar" aria-hidden="true">
                <LumenMark size={12} />
              </span>
              <div className="concierge-pending">
                <span className="concierge-pending__bar" aria-hidden="true" />
                <p>Consulting the catalog and your live workspace...</p>
              </div>
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
            <TicketConfirmation ticket={ticket} email={sentTo} />
          ) : (
            <EscalationForm concierge={concierge} user={user} onSent={onSent} />
          ))}
      </div>

      {/* One persistent live region: the unlock is announced as a change, and
          while locked the status is spoken but never painted. */}
      <div
        className={unlocked ? 'concierge-gate' : 'concierge-gate visually-hidden'}
        data-testid="concierge-gatekeeper-status"
        data-escalation={concierge.escalation}
        role="status"
      >
        <p>{unlocked ? UNLOCKED_COPY[concierge.escalationReason] : LOCKED_COPY}</p>
      </div>

      {active && <QuickPrompts prompts={concierge.quickPrompts} layout="chips" disabled={pending} onAsk={send} />}

      <form className="concierge-composer" onSubmit={onSubmit}>
        <div className="concierge-composer__field">
          <label className="visually-hidden" htmlFor={`${panelId}-input`}>
            Ask Lumen
          </label>
          <input
            ref={inputRef}
            id={`${panelId}-input`}
            className="concierge-composer__input"
            type="text"
            autoComplete="off"
            maxLength={QUESTION_MAX}
            placeholder="Ask about any part or your room"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            data-testid="concierge-input"
          />
          <button
            type="submit"
            className="concierge-composer__send"
            aria-label="Ask"
            data-testid="concierge-send"
            disabled={pending || draft.trim() === ''}
          >
            <SendGlyph />
          </button>
        </div>
      </form>
    </section>
  );
}

import { lazy, Suspense, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import {
  deleteProject,
  getCloudTransport,
  getLibraryScope,
  LIBRARY_LABELS,
  loadProjects,
  loadQuotes,
  loadSupportTickets,
  subscribeCloudTransport,
} from '../api/client.js';
import { ElevationThumb } from '../components/ElevationThumb.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { ArrowRight } from '../components/icons.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useScrollReveal } from '../hooks/useScrollReveal.js';
import { accountDiffSources } from '../lib/diff-sources.js';
import { formatUsd, padIndex } from '../lib/format.js';
import { loadProjectName, persistProjectName } from '../lib/project-library.js';
import { formatMoney, getCurrency } from '../lib/quote.js';
import {
  DEFAULT_ROOM_WALL,
  getFurniture,
  LIGHTING_MODES,
  loadRoomState,
  persistRoomState,
  wallCounts,
  wallOf,
} from '../lib/room-3d.js';
import { loadLayout, persistLayout, summarizeWall } from '../lib/wall-studio.js';
import '../styles/pages.css';
import '../styles/account.css';

// The diff engine pulls in the acoustic and photometric models; the account
// entry only loads them, in the chunk the planners share, once a compare opens.
const ProjectDiffModal = lazy(() =>
  import('../components/ProjectDiffModal.jsx').then((module) => ({ default: module.ProjectDiffModal })),
);

function formatSavedAt(iso) {
  const date = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function describeProject(record) {
  const { kind, data } = record;
  if (kind === 'wall') {
    const { widthCm, heightCm, surface, slope } = data.wall;
    return {
      kindLabel: '2D Wall Studio',
      href: '/studio-2d',
      action: 'Open in Wall Studio',
      envelope: `${widthCm} x ${heightCm} cm${slope ? ', attic slope' : ''}`,
      context: surface === 'daylight' ? 'Daylight elevation' : 'Ambient elevation',
      thumb: { widthCm, heightCm, slope, items: data.items },
      restore: () => {
        persistLayout(data);
        persistProjectName('wall', record.name);
      },
    };
  }
  const { widthCm, depthCm, heightCm, furniture, lighting } = data.room;
  const walls = Object.values(wallCounts(data.items)).filter((count) => count > 0).length;
  return {
    kindLabel: '3D Room Planner',
    href: '/room-3d',
    action: 'Open Room Planner',
    envelope: `${widthCm} x ${depthCm} x ${heightCm} cm${walls > 1 ? `, ${walls} walls` : ''}`,
    context: `${LIGHTING_MODES.find((mode) => mode.id === lighting).label} / ${getFurniture(furniture).label}`,
    // The thumbnail draws the north elevation.
    thumb: { widthCm, heightCm, items: data.items.filter((item) => wallOf(item) === DEFAULT_ROOM_WALL) },
    restore: () => {
      persistRoomState(data);
      persistProjectName('room', record.name);
    },
  };
}

function ProjectCard({ record, index, deleting, onDelete, onCompare }) {
  const view = describeProject(record);
  const summary = summarizeWall(record.data);
  return (
    <article
      className="project-card"
      data-testid="saved-project"
      data-project={record.kind}
      data-modules={summary.modules}
      data-revision={record.revision}
      data-project-id={record.id}
      data-busy={deleting || undefined}
      aria-busy={deleting || undefined}
    >
      <header className="project-card__head">
        <p className="index-label">
          <span className="index-label__num">{padIndex(index)}</span> / {view.kindLabel}
        </p>
        <span className="project-card__badge mono" data-testid="saved-project-revision">
          Rev {padIndex(record.revision)}
        </span>
      </header>
      <ElevationThumb
        {...view.thumb}
        className="project-card__thumb"
        label={`${record.name} elevation, ${summary.modules} modules`}
      />
      <h3 className="project-card__title">{record.name}</h3>
      <dl className="project-card__spec mono">
        <div>
          <dt>Envelope</dt>
          <dd>{view.envelope}</dd>
        </div>
        <div>
          <dt>Context</dt>
          <dd>{view.context}</dd>
        </div>
        <div>
          <dt>Modules</dt>
          <dd data-testid="saved-project-modules">{padIndex(summary.modules)}</dd>
        </div>
        <div>
          <dt>24V load</dt>
          <dd>
            {summary.loadW} W / {summary.psu.label}
          </dd>
        </div>
        <div>
          <dt>List price</dt>
          <dd data-testid="saved-project-price">{formatUsd(summary.priceUsd)}</dd>
        </div>
        <div>
          <dt>Saved</dt>
          <dd>{formatSavedAt(record.savedAt)}</dd>
        </div>
      </dl>
      <div className="project-card__actions">
        {/* Opening a project checks the saved revision out into the planner workspace. */}
        <Link
          to={view.href}
          className="button button--primary project-card__open"
          onClick={(event) => (deleting ? event.preventDefault() : view.restore())}
          aria-disabled={deleting || undefined}
          tabIndex={deleting ? -1 : undefined}
        >
          {view.action}
          <ArrowRight />
        </Link>
        <button
          type="button"
          className="button project-card__compare"
          data-testid="compare-saved-project"
          aria-haspopup="dialog"
          aria-label={`Compare ${record.name}`}
          disabled={deleting}
          onClick={(event) => onCompare(record, event.currentTarget)}
        >
          Compare
        </button>
        <button
          type="button"
          className="button project-card__delete"
          data-testid="delete-saved-project"
          aria-label={`Delete ${record.name}`}
          disabled={deleting}
          onClick={() => onDelete(record)}
        >
          <span className="project-card__delete-labels">
            <span data-active={!deleting || undefined}>Delete</span>
            <span data-active={deleting || undefined}>Deleting...</span>
          </span>
        </button>
      </div>
    </article>
  );
}

function OrderRow({ quote }) {
  const status = quote.status.toLowerCase().replace(/\s+/g, '-');
  return (
    <li className="order-row" data-testid="order-row" data-quote={quote.quoteId}>
      <div className="order-row__head">
        <span className="order-row__id mono">{quote.quoteId}</span>
        <span className="order-row__status mono" data-status={status}>
          {quote.status}
        </span>
      </div>
      <p className="order-row__project">{quote.reference}</p>
      <dl className="order-row__meta mono">
        <div>
          <dt>Date</dt>
          <dd>{quote.submittedAt.slice(0, 10)}</dd>
        </div>
        <div>
          <dt>Lines</dt>
          <dd>{padIndex(quote.lines)}</dd>
        </div>
        <div>
          <dt>Load</dt>
          <dd>{quote.loadW} W</dd>
        </div>
        <div>
          <dt>Gross</dt>
          <dd data-testid="order-gross">{formatMoney(quote.grossMinor, getCurrency(quote.currency))}</dd>
        </div>
      </dl>
      <p className="order-row__ref mono">
        Requisition {quote.ref} / {quote.preparedFor}
      </p>
    </li>
  );
}

const TICKET_REASONS = Object.freeze({
  unresolved_query: 'Studio AI could not resolve',
  marked_unhelpful: 'Marked as not resolving the issue',
});

function TicketRow({ ticket }) {
  const status = ticket.status.toLowerCase().replace(/\s+/g, '-');
  return (
    <li
      className="ticket-row"
      data-testid="account-ticket"
      data-ticket-ref={ticket.ref}
      data-reason={ticket.reason}
      data-pending={ticket.pending || undefined}
    >
      <div className="order-row__head">
        <span className="ticket-row__ref mono" data-testid="account-ticket-ref">
          {ticket.ref}
        </span>
        <span className="ticket-row__status mono" data-status={status} data-testid="account-ticket-status">
          {ticket.status}
        </span>
      </div>
      <p className="order-row__project" data-testid="account-ticket-subject">
        {ticket.subject}
      </p>
      <dl className="order-row__meta mono">
        <div>
          <dt>Submitted</dt>
          <dd data-testid="account-ticket-time">{formatSavedAt(ticket.submittedAt)}</dd>
        </div>
        <div>
          <dt>Escalation</dt>
          <dd>{TICKET_REASONS[ticket.reason]}</dd>
        </div>
        <div>
          <dt>Turns</dt>
          <dd>{padIndex(ticket.turns)}</dd>
        </div>
        <div>
          <dt>Reply To</dt>
          <dd>{ticket.email}</dd>
        </div>
      </dl>
      <p className="ticket-row__inquiry">Escalated inquiry: {ticket.inquiry}</p>
      {ticket.workspaceSummary && (
        <p className="ticket-row__summary mono" data-testid="account-ticket-summary">
          {ticket.workspaceSummary}
        </p>
      )}
      {ticket.pending && (
        <p className="order-row__ref mono" data-testid="account-ticket-pending">
          Device copy. It transmits through the Studio AI gatekeeper when Lumen Cloud is reachable.
        </p>
      )}
    </li>
  );
}

function useSupportTickets() {
  const [tickets, setTickets] = useState({ status: 'loading', list: [] });
  useEffect(() => {
    let live = true;
    loadSupportTickets().then(
      (list) => live && setTickets({ status: 'ready', list }),
      () => live && setTickets({ status: 'error', list: [] }),
    );
    return () => {
      live = false;
    };
  }, []);
  return tickets;
}

function CloudLoading({ testId, rows }) {
  return (
    <div className="cloud-loading" data-testid={testId} role="status">
      <div className="cloud-loading__rows" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <span key={i} className="cloud-loading__row" />
        ))}
      </div>
      <p className="cloud-loading__label mono">Syncing with Lumen Cloud...</p>
    </div>
  );
}

function useCloudAccount() {
  const [cloud, setCloud] = useState({ status: 'loading', projects: [], quotes: [] });
  const [deleting, setDeleting] = useState(() => new Set());
  const { addToast } = useToast();

  useEffect(() => {
    let live = true;
    Promise.all([loadProjects(), loadQuotes()]).then(
      ([projects, quotes]) => {
        const status = getCloudTransport().mode === 'local' ? 'offline' : 'ready';
        if (live) setCloud({ status, projects, quotes });
      },
      () => live && setCloud({ status: 'error', projects: [], quotes: [] }),
    );
    return () => {
      live = false;
    };
  }, []);

  const removeProject = useCallback(
    async (record) => {
      setDeleting((prev) => new Set(prev).add(record.id));
      try {
        await deleteProject(record.id);
        setCloud((prev) => ({ ...prev, projects: prev.projects.filter((project) => project.id !== record.id) }));
        addToast(
          getCloudTransport().mode === 'local'
            ? `${record.name} deleted on this device. Lumen Cloud syncs it when the API is reachable.`
            : `${record.name} deleted from Lumen Cloud.`,
          'success',
        );
        return true;
      } catch (error) {
        addToast(error?.name === 'ApiError' ? error.message : 'Delete failed. Try again.', 'error');
        return false;
      } finally {
        setDeleting((prev) => {
          const next = new Set(prev);
          next.delete(record.id);
          return next;
        });
      }
    },
    [addToast],
  );

  return { ...cloud, deleting, removeProject };
}

const SYNC_LABELS = { loading: 'Syncing', ready: 'Up to date', offline: 'Device copy', error: 'Offline' };

export default function AccountPage() {
  useDocumentTitle('Account');
  const { user, signOut } = useAuth();
  const { addToast } = useToast();
  const cloud = useCloudAccount();
  const tickets = useSupportTickets();
  const transport = useSyncExternalStore(subscribeCloudTransport, getCloudTransport, getCloudTransport);
  const reveal = useScrollReveal();
  const loading = cloud.status === 'loading';

  // The deleted card takes focus with it; land on the panel title instead of the page body.
  const remove = async (record) => {
    const removed = await cloud.removeProject(record);
    if (removed && (document.activeElement === document.body || !document.activeElement?.isConnected)) {
      document.getElementById('account-projects-title')?.focus();
    }
  };
  const count = (list) => (loading ? '--' : padIndex(list.length));
  // Read on every render: a refused session drops to the profile library during the load.
  const scope = getLibraryScope();

  // The live drafts are read from storage once, when the dialog opens.
  const [compare, setCompare] = useState(null);
  const closeCompare = useCallback(() => setCompare(null), []);
  const openCompare = (focusId, trigger) => {
    const drafts = {
      wall: { state: loadLayout(), name: loadProjectName('wall') },
      room: { state: loadRoomState(), name: loadProjectName('room') },
    };
    setCompare({ trigger, view: accountDiffSources(cloud.projects, drafts, focusId) });
  };

  const leave = () => {
    const bound = getLibraryScope() === 'account';
    signOut();
    addToast(
      bound
        ? 'Signed out. Your projects stay in your Lumen Cloud account.'
        : 'Signed out. Saved projects stay with this browser profile.',
      'info',
    );
  };

  const facts = [
    {
      term: 'Transport',
      value: loading && transport.mode === 'idle' ? '--' : transport.label,
      attrs: { 'data-mode': transport.mode, 'data-round-trip-ms': transport.roundTripMs ?? undefined },
    },
    { term: 'Library', value: LIBRARY_LABELS[scope], attrs: { 'data-scope': scope } },
    { term: 'Sync', value: SYNC_LABELS[cloud.status] },
    { term: 'Projects', value: count(cloud.projects) },
    { term: 'Quotes', value: count(cloud.quotes) },
  ];

  return (
    <div className="account-page" data-testid="account-page">
      <PageHeader
        index="06"
        section="Account"
        title="Account"
        lede="Saved spatial projects and submitted requisitions, synced through Lumen Cloud. Save a wall or room from its planner and it appears here with its revision."
      />

      <div className="container account-grid reveal-stagger" aria-busy={loading || undefined}>
        <section
          ref={reveal}
          className="account-profile reveal-up"
          aria-labelledby="account-profile-title"
          data-testid="account-profile"
        >
          <div className="account-profile__identity" data-testid="account-user">
            <p className="index-label">
              <span className="index-label__num">01</span> / Profile
            </p>
            <h2 id="account-profile-title" className="account-profile__name">
              {user.name}
            </h2>
            <p className="account-profile__email mono">{user.email}</p>
          </div>
          <button type="button" className="button account-profile__sign-out" data-testid="sign-out" onClick={leave}>
            Sign Out
          </button>
          <dl className="account-profile__facts mono">
            {facts.map(({ term, value, attrs }) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd data-testid={`account-fact-${term.toLowerCase()}`} {...attrs}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          ref={reveal}
          className="account-panel reveal-up"
          aria-labelledby="account-projects-title"
          data-testid="account-projects"
        >
          <header className="account-panel__head account-panel__head--action">
            <div>
              <p className="index-label">
                <span className="index-label__num">02</span> / Projects
              </p>
              <h2 id="account-projects-title" className="account-panel__title" tabIndex={-1}>
                Saved Spatial Projects
              </h2>
            </div>
            {!loading && cloud.projects.length >= 2 && (
              <button
                type="button"
                className="button account-panel__compare"
                data-testid="open-project-compare"
                aria-haspopup="dialog"
                onClick={(event) => openCompare(null, event.currentTarget)}
              >
                Compare Projects
              </button>
            )}
          </header>
          {loading ? (
            <CloudLoading testId="projects-loading" rows={2} />
          ) : cloud.projects.length > 0 ? (
            <div className="project-grid" data-testid="saved-projects">
              {cloud.projects.map((record, i) => (
                <ProjectCard
                  key={record.id}
                  record={record}
                  index={i + 1}
                  deleting={cloud.deleting.has(record.id)}
                  onDelete={remove}
                  onCompare={(focus, trigger) => openCompare(focus.id, trigger)}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              art="cube"
              testId="saved-projects-empty"
              title="No spatial projects yet."
              body="Compose a wall or plan a room, then save it to Lumen Cloud."
              actions={[
                { to: '/studio-2d', label: 'Start 2D Wall Studio', primary: true },
                { to: '/room-3d', label: 'Open Room Planner' },
              ]}
            />
          )}
        </section>

        <section
          ref={reveal}
          className="account-panel reveal-up"
          aria-labelledby="account-orders-title"
          data-testid="account-orders"
        >
          <header className="account-panel__head">
            <p className="index-label">
              <span className="index-label__num">03</span> / Quotes
            </p>
            <h2 id="account-orders-title" className="account-panel__title">
              Order History
            </h2>
          </header>
          {loading ? (
            <CloudLoading testId="orders-loading" rows={3} />
          ) : cloud.quotes.length > 0 ? (
            <ol className="order-list" data-testid="order-history">
              {cloud.quotes.map((quote) => (
                <OrderRow key={quote.ref} quote={quote} />
              ))}
            </ol>
          ) : (
            <EmptyState
              art="sheet"
              compact
              testId="order-history-empty"
              title="No quotes submitted yet."
              body="Submit a requisition from checkout and it is tracked here."
              actions={[{ to: '/catalog', label: 'Browse Catalog' }]}
            />
          )}
        </section>

        <section
          ref={reveal}
          className="account-panel account-panel--tickets reveal-up"
          aria-labelledby="account-tickets-title"
          aria-busy={tickets.status === 'loading' || undefined}
          data-testid="account-tickets-section"
          data-state={tickets.status}
          data-count={tickets.list.length}
        >
          <header className="account-panel__head">
            <p className="index-label">
              <span className="index-label__num">04</span> / Support
            </p>
            <h2 id="account-tickets-title" className="account-panel__title">
              Studio Engineering Tickets
            </h2>
          </header>
          {tickets.status === 'loading' ? (
            <CloudLoading testId="tickets-loading" rows={2} />
          ) : tickets.list.length > 0 ? (
            <ol className="order-list ticket-list" data-testid="account-tickets">
              {tickets.list.map((ticket) => (
                <TicketRow key={ticket.ref} ticket={ticket} />
              ))}
            </ol>
          ) : (
            <EmptyState
              art="sheet"
              compact
              testId="account-tickets-empty"
              title="No engineering tickets."
              body="Studio AI answers most questions directly. A ticket opens only when it cannot, and it is tracked here."
            />
          )}
        </section>
      </div>

      {compare && (
        <Suspense fallback={null}>
          <ProjectDiffModal
            open
            onClose={closeCompare}
            sources={compare.view.sources}
            baseId={compare.view.baseId}
            targetId={compare.view.targetId}
            returnFocus={compare.trigger}
            title="Compare Projects"
          />
        </Suspense>
      )}
    </div>
  );
}

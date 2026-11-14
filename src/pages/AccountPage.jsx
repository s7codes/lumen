import { lazy, Suspense, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import {
  deleteProject,
  getCloudTransport,
  getLibraryScope,
  LIBRARY_LABELS,
  loadProjects,
  loadQuotes,
  subscribeCloudTransport,
  syncQueuedTickets,
} from '../api/client.js';
import { ElevationThumb } from '../components/ElevationThumb.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { ArrowRight } from '../components/icons.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useScrollReveal } from '../hooks/useScrollReveal.js';
import { accountDiffSources } from '../lib/diff-sources.js';
import { formatUsd, padIndex } from '../lib/format.js';
import { loadProjectName, persistProjectName } from '../lib/project-library.js';
import { formatMoney, getCurrency } from '../lib/quote.js';
import {
  createRoomState,
  DEFAULT_ROOM_WALL,
  getFurniture,
  LIGHTING_MODES,
  loadRoomState,
  persistRoomState,
  roomFromWallLayout,
  wallCounts,
  wallOf,
} from '../lib/room-3d.js';
import { loadLayout, summarizeWall } from '../lib/wall-studio.js';
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

// Every saved project opens in the 3D Room Planner. A wall elevation saved
// before the planners were unified lands on the north wall of a fresh room,
// with its width, height, modules and light carried across.
function describeProject(record) {
  const { kind, data } = record;
  if (kind === 'wall') {
    const { widthCm, heightCm, surface, slope } = data.wall;
    return {
      kindLabel: 'Wall Elevation',
      href: '/room-3d',
      action: 'Open Room Planner',
      envelope: `${widthCm} x ${heightCm} cm${slope ? ', attic slope' : ''}`,
      context: surface === 'daylight' ? 'Daylight elevation' : 'Ambient elevation',
      thumb: { widthCm, heightCm, slope, items: data.items },
      restore: () => {
        persistRoomState(roomFromWallLayout(createRoomState(), data, DEFAULT_ROOM_WALL));
        persistProjectName('room', record.name);
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
      <header className="project-card__head" data-index={padIndex(index)}>
        <p className="project-card__kind">{view.kindLabel}</p>
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
    // Engineering tickets queued offline replay through the gatekeeper here; the
    // account does not list them (engineers reply by email with the reference).
    syncQueuedTickets().catch(() => {});
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
    // A wall drawn before the planners were unified stays comparable; an empty one is left out.
    const wallDraft = loadLayout();
    const drafts = {
      ...(wallDraft.items.length > 0 ? { wall: { state: wallDraft, name: loadProjectName('wall') } } : {}),
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

  // One quiet caption instead of a table: the transport, library and sync
  // state on one line, the two counts on the next. The terms stay in the
  // markup for assistive technology; only the counts show theirs.
  const status = [
    {
      term: 'Transport',
      value: loading && transport.mode === 'idle' ? '--' : transport.label,
      attrs: { 'data-mode': transport.mode, 'data-round-trip-ms': transport.roundTripMs ?? undefined },
    },
    { term: 'Library', value: LIBRARY_LABELS[scope], attrs: { 'data-scope': scope } },
    { term: 'Sync', value: SYNC_LABELS[cloud.status] },
  ];
  const counts = [
    { term: 'Projects', value: count(cloud.projects) },
    { term: 'Quotes', value: count(cloud.quotes) },
  ];

  return (
    <div className="account-page" data-testid="account-page">
      {/* A serene split: the profile in a narrow left column, the register in
          the wide right one, one vertical hairline between them. */}
      <div className="container account-split" aria-busy={loading || undefined}>
        <section
          ref={reveal}
          className="account-profile reveal-up"
          aria-labelledby="account-profile-title"
          data-testid="account-profile"
        >
          <h1 className="account-profile__heading">Account</h1>
          <div className="account-profile__identity" data-testid="account-user">
            <h2 id="account-profile-title" className="account-profile__name">
              {user.name}
            </h2>
            <p className="account-profile__email">{user.email}</p>
          </div>
          <div className="account-profile__meta" data-testid="account-meta">
            <dl className="account-profile__facts mono" aria-label="Lumen Cloud sync">
              {status.map(({ term, value, attrs }) => (
                <div key={term} className="account-profile__fact">
                  <dt className="visually-hidden">{term}</dt>
                  <dd data-testid={`account-fact-${term.toLowerCase()}`} {...attrs}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <dl className="account-profile__facts account-profile__facts--counts mono" aria-label="Library contents">
              {counts.map(({ term, value }) => (
                <div key={term} className="account-profile__fact">
                  <dt className="account-profile__term">{term}</dt>
                  <dd data-testid={`account-fact-${term.toLowerCase()}`}>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <button type="button" className="button account-profile__sign-out" data-testid="sign-out" onClick={leave}>
            Sign Out
          </button>
        </section>

        <div className="account-register">
          <section
            ref={reveal}
            className="account-panel reveal-up"
            aria-labelledby="account-projects-title"
            data-testid="account-projects"
          >
            <header className="account-panel__head">
              <h2 id="account-projects-title" className="account-panel__title" tabIndex={-1}>
                Saved Spatial Projects
              </h2>
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
                art={null}
                testId="saved-projects-empty"
                title="No spatial projects yet."
                body="Plan a room and its walls in 3D, then save it to Lumen Cloud."
                actions={[{ to: '/room-3d', label: 'Open 3D Room Planner', primary: true }]}
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
                art={null}
                compact
                testId="order-history-empty"
                title="No quotes submitted yet."
                body="Submit a requisition from checkout and it is tracked here."
                actions={[{ to: '/catalog', label: 'Browse Catalog' }]}
              />
            )}
          </section>

        </div>
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

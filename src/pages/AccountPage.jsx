import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadProjects, loadQuotes } from '../api/client.js';
import { EmptyState } from '../components/EmptyState.jsx';
import { ArrowRight } from '../components/icons.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { getFinish, getProduct } from '../data/products.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useScrollReveal } from '../hooks/useScrollReveal.js';
import { formatUsd, padIndex } from '../lib/format.js';
import { formatMoney, getCurrency } from '../lib/quote.js';
import { getFurniture, LIGHTING_MODES, persistRoomState } from '../lib/room-3d.js';
import { persistLayout, summarizeWall } from '../lib/wall-studio.js';
import '../styles/pages.css';
import '../styles/account.css';

/** Main-wall elevation drawn from stored module positions (floor at the bottom). */
function ElevationThumb({ widthCm, heightCm, items, label }) {
  return (
    <svg
      className="project-card__thumb"
      viewBox={`0 0 ${widthCm} ${heightCm}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={label}
    >
      <rect className="project-card__wall" x="0" y="0" width={widthCm} height={heightCm} />
      {items.map((item) => {
        const { w, h } = getProduct(item.productId).dimsCm;
        return (
          <rect
            key={item.uid}
            className="project-card__module"
            x={item.xCm}
            y={heightCm - item.yCm - h}
            width={w}
            height={h}
            fill={getFinish(item.finish).hex}
          />
        );
      })}
    </svg>
  );
}

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
      thumb: { widthCm, heightCm, items: data.items },
      restore: () => persistLayout(data),
    };
  }
  const { widthCm, depthCm, heightCm, furniture, lighting } = data.room;
  return {
    kindLabel: '3D Room Planner',
    href: '/room-3d',
    action: 'Open Room Planner',
    envelope: `${widthCm} x ${depthCm} x ${heightCm} cm`,
    context: `${LIGHTING_MODES.find((mode) => mode.id === lighting).label} / ${getFurniture(furniture).label}`,
    thumb: { widthCm, heightCm, items: data.items },
    restore: () => persistRoomState(data),
  };
}

function ProjectCard({ record, index }) {
  const view = describeProject(record);
  const summary = summarizeWall(record.data);
  return (
    <article
      className="project-card"
      data-testid="saved-project"
      data-project={record.kind}
      data-modules={summary.modules}
      data-revision={record.revision}
    >
      <header className="project-card__head">
        <p className="index-label">
          <span className="index-label__num">{padIndex(index)}</span> / {view.kindLabel}
        </p>
        <span className="project-card__badge mono" data-testid="saved-project-revision">
          Rev {padIndex(record.revision)}
        </span>
      </header>
      <ElevationThumb {...view.thumb} label={`${record.name} elevation, ${summary.modules} modules`} />
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
      {/* Opening a project checks the saved revision out into the planner workspace. */}
      <Link to={view.href} className="button project-card__open" onClick={view.restore}>
        {view.action}
        <ArrowRight />
      </Link>
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

  useEffect(() => {
    let live = true;
    Promise.all([loadProjects(), loadQuotes()]).then(
      ([projects, quotes]) => live && setCloud({ status: 'ready', projects, quotes }),
      () => live && setCloud({ status: 'error', projects: [], quotes: [] }),
    );
    return () => {
      live = false;
    };
  }, []);

  return cloud;
}

const SYNC_LABELS = { loading: 'Syncing', ready: 'Up to date', error: 'Offline' };

export default function AccountPage() {
  useDocumentTitle('Account');
  const { user, signOut } = useAuth();
  const { addToast } = useToast();
  const cloud = useCloudAccount();
  const reveal = useScrollReveal();
  const loading = cloud.status === 'loading';
  const count = (list) => (loading ? '--' : padIndex(list.length));

  const leave = () => {
    signOut();
    addToast('Signed out. Saved projects stay on this device.', 'info');
  };

  return (
    <div className="page-atmosphere" data-testid="account-page">
      <PageHeader
        index="06"
        section="Account"
        title="Account"
        lede="Saved spatial projects and submitted requisitions, synced through Lumen Cloud. Save a wall or room from its planner and it appears here with its revision."
      />

      <div className="container account-grid reveal-stagger" aria-busy={loading || undefined}>
        <section
          ref={reveal}
          className="account-profile bento reveal-cinematic"
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
            {[
              ['Storage', 'Lumen Cloud'],
              ['Sync', SYNC_LABELS[cloud.status]],
              ['Projects', count(cloud.projects)],
              ['Quotes', count(cloud.quotes)],
            ].map(([term, value]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd data-testid={`account-fact-${term.toLowerCase()}`}>{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          ref={reveal}
          className="account-panel bento reveal-cinematic"
          aria-labelledby="account-projects-title"
          data-testid="account-projects"
        >
          <header className="account-panel__head">
            <p className="index-label">
              <span className="index-label__num">02</span> / Projects
            </p>
            <h2 id="account-projects-title" className="account-panel__title">
              Saved Spatial Projects
            </h2>
          </header>
          {loading ? (
            <CloudLoading testId="projects-loading" rows={2} />
          ) : cloud.projects.length > 0 ? (
            <div className="project-grid" data-testid="saved-projects">
              {cloud.projects.map((record, i) => (
                <ProjectCard key={record.id} record={record} index={i + 1} />
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
          className="account-panel bento reveal-cinematic"
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
      </div>
    </div>
  );
}

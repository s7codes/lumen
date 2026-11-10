import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from '../components/icons.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { ORDER_HISTORY } from '../data/order-history.js';
import { getFinish, getProduct } from '../data/products.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useScrollReveal } from '../hooks/useScrollReveal.js';
import { formatUsd, padIndex } from '../lib/format.js';
import { getFurniture, LIGHTING_MODES, loadRoomState } from '../lib/room-3d.js';
import { loadLayout, summarizeWall } from '../lib/wall-studio.js';
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

function readProjects() {
  const projects = [];
  const wall = loadLayout();
  if (wall.items.length > 0) {
    const { widthCm, heightCm, surface, slope } = wall.wall;
    projects.push({
      id: 'wall',
      kind: '2D Wall Studio',
      title: 'Wall A',
      href: '/studio-2d',
      action: 'Open in Wall Studio',
      envelope: `${widthCm} x ${heightCm} cm${slope ? ', attic slope' : ''}`,
      context: surface === 'daylight' ? 'Daylight elevation' : 'Ambient elevation',
      thumb: { widthCm, heightCm, items: wall.items },
      summary: summarizeWall(wall),
    });
  }
  const room = loadRoomState();
  if (room.items.length > 0) {
    const { widthCm, depthCm, heightCm, furniture, lighting } = room.room;
    projects.push({
      id: 'room',
      kind: '3D Room Planner',
      title: 'Room',
      href: '/room-3d',
      action: 'Open Room Planner',
      envelope: `${widthCm} x ${depthCm} x ${heightCm} cm`,
      context: `${LIGHTING_MODES.find((mode) => mode.id === lighting).label} / ${getFurniture(furniture).label}`,
      thumb: { widthCm, heightCm, items: room.items },
      summary: summarizeWall(room),
    });
  }
  return projects;
}

function ProjectCard({ project, index }) {
  const { summary } = project;
  return (
    <article className="project-card" data-testid="saved-project" data-project={project.id} data-modules={summary.modules}>
      <header className="project-card__head">
        <p className="index-label">
          <span className="index-label__num">{padIndex(index)}</span> / {project.kind}
        </p>
        <span className="project-card__badge mono" title="Stored in this browser. Cloud sync arrives with the Lumen API.">
          Local
        </span>
      </header>
      <ElevationThumb {...project.thumb} label={`${project.title} elevation, ${summary.modules} modules`} />
      <h3 className="project-card__title">{project.title}</h3>
      <dl className="project-card__spec mono">
        <div>
          <dt>Envelope</dt>
          <dd>{project.envelope}</dd>
        </div>
        <div>
          <dt>Context</dt>
          <dd>{project.context}</dd>
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
      </dl>
      <Link to={project.href} className="button project-card__open">
        {project.action}
        <ArrowRight />
      </Link>
    </article>
  );
}

function OrderRow({ order }) {
  return (
    <li className="order-row" data-testid="order-row" data-quote={order.quoteId}>
      <div className="order-row__head">
        <span className="order-row__id mono">{order.quoteId}</span>
        <span className="order-row__status mono" data-status={order.status.toLowerCase().replace(/\s+/g, '-')}>
          {order.status}
        </span>
      </div>
      <p className="order-row__project">{order.project}</p>
      <dl className="order-row__meta mono">
        <div>
          <dt>Date</dt>
          <dd>{order.date}</dd>
        </div>
        <div>
          <dt>Lines</dt>
          <dd>{padIndex(order.lines)}</dd>
        </div>
        <div>
          <dt>Load</dt>
          <dd>{order.loadW} W</dd>
        </div>
        <div>
          <dt>Gross</dt>
          <dd>{formatUsd(order.grossUsd)}</dd>
        </div>
      </dl>
      <p className="order-row__ref mono">{order.requisition ? `Requisition ${order.requisition}` : 'No requisition raised'}</p>
    </li>
  );
}

export default function AccountPage() {
  useDocumentTitle('Account');
  const { user, signOut } = useAuth();
  const { addToast } = useToast();
  const [projects] = useState(readProjects);
  const reveal = useScrollReveal();

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
        lede="Saved spatial projects and quote history in one place. Projects are read from this browser today and move to cloud storage when the Lumen API ships."
      />

      <div className="container account-grid reveal-stagger">
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
              ['Storage', 'Local device'],
              ['Sync', 'Pending API'],
              ['Projects', padIndex(projects.length)],
              ['Quotes', padIndex(ORDER_HISTORY.length)],
            ].map(([term, value]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{value}</dd>
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
          {projects.length > 0 ? (
            <div className="project-grid" data-testid="saved-projects">
              {projects.map((project, i) => (
                <ProjectCard key={project.id} project={project} index={i + 1} />
              ))}
            </div>
          ) : (
            <div className="account-empty" data-testid="saved-projects-empty">
              <p>No saved projects on this device yet. Compose a wall or plan a room; both save as you work.</p>
              <div className="account-empty__actions">
                <Link to="/studio-2d" className="button">
                  Open Wall Studio
                </Link>
                <Link to="/room-3d" className="button">
                  Open Room Planner
                </Link>
              </div>
            </div>
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
          <ol className="order-list" data-testid="order-history">
            {ORDER_HISTORY.map((order) => (
              <OrderRow key={order.quoteId} order={order} />
            ))}
          </ol>
          <p className="account-panel__note mono">Sample records. Live requisitions replace them once the order API is connected.</p>
        </section>
      </div>
    </div>
  );
}

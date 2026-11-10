import { PageHeader } from '../components/PageHeader.jsx';
import { WorkspaceFrame } from '../components/WorkspaceFrame.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import '../styles/pages.css';

const WALL_MM = { width: 3600, height: 2700 };

function ticks(length, step) {
  return Array.from({ length: Math.floor(length / step) + 1 }, (_, i) => ({
    value: i * step,
    pct: ((i * step) / length) * 100,
  }));
}

const X_TICKS = ticks(WALL_MM.width, 600);
const Y_TICKS = ticks(WALL_MM.height, 450);

const INSPECTOR = [
  {
    heading: 'Layers',
    rows: [
      ['Rails', '00'],
      ['Shelves', '00'],
      ['Wall lights', '00'],
    ],
  },
  {
    heading: 'Grid',
    rows: [
      ['Major', '500 mm'],
      ['Minor', '100 mm'],
      ['Snap', '10 mm'],
    ],
  },
  {
    heading: 'Export',
    rows: [['Format', 'SVG / JSON']],
  },
];

export default function WallStudioPage() {
  useDocumentTitle('Wall Studio');

  return (
    <>
      <PageHeader
        index="04"
        section="Wall Studio"
        title="Wall Studio"
        lede="A 2D elevation workspace for rails, shelves and wall lights. Spatial Studio embeds here and reads from the same parts index."
        meta={[
          ['Scale', '1:20'],
          ['Snap', '10 mm'],
          ['Wall', '3600 x 2700 mm'],
        ]}
      />

      <div className="workspace-layout container">
        <WorkspaceFrame
          label="Elevation / Wall A"
          status="Studio not mounted"
          footer={
            <>
              <span>Cursor --</span>
              <span>Snap 10 mm</span>
            </>
          }
        >
          <div className="studio">
            <span className="studio__origin mono" aria-hidden="true">
              mm
            </span>
            <div className="studio__ruler studio__ruler--x mono" aria-hidden="true">
              {X_TICKS.map((tick) => (
                <span key={tick.value} className="studio__tick" style={{ left: `${tick.pct}%` }}>
                  {tick.value}
                </span>
              ))}
            </div>
            <div className="studio__ruler studio__ruler--y mono" aria-hidden="true">
              {Y_TICKS.map((tick) => (
                <span key={tick.value} className="studio__tick" style={{ top: `${tick.pct}%` }}>
                  {tick.value}
                </span>
              ))}
            </div>
            <div className="studio__canvas" data-slot="spatial-studio">
              <span className="studio__wall-label mono">Wall A / 3600 x 2700 mm</span>
              <span className="studio__floor" aria-hidden="true" />
            </div>
          </div>
        </WorkspaceFrame>

        <aside className="inspector" aria-label="Studio inspector">
          {INSPECTOR.map((section) => (
            <section key={section.heading} className="inspector__section">
              <h2 className="index-label inspector__heading">{section.heading}</h2>
              <dl className="inspector__rows">
                {section.rows.map(([term, value]) => (
                  <div key={term} className="inspector__row">
                    <dt>{term}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </aside>
      </div>
    </>
  );
}

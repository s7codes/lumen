import { PageHeader } from '../components/PageHeader.jsx';
import { WorkspaceFrame } from '../components/WorkspaceFrame.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import '../styles/pages.css';

const VIEW_W = 800;
const VIEW_H = 450;
const BACK = { left: 250, right: 550, top: 120, bottom: 300 };
const FLOOR_DEPTHS = [0.12, 0.28, 0.48, 0.72];

// One-point perspective: the side walls run from the frame corners to the
// back-wall corners, so x on the left floor edge is linear in y.
function leftFloorX(y) {
  return ((VIEW_H - y) / (VIEW_H - BACK.bottom)) * BACK.left;
}

function RoomWireframe() {
  const floorRays = Array.from({ length: 9 }, (_, i) => ({
    x1: BACK.left + (i * (BACK.right - BACK.left)) / 8,
    x2: (i * VIEW_W) / 8,
  }));
  const floorLines = FLOOR_DEPTHS.map((t) => {
    const y = BACK.bottom + t * (VIEW_H - BACK.bottom);
    const x = leftFloorX(y);
    return { y, x1: x, x2: VIEW_W - x };
  });

  return (
    <svg
      className="room-wireframe"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <g className="room-wireframe__floor">
        {floorRays.map((ray) => (
          <line key={ray.x2} x1={ray.x1} y1={BACK.bottom} x2={ray.x2} y2={VIEW_H} />
        ))}
        {floorLines.map((line) => (
          <line key={line.y} x1={line.x1} y1={line.y} x2={line.x2} y2={line.y} />
        ))}
      </g>
      <g className="room-wireframe__walls">
        <rect
          x={BACK.left}
          y={BACK.top}
          width={BACK.right - BACK.left}
          height={BACK.bottom - BACK.top}
        />
        <line x1="0" y1="0" x2={BACK.left} y2={BACK.top} />
        <line x1={VIEW_W} y1="0" x2={BACK.right} y2={BACK.top} />
        <line x1="0" y1={VIEW_H} x2={BACK.left} y2={BACK.bottom} />
        <line x1={VIEW_W} y1={VIEW_H} x2={BACK.right} y2={BACK.bottom} />
      </g>
      <line className="room-wireframe__track" x1="400" y1={BACK.top} x2="400" y2="0" />
      <circle className="room-wireframe__vp" cx="400" cy="210" r="3" />
    </svg>
  );
}

function AxisGizmo() {
  return (
    <svg className="axis-gizmo" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <line x1="20" y1="44" x2="54" y2="44" className="axis-gizmo__x" />
      <line x1="20" y1="44" x2="20" y2="10" className="axis-gizmo__y" />
      <line x1="20" y1="44" x2="6" y2="58" className="axis-gizmo__z" />
      <text x="56" y="47">X</text>
      <text x="17" y="8">Y</text>
      <text x="0" y="62">Z</text>
    </svg>
  );
}

const INSPECTOR = [
  {
    heading: 'Room',
    rows: [
      ['Width', '4800 mm'],
      ['Depth', '3600 mm'],
      ['Height', '2700 mm'],
    ],
  },
  {
    heading: 'Lighting',
    rows: [
      ['Colour temp', '2700 K'],
      ['Fixtures', '00'],
      ['Bus load', '0 / 96 W'],
    ],
  },
  {
    heading: 'Camera',
    rows: [
      ['Projection', 'Perspective'],
      ['Field of view', '50 deg'],
    ],
  },
];

export default function RoomPlannerPage() {
  useDocumentTitle('Room Planner');

  return (
    <>
      <PageHeader
        index="03"
        section="3D Room"
        title="Room Planner"
        lede="A dimensioned room for placing fixtures and reading light falloff. The real-time renderer mounts into this viewport."
        meta={[
          ['Engine', 'Three.js / R3F'],
          ['Units', 'mm'],
          ['Scene', 'Empty'],
        ]}
      />

      <div className="workspace-layout container">
        <WorkspaceFrame
          label="Viewport / Perspective"
          status="Renderer idle"
          data-slot="room-renderer"
          footer={
            <>
              <span>Room 4800 x 3600 x 2700 mm</span>
              <span>Fixtures 00</span>
            </>
          }
        >
          <RoomWireframe />
          <AxisGizmo />
        </WorkspaceFrame>

        <aside className="inspector" aria-label="Room inspector">
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

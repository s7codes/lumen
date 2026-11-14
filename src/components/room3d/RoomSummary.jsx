import { formatInt } from '../../lib/format.js';
import { BusTelemetryCell } from '../BusTelemetryCell.jsx';
import { CloudSaveButton, CompareChangesButton } from '../CloudSaveButton.jsx';
import { EnvironmentalPhysicsCell } from '../EnvironmentalPhysicsCell.jsx';
import { ProjectNameField } from '../ProjectNameField.jsx';
import { SummaryKpis } from '../SummaryKpis.jsx';
import { ArrowRight } from '../icons.jsx';

/**
 * Primary strip: the four key figures beside the project name, cloud save
 * and cart sync. Below a hairline, engineering telemetry and the CAD bridge
 * (the 1:20 blueprint of the active wall, .OBJ export, .PNG studio render,
 * share link) share a structured sub-grid that Specs mode lifts forward.
 */
export function RoomSummary({
  summary,
  bus,
  physics,
  floorLux,
  shareUrl,
  onShare,
  conflictCount,
  wallLabel = 'North Wall',
  wallCount = 0,
  status,
  syncRef,
  cloudStatus,
  project,
  blueprintOpen = false,
  onOpenBlueprint,
  onExportObj,
  onCapturePng,
  onSave,
  onSync,
  onCompare,
}) {
  const { modules, psu } = summary;
  const empty = modules === 0;

  return (
    <section className="studio-summary room3d-summary" aria-label="Room telemetry" data-testid="room-summary">
      <div className="studio-summary__primary">
        <SummaryKpis summary={summary} prefix="room" />

        <div className="studio-summary__action">
          <div className="studio-summary__project">
            <ProjectNameField
              value={project.name}
              onChange={project.change}
              onCommit={project.commit}
              className="studio-summary__name"
            />
            <CompareChangesButton onCompare={onCompare} />
          </div>
          <div className="studio-summary__buttons">
            <CloudSaveButton
              status={cloudStatus}
              disabled={empty}
              onSave={onSave}
              className="studio-summary__save"
              testId="save-room-to-cloud"
            />
            <button
              ref={syncRef}
              type="button"
              className="button button--primary studio-summary__sync"
              data-testid="sync-room-to-bag"
              disabled={empty}
              onClick={onSync}
            >
              Sync Room to Cart
              <ArrowRight />
            </button>
          </div>
        </div>
      </div>

      <div className="studio-summary__engineering" role="group" aria-label="Engineering telemetry and CAD bridge">
        <div className="studio-summary__engineering-head">
          <h3 className="studio-summary__engineering-title">Engineering Telemetry &amp; CAD Bridge</h3>
          <p className="studio-summary__note" data-conflicts={conflictCount > 0 || undefined}>
            {conflictCount > 0
              ? `${conflictCount} ${conflictCount === 1 ? 'module' : 'modules'} in conflict`
              : `CAD bridge on the ${wallLabel}`}
          </p>
        </div>

        <dl className="studio-summary__grid">
          <div className="studio-summary__cell studio-summary__cell--psu">
            <dt>Driver</dt>
            <dd data-testid="room-psu">{psu.label}</dd>
          </div>
          <BusTelemetryCell topology={bus} />
          <EnvironmentalPhysicsCell physics={physics} />
          {floorLux && (
            <div
              className="studio-summary__cell studio-summary__cell--floor-lux"
              data-testid="floor-lux-summary"
              data-peak-lux={floorLux.peakLux}
              data-avg-lux={floorLux.avgLux}
              data-uniformity={floorLux.uniformityRatio.toFixed(2)}
            >
              <dt>Floor Lux Grid</dt>
              <dd>
                <span className="physics__line" data-testid="floor-lux-line">
                  Peak {formatInt(floorLux.peakLux)} lx / Avg {formatInt(floorLux.avgLux)} lx
                </span>
                <span className="studio-summary__sub" data-testid="floor-lux-detail">
                  U0 {floorLux.uniformityRatio.toFixed(2)} / {floorLux.cols} x {floorLux.rows} grid
                  {floorLux.hotspot ? ` / hotspot X ${floorLux.hotspot.xCm} Y ${floorLux.hotspot.yCm} cm` : ' / no lit modules'}
                </span>
              </dd>
            </div>
          )}
        </dl>

        <div className="room3d-bridge" role="group" aria-label="CAD bridge">
          <button
            type="button"
            className="tool-button"
            aria-haspopup="dialog"
            aria-expanded={blueprintOpen}
            data-testid="open-blueprint-sheet"
            title={`The 1:20 ISO blueprint of the ${wallLabel}, as .SVG or AutoCAD .DXF`}
            disabled={wallCount === 0}
            onClick={(event) => onOpenBlueprint(event.currentTarget)}
          >
            Blueprint .SVG / .DXF
          </button>
          <span className="studio-toolbar__divider" aria-hidden="true" />
          <button type="button" className="tool-button" data-testid="export-room-obj" onClick={onExportObj}>
            Export 3D .OBJ
          </button>
          <button
            type="button"
            className="tool-button"
            data-testid="capture-room-png"
            title="Download a 1600 x 1000 studio render with the room specification"
            onClick={onCapturePng}
          >
            Capture .PNG
          </button>
          <button
            type="button"
            className="tool-button"
            data-testid="copy-share-link"
            data-share-url={shareUrl || undefined}
            title="Copy a link that reopens this room"
            onClick={onShare}
          >
            Share Link
          </button>
        </div>
      </div>

      <p className="studio-summary__status" role="status" aria-live="polite" data-testid="room-bridge-status">
        {status}
      </p>
    </section>
  );
}

import { Link } from 'react-router-dom';
import { formatInt } from '../../lib/format.js';
import { BusTelemetryCell } from '../BusTelemetryCell.jsx';
import { CloudSaveButton } from '../CloudSaveButton.jsx';
import { EnvironmentalPhysicsCell } from '../EnvironmentalPhysicsCell.jsx';
import { ProjectNameField } from '../ProjectNameField.jsx';
import { SummaryKpis } from '../SummaryKpis.jsx';
import { ArrowRight } from '../icons.jsx';

/**
 * Primary strip: the four key figures beside the project name, cloud save
 * and cart sync. Below a hairline, engineering telemetry and the CAD bridge
 * (2D wall exchange for the active wall, .OBJ export, share link) share a
 * structured sub-grid that Specs mode lifts forward.
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
  onImport,
  onExport,
  onExportObj,
  onSave,
  onSync,
}) {
  const { modules, psu } = summary;
  const empty = modules === 0;

  return (
    <section className="studio-summary room3d-summary" aria-label="Room telemetry" data-testid="room-summary">
      <div className="studio-summary__primary">
        <SummaryKpis summary={summary} prefix="room" />

        <div className="studio-summary__action">
          <ProjectNameField
            value={project.name}
            onChange={project.change}
            onCommit={project.commit}
            className="studio-summary__name"
          />
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
              : `2D bridge on the ${wallLabel}`}
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

        <div className="room3d-bridge" role="group" aria-label="2D and CAD bridge">
          <button
            type="button"
            className="tool-button"
            data-testid="import-from-wall-studio"
            title={`Replace the ${wallLabel} with the saved 2D wall`}
            onClick={onImport}
          >
            Load from 2D Wall Studio
          </button>
          <button
            type="button"
            className="tool-button"
            data-testid="export-to-wall-studio"
            title={`Send the ${wallLabel} to the 2D studio`}
            disabled={wallCount === 0}
            onClick={onExport}
          >
            Push to 2D Wall Studio
          </button>
          <Link to="/studio-2d" className="tool-button room3d-bridge__link">
            Open Wall Studio
          </Link>
          <span className="studio-toolbar__divider" aria-hidden="true" />
          <button type="button" className="tool-button" data-testid="export-room-obj" onClick={onExportObj}>
            Export 3D .OBJ
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

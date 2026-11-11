import { BusTelemetryCell } from '../BusTelemetryCell.jsx';
import { CloudSaveButton } from '../CloudSaveButton.jsx';
import { EnvironmentalPhysicsCell } from '../EnvironmentalPhysicsCell.jsx';
import { ProjectNameField } from '../ProjectNameField.jsx';
import { SummaryKpis } from '../SummaryKpis.jsx';
import { ArrowRight } from '../icons.jsx';

/**
 * Primary strip: the four key figures beside the project name, cloud save
 * and cart sync. Below a hairline, the engineering telemetry sits in its own
 * sub-grid; Specs mode lifts it forward.
 */
export function StudioSummary({
  summary,
  bus,
  physics,
  conflictCount,
  syncNote,
  syncRef,
  cloudStatus,
  project,
  onSave,
  onSync,
}) {
  const { modules, psu } = summary;
  const empty = modules === 0;

  return (
    <section className="studio-summary" aria-label="Wall telemetry" data-testid="wall-summary">
      <div className="studio-summary__primary">
        <SummaryKpis summary={summary} prefix="wall" />

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
              testId="save-wall-to-cloud"
            />
            <button
              ref={syncRef}
              type="button"
              className="button button--primary studio-summary__sync"
              data-testid="sync-wall-to-bag"
              disabled={empty}
              onClick={onSync}
            >
              Sync Wall to Cart
              <ArrowRight />
            </button>
          </div>
        </div>
      </div>

      <div className="studio-summary__engineering" role="group" aria-label="Engineering telemetry">
        <div className="studio-summary__engineering-head">
          <h3 className="studio-summary__engineering-title">Engineering Telemetry</h3>
          <p className="studio-summary__note" data-conflicts={conflictCount > 0 || undefined}>
            {conflictCount > 0
              ? `${conflictCount} ${conflictCount === 1 ? 'module' : 'modules'} in conflict`
              : 'Driver sized on full connected load'}
          </p>
        </div>
        <dl className="studio-summary__grid">
          <div className="studio-summary__cell studio-summary__cell--psu">
            <dt>Driver</dt>
            <dd data-testid="wall-psu">{psu.label}</dd>
          </div>
          <BusTelemetryCell topology={bus} />
          <EnvironmentalPhysicsCell physics={physics} />
        </dl>
      </div>

      <p className="studio-summary__status" role="status" aria-live="polite" data-testid="sync-status">
        {syncNote}
      </p>
    </section>
  );
}

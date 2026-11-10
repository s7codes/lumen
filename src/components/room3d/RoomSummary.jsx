import { Link } from 'react-router-dom';
import { formatInt, formatUsd, padIndex } from '../../lib/format.js';
import { CloudSaveButton } from '../CloudSaveButton.jsx';
import { ArrowRight } from '../icons.jsx';

export function RoomSummary({ summary, conflictCount, status, syncRef, cloudStatus, onImport, onExport, onSave, onSync }) {
  const { modules, loadW, activeW, lumens, priceUsd, psu } = summary;
  const empty = modules === 0;

  return (
    <section className="studio-summary room3d-summary" aria-label="Room telemetry" data-testid="room-summary">
      <dl className="studio-summary__grid">
        <div className="studio-summary__cell">
          <dt>Modules</dt>
          <dd data-testid="room-modules">{padIndex(modules)}</dd>
        </div>
        <div className="studio-summary__cell">
          <dt>24V DC Load</dt>
          <dd>
            <span data-testid="room-load">{loadW} W</span>
            {activeW !== loadW && <span className="studio-summary__sub">{activeW} W live</span>}
          </dd>
        </div>
        <div className="studio-summary__cell">
          <dt>Luminous Flux</dt>
          <dd data-testid="room-flux">{formatInt(lumens)} lm</dd>
        </div>
        <div className="studio-summary__cell">
          <dt>Price</dt>
          <dd data-testid="room-price">{formatUsd(priceUsd)}</dd>
        </div>
        <div className="studio-summary__cell studio-summary__cell--psu">
          <dt>Driver</dt>
          <dd data-testid="room-psu">{psu.label}</dd>
        </div>
      </dl>

      <div className="room3d-bridge">
        <p className="studio-summary__note mono" data-conflicts={conflictCount > 0 || undefined}>
          {conflictCount > 0
            ? `${conflictCount} ${conflictCount === 1 ? 'module' : 'modules'} in conflict`
            : '2D wall bridge / lumen_wall_studio_v1'}
        </p>
        <div className="room3d-bridge__actions">
          <button type="button" className="tool-button" data-testid="import-from-wall-studio" onClick={onImport}>
            Load from 2D Wall Studio
          </button>
          <button
            type="button"
            className="tool-button"
            data-testid="export-to-wall-studio"
            disabled={empty}
            onClick={onExport}
          >
            Push to 2D Wall Studio
          </button>
          <Link to="/studio-2d" className="tool-button room3d-bridge__link">
            Open Wall Studio
          </Link>
          <CloudSaveButton
            status={cloudStatus}
            disabled={empty}
            onSave={onSave}
            className="room3d-bridge__save"
            testId="save-room-to-cloud"
          />
          <button
            ref={syncRef}
            type="button"
            className="button button--primary room3d-bridge__sync"
            data-testid="sync-room-to-bag"
            disabled={empty}
            onClick={onSync}
          >
            Sync Room to Cart
            <ArrowRight />
          </button>
        </div>
        <p className="studio-summary__status mono" role="status" aria-live="polite" data-testid="room-bridge-status">
          {status}
        </p>
      </div>
    </section>
  );
}

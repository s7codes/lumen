import { formatInt, formatUsd, padIndex } from '../../lib/format.js';
import { ArrowRight } from '../icons.jsx';

export function StudioSummary({ summary, conflictCount, syncNote, syncRef, onSync }) {
  const { modules, loadW, activeW, lumens, priceUsd, psu } = summary;
  const empty = modules === 0;

  return (
    <section className="studio-summary" aria-label="Wall telemetry" data-testid="wall-summary">
      <dl className="studio-summary__grid">
        <div className="studio-summary__cell">
          <dt>Modules</dt>
          <dd data-testid="wall-modules">{padIndex(modules)}</dd>
        </div>
        <div className="studio-summary__cell">
          <dt>24V DC Load</dt>
          <dd>
            <span data-testid="wall-load">{loadW} W</span>
            {activeW !== loadW && (
              <span className="studio-summary__sub" data-testid="wall-active-load">
                {activeW} W live
              </span>
            )}
          </dd>
        </div>
        <div className="studio-summary__cell">
          <dt>Luminous Flux</dt>
          <dd data-testid="wall-flux">{formatInt(lumens)} lm</dd>
        </div>
        <div className="studio-summary__cell">
          <dt>Price</dt>
          <dd data-testid="wall-price">{formatUsd(priceUsd)}</dd>
        </div>
        <div className="studio-summary__cell studio-summary__cell--psu">
          <dt>Driver</dt>
          <dd data-testid="wall-psu">{psu.label}</dd>
        </div>
      </dl>

      <div className="studio-summary__action">
        <p className="studio-summary__note mono" data-conflicts={conflictCount > 0 || undefined}>
          {conflictCount > 0
            ? `${conflictCount} ${conflictCount === 1 ? 'module' : 'modules'} in conflict`
            : 'Driver sized on full connected load'}
        </p>
        <button
          ref={syncRef}
          type="button"
          className="button button--primary studio-summary__sync"
          data-testid="sync-wall-to-bag"
          disabled={empty}
          onClick={onSync}
        >
          Sync Wall to Bag
          <ArrowRight />
        </button>
        <p className="studio-summary__status mono" role="status" aria-live="polite" data-testid="sync-status">
          {syncNote}
        </p>
      </div>
    </section>
  );
}

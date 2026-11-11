import { formatBusTelemetry } from '../lib/bus-topology.js';

export function BusTelemetryCell({ topology }) {
  return (
    <div className="studio-summary__cell studio-summary__cell--bus">
      <dt>24V Bus Run</dt>
      <dd data-tone={topology.withinSpec ? 'ok' : 'fault'}>
        <span
          data-testid="bus-run-telemetry"
          data-within-spec={String(topology.withinSpec)}
          data-current-a={topology.currentA}
          data-active-w={topology.activeWatts}
          data-rated-w={topology.ratedWatts}
        >
          {formatBusTelemetry(topology)}
        </span>
        <span className="studio-summary__sub" data-testid="bus-spec-status">
          {topology.withinSpec ? `SELV within ${topology.limitPct}% drop` : `Exceeds ${topology.limitPct}% drop limit`}
        </span>
      </dd>
    </div>
  );
}

import { formatInt, formatUsd, formatWatts, padIndex } from '../lib/format.js';

/**
 * The four figures a planner reads at a glance: modules, 24V load, luminous
 * flux and total price. `prefix` keeps each planner's test ids (wall / room).
 */
export function SummaryKpis({ summary, prefix }) {
  const { modules, loadW, activeW, lumens, dimmed, priceUsd } = summary;
  return (
    <dl className="studio-summary__kpis">
      <div className="studio-summary__kpi">
        <dt>Modules</dt>
        <dd data-testid={`${prefix}-modules`}>{padIndex(modules)}</dd>
      </div>
      <div className="studio-summary__kpi">
        <dt>24V Load</dt>
        <dd>
          <span data-testid={`${prefix}-load`}>{loadW} W</span>
          {activeW !== loadW && (
            <span className="studio-summary__sub" data-testid={`${prefix}-active-load`}>
              {formatWatts(activeW)} W live
            </span>
          )}
        </dd>
      </div>
      <div className="studio-summary__kpi">
        <dt>Luminous Flux</dt>
        <dd>
          <span data-testid={`${prefix}-flux`} data-lm={lumens}>
            {formatInt(lumens)} lm
          </span>
          {dimmed > 0 && (
            <span className="studio-summary__sub" data-testid={`${prefix}-dimmed`}>
              {dimmed} {dimmed === 1 ? 'channel' : 'channels'} dimmed / DALI-2
            </span>
          )}
        </dd>
      </div>
      <div className="studio-summary__kpi">
        <dt>Total Price</dt>
        <dd data-testid={`${prefix}-price`}>{formatUsd(priceUsd)}</dd>
      </div>
    </dl>
  );
}

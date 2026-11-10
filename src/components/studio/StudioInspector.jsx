import { getFinish, getProduct } from '../../data/products.js';
import { formatInt, formatUsd, padIndex } from '../../lib/format.js';
import { anchorPoints, snapToWall } from '../../lib/wall-studio.js';
import '../../styles/product.css';
import { FinishPicker, NumberField, PanelSection, Switch } from './controls.jsx';

function conflictText(conflict, items) {
  if (!conflict) return 'Clear';
  if (conflict.bounds) return 'Exceeds wall';
  const parts = [];
  if (conflict.slope) parts.push('Cuts attic slope');
  if (conflict.overlaps.length > 0) {
    const names = conflict.overlaps.map((uid) => {
      const other = items.find((entry) => entry.uid === uid);
      return other ? getProduct(other.productId).name : uid;
    });
    parts.push(`Overlaps ${names.join(', ')}`);
  }
  return parts.join(' / ');
}

function ModuleList({ items, conflicts, onSelect }) {
  return (
    <PanelSection index="04" title="Modules">
      {items.length === 0 ? (
        <p className="studio-panel__empty">No modules mounted. Pick a component or preset.</p>
      ) : (
        <ul className="module-list">
          {items.map((item, i) => {
            const product = getProduct(item.productId);
            const finish = getFinish(item.finish);
            const conflict = conflicts.has(item.uid);
            return (
              <li key={item.uid}>
                <button
                  type="button"
                  className="module-list__item"
                  data-conflict={conflict || undefined}
                  onClick={() => onSelect(item.uid)}
                >
                  <span className="module-list__index mono">{padIndex(i + 1)}</span>
                  <span className="module-list__name">{product.name}</span>
                  <span className="module-list__meta mono">
                    {finish.label} / {item.xCm}, {item.yCm}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </PanelSection>
  );
}

function ModuleDetail({ item, layout, conflict, actions }) {
  const product = getProduct(item.productId);
  const { wall, items } = layout;
  const lit = product.watts > 0;
  const status = conflictText(conflict, items);
  const position = (x, y) => snapToWall(product, wall, x, y);

  return (
    <>
      <PanelSection index="04" title="Module" className="studio-inspector__head">
        <p className="studio-inspector__name" data-testid="inspector-name">
          {product.name}
        </p>
        <p className="studio-inspector__meta mono">
          {product.sku} / W {product.dimsCm.w} / H {product.dimsCm.h} / D {product.dimsCm.d} cm
        </p>
        <p className="studio-inspector__status mono" data-state={conflict ? 'conflict' : 'clear'} data-testid="inspector-status">
          {status}
        </p>
      </PanelSection>

      <PanelSection index="05" title="Finish and channel">
        <FinishPicker product={product} finishId={item.finish} onChange={(finish) => actions.update(item.uid, { finish })} />
        <Switch
          label="24V LED channel"
          hint={lit ? (item.led ? 'On' : 'Off') : 'Passive'}
          checked={lit && item.led}
          disabled={!lit}
          onChange={(led) => actions.update(item.uid, { led })}
          testId="led-channel"
        />
        <p className="studio-panel__note mono">
          {lit
            ? `${product.watts} W / ${formatInt(product.lumens)} lm / ${product.kelvin} K / CRI ${product.cri}`
            : 'No light source / bus hardware'}
        </p>
      </PanelSection>

      <PanelSection index="06" title="Position">
        <div className="studio-fields">
          <NumberField
            label="Left X (cm)"
            value={item.xCm}
            min={0}
            max={wall.widthCm - product.dimsCm.w}
            normalize={(x) => position(x, item.yCm).xCm}
            onCommit={(xCm) => actions.update(item.uid, { xCm })}
            disabled={item.locked}
            testId="module-x"
          />
          <NumberField
            label="Bottom from Floor (cm)"
            value={item.yCm}
            min={0}
            max={wall.heightCm - product.dimsCm.h}
            normalize={(y) => position(item.xCm, y).yCm}
            onCommit={(yCm) => actions.update(item.uid, { yCm })}
            disabled={item.locked}
            testId="module-y"
          />
        </div>
        <dl className="studio-anchors mono">
          {anchorPoints(item).map((point, i) => (
            <div key={`${point.xCm}-${point.yCm}`} className="studio-anchors__row">
              <dt>A{i + 1}</dt>
              <dd>
                X {point.xCm} / Y {point.yCm}
              </dd>
            </div>
          ))}
        </dl>
      </PanelSection>

      <PanelSection index="07" title="Actions">
        <dl className="studio-inspector__price mono">
          <div>
            <dt>Unit price</dt>
            <dd>{formatUsd(product.priceUsd)}</dd>
          </div>
        </dl>
        <div className="studio-actions">
          <button type="button" className="tool-button" onClick={() => actions.duplicate(item.uid)}>
            Duplicate
          </button>
          <button
            type="button"
            className="tool-button"
            aria-pressed={item.locked}
            onClick={() => actions.update(item.uid, { locked: !item.locked })}
          >
            {item.locked ? 'Unlock' : 'Lock'}
          </button>
          <button
            type="button"
            className="tool-button tool-button--danger"
            disabled={item.locked}
            onClick={() => actions.remove(item.uid)}
          >
            Remove
          </button>
          <button type="button" className="tool-button" onClick={() => actions.select(null)}>
            Done
          </button>
        </div>
      </PanelSection>
    </>
  );
}

export function StudioInspector({ layout, item, conflicts, actions }) {
  return (
    <aside className="studio-panel studio-inspector" aria-label="Module inspector" data-testid="studio-inspector">
      {item ? (
        <ModuleDetail item={item} layout={layout} conflict={conflicts.get(item.uid)} actions={actions} />
      ) : (
        <ModuleList items={layout.items} conflicts={conflicts} onSelect={actions.select} />
      )}
    </aside>
  );
}

import { getFinish, getProduct } from '../../data/products.js';
import { formatInt, formatUsd, padIndex } from '../../lib/format.js';
import { anchorPoints, boundsOf, itemRect, snapToWall } from '../../lib/wall-studio.js';
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
                    {finish.label}
                    <span className="module-list__coords"> / {item.xCm}, {item.yCm}</span>
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
    <div className="studio-inspector__detail">
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

      <PanelSection index="06" title="Position" className="studio-inspector__position">
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
    </div>
  );
}

// Hairline glyphs: a reference rule plus two bars of unequal length.
const ALIGN_TOOLS = [
  { mode: 'left', label: 'Left', glyph: 'M2 1v12M4 3h8M4 9h5', aria: 'Align left edges' },
  { mode: 'center-x', label: 'Centre', glyph: 'M7 1v12M2 3h10M4 9h6', aria: 'Align vertical centrelines' },
  { mode: 'right', label: 'Right', glyph: 'M12 1v12M2 3h8M5 9h5', aria: 'Align right edges' },
  { mode: 'top', label: 'Top', glyph: 'M1 2h12M3 4v8M9 4v5', aria: 'Align top edges' },
  { mode: 'center-y', label: 'Middle', glyph: 'M1 7h12M3 2v10M9 4v6', aria: 'Align horizontal centrelines' },
  { mode: 'bottom', label: 'Bottom', glyph: 'M1 12h12M3 2v8M9 5v5', aria: 'Align bottom edges' },
];

const DISTRIBUTE_TOOLS = [
  { axis: 'horizontal', label: 'Space H', glyph: 'M1 1v12M13 1v12M5 4v6M9 4v6', aria: 'Distribute horizontally' },
  { axis: 'vertical', label: 'Space V', glyph: 'M1 1h12M1 13h12M4 5h6M4 9h6', aria: 'Distribute vertically' },
];

function ToolGlyph({ d }) {
  return (
    <svg className="studio-align__glyph" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

function BatchFinish({ items, onChange }) {
  const ids = [];
  for (const item of items) {
    for (const id of getProduct(item.productId).finishes) if (!ids.includes(id)) ids.push(id);
  }
  const shared = items.every((item) => item.finish === items[0].finish) ? items[0].finish : null;
  return (
    <fieldset className="swatches studio-swatches">
      <legend className="swatches__legend">Finish</legend>
      <div className="swatches__row">
        {ids.map((id) => {
          const option = getFinish(id);
          return (
            <label
              key={id}
              className="swatch"
              style={{ '--swatch': option.hex, '--swatch-hi': option.highlight, '--swatch-lo': option.shade }}
            >
              <input
                className="swatch__input"
                type="radio"
                name="batch-finish"
                value={id}
                checked={id === shared}
                data-testid={`batch-finish-${id}`}
                onChange={() => onChange(id)}
              />
              <span className="swatch__chip" aria-hidden="true" />
              <span className="visually-hidden">{option.label}</span>
            </label>
          );
        })}
        <span className="swatches__name">{shared ? getFinish(shared).name : 'Mixed'}</span>
      </div>
    </fieldset>
  );
}

function MultiDetail({ items, actions }) {
  const uids = items.map((item) => item.uid);
  const movable = items.filter((item) => !item.locked);
  const locked = items.length - movable.length;
  const lit = items.filter((item) => getProduct(item.productId).watts > 0);
  const litOn = lit.filter((item) => item.led);
  const box = boundsOf(items.map(itemRect));
  const watts = litOn.reduce((sum, item) => sum + getProduct(item.productId).watts, 0);
  const priceUsd = items.reduce((sum, item) => sum + getProduct(item.productId).priceUsd, 0);

  return (
    <div className="studio-inspector__detail" data-testid="multi-select-inspector" data-count={items.length}>
      <PanelSection index="04" title="Selection" className="studio-inspector__head">
        <p className="studio-inspector__name" data-testid="multi-select-title">
          Multi-Selection ({items.length} modules)
        </p>
        <p className="studio-inspector__meta mono" data-testid="multi-select-bounds">
          Bounds X {box.x} / Y {box.y} / {box.w} x {box.h} cm
        </p>
        <p className="studio-inspector__status mono" data-state={locked ? 'conflict' : 'clear'}>
          {locked ? `${locked} locked / held in place` : 'All unlocked'}
        </p>
      </PanelSection>

      <PanelSection index="05" title="Align and distribute">
        <div className="studio-align" role="group" aria-label="Align selection">
          {ALIGN_TOOLS.map((tool) => (
            <button
              key={tool.mode}
              type="button"
              className="tool-button studio-align__button"
              aria-label={tool.aria}
              title={tool.aria}
              disabled={movable.length < 2}
              data-testid={`align-${tool.mode}`}
              onClick={() => actions.align(uids, tool.mode)}
            >
              <ToolGlyph d={tool.glyph} />
              <span aria-hidden="true">{tool.label}</span>
            </button>
          ))}
        </div>
        <div className="studio-align studio-align--pair" role="group" aria-label="Distribute selection">
          {DISTRIBUTE_TOOLS.map((tool) => (
            <button
              key={tool.axis}
              type="button"
              className="tool-button studio-align__button"
              aria-label={tool.aria}
              title={tool.aria}
              disabled={movable.length < 3}
              data-testid={`distribute-${tool.axis}`}
              onClick={() => actions.distribute(uids, tool.axis)}
            >
              <ToolGlyph d={tool.glyph} />
              <span aria-hidden="true">{tool.label}</span>
            </button>
          ))}
        </div>
        <p className="studio-panel__note mono">
          {movable.length < 3 ? 'Distribute needs 3 unlocked modules' : 'End modules hold / equal gaps between'}
        </p>
      </PanelSection>

      <PanelSection index="06" title="Finish and channel">
        <BatchFinish items={items} onChange={(finish) => actions.updateMany(uids, { finish })} />
        <Switch
          label="24V LED channel"
          hint={lit.length ? `${litOn.length} / ${lit.length} on` : 'Passive'}
          checked={lit.length > 0 && litOn.length === lit.length}
          disabled={lit.length === 0}
          onChange={(led) => actions.updateMany(uids, { led })}
          testId="batch-led"
        />
        <p className="studio-panel__note mono">
          {formatInt(watts)} W active / {formatUsd(priceUsd)} list
        </p>
      </PanelSection>

      <PanelSection index="07" title="Actions">
        <div className="studio-actions">
          <button
            type="button"
            className="tool-button tool-button--danger"
            disabled={movable.length === 0}
            data-testid="batch-remove"
            onClick={() => actions.removeMany(uids)}
          >
            Remove {movable.length}
          </button>
          <button type="button" className="tool-button" onClick={() => actions.select(null)}>
            Done
          </button>
        </div>
        <p className="studio-panel__note mono">Shift + click adds or drops / arrows move the group</p>
      </PanelSection>
    </div>
  );
}

export function StudioInspector({ layout, item, selection = [], conflicts, actions }) {
  return (
    <aside className="studio-panel studio-inspector" aria-label="Module inspector" data-testid="studio-inspector">
      {selection.length > 1 ? (
        <MultiDetail items={selection} actions={actions} />
      ) : item ? (
        <ModuleDetail item={item} layout={layout} conflict={conflicts.get(item.uid)} actions={actions} />
      ) : (
        <ModuleList items={layout.items} conflicts={conflicts} onSelect={actions.select} />
      )}
    </aside>
  );
}

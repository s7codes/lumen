import { getFinish, getProduct } from '../../data/products.js';
import { formatInt, formatUsd, padIndex } from '../../lib/format.js';
import { getFurniture, roomWall } from '../../lib/room-3d.js';
import { clampToWall } from '../../lib/wall-studio.js';
import '../../styles/product.css';
import { FinishPicker, NumberField, PanelSection, Switch } from '../studio/controls.jsx';

function conflictText(conflict, items, room) {
  if (!conflict) return 'Clear';
  if (conflict.bounds) return 'Exceeds wall';
  const parts = [];
  if (conflict.furniture) parts.push(`Collides with ${getFurniture(room.furniture).label}`);
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
    <PanelSection index="03" title="Modules">
      {items.length === 0 ? (
        <p className="studio-panel__empty">No modules in the room. Mount a component or load the 2D wall.</p>
      ) : (
        <ul className="module-list" data-testid="room-module-list">
          {items.map((item, i) => {
            const product = getProduct(item.productId);
            const finish = getFinish(item.finish);
            return (
              <li key={item.uid}>
                <button
                  type="button"
                  className="module-list__item"
                  data-uid={item.uid}
                  data-conflict={conflicts.has(item.uid) || undefined}
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

function ModuleDetail({ item, state, conflict, actions }) {
  const product = getProduct(item.productId);
  const { room, items } = state;
  const wall = roomWall(room);
  const { w, h, d } = product.dimsCm;
  const lit = product.watts > 0;
  const position = (x, y) => clampToWall(product, wall, Math.round(x), Math.round(y));

  return (
    <>
      <PanelSection index="03" title="Module">
        <p className="studio-inspector__name" data-testid="room-inspector-name">
          {product.name}
        </p>
        <p className="studio-inspector__meta mono" data-testid="room-inspector-dims">
          {product.sku} / W {w} x H {h} x D {d} cm
        </p>
        <p
          className="studio-inspector__status mono"
          data-state={conflict ? 'conflict' : 'clear'}
          data-testid="room-inspector-status"
        >
          {conflictText(conflict, items, room)}
        </p>
      </PanelSection>

      <PanelSection index="04" title="Finish and channel">
        <FinishPicker product={product} finishId={item.finish} onChange={(finish) => actions.update(item.uid, { finish })} />
        <Switch
          label="24V LED channel"
          hint={lit ? (item.led ? 'On' : 'Off') : 'Passive'}
          checked={lit && item.led}
          disabled={!lit}
          onChange={(led) => actions.update(item.uid, { led })}
          testId="room-led-channel"
        />
        <p className="studio-panel__note mono">
          {lit
            ? `${product.watts} W / ${formatInt(product.lumens)} lm / ${product.kelvin} K / CRI ${product.cri}`
            : 'No light source / bus hardware'}
        </p>
      </PanelSection>

      <PanelSection index="05" title="Position">
        <div className="studio-fields">
          <NumberField
            label="Left X (cm)"
            value={item.xCm}
            min={0}
            max={room.widthCm - w}
            normalize={(x) => position(x, item.yCm).xCm}
            onCommit={(xCm) => actions.update(item.uid, { xCm })}
            testId="room-module-x"
          />
          <NumberField
            label="Bottom Y (cm)"
            value={item.yCm}
            min={0}
            max={room.heightCm - h}
            normalize={(y) => position(item.xCm, y).yCm}
            onCommit={(yCm) => actions.update(item.uid, { yCm })}
            testId="room-module-y"
          />
        </div>
        <dl className="studio-anchors mono">
          <div className="studio-anchors__row">
            <dt>Extents X</dt>
            <dd>
              {item.xCm} - {item.xCm + w}
            </dd>
          </div>
          <div className="studio-anchors__row">
            <dt>Extents Y</dt>
            <dd>
              {item.yCm} - {item.yCm + h}
            </dd>
          </div>
          <div className="studio-anchors__row">
            <dt>Extents Z</dt>
            <dd>0 - {d}</dd>
          </div>
        </dl>
      </PanelSection>

      <PanelSection index="06" title="Actions">
        <dl className="studio-inspector__price mono">
          <div>
            <dt>Unit price</dt>
            <dd>{formatUsd(product.priceUsd)}</dd>
          </div>
        </dl>
        <div className="studio-actions">
          <button type="button" className="tool-button tool-button--danger" onClick={() => actions.remove(item.uid)}>
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

export function RoomInspector({ state, item, conflicts, actions }) {
  return (
    <aside className="studio-panel studio-inspector" aria-label="Room inspector" data-testid="room-inspector">
      {item ? (
        <ModuleDetail item={item} state={state} conflict={conflicts.get(item.uid)} actions={actions} />
      ) : (
        <ModuleList items={state.items} conflicts={conflicts} onSelect={actions.select} />
      )}
    </aside>
  );
}

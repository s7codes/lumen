import { useId } from 'react';
import { getFinish, getProduct } from '../../data/products.js';
import { dimFactor, sanitizeDimPct } from '../../lib/dimming.js';
import { formatInt, formatUsd, formatWatts } from '../../lib/format.js';
import { getFurniture, ROOM_WALLS, roomWall, WALL_LABELS, wallOf, wallSpanCm } from '../../lib/room-3d.js';
import { clampToWall } from '../../lib/wall-studio.js';
import '../../styles/product.css';
import { DimmingSlider, FinishPicker, NumberField, PanelSection, Switch } from '../studio/controls.jsx';

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

function ModuleList({ items, activeWall, conflicts, onSelect }) {
  return (
    <PanelSection title="Modules">
      {items.length === 0 ? (
        <p className="studio-panel__empty">No modules in the room yet. Pick a wall, then mount a component or load the 2D wall.</p>
      ) : (
        <ul className="module-list" data-testid="room-module-list">
          {items.map((item) => {
            const product = getProduct(item.productId);
            const finish = getFinish(item.finish);
            const wall = wallOf(item);
            return (
              <li key={item.uid}>
                <button
                  type="button"
                  className="module-list__item"
                  data-uid={item.uid}
                  data-wall={wall}
                  data-active-wall={wall === activeWall || undefined}
                  data-conflict={conflicts.has(item.uid) || undefined}
                  onClick={() => onSelect(item.uid)}
                >
                  <span
                    className="module-list__swatch"
                    style={{ '--swatch': finish.hex, '--swatch-hi': finish.highlight, '--swatch-lo': finish.shade }}
                    aria-hidden="true"
                  />
                  <span className="module-list__name">{product.name}</span>
                  <span className="module-list__meta">
                    {WALL_LABELS[wall]} / {finish.label}
                    <span className="module-list__coords mono"> / {item.xCm}, {item.yCm}</span>
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

function WallSelect({ value, onChange }) {
  const id = useId();
  return (
    <div className="field studio-field room3d-wall-field">
      <label className="field__label" htmlFor={id}>
        Mounted on
      </label>
      <select
        id={id}
        className="field__input field__select"
        value={value}
        data-testid="module-wall-select"
        onChange={(event) => onChange(event.target.value)}
      >
        {ROOM_WALLS.map((wall) => (
          <option key={wall} value={wall}>
            {WALL_LABELS[wall]}
          </option>
        ))}
      </select>
    </div>
  );
}

function ModuleDetail({ item, state, conflict, actions }) {
  const product = getProduct(item.productId);
  const { room, items } = state;
  const wallId = wallOf(item);
  const wall = roomWall(room, wallId);
  const span = wallSpanCm(room, wallId);
  const { w, h, d } = product.dimsCm;
  const lit = product.watts > 0;
  const position = (x, y) => clampToWall(product, wall, Math.round(x), Math.round(y));

  return (
    <div className="studio-inspector__detail">
      <PanelSection title="Module">
        <p className="studio-inspector__name" data-testid="room-inspector-name">
          {product.name}
        </p>
        <p className="studio-inspector__meta mono" data-testid="room-inspector-dims">
          {product.sku} / W {w} x H {h} x D {d} cm
        </p>
        <p className="studio-inspector__wall" data-testid="room-inspector-wall" data-wall={wallId}>
          {WALL_LABELS[wallId]}
        </p>
        <p
          className="studio-inspector__status mono"
          data-state={conflict ? 'conflict' : 'clear'}
          data-testid="room-inspector-status"
        >
          {conflictText(conflict, items, room)}
        </p>
      </PanelSection>

      <PanelSection title="Finish & Light">
        <FinishPicker product={product} finishId={item.finish} onChange={(finish) => actions.update(item.uid, { finish })} />
        <Switch
          label="24V LED channel"
          hint={lit ? (item.led ? 'On' : 'Off') : 'Passive'}
          checked={lit && item.led}
          disabled={!lit}
          onChange={(led) => actions.update(item.uid, { led })}
          testId="room-led-channel"
        />
        {lit && (
          <DimmingSlider
            value={sanitizeDimPct(item.dimPct)}
            onCommit={(dimPct) => actions.update(item.uid, { dimPct })}
            hint={item.led ? '' : 'Channel off / level held for the next scene'}
          />
        )}
        <p className="studio-panel__note mono" data-testid="room-module-output">
          {lit
            ? `${formatWatts(product.watts * dimFactor(item))} W / ${formatInt(Math.round(product.lumens * dimFactor(item)))} lm at ${sanitizeDimPct(item.dimPct)}% / ${product.kelvin} K / CRI ${product.cri}`
            : 'No light source / bus hardware'}
        </p>
      </PanelSection>

      <PanelSection title="Wall & Position" className="studio-inspector__position">
        <WallSelect value={wallId} onChange={(next) => actions.update(item.uid, { wall: next })} />
        <div className="studio-fields">
          <NumberField
            label="Left X (cm)"
            value={item.xCm}
            min={0}
            max={span - w}
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
            <dt>Along wall</dt>
            <dd>
              {item.xCm} - {item.xCm + w} / {span}
            </dd>
          </div>
          <div className="studio-anchors__row">
            <dt>Height</dt>
            <dd>
              {item.yCm} - {item.yCm + h}
            </dd>
          </div>
          <div className="studio-anchors__row">
            <dt>Off wall</dt>
            <dd>0 - {d}</dd>
          </div>
        </dl>
      </PanelSection>

      <PanelSection title="Actions">
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
    </div>
  );
}

export function RoomInspector({ state, item, activeWall, conflicts, actions }) {
  return (
    <aside className="studio-panel studio-inspector" aria-label="Room inspector" data-testid="room-inspector">
      {item ? (
        <ModuleDetail item={item} state={state} conflict={conflicts.get(item.uid)} actions={actions} />
      ) : (
        <ModuleList items={state.items} activeWall={activeWall} conflicts={conflicts} onSelect={actions.select} />
      )}
    </aside>
  );
}

import { useEffect, useId, useRef } from 'react';
import { PRODUCTS } from '../../data/products.js';
import { formatUsd } from '../../lib/format.js';
import {
  FURNITURE,
  furnitureSlackCm,
  furnitureWallOf,
  LIGHTING_MODES,
  ROOM_DEPTH,
  ROOM_HEIGHT,
  ROOM_SIZE_PRESETS,
  ROOM_WALLS,
  ROOM_WIDTH,
  roomSizePreset,
  solarHourOf,
  WALL_LABELS,
  windowWallOf,
} from '../../lib/room-3d.js';
import {
  formatSolarHour,
  SOLAR_HOUR,
  SOLAR_PRESETS,
  solarPreset,
  solarState,
  WINDOW_LABELS,
  WINDOW_WALLS,
} from '../../lib/solar-path.js';
import { MAX_WALL_ITEMS } from '../../lib/wall-studio.js';
import { clampNumber } from '../../security/sanitize.js';
import { Disclosure, NumberField, PaletteItem, PanelSection } from '../studio/controls.jsx';

function dimension(range) {
  return (value) => clampNumber(Math.round(value), range.min, range.max, range.initial);
}

function Segment({ legend, name, options, value, onChange, columns = 2 }) {
  return (
    <fieldset className="studio-segment room3d-segment">
      <legend className="field__label">{legend}</legend>
      <div className="studio-segment__track" data-columns={columns}>
        {options.map((option) => (
          <label key={option.id} className="studio-segment__option">
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={value === option.id}
              onChange={() => onChange(option.id)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** One press sets width, depth and ceiling together; an edited envelope leaves every pill up. */
function ScalePresets({ room, onRoom }) {
  const active = roomSizePreset(room);
  return (
    <div className="room3d-scale" role="group" aria-labelledby="room-scale-label" data-testid="room-size-presets">
      <p id="room-scale-label" className="field__label">
        Room scale
      </p>
      <div className="room3d-scale__track">
        {ROOM_SIZE_PRESETS.map(({ id, label, widthCm, depthCm, heightCm }) => (
          <button
            key={id}
            type="button"
            className="room3d-scale__pill"
            aria-pressed={active === id}
            data-testid={`room-preset-${id}`}
            onClick={() => onRoom({ widthCm, depthCm, heightCm })}
          >
            <span className="room3d-scale__name">{label}</span>
            <span className="room3d-scale__dims mono">
              {widthCm} x {depthCm} x {heightCm}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * A range that paints its fill and readout straight to the DOM while the
 * thumb moves and commits once on `change` (pointer release or a key step),
 * so a drag is one undoable edit, never a render per pointer move.
 */
function CommitRange({ label, value, min, max, step, format, onCommit, testId, disabled = false }) {
  const id = useId();
  const inputRef = useRef(null);
  const readoutRef = useRef(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const formatRef = useRef(format);
  formatRef.current = format;

  const paint = (next) => {
    const input = inputRef.current;
    if (!input) return;
    const span = max - min;
    input.style.setProperty('--dim-fill', `${span > 0 ? ((next - min) / span) * 100 : 0}%`);
    input.setAttribute('aria-valuetext', formatRef.current(next));
    if (readoutRef.current) readoutRef.current.textContent = formatRef.current(next);
  };

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.value = String(value);
    paint(value);
    // min and max move the fill too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, min, max]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return undefined;
    const onInput = () => paint(Number(input.value));
    const onChange = () => commitRef.current(Number(input.value));
    input.addEventListener('input', onInput);
    input.addEventListener('change', onChange);
    return () => {
      input.removeEventListener('input', onInput);
      input.removeEventListener('change', onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="dim-slider room3d-range" data-disabled={disabled || undefined}>
      <div className="dim-slider__head">
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
        <output className="dim-slider__value mono" htmlFor={id} ref={readoutRef} data-testid={`${testId}-value`}>
          {format(value)}
        </output>
      </div>
      <input
        ref={inputRef}
        id={id}
        className="dim-slider__input"
        type="range"
        min={min}
        max={max}
        step={step}
        defaultValue={value}
        disabled={disabled}
        data-testid={testId}
        data-value={value}
      />
    </div>
  );
}

const signedCm = (value) => `${value > 0 ? '+' : ''}${value} cm`;

/**
 * Sun & Aperture: local solar time with four quick presets, and the wall
 * the daylight window sits in. The sun moves in Daylight Studio; at night
 * the window stays dark.
 */
function SunAperture({ room, onRoom }) {
  const hour = solarHourOf(room);
  const preset = solarPreset(hour);
  const windowWall = windowWallOf(room);
  const solar = solarState(hour);
  const daylight = room.lighting === 'daylight';
  return (
    <Disclosure
      label="Sun & Aperture"
      summary={`${formatSolarHour(hour)} / ${windowWall === 'none' ? 'No window' : `${WINDOW_LABELS[windowWall]} window`}`}
      testId="room-solar-controls"
    >
      <CommitRange
        label="Solar time"
        value={hour}
        min={SOLAR_HOUR.min}
        max={SOLAR_HOUR.max}
        step={SOLAR_HOUR.step}
        format={formatSolarHour}
        onCommit={(solarHour) => onRoom({ solarHour })}
        testId="room-solar-hour"
      />
      <div className="room3d-sun__presets" role="group" aria-label="Solar time presets">
        {SOLAR_PRESETS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="room3d-sun__preset"
            aria-pressed={preset === entry.id}
            data-testid={`room-solar-${entry.id}`}
            onClick={() => onRoom({ solarHour: entry.hour })}
          >
            <span>{entry.label}</span>
            <span className="mono">{formatSolarHour(entry.hour)}</span>
          </button>
        ))}
      </div>
      <Segment
        legend="Window"
        name="room-window"
        options={WINDOW_WALLS.map((id) => ({ id, label: WINDOW_LABELS[id] }))}
        value={windowWall}
        onChange={(next) => onRoom({ windowWall: next })}
      />
      <p
        className="room3d-sun__readout mono"
        data-testid="room-solar-readout"
        data-azimuth={solar.azimuthDeg}
        data-elevation={solar.elevationDeg}
        data-kelvin={solar.kelvin}
      >
        {daylight
          ? solar.up
            ? `Sun AZ ${Math.round(solar.azimuthDeg)} deg / EL ${Math.round(solar.elevationDeg)} deg / ${solar.kelvin}K`
            : 'Sun below the horizon / twilight sky'
          : 'Night Ambient: the sun moves in Daylight Studio.'}
      </p>
    </Disclosure>
  );
}

/** Which wall the floor reference backs onto, and its slide along it. */
function FurniturePlacement({ room, onRoom }) {
  if (room.furniture === 'none') return null;
  const wall = furnitureWallOf(room);
  const slack = furnitureSlackCm(room);
  const offset = room.furnitureOffsetCm ?? 0;
  const turn = () => onRoom({ furnitureWall: ROOM_WALLS[(ROOM_WALLS.indexOf(wall) + 1) % ROOM_WALLS.length] });
  return (
    <Disclosure label="Placement" summary={`${WALL_LABELS[wall]} / ${signedCm(offset)}`} testId="furniture-placement">
      <div className="room3d-placement">
        <div className="field studio-field">
          <label className="field__label" htmlFor="furniture-wall">
            Backs onto
          </label>
          <select
            id="furniture-wall"
            className="field__input field__select"
            value={wall}
            data-testid="furniture-wall-select"
            onChange={(event) => onRoom({ furnitureWall: event.target.value })}
          >
            {ROOM_WALLS.map((id) => (
              <option key={id} value={id}>
                {WALL_LABELS[id]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="tool-button room3d-placement__turn"
          data-testid="furniture-rotate"
          title="Turn the floor reference onto the next wall, clockwise"
          onClick={turn}
        >
          Rotate 90 deg
        </button>
      </div>
      <CommitRange
        label="Offset along wall"
        value={offset}
        min={-slack}
        max={slack}
        step={1}
        format={signedCm}
        disabled={slack === 0}
        onCommit={(furnitureOffsetCm) => onRoom({ furnitureOffsetCm })}
        testId="furniture-offset"
      />
    </Disclosure>
  );
}

function RoomSettings({ room, onRoom }) {
  return (
    <PanelSection title="Envelope & Lighting">
      <ScalePresets room={room} onRoom={onRoom} />
      <Disclosure
        label="Dimensions"
        summary={`${room.widthCm} x ${room.depthCm} x ${room.heightCm} cm`}
        testId="room-dimensions"
      >
        <div className="room3d-fields dimension-fields">
          <NumberField
            label="Width (cm)"
            value={room.widthCm}
            min={ROOM_WIDTH.min}
            max={ROOM_WIDTH.max}
            normalize={dimension(ROOM_WIDTH)}
            onCommit={(widthCm) => onRoom({ widthCm })}
            testId="room-width"
          />
          <NumberField
            label="Depth (cm)"
            value={room.depthCm}
            min={ROOM_DEPTH.min}
            max={ROOM_DEPTH.max}
            normalize={dimension(ROOM_DEPTH)}
            onCommit={(depthCm) => onRoom({ depthCm })}
            testId="room-depth"
          />
          <NumberField
            label="Ceiling (cm)"
            value={room.heightCm}
            min={ROOM_HEIGHT.min}
            max={ROOM_HEIGHT.max}
            normalize={dimension(ROOM_HEIGHT)}
            onCommit={(heightCm) => onRoom({ heightCm })}
            testId="room-height"
          />
        </div>
        <p className="studio-panel__note">
          Width {ROOM_WIDTH.min}-{ROOM_WIDTH.max}, depth {ROOM_DEPTH.min}-{ROOM_DEPTH.max}, ceiling {ROOM_HEIGHT.min}-
          {ROOM_HEIGHT.max} cm
        </p>
      </Disclosure>

      <Segment
        legend="Lighting"
        name="room-lighting"
        options={LIGHTING_MODES}
        value={room.lighting}
        onChange={(lighting) => onRoom({ lighting })}
      />
      <div className="room3d-disclosure-row">
        <SunAperture room={room} onRoom={onRoom} />
      </div>
      <Segment
        legend="Floor reference"
        name="room-furniture"
        options={FURNITURE}
        value={room.furniture}
        onChange={(furniture) => onRoom({ furniture })}
      />
      {room.furniture !== 'none' && (
        <div className="room3d-disclosure-row">
          <FurniturePlacement room={room} onRoom={onRoom} />
        </div>
      )}
    </PanelSection>
  );
}

function ComponentList({ full, wallLabel, onMount }) {
  return (
    <PanelSection title="Asset Shelf" hint={`One click mounts a part on the ${wallLabel}.`}>
      <ul className="palette-list" data-testid="room-palette" data-target-wall={wallLabel}>
        {PRODUCTS.map((product) => (
          <li key={product.id}>
            <PaletteItem
              product={product}
              note={full ? 'Room full' : formatUsd(product.priceUsd)}
              disabled={full}
              withDepth
              onMount={onMount}
            />
          </li>
        ))}
      </ul>
    </PanelSection>
  );
}

export function RoomControls({ state, activeWall, actions }) {
  return (
    <aside className="studio-panel room3d-controls" aria-label="Room controls">
      <RoomSettings room={state.room} onRoom={actions.setRoom} />
      <ComponentList
        full={state.items.length >= MAX_WALL_ITEMS}
        wallLabel={WALL_LABELS[activeWall]}
        onMount={actions.mount}
      />
    </aside>
  );
}

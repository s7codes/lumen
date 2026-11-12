// Cantilever and light aperture: structural spine, base return and a
// cantilevered shelf slab, with a tungsten slit held between slab and base.
export function LumenMark({ size = 24, className }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      data-testid="lumen-mark"
    >
      <rect data-part="spine" x="3" y="3" width="4" height="18" fill="currentColor" />
      <rect data-part="base" x="3" y="17" width="18" height="4" fill="currentColor" />
      <rect data-part="cantilever" x="10" y="3" width="11" height="3.5" fill="currentColor" />
      <rect data-part="aperture" x="14.25" y="8.5" width="2" height="6.5" fill="var(--lumen-amber)" />
    </svg>
  );
}

export function ArrowRight({ className }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M2 8h11M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square" />
    </svg>
  );
}

// Six-blade camera aperture inside a hexagonal bezel: the Studio AI mark.
export function ApertureGlyph({ size = 18 }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true" focusable="false" className="aperture-glyph">
      <path d="M10 1.75 17.15 5.88V14.12L10 18.25 2.85 14.12V5.88Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M10 1.75 12.7 8.45M17.15 5.88 11.9 10.95M17.15 14.12 9.95 13.05M10 18.25 7.3 11.55M2.85 14.12 8.1 9.05M2.85 5.88 10.05 6.95"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <path d="M10 7.2 12.42 8.6V11.4L10 12.8 7.58 11.4V8.6Z" fill="currentColor" />
    </svg>
  );
}

export function PlusGlyph() {
  return (
    <svg className="glyph-plus" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square" />
    </svg>
  );
}

// Three faders with square caps: the camera settings trigger.
export function FaderGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeOpacity="0.45" />
      <rect x="9" y="2.5" width="2.5" height="3" fill="currentColor" />
      <rect x="4" y="6.5" width="2.5" height="3" fill="currentColor" />
      <rect x="10.5" y="10.5" width="2.5" height="3" fill="currentColor" />
    </svg>
  );
}

export function ResetGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M3.5 6.5A5 5 0 1 1 3 9.5" stroke="currentColor" strokeWidth="1.25" />
      <path d="M2.5 3v4h4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square" />
    </svg>
  );
}

export function ChevronGlyph({ className }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square" />
    </svg>
  );
}

export function CatalogGlyph() {
  return (
    <svg viewBox="0 0 120 72" fill="none" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="1">
        <rect x="8.5" y="8.5" width="30" height="24" />
        <rect x="45.5" y="8.5" width="30" height="24" />
        <rect x="82.5" y="8.5" width="30" height="24" />
        <rect x="8.5" y="39.5" width="30" height="24" />
        <rect x="45.5" y="39.5" width="30" height="24" />
        <rect x="82.5" y="39.5" width="30" height="24" strokeDasharray="2 3" />
      </g>
      <path d="M60.5 14v6" stroke="currentColor" />
      <path d="M56 24a4.5 4.5 0 0 1 9 0z" fill="var(--lumen-amber)" />
    </svg>
  );
}

export function RoomGlyph() {
  return (
    <svg viewBox="0 0 120 72" fill="none" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="1">
        <path d="M60 6.5 104.5 24v30L60 68.5 15.5 54V24L60 6.5Z" />
        <path d="M60 6.5v30M60 36.5 15.5 24M60 36.5 104.5 24" strokeOpacity="0.45" />
        <path d="M60 36.5v32" strokeDasharray="2 3" strokeOpacity="0.45" />
      </g>
      <path d="M78 22v8" stroke="currentColor" />
      <circle cx="78" cy="32" r="3" fill="var(--lumen-amber)" />
    </svg>
  );
}

export function WallGlyph() {
  return (
    <svg viewBox="0 0 120 72" fill="none" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="1">
        <rect x="10.5" y="8.5" width="99" height="54" />
        <path d="M30.5 8.5v54M89.5 8.5v54" strokeOpacity="0.45" />
        <path d="M30.5 28.5h59M30.5 44.5h59" strokeWidth="2" />
        <path d="M10.5 66.5h99M10.5 64v5M109.5 64v5" strokeOpacity="0.45" />
      </g>
      <path d="M52 17.5h16" stroke="var(--lumen-amber)" strokeWidth="2.5" />
    </svg>
  );
}

export function SearchGlyph({ className }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.25" />
      <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square" />
    </svg>
  );
}

export function WorkspaceGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <rect x="2.5" y="2.5" width="11" height="11" stroke="currentColor" strokeWidth="1" />
      <path d="M2.5 6h11M6 6v7.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function ModuleGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M8 2 13.5 5v6L8 14l-5.5-3V5L8 2Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      <path d="M2.5 5 8 8l5.5-3M8 8v6" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

export function CommandGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M3 4.5 6.5 8 3 11.5M8.5 12H13" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square" />
    </svg>
  );
}

// Room plan seen from above, north at the top; the active wall is drawn solid.
const PLAN_SIDES = Object.freeze({
  north: 'M3 3h10',
  east: 'M13 3v10',
  south: 'M3 13h10',
  west: 'M3 3v10',
});

export function PlanWallGlyph({ wall }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="10" height="10" stroke="currentColor" strokeOpacity="0.4" />
      <path d={PLAN_SIDES[wall] ?? PLAN_SIDES.north} stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" />
    </svg>
  );
}

/** Wireframe cube for the studio launch key: near edges solid, hidden edges dashed. */
export function CubeGlyph({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round">
        <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z" />
        <path d="M4 7.5 12 12l8-4.5M12 12v9" />
        <path d="M12 3v9" strokeDasharray="1.5 1.8" strokeOpacity="0.55" />
      </g>
    </svg>
  );
}

export function PresetOrbitGlyph() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="1.1">
        <path d="M16 10.5 22 13.5v6L16 22.5l-6-3v-6l6-3Z" />
        <path d="M10 13.5 16 16.5l6-3M16 16.5v6" strokeOpacity="0.5" />
        <ellipse cx="16" cy="17" rx="13" ry="5.5" strokeDasharray="2 2.4" strokeOpacity="0.7" />
      </g>
      <path d="m26.5 12.4 2.6.6-1.6 2.1" stroke="var(--lumen-amber)" strokeWidth="1.1" />
    </svg>
  );
}

export function PresetEyeGlyph() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="1.1">
        <path d="M3 26h26" strokeOpacity="0.5" />
        <path d="M8 26V12.5" strokeDasharray="1.5 2" strokeOpacity="0.6" />
        <path d="M8 12.5 28 5M8 12.5 28 20" strokeOpacity="0.8" />
        <path d="M28 5v15" strokeDasharray="2 2" />
      </g>
      <path d="M5 12.5h6M8 9.5v6" stroke="var(--lumen-amber)" strokeWidth="1.25" />
    </svg>
  );
}

export function PresetLoftGlyph() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="1.1">
        <path d="M3 11 17 5l12 5v12l-14 6-12-6V11Z" />
        <path d="M3 11l12 5 14-6M15 16v12" strokeOpacity="0.5" />
      </g>
      <path d="M3 30.5h12M15 30.5l14-6" stroke="var(--lumen-amber)" strokeWidth="1.1" strokeDasharray="1.6 1.6" />
    </svg>
  );
}

/** Transform gizmo: a module plate with its X and Y handles and the cursor ray landing on it. */
export function PresetGizmoGlyph() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="1.1">
        <path d="M3 27h26" strokeOpacity="0.5" />
        <rect x="9" y="13" width="12" height="6" rx="0.5" />
        <path d="M15 16h11m-2.5-2.2L26 16l-2.5 2.2M15 16V5m-2.2 2.5L15 5l2.2 2.5" strokeOpacity="0.85" />
      </g>
      <path d="M5 4.5 15 16" stroke="var(--lumen-amber)" strokeWidth="1.1" strokeDasharray="1.6 1.6" />
    </svg>
  );
}

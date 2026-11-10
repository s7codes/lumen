export function LumenMark({ size = 22, className }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="0.5" y="0.5" width="31" height="31" rx="3.5" stroke="currentColor" strokeOpacity="0.22" />
      <path d="M9 7v18h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" />
      <path d="M19 7v5.5" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1" />
      <path d="M15.5 16a3.5 3.5 0 0 1 7 0z" fill="var(--lumen-amber)" />
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

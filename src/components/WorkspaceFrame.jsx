export function WorkspaceFrame({ label, status, footer, className = '', children, ...rest }) {
  return (
    <section className={`workspace-frame ${className}`.trim()} aria-label={label} {...rest}>
      <div className="workspace-frame__bar mono">
        <span>{label}</span>
        {status && <span className="workspace-frame__status">{status}</span>}
      </div>
      <div className="workspace-frame__viewport">
        {children}
        <span className="workspace-frame__corner workspace-frame__corner--tl" aria-hidden="true" />
        <span className="workspace-frame__corner workspace-frame__corner--tr" aria-hidden="true" />
        <span className="workspace-frame__corner workspace-frame__corner--bl" aria-hidden="true" />
        <span className="workspace-frame__corner workspace-frame__corner--br" aria-hidden="true" />
      </div>
      {footer && <div className="workspace-frame__bar workspace-frame__bar--bottom mono">{footer}</div>}
    </section>
  );
}

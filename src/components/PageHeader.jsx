export function PageHeader({ index, section, title, lede, meta = [] }) {
  return (
    <header className="page-header container">
      <p className="index-label">
        <span className="index-label__num">{index}</span> / {section}
      </p>
      <h1 className="page-header__title">{title}</h1>
      {lede && <p className="page-header__lede">{lede}</p>}
      {meta.length > 0 && (
        <dl className="page-header__meta">
          {meta.map(([term, value]) => (
            <div key={term} className="page-header__meta-item">
              <dt>{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}

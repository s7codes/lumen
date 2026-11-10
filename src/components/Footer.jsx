import { Link } from 'react-router-dom';
import { NAV_ROUTES } from '../lib/routes.js';
import { LumenMark } from './icons.jsx';

const SYSTEM_ROWS = [
  ['Bus', '24V DC / Class 2 SELV'],
  ['Light', 'CRI 97+ / 2700K'],
  ['Material', 'FSC Walnut / 6063-T5'],
];

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner container">
        <div className="footer__brand">
          <LumenMark size={28} />
          <p className="footer__tagline">
            Architectural lighting and modular furniture on a shared low-voltage spine.
          </p>
        </div>

        <nav className="footer__col" aria-label="Footer">
          <p className="index-label">Index</p>
          <ul className="footer__list">
            {NAV_ROUTES.map((route) => (
              <li key={route.path}>
                <Link to={route.path} className="footer__link">
                  <span className="footer__link-index mono">{route.index}</span>
                  {route.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="footer__col">
          <p className="index-label">System</p>
          <dl className="footer__specs">
            {SYSTEM_ROWS.map(([term, value]) => (
              <div key={term} className="footer__spec">
                <dt>{term}</dt>
                <dd className="mono">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="footer__base container mono">
        <span>Rev {__APP_VERSION__}</span>
        <span>{new Date().getFullYear()} Lumen</span>
      </div>
    </footer>
  );
}

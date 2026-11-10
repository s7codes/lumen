import { Outlet, ScrollRestoration } from 'react-router-dom';
import { AuthProvider } from '../contexts/AuthContext.jsx';
import { ToastProvider } from '../contexts/ToastContext.jsx';
import { useMagneticField } from '../hooks/useMagneticField.js';
import { BagProvider } from './BagProvider.jsx';
import { Footer } from './Footer.jsx';
import { Navbar } from './Navbar.jsx';
import '../styles/shell.css';
import '../styles/toast.css';

const GRID_COLUMNS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));

function StructuralGrid() {
  return (
    <div className="structural-grid" aria-hidden="true">
      <div className="structural-grid__inner">
        {GRID_COLUMNS.map((label) => (
          <span key={label} className="structural-grid__col">
            <span className="structural-grid__label">{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function LayoutShell() {
  useMagneticField();

  return (
    <AuthProvider>
      <ToastProvider>
        <BagProvider>
          <a href="#main" className="skip-link">
            Skip to content
          </a>
          <StructuralGrid />
          <div className="shell">
            <Navbar />
            <main id="main" className="shell__main" tabIndex={-1}>
              <Outlet />
            </main>
            <Footer />
          </div>
          <ScrollRestoration />
        </BagProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

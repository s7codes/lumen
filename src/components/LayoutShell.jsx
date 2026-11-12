import { Outlet, ScrollRestoration } from 'react-router-dom';
import { AuthProvider } from '../contexts/AuthContext.jsx';
import { ToastProvider } from '../contexts/ToastContext.jsx';
import { useMagneticField } from '../hooks/useMagneticField.js';
import { BagProvider } from './BagProvider.jsx';
import { CommandPaletteProvider } from './CommandPalette.jsx';
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

// Focus moves to the landmark itself; a bare fragment jump only moves the caret start point.
function focusMain(event) {
  const main = document.getElementById('main-content');
  if (!main) return;
  event.preventDefault();
  main.focus();
  main.scrollIntoView({ block: 'start' });
}

export function LayoutShell() {
  useMagneticField();

  return (
    <AuthProvider>
      <ToastProvider>
        <BagProvider>
          <CommandPaletteProvider>
            <a href="#main-content" className="skip-link" data-testid="skip-to-main" onClick={focusMain}>
              Skip to main content
            </a>
            <StructuralGrid />
            <div className="shell">
              <Navbar />
              <main id="main-content" className="shell__main" tabIndex={-1}>
                <Outlet />
              </main>
              <Footer />
            </div>
            <ScrollRestoration />
          </CommandPaletteProvider>
        </BagProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

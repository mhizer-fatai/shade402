import { useEffect, useState } from 'react';
import HomePage from './HomePage';
import DashboardPage from './DashboardPage';
import { useTheme } from './useTheme';
import { useScrollProgress } from './useScrollFx';
import { shortHash, explorerContractUrl } from './api';
import { useWallet } from './WalletContext';

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

export type View = 'home' | 'dashboard';

function viewFromPath(path: string): View {
  return path.startsWith('/dashboard') ? 'dashboard' : 'home';
}

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [view, setView] = useState<View>(() =>
    typeof window === 'undefined' ? 'home' : viewFromPath(window.location.pathname),
  );
  const [contract, setContract] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const scrollProgress = useScrollProgress();
  const { connected, snapshot } = useWallet();

  // Keep the view in sync with the URL so /dashboard is directly linkable and
  // the browser back/forward buttons work.
  useEffect(() => {
    const onPop = () => setView(viewFromPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function navigate(next: View) {
    const path = next === 'dashboard' ? '/dashboard' : '/';
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setView(next);
  }

  // Lazily capture the contract address for the nav chip once we're in the dashboard.
  function handleLaunch() {
    navigate('dashboard');
    fetch('/api/health')
      .then((r) => r.json())
      .then((j) => {
        setContract(j?.contractAddress ?? null);
        setNetwork(j?.network ?? null);
      })
      .catch(() => {});
  }

  return (
    <div className="app">
      {view === 'home' && (
        <div className="scroll-progress" aria-hidden="true">
          <div className="scroll-progress-fill" style={{ width: `${scrollProgress * 100}%` }} />
        </div>
      )}
      <nav className="nav">
        <div className="nav-inner">
          <button className="brand brand-button" onClick={() => navigate('home')}>
            <div className="brand-glyph">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            </div>
            Shade402
          </button>
          <div className="nav-links">
            <button
              className={`nav-link ${view === 'home' ? 'active' : ''}`}
              onClick={() => navigate('home')}
            >
              Home
            </button>
            <button
              className={`nav-link ${view === 'dashboard' ? 'active' : ''}`}
              onClick={handleLaunch}
            >
              Dashboard
            </button>
          </div>
          <div className="nav-right">
            {view === 'dashboard' && contract && !connected && (
              <a
                className="wallet-chip ext-link"
                href={explorerContractUrl(contract, network)}
                target="_blank"
                rel="noreferrer"
              >
                <span className="dot" />
                contract {shortHash(contract, 6, 4)}
              </a>
            )}
            <button
              className={`nav-link ${connected ? '' : 'active'}`}
              onClick={() => {
                if (!connected) navigate('dashboard');
              }}
            >
              {connected ? (
                <span className="wallet-chip" style={{ borderColor: 'var(--border)' }}>
                  <span className="dot" />
                  {snapshot?.unshieldedAddress ? shortHash(snapshot.unshieldedAddress, 8, 6) : 'Connected'}
                </span>
              ) : (
                'Connect Wallet'
              )}
            </button>
            <button
              className="theme-toggle"
              onClick={toggleTheme}
              title={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
              aria-label="Toggle theme"
            >
              {theme === 'light' ? <MoonIcon /> : <SunIcon />}
            </button>
          </div>
        </div>
      </nav>

      {view === 'home' ? <HomePage onLaunch={handleLaunch} /> : <DashboardPage />}

      <footer className="footer">
        <p className="footer-copy">© 2026 Shade402. All rights reserved.</p>
        <a
          className="footer-link"
          href="https://github.com/mhizer-fatai/shade402"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
      </footer>
    </div>
  );
}

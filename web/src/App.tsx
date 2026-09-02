import { useState } from 'react';
import HomePage from './HomePage';
import DashboardPage from './DashboardPage';
import { useTheme } from './useTheme';
import { useScrollProgress } from './useScrollFx';
import { shortHash } from './api';

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

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [view, setView] = useState<View>('home');
  const [contract, setContract] = useState<string | null>(null);
  const scrollProgress = useScrollProgress();

  // Lazily capture the contract address for the nav chip once we're in the dashboard.
  function handleLaunch() {
    setView('dashboard');
    fetch('/api/health')
      .then((r) => r.json())
      .then((j) => setContract(j?.contractAddress ?? null))
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
          <button className="brand brand-button" onClick={() => setView('home')}>
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
              onClick={() => setView('home')}
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
            {view === 'dashboard' && contract && (
              <span className="wallet-chip">
                <span className="dot" />
                {shortHash(contract, 8, 6)}
              </span>
            )}
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
        Shade402 · Midnight Buildathon Wave 1 · Private, rule-controlled x402 payments for
        AI agents
      </footer>
    </div>
  );
}

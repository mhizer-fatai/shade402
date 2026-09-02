import { useState, useEffect, useCallback } from 'react';
import type { AgentInfo, HealthInfo, PayResult, MockResourceResult } from './api';
import { useTheme } from './useTheme';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const json = await res.json();
  if (!res.ok) throw new Error((json as any).error ?? `Request failed: ${res.status}`);
  return json as T;
}

function shortHash(hash: string, head = 10, tail = 6): string {
  if (!hash) return '—';
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

interface PaymentRow {
  invoiceId: string;
  txId: string;
  amount: string;
  recipient: string;
  time: string;
}

const RESOURCES = [
  { path: '/api/data/flight-prices', label: 'Flight prices', price: '15' },
  { path: '/api/data/market-data', label: 'Market data', price: '20' },
  { path: '/api/data/ai-inference', label: 'AI inference', price: '30' },
];

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [showRegister, setShowRegister] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);

  const [dailyLimit, setDailyLimit] = useState('1000');
  const [perPaymentLimit, setPerPaymentLimit] = useState('200');
  const [depositAmount, setDepositAmount] = useState('100');
  const [payPath, setPayPath] = useState(RESOURCES[0].path);
  const [resourceResult, setResourceResult] = useState<MockResourceResult | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [h, a] = await Promise.all([api<HealthInfo>('/api/health'), api<AgentInfo>('/api/agent')]);
      setHealth(h);
      setAgent(a);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    await run(() =>
      api('/api/agent/register', {
        method: 'POST',
        body: JSON.stringify({ dailyLimit, perPaymentLimit, periodHours: 24 }),
      }),
    );
    setShowRegister(false);
  }

  async function deposit() {
    await run(() =>
      api('/api/agent/deposit', {
        method: 'POST',
        body: JSON.stringify({ amount: depositAmount }),
      }),
    );
    setShowDeposit(false);
  }

  async function pay() {
    setResourceResult(null);
    await run(async () => {
      const result = await api<PayResult>('/api/pay', {
        method: 'POST',
        body: JSON.stringify({ resourcePath: payPath }),
      });
      setPayments((prev) => [
        {
          invoiceId: result.invoiceId,
          txId: result.txId,
          amount: RESOURCES.find((r) => r.path === payPath)?.price ?? '—',
          recipient: 'midnight provider',
          time: new Date().toLocaleTimeString(),
        },
        ...prev,
      ]);
      // Fetch the paid resource to complete the x402 loop
      try {
        const res = await api<MockResourceResult>(
          `/api/mock/resource?path=${encodeURIComponent(payPath)}&receipt=${encodeURIComponent(result.receipt)}&invoiceId=${encodeURIComponent(result.invoiceId)}`,
        );
        setResourceResult(res);
      } catch {
        /* resource fetch optional for the demo */
      }
    });
  }

  const spent = agent?.spentInPeriod ? Number(agent.spentInPeriod) : 0;
  const limit = agent?.dailyLimit ? Number(agent.dailyLimit) : 0;
  const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
  const remaining = Math.max(0, limit - spent);
  const overLimit = limit > 0 && remaining === 0;

  return (
    <div className="app">
      {/* ── Top bar ── */}
      <nav className="nav">
        <div className="nav-inner">
          <div className="brand">
            <div className="brand-glyph">🌑</div>
            Shade402
          </div>
          <div className="nav-links">
            <button className="nav-link active">Overview</button>
            <button className="nav-link">Agents</button>
            <button className="nav-link">Payments</button>
            <button className="nav-link">Settings</button>
          </div>
          <div className="nav-right">
            {health && <span className="network-badge">{health.network}</span>}
            {health?.contractAddress && (
              <span className="wallet-chip">
                <span className="dot" />
                {shortHash(health.contractAddress, 8, 6)}
              </span>
            )}
            <button
              className="theme-toggle"
              onClick={toggleTheme}
              title={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
              aria-label="Toggle theme"
            >
              {theme === 'light' ? '🌙' : '☀️'}
            </button>
          </div>
        </div>
      </nav>

      <main className="main">
        {error && (
          <div className="error-banner">
            <span>⚠</span>
            {error}
          </div>
        )}
        {busy && (
          <div className="busy-banner">
            <span className="spinner" />
            Submitting on-chain transaction — this can take 30–60 seconds.
          </div>
        )}

        {/* ── Page header ── */}
        <div className="page-header">
          <div>
            <h1 className="page-title">Owner dashboard</h1>
            <p className="page-subtitle">
              Private, rule-controlled x402 payments for your AI agents on Midnight.
            </p>
          </div>
          <div className="header-actions">
            <button className="btn btn-primary" onClick={() => setShowRegister(true)} disabled={busy}>
              Register agent
            </button>
            <button className="btn btn-secondary" onClick={() => setShowDeposit(true)} disabled={busy}>
              Deposit funds
            </button>
          </div>
        </div>

        {/* ── Stats ── */}
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-label">Agent balance</div>
            <div className="stat-value">
              {agent?.balance ?? '—'}
              <span className="stat-unit">tNIGHT</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Daily limit remaining</div>
            <div className="stat-value">
              {agent?.registered ? remaining : '—'}
              {agent?.registered && <span className="stat-unit">tNIGHT</span>}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Spent this period</div>
            <div className="stat-value">{agent?.registered ? spent : '—'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Network</div>
            <div className="stat-value" style={{ fontSize: 18 }}>
              {health?.network ?? '—'}
            </div>
          </div>
        </div>

        {/* ── Agents ── */}
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Agents</h2>
          </div>

          {agent?.registered ? (
            <div className="agent-card">
              <div className="agent-head">
                <div className="agent-avatar">A</div>
                <div className="agent-id">
                  <p className="agent-name">Agent Alpha</p>
                  <span className="agent-key">{shortHash(agent.agentKey, 12, 8)}</span>
                </div>
                <span className={`chip ${overLimit ? 'chip-warning' : 'chip-success'}`}>
                  {overLimit ? 'Limit reached' : 'Within policy'}
                </span>
              </div>

              <div className="limit-row">
                <div className="limit-meta">
                  <span>
                    Spent {spent} of {limit} tNIGHT today
                  </span>
                  <span>{pct.toFixed(1)}%</span>
                </div>
                <div className="limit-bar">
                  <div className={`limit-fill ${pct > 80 ? 'warn' : ''}`} style={{ width: `${pct}%` }} />
                </div>
              </div>

              <div className="agent-metrics">
                <div className="metric">
                  <div className="metric-label">Balance</div>
                  <div className="metric-value">{agent.balance}</div>
                </div>
                <div className="metric">
                  <div className="metric-label">Spent today</div>
                  <div className="metric-value">{agent.spentInPeriod}</div>
                </div>
                <div className="metric">
                  <div className="metric-label">Daily limit</div>
                  <div className="metric-value">{agent.dailyLimit}</div>
                </div>
                <div className="metric">
                  <div className="metric-label">Per-payment cap</div>
                  <div className="metric-value">{agent.perPaymentLimit}</div>
                </div>
              </div>

              <div className="agent-actions">
                <button className="btn btn-primary btn-sm" onClick={() => setShowDeposit(true)} disabled={busy}>
                  Deposit
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => void pay()} disabled={busy}>
                  Pay a service
                </button>
              </div>
            </div>
          ) : (
            <div className="table-card">
              <div className="empty-state">
                No agents registered yet. Click <strong>Register agent</strong> to create one with a spending policy.
              </div>
            </div>
          )}
        </section>

        {/* ── Pay an x402 service (demo) ── */}
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Pay an x402 service</h2>
          </div>
          <div className="table-card" style={{ padding: 20 }}>
            <div className="form-grid" style={{ marginBottom: 0 }}>
              <div className="field">
                <label>Protected resource</label>
                <select value={payPath} onChange={(e) => setPayPath(e.target.value)}>
                  {RESOURCES.map((r) => (
                    <option key={r.path} value={r.path}>
                      {r.label} · {r.price} tNIGHT
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ justifyContent: 'flex-end' }}>
                <label>&nbsp;</label>
                <button className="btn btn-primary" onClick={() => void pay()} disabled={busy || !agent?.registered}>
                  Request &amp; pay
                </button>
              </div>
            </div>
            {resourceResult?.ok && (
              <pre
                className="mono"
                style={{
                  background: 'var(--surface-2)',
                  padding: 14,
                  borderRadius: 10,
                  marginTop: 16,
                  overflowX: 'auto',
                  color: 'var(--success)',
                }}
              >
                {JSON.stringify(resourceResult.resource, null, 2)}
              </pre>
            )}
          </div>
        </section>

        {/* ── Register form ── */}
        {showRegister && (
          <section className="section">
            <div className="section-head">
              <h2 className="section-title">Register agent</h2>
            </div>
            <div className="table-card" style={{ padding: 20 }}>
              <div className="form-grid">
                <div className="field">
                  <label>Daily limit (tNIGHT)</label>
                  <input value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} />
                </div>
                <div className="field">
                  <label>Per-payment cap (tNIGHT)</label>
                  <input value={perPaymentLimit} onChange={(e) => setPerPaymentLimit(e.target.value)} />
                </div>
              </div>
              <div className="agent-actions">
                <button className="btn btn-primary btn-sm" onClick={() => void register()} disabled={busy}>
                  Register on-chain
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowRegister(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ── Deposit form ── */}
        {showDeposit && (
          <section className="section">
            <div className="section-head">
              <h2 className="section-title">Deposit funds</h2>
            </div>
            <div className="table-card" style={{ padding: 20 }}>
              <div className="form-grid">
                <div className="field">
                  <label>Amount (tNIGHT)</label>
                  <input value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} />
                </div>
              </div>
              <div className="agent-actions">
                <button className="btn btn-primary btn-sm" onClick={() => void deposit()} disabled={busy}>
                  Deposit on-chain
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowDeposit(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ── Recent activity ── */}
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Recent activity</h2>
          </div>
          <div className="table-card">
            {payments.length === 0 ? (
              <div className="empty-state">No payments yet — pay a service above to see it appear here.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Amount</th>
                    <th>Recipient</th>
                    <th>Tx hash</th>
                    <th>Time</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.txId}>
                      <td className="mono">{shortHash(p.invoiceId, 14, 4)}</td>
                      <td className="mono">{p.amount} tNIGHT</td>
                      <td>{p.recipient}</td>
                      <td className="mono">{shortHash(p.txId, 10, 6)}</td>
                      <td>{p.time}</td>
                      <td>
                        <span className="chip chip-success">Settled</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>

      <footer className="footer">
        Shade402 · Midnight Buildathon Wave 1 · Contract{' '}
        {health?.contractAddress ? shortHash(health.contractAddress, 10, 8) : 'not deployed'}
      </footer>
    </div>
  );
}

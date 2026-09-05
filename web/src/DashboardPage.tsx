import { useState, useEffect, useCallback } from 'react';
import type { AgentInfo, HealthInfo, PayResult, MockResourceResult } from './api';
import { api, shortHash, setApiToken, getApiToken } from './api';
import { useWallet } from './WalletContext';
import ConnectWallet from './ConnectWallet';

const RESOURCES = [
  { path: '/api/data/flight-prices', label: 'Flight prices', price: '15' },
  { path: '/api/data/market-data', label: 'Market data', price: '20' },
  { path: '/api/data/ai-inference', label: 'AI inference', price: '30' },
];

export default function DashboardPage() {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [walletInfo, setWalletInfo] = useState<{ depositRecipient: string; tokenType: string } | null>(null);
  const [authed, setAuthed] = useState<boolean>(() => getApiToken() !== '');
  const [tokenInput, setTokenInput] = useState('');
  const [depositMsg, setDepositMsg] = useState<string | null>(null);
  const [payments, setPayments] = useState<
    { invoiceId: string; txId: string; amount: string; recipient: string; time: string }[]
  >([]);
  const [showRegister, setShowRegister] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);

  const [dailyLimit, setDailyLimit] = useState('1000');
  const [perPaymentLimit, setPerPaymentLimit] = useState('200');
  const [depositAmount, setDepositAmount] = useState('100');
  const [payPath, setPayPath] = useState(RESOURCES[0].path);
  const [resourceResult, setResourceResult] = useState<MockResourceResult | null>(null);

  const { connected, api: walletApi, refresh: refreshWallet } = useWallet();

  const refresh = useCallback(async () => {
    try {
      const [h, a, w] = await Promise.all([
        api<HealthInfo>('/api/health'),
        api<AgentInfo>('/api/agent'),
        api<{ depositRecipient: string; tokenType: string }>('/api/wallet'),
      ]);
      setHealth(h);
      setAgent(a);
      setWalletInfo(w);
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
    if (!walletApi || !walletInfo) {
      setError('Connect your wallet and ensure the backend is reachable first.');
      return;
    }
    setBusy(true);
    setError(null);
    setDepositMsg(null);
    try {
      const amount = BigInt(depositAmount);
      if (amount <= 0n) throw new Error('Amount must be positive');

      // STEP 1 — REAL USER-SIGNED TRANSACTION: Lace builds, balances, and
      // submits a transfer of tNIGHT to the Shade402 recipient wallet. The
      // user approves it in their wallet.
      setDepositMsg('Step 1/2 — approve the deposit in your wallet (Lace)…');
      const { tx } = await walletApi.makeTransfer([
        {
          kind: 'unshielded',
          type: walletInfo.tokenType,
          value: amount,
          recipient: walletInfo.depositRecipient,
        },
      ]);
      await walletApi.submitTransaction(tx);

      // STEP 2 — credit the agent balance. The recipient wallet runs its own
      // deposit circuit so the agent's on-chain balance increases.
      setDepositMsg('Step 2/2 — crediting agent balance on-chain…');
      await api('/api/agent/deposit', {
        method: 'POST',
        body: JSON.stringify({ amount: depositAmount }),
      });
      setDepositMsg('Deposit complete.');
      await refreshWallet();
      setShowDeposit(false);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
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
          amount: result.amount,
          recipient: 'midnight provider',
          time: new Date().toLocaleTimeString(),
        },
        ...prev,
      ]);
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
    <main className="main">
      {!connected && <ConnectWallet />}

      {connected && (
        <>
      {!authed && (
        <div className="table-card" style={{ padding: 24, marginBottom: 24 }}>
          <h2 className="section-title" style={{ marginBottom: 8 }}>
            Backend access token
          </h2>
          <p className="page-subtitle" style={{ marginBottom: 16 }}>
            Shade402's payment service is protected by a token printed in the
            backend console. Paste it once so the app can drive agent payments.
          </p>
          <div className="form-grid">
            <div className="field">
              <label>API token</label>
              <input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Paste token from server console"
              />
            </div>
            <div className="field" style={{ justifyContent: 'flex-end' }}>
              <label>&nbsp;</label>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setApiToken(tokenInput);
                  setAuthed(tokenInput.trim() !== '');
                }}
              >
                Save token
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="error-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          {error}
        </div>
      )}
      {busy && (
        <div className="busy-banner">
          <span className="spinner" />
          Submitting on-chain transaction — this can take 30–60 seconds.
        </div>
      )}

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

      {depositMsg && (
        <div className="busy-banner" style={{ marginTop: -16, marginBottom: 24 }}>
          <span className="spinner" />
          {depositMsg}
        </div>
      )}

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

      {showDeposit && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Deposit funds</h2>
          </div>
          <div className="table-card" style={{ padding: 20 }}>
            <p className="page-subtitle" style={{ marginBottom: 16 }}>
              You approve this in your wallet. Shade402 then credits the amount
              to your agent's private spending account on-chain.
            </p>
            <div className="form-grid">
              <div className="field">
                <label>Amount (tNIGHT)</label>
                <input value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} />
              </div>
            </div>
            <div className="agent-actions">
              <button className="btn btn-primary btn-sm" onClick={() => void deposit()} disabled={busy}>
                Sign &amp; deposit in wallet
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowDeposit(false)}>
                Cancel
              </button>
            </div>
          </div>
        </section>
      )}

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
        </>
      )}
    </main>
  );
}

import { useState, useEffect, useCallback } from 'react';
import type { AgentInfo, HealthInfo, PayResult, MockResourceResult } from './api';
import { api, shortHash, setApiToken, getApiToken, explorerContractUrl, type TxInfo } from './api';
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
  const [tx, setTx] = useState<{ loading: boolean; error: string | null; info: TxInfo | null } | null>(
    null,
  );

  // Demo mode: drive the live contract through the backend's custodian wallet,
  // so the whole flow works in the browser without Lace. The backend is the
  // deployer and already funds the contract, so register/deposit/pay all run
  // server-side. Lace only becomes involved if the user opts into it.
  const [demoMode, setDemoMode] = useState<boolean>(
    () => window.localStorage.getItem('shade402-demo-mode') === '1',
  );

  const { connected, api: walletApi, refresh: refreshWallet } = useWallet();
  const active = demoMode || connected;
  const isDemo = demoMode && !connected;

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
    if (!active) {
      setError('Connect your wallet or enter demo mode first.');
      return;
    }
    setBusy(true);
    setError(null);
    setDepositMsg(null);
    try {
      const amount = BigInt(depositAmount);
      if (amount <= 0n) throw new Error('Amount must be positive');

      if (demoMode) {
        // Demo mode — the backend's custodian wallet funds the deposit, so no
        // Lace signature is needed. The deposit circuit still runs on-chain.
        setDepositMsg('Depositing from the demo custodian wallet on-chain…');
        await api('/api/agent/deposit', {
          method: 'POST',
          body: JSON.stringify({ amount: depositAmount }),
        });
        setDepositMsg('Deposit complete.');
        setShowDeposit(false);
        return;
      }

      if (!walletApi || !walletInfo) {
        throw new Error('Wallet not ready — reconnect and retry.');
      }

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

  // On-chain verification for a settlement, read from the indexer (the
  // community explorer doesn't index Preview transactions yet).
  function openTx(id: string) {
    setTx({ loading: true, error: null, info: null });
    api<TxInfo>(`/api/tx/${id}`)
      .then((info) => setTx({ loading: false, error: null, info }))
      .catch((e: any) => setTx({ loading: false, error: e?.message ?? String(e), info: null }));
  }

  const spent = agent?.spentInPeriod ? Number(agent.spentInPeriod) : 0;
  const limit = agent?.dailyLimit ? Number(agent.dailyLimit) : 0;
  const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
  const remaining = Math.max(0, limit - spent);
  const overLimit = limit > 0 && remaining === 0;

  // One fixed, top-left transaction notice — visible no matter where the user
  // is on the page (no scrolling up required). Shows progress while a
  // transaction is being signed/submitted, then the outcome.

  return (
    <main className="main">
      <TxToast
        error={error}
        busy={busy}
        depositMsg={depositMsg}
      />
      {!active && (
        <ConnectWallet
          onEnterDemo={() => {
            // Demo mode drives the live contract through the backend custodian
            // wallet. The pinned localhost demo token is pre-seeded so the flow
            // works with zero setup; the bearer-token auth stays enforced.
            window.localStorage.setItem('shade402-demo-mode', '1');
            if (!getApiToken()) {
              setApiToken('shade402-demo-token');
              setAuthed(true);
            }
            setDemoMode(true);
          }}
        />
      )}

      {active && (
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

      {isDemo && (
        <div className="demo-banner">
          <div className="demo-banner-head">
            <span className="chip chip-neutral">Demo mode</span>
            <span className="demo-banner-note">
              Transactions are signed by the backend&apos;s custodian wallet — no browser
              wallet needed. All actions still run on the live Midnight Preview contract.
            </span>
          </div>
          <div className="demo-banner-actions">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                window.localStorage.removeItem('shade402-demo-mode');
                setDemoMode(false);
              }}
            >
              Connect Lace instead
            </button>
          </div>
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
              {demoMode
                ? "Deposits are funded from the demo custodian wallet. The deposit runs as a real on-chain transaction on Midnight Preview."
                : "You approve this in your wallet. Shade402 then credits the amount to your agent's private spending account on-chain."}
            </p>
            <div className="form-grid">
              <div className="field">
                <label>Amount (tNIGHT)</label>
                <input value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} />
              </div>
            </div>
            <div className="agent-actions">
              <button className="btn btn-primary btn-sm" onClick={() => void deposit()} disabled={busy}>
                {demoMode ? "Deposit (demo custodian)" : "Sign & deposit in wallet"}
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
                    <td className="mono">
                      <button className="tx-link" onClick={() => openTx(p.txId)}>
                        {shortHash(p.txId, 10, 6)}
                      </button>
                    </td>
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

      {tx && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setTx(null)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2 className="modal-title">On-chain verification</h2>
              <button className="modal-close" onClick={() => setTx(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              {tx.loading && (
                <div className="modal-loading">
                  <span className="spinner" /> Reading the Midnight indexer…
                </div>
              )}
              {tx.error && <p className="modal-error">{tx.error}</p>}
              {tx.info && (
                <>
                  <div className="modal-row">
                    <span>Status</span>
                    <span className="chip chip-success">Confirmed</span>
                  </div>
                  <div className="modal-row">
                    <span>Network</span>
                    <span>{tx.info.network}</span>
                  </div>
                  <div className="modal-row">
                    <span>Block</span>
                    <span className="mono">#{tx.info.blockHeight ?? '—'}</span>
                  </div>
                  <div className="modal-row">
                    <span>Time</span>
                    <span>
                      {tx.info.timestamp ? new Date(tx.info.timestamp).toLocaleString() : '—'}
                    </span>
                  </div>
                  <div className="modal-row">
                    <span>Tx hash</span>
                    <span className="mono modal-break">{tx.info.hash}</span>
                  </div>
                  {tx.info.contractActions.length > 0 && (
                    <div className="modal-row">
                      <span>Contract</span>
                      <span className="mono modal-break">
                        {shortHash(tx.info.contractActions[0], 12, 8)}
                      </span>
                    </div>
                  )}
                  <div className="modal-actions">
                    {health?.contractAddress && (
                      <a
                        className="btn btn-secondary btn-sm"
                        href={explorerContractUrl(health.contractAddress, health?.network)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open contract on explorer ↗
                      </a>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function TxToast({
  error,
  busy,
  depositMsg,
}: {
  error: string | null;
  busy: boolean;
  depositMsg: string | null;
}) {
  // Auto-dismiss a settled/error notice so the corner doesn't linger.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!busy) {
      const t = window.setTimeout(() => setDismissed(true), 8000);
      return () => window.clearTimeout(t);
    }
    setDismissed(false);
  }, [busy, error, depositMsg]);

  const success = !busy && depositMsg === 'Deposit complete.';
  if (dismissed || (!error && !busy && !depositMsg)) return null;

  const message =
    error ?? depositMsg ?? 'Submitting on-chain transaction — this can take 30–60 seconds.';

  return (
    <div
      className={`tx-toast ${error ? 'err' : success ? 'ok' : 'busy'}`}
      role="status"
      aria-live="polite"
    >
      {error ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      ) : success ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <span className="spinner" />
      )}
      <span>{message}</span>
    </div>
  );
}

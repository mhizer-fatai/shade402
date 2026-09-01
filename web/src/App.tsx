import { useState, useEffect, useCallback } from 'react';
import type { AgentInfo, HealthInfo, PayResult, MockResourceResult } from './api';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const json = await res.json();
  if (!res.ok) throw new Error((json as any).error ?? `Request failed: ${res.status}`);
  return json as T;
}

export default function App() {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [dailyLimit, setDailyLimit] = useState('1000');
  const [perPaymentLimit, setPerPaymentLimit] = useState('100');
  const [depositAmount, setDepositAmount] = useState('100');

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
  }

  async function deposit() {
    await run(() =>
      api('/api/agent/deposit', {
        method: 'POST',
        body: JSON.stringify({ amount: depositAmount }),
      }),
    );
  }

  const [payPath, setPayPath] = useState('/api/data/flight-prices');
  const [lastPay, setLastPay] = useState<PayResult | null>(null);
  const [mockResult, setMockResult] = useState<MockResourceResult | null>(null);

  async function pay() {
    await run(async () => {
      const result = await api<PayResult>('/api/pay', {
        method: 'POST',
        body: JSON.stringify({ resourcePath: payPath }),
      });
      setLastPay(result);
    });
  }

  async function fetchResource() {
    await run(async () => {
      if (!lastPay) throw new Error('Pay for a resource first');
      const result = await api<MockResourceResult>(
        `/api/mock/resource?path=${encodeURIComponent(payPath)}&receipt=${encodeURIComponent(lastPay.receipt)}&invoiceId=${encodeURIComponent(lastPay.invoiceId)}`,
      );
      setMockResult(result);
    });
  }

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>🌑 Shade402</h1>
      <p><strong>Private, rule-controlled payments for AI agents on Midnight.</strong></p>
      <p>The agent's balance and spending policy stay hidden; the Shade402 contract is the visible payer.</p>

      {health && (
        <p>
          Network: <code>{health.network}</code> · Contract:{' '}
          <code>{health.contractAddress ?? 'not deployed'}</code>
        </p>
      )}
      {error && <p style={{ color: '#c00', background: '#fee', padding: 8 }}>{error}</p>}
      {busy && <p>⏳ Processing on-chain transaction (can take 30-60s)...</p>}

      <section style={{ border: '1px solid #ccc', borderRadius: 8, padding: 16, margin: '16px 0' }}>
        <h2>Agent policy</h2>
        {agent && agent.registered ? (
          <ul>
            <li>Balance: <strong>{agent.balance}</strong></li>
            <li>Daily limit: <strong>{agent.dailyLimit}</strong></li>
            <li>Spent this period: <strong>{agent.spentInPeriod}</strong></li>
            <li>Per-payment limit: <strong>{agent.perPaymentLimit}</strong></li>
            <li>Period ends: <strong>{agent.periodEndsAt ? new Date(Number(agent.periodEndsAt) * 1000).toISOString() : ''}</strong></li>
            <li>Agent key: <code>{agent.agentKey.slice(0, 24)}…</code></li>
          </ul>
        ) : (
          <p>Agent not registered yet.</p>
        )}
      </section>

      <section style={{ border: '1px solid #ccc', borderRadius: 8, padding: 16, margin: '16px 0' }}>
        <h2>Register agent</h2>
        <label>Daily limit: <input value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} /></label>
        <br />
        <label>Per-payment limit: <input value={perPaymentLimit} onChange={(e) => setPerPaymentLimit(e.target.value)} /></label>
        <br />
        <button onClick={() => void register()} disabled={busy}>Register</button>
      </section>

      <section style={{ border: '1px solid #ccc', borderRadius: 8, padding: 16, margin: '16px 0' }}>
        <h2>Deposit funds</h2>
        <label>Amount: <input value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} /></label>
        <br />
        <button onClick={() => void deposit()} disabled={busy}>Deposit</button>
      </section>

      <section style={{ border: '1px solid #ccc', borderRadius: 8, padding: 16, margin: '16px 0' }}>
        <h2>Pay an x402 service</h2>
        <label>
          Resource:{' '}
          <select value={payPath} onChange={(e) => setPayPath(e.target.value)}>
            <option value="/api/data/flight-prices">Flight prices (15)</option>
            <option value="/api/data/market-data">Market data (20)</option>
            <option value="/api/data/ai-inference">AI inference (30)</option>
          </select>
        </label>
        <br />
        <button onClick={() => void pay()} disabled={busy}>Pay with Shade402</button>
        <button onClick={() => void fetchResource()} disabled={busy || !lastPay}>Fetch resource</button>

        {lastPay && (
          <div style={{ marginTop: 12 }}>
            <p>✅ Paid — invoice {lastPay.invoiceId}</p>
            <p><code>txId: {lastPay.txId}</code></p>
            <p><code>invoiceHash: {lastPay.invoiceHash}</code></p>
          </div>
        )}
        {mockResult && <pre>{JSON.stringify(mockResult, null, 2)}</pre>}
      </section>
    </main>
  );
}

import { useEffect, useState } from 'react';
import { useWallet } from './WalletContext';
import { shortHash } from './api';

export default function ConnectWallet() {
  const { installed, wallets, connected, connecting, error, walletName, snapshot, network, connect, disconnect } =
    useWallet();
  const [selected, setSelected] = useState<string | null>(null);

  // Auto-select the first available wallet so Connect is one click.
  useEffect(() => {
    if (!selected && wallets.length > 0) {
      setSelected(wallets[0].rdns);
    }
  }, [wallets, selected]);

  const channelError = error && /shutdown|channel|no longer be used/i.test(error);

  return (
    <div className="connect-wallet">
      {!installed ? (
        <div className="table-card" style={{ padding: 32, textAlign: 'center' }}>
          <h2 className="section-title" style={{ marginBottom: 12 }}>
            No Midnight wallet detected
          </h2>
          <p className="page-subtitle" style={{ marginBottom: 20, marginLeft: 'auto', marginRight: 'auto' }}>
            Install the Lace wallet extension to connect and fund your agents. After
            installing, refresh this page.
          </p>
          <a
            className="btn btn-primary"
            href="https://docs.midnight.network/getting-started/installation"
            target="_blank"
            rel="noreferrer"
          >
            Install Lace
          </a>
        </div>
      ) : connected && walletName ? (
        <div className="connected-bar">
          <div className="connected-info">
            <span className="dot" />
            <span className="mono">{snapshot?.unshieldedAddress ? shortHash(snapshot.unshieldedAddress, 12, 8) : 'Connected'}</span>
            <span className="chip chip-neutral">{network === 'preview' ? 'Preview' : network}</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={disconnect}>
            Disconnect
          </button>
        </div>
      ) : (
        <div className="table-card" style={{ padding: 28 }}>
          <h2 className="section-title" style={{ marginBottom: 6 }}>
            Connect your wallet
          </h2>
          <p className="page-subtitle" style={{ marginBottom: 18 }}>
            Connect to fund your agents. You will approve a real transaction in your
            wallet when you deposit.
          </p>

          {error && (
            <div className="error-banner" style={{ marginBottom: 14 }}>
              {error}
              {channelError && (
                <div className="wallet-hint">
                  Lace ended the connection. This usually means it is still syncing to
                  Midnight Preview, or a stale session needs clearing.
                </div>
              )}
            </div>
          )}

          {channelError && (
            <div className="table-card" style={{ padding: 16, marginBottom: 16, background: 'var(--surface-2)' }}>
              <h3 className="feature-title" style={{ marginBottom: 8 }}>
                Try these first
              </h3>
              <ol className="wallet-steps">
                <li>Open the Lace extension and confirm the network is <strong>Midnight Preview</strong>.</li>
                <li>Let Lace finish syncing (you may see it catch up in the extension).</li>
                <li>If it's synced, click Disconnect, then Connect again.</li>
                <li>Still failing? Reload this page, then click Connect — this clears the stale session.</li>
              </ol>
            </div>
          )}

          <div className="wallet-list">
            {wallets.map((w) => {
              const isSelected = selected === w.rdns;
              return (
                <button
                  key={w.rdns}
                  className={`wallet-option ${isSelected ? 'active' : ''}`}
                  onClick={() => setSelected(w.rdns)}
                >
                  {w.icon ? <img src={w.icon} alt="" className="wallet-icon" /> : <div className="wallet-icon" />}
                  <span className="wallet-option-name">{w.name}</span>
                  {isSelected && <span className="chip chip-success">Selected</span>}
                </button>
              );
            })}
          </div>

          <div className="agent-actions" style={{ marginTop: 18 }}>
            <button
              className="btn btn-primary"
              disabled={!selected || connecting}
              onClick={() => selected && void connect(selected)}
            >
              {connecting ? 'Waiting for Lace… (check the extension for a prompt)' : 'Connect to Preview'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

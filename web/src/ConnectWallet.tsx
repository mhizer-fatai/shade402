import { useState } from 'react';
import { useWallet } from './WalletContext';
import { shortHash } from './api';

export default function ConnectWallet() {
  const { installed, wallets, connected, connecting, error, walletName, snapshot, network, connect, disconnect } =
    useWallet();
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

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
              {connecting ? 'Connecting…' : 'Connect to Preview'}
            </button>
            {expanded && (
              <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(false)}>
                Hide details
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

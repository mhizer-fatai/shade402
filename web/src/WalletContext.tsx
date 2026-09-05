import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import {
  listWallets,
  connectWallet,
  getWalletSnapshot,
  checkNetwork,
  isWalletInstalled,
  type MidnightWalletInfo,
  type WalletSnapshot,
} from './midnightWallet';

interface WalletContextValue {
  installed: boolean;
  wallets: MidnightWalletInfo[];
  connected: boolean;
  connecting: boolean;
  error: string | null;
  walletName: string | null;
  snapshot: WalletSnapshot | null;
  network: string | null;
  api: ConnectedAPI | null;
  connect: (rdns: string) => Promise<boolean>;
  disconnect: () => void;
  refresh: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<MidnightWalletInfo[]>([]);
  const [installed, setInstalled] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<WalletSnapshot | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [api, setApi] = useState<ConnectedAPI | null>(null);

  useEffect(() => {
    const update = () => {
      const list = listWallets();
      setWallets(list);
      setInstalled(isWalletInstalled());
    };
    update();
    // Re-check when the extension injects late (after page load).
    const t = window.setInterval(update, 1000);
    return () => window.clearInterval(t);
  }, []);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const snap = await getWalletSnapshot(api);
      setSnapshot(snap);
      const net = await checkNetwork(api);
      setNetwork(net);
      setConnected(net === 'preview');
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const connect = useCallback(
    async (rdns: string): Promise<boolean> => {
      setConnecting(true);
      setError(null);
      try {
        const connectedApi = await connectWallet(rdns);
        setApi(connectedApi);
        setWalletName(rdns);
        return true;
      } catch (e: any) {
        setError(e?.message ?? String(e));
        return false;
      } finally {
        setConnecting(false);
      }
    },
    [],
  );

  const disconnect = useCallback(() => {
    setApi(null);
    setConnected(false);
    setSnapshot(null);
    setNetwork(null);
    setWalletName(null);
    setError(null);
  }, []);

  return (
      <WalletContext.Provider
        value={{
          installed,
          wallets,
          connected,
          connecting,
          error,
          walletName,
          snapshot,
          network,
          api,
          connect,
          disconnect,
          refresh,
        }}
      >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}

import type {
  InitialAPI,
  ConnectedAPI,
} from '@midnight-ntwrk/dapp-connector-api';

export interface MidnightWalletInfo {
  rdns: string;
  name: string;
  icon: string;
  apiVersion: string;
}

declare global {
  interface Window {
    midnight?: Record<string, InitialAPI>;
  }
}

export const NETWORK_ID = 'preview';

/** List wallets injected into window.midnight (each under a UUID key). */
export function listWallets(): MidnightWalletInfo[] {
  const injected = window.midnight;
  if (!injected) return [];
  return Object.entries(injected).map(([key, api]) => ({
    rdns: api.rdns || key,
    name: api.name || key,
    icon: api.icon,
    apiVersion: api.apiVersion,
  }));
}

export function isWalletInstalled(): boolean {
  return !!window.midnight && Object.keys(window.midnight).length > 0;
}

/** Connect to a specific wallet by its rdns/name and return the ConnectedAPI. */
export async function connectWallet(
  targetRdns: string,
  networkId: string = NETWORK_ID,
): Promise<ConnectedAPI> {
  const injected = window.midnight;
  if (!injected) {
    throw new Error('No Midnight wallet found. Install Lace and refresh.');
  }
  const entry = Object.entries(injected).find(
    ([, api]) => api.rdns === targetRdns || api.name === targetRdns,
  );
  if (!entry) {
    throw new Error(`Wallet "${targetRdns}" not found.`);
  }
  const api = entry[1];

  // Never hang forever on wallets that ignore the connect request: time out
  // after 90s with a clear error.
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () =>
        reject(
          new Error(
            'Wallet did not answer. Check the Lace extension for a pending approval request, and confirm it is on the Midnight Preview network.',
          ),
        ),
      90_000,
    );
  });

  try {
    const connected = await Promise.race([api.connect(networkId), timeout]);
    const status = await connected.getConnectionStatus();
    if (status.status !== 'connected') {
      throw new Error('Wallet connection was not established.');
    }
    if (status.networkId !== networkId) {
      throw new Error(
        `Connected to ${status.networkId}, but this app needs ${networkId}. Switch networks in Lace and retry.`,
      );
    }
    return connected;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export interface WalletSnapshot {
  unshieldedAddress: string;
  unshieldedBalances: Record<string, bigint>;
  dustBalance: { cap: bigint; balance: bigint };
}

/** Read the wallet's addresses and balances. */
export async function getWalletSnapshot(api: ConnectedAPI): Promise<WalletSnapshot> {
  const [{ unshieldedAddress }, unshieldedBalances, dustBalance] = await Promise.all([
    api.getUnshieldedAddress(),
    api.getUnshieldedBalances(),
    api.getDustBalance(),
  ]);
  return { unshieldedAddress, unshieldedBalances, dustBalance };
}

/** True if the connected network matches what the app expects. */
export async function checkNetwork(api: ConnectedAPI): Promise<string> {
  const status = await api.getConnectionStatus();
  return status.status === 'connected' ? status.networkId : 'disconnected';
}

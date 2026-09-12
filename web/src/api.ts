export interface AgentInfo {
  registered: boolean;
  agentKey: string;
  balance?: string;
  dailyLimit?: string;
  spentInPeriod?: string;
  periodEndsAt?: string;
  perPaymentLimit?: string;
}

export interface HealthInfo {
  ok: boolean;
  network: string;
  contractAddress: string | null;
}

export interface StatsInfo {
  network: string;
  contractAddress: string;
  registeredAgents: string;
  totalDeposited: string;
  totalSettled: string;
  invoicesSettled: string;
  lastSettledInvoice: string;
}

export interface PayResult {
  ok: boolean;
  invoiceId: string;
  txId: string;
  amount: string;
  blockHeight: string;
  invoiceHash: string;
  receipt: string;
}

export interface TxInfo {
  ok: boolean;
  network: string;
  identifier: string;
  id: number;
  hash: string;
  protocolVersion: number;
  blockHeight: number | null;
  timestamp: number | null;
  contractActions: string[];
}

export interface MockResourceResult {
  ok: boolean;
  resource?: unknown;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = window.localStorage.getItem('shade402-api-token') ?? '';
  const res = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...init,
  });
  const json = await res.json();
  if (!res.ok) throw new Error((json as any).error ?? `Request failed: ${res.status}`);
  return json as T;
}

export function setApiToken(token: string) {
  window.localStorage.setItem('shade402-api-token', token.trim());
}

export function getApiToken(): string {
  return window.localStorage.getItem('shade402-api-token') ?? '';
}

export function shortHash(hash: string, head = 10, tail = 6): string {
  if (!hash) return '—';
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

// Community Midnight Explorer (Tech-Expansion/TexLabs). Host is chosen per
// network; override entirely with VITE_EXPLORER_URL.
const EXPLORER_OVERRIDE = ((import.meta as any).env?.VITE_EXPLORER_URL as string | undefined)?.replace(
  /\/+$/,
  '',
);
const EXPLORER_HOSTS: Record<string, string> = {
  preview: 'https://preview.midnightexplorer.com',
  preprod: 'https://preprod.midnightexplorer.com',
};

function explorerBase(network?: string | null): string {
  if (EXPLORER_OVERRIDE) return EXPLORER_OVERRIDE;
  return EXPLORER_HOSTS[network ?? ''] ?? EXPLORER_HOSTS.preview;
}

export function explorerTxUrl(hash: string, network?: string | null): string {
  return `${explorerBase(network)}/tx/${hash}`;
}

export function explorerContractUrl(address: string, network?: string | null): string {
  return `${explorerBase(network)}/contracts/${address}`;
}

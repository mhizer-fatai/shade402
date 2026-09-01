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

export interface PayResult {
  ok: boolean;
  invoiceId: string;
  txId: string;
  blockHeight: string;
  invoiceHash: string;
  receipt: string;
}

export interface MockResourceResult {
  ok: boolean;
  resource?: unknown;
}

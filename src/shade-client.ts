import * as crypto from 'node:crypto';
import { persistentHash, CompactTypeBytes, CompactTypeVector } from '@midnight-ntwrk/compact-runtime';

// Must match the contract's `persistentHash<Vector<2, Bytes<32>>>` for the
// agent leaf in `shade402.compact` exactly — otherwise the JS-side leaf will
// differ from the leaf the contract stores in the Merkle tree.
//
// Built from the string (rather than hand-typed bytes) so it cannot drift:
// the contract uses pad(32, "shade402:agent-leaf:v2").
function pad32(domain: string): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set(Buffer.from(domain, 'utf8').subarray(0, 32));
  return bytes;
}

const AGENT_LEAF_PREFIX = pad32('shade402:agent-leaf:v2');

const agentLeafType = new CompactTypeVector(2, new CompactTypeBytes(32));

export interface AgentPolicy {
  balance: bigint;
  dailyLimit: bigint;
  spentInPeriod: bigint;
  periodEndsAt: bigint;
  perPaymentLimit: bigint;
}

export const EMPTY_POLICY: AgentPolicy = {
  balance: 0n,
  dailyLimit: 0n,
  spentInPeriod: 0n,
  periodEndsAt: 0n,
  perPaymentLimit: 0n,
};

/**
 * Build a v2 private state. `ownerSecret` defaults to `agentSecret` (the
 * single-custodian demo uses one seed for both roles); callers that want a
 * distinct owner may pass it explicitly.
 */
export function makePrivateState(
  agentSecret: Uint8Array,
  policy: Partial<AgentPolicy> = {},
  ownerSecret: Uint8Array = agentSecret,
): ShadePrivateState {
  return { ownerSecret, agentSecret, policy: { ...EMPTY_POLICY, ...policy } };
}

/**
 * Private state held by the custodian (never on-chain).
 *
 * v2: per-agent balance and policy live here, threaded through witnesses so
 * the circuit can enforce policy in-ZK without any of it touching the public
 * ledger. `ownerSecret` and `agentSecret` are distinct so the owner authority
 * is separate from the paying agent's identity.
 */
export interface ShadePrivateState {
  ownerSecret: Uint8Array;
  agentSecret: Uint8Array;
  policy: AgentPolicy;
}

export interface InvoiceChallenge {
  invoiceId: string;
  recipientAddress: string;
  amount: bigint;
  expiresAt: number;
}

export interface PaymentPayload {
  recipient: Uint8Array;
  invoiceHash: Uint8Array;
  amount: bigint;
}

export class Shade402Client {
  private state: ShadePrivateState;

  constructor(
    agentSecret: Uint8Array,
    policy: Partial<AgentPolicy> = {},
    ownerSecret: Uint8Array = agentSecret,
  ) {    this.state = {
      ownerSecret,
      agentSecret,
      policy: {
        balance: 0n,
        dailyLimit: 0n,
        spentInPeriod: 0n,
        periodEndsAt: 0n,
        perPaymentLimit: 0n,
        ...policy,
      },
    };
  }

  public getSecret(): Uint8Array {
    return this.state.agentSecret;
  }

  public getPolicy(): AgentPolicy {
    return { ...this.state.policy };
  }

  public setPolicy(policy: Partial<AgentPolicy>): void {
    this.state.policy = { ...this.state.policy, ...policy };
  }

  /** The 32-byte Merkle leaf (identity commitment) for this agent. */
  public static agentLeaf(agentSecret: Uint8Array): Uint8Array {
    return persistentHash(agentLeafType as any, [AGENT_LEAF_PREFIX, agentSecret]);
  }

  public getAgentLeaf(): Uint8Array {
    return Shade402Client.agentLeaf(this.state.agentSecret);
  }

  /**
   * Build the witness set the compact runtime calls during proof generation.
   *
   * The generated contract API (v2) declares these witnesses:
   *   localSecret, agentSecret, agentPath, policyBalance, policyDailyLimit,
   *   policySpentInPeriod, policyPerPaymentLimit
   *
   * - localSecret: the deployer's secret (owner authority).
   * - agentSecret / agentLeaf: the paying agent's identity.
   * - agentPath: read from the *projected ledger state* available in the
   *   witness context. The HistoricMerkleTree exposes findPathForLeaf; we
   *   return the private inclusion path so the circuit can recompute the root
   *   and prove membership without the path ever going on-chain.
   * - policy*: the agent's private balance/limits, read from this.state.policy.
   */
  public getWitnesses() {
    return {
      localSecret: (_context: any): [ShadePrivateState, Uint8Array] => {
        return [this.state, this.state.ownerSecret];
      },
      agentSecret: (_context: any): [ShadePrivateState, Uint8Array] => {
        return [this.state, this.state.agentSecret];
      },
      agentPath: (context: any): [ShadePrivateState, unknown] => {
        const leaf = this.getAgentLeaf();
        const agents = context?.ledger?.agents;
        if (!agents || typeof agents.findPathForLeaf !== 'function') {
          throw new Error('agentPath witness: ledger does not expose findPathForLeaf');
        }
        const path = agents.findPathForLeaf(leaf);
        if (!path) {
          throw new Error('Agent is not registered: no Merkle path for this agent leaf');
        }
        return [this.state, path];
      },
      policyBalance: (context: any): [ShadePrivateState, bigint] => {
        return [this.state, this.state.policy.balance];
      },
      policyDailyLimit: (context: any): [ShadePrivateState, bigint] => {
        return [this.state, this.state.policy.dailyLimit];
      },
      policySpentInPeriod: (context: any): [ShadePrivateState, bigint] => {
        return [this.state, this.state.policy.spentInPeriod];
      },
      policyPerPaymentLimit: (context: any): [ShadePrivateState, bigint] => {
        return [this.state, this.state.policy.perPaymentLimit];
      },
    };
  }

  public static invoiceHash(challenge: InvoiceChallenge): Uint8Array {
    return new Uint8Array(
      crypto.createHash('sha256')
        .update(
          `${challenge.invoiceId}:${challenge.recipientAddress}:${challenge.amount.toString()}:${challenge.expiresAt.toString()}`,
        )
        .digest(),
    );
  }

  public static recipientHash(recipientAddress: string): Uint8Array {
    return new Uint8Array(crypto.createHash('sha256').update(recipientAddress).digest());
  }

  public buildPaymentPayload(challenge: InvoiceChallenge): PaymentPayload {
    if (challenge.amount <= 0n) {
      throw new Error('Payment amount must be positive');
    }
    if (challenge.expiresAt <= Date.now()) {
      throw new Error('Invoice has expired');
    }
    return {
      recipient: Shade402Client.recipientHash(challenge.recipientAddress),
      invoiceHash: Shade402Client.invoiceHash(challenge),
      amount: challenge.amount,
    };
  }
}

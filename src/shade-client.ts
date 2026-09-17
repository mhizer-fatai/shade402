import * as crypto from 'node:crypto';
import {
  persistentHash,
  CompactTypeBytes,
  CompactTypeVector,
  CompactTypeUnsignedInteger,
} from '@midnight-ntwrk/compact-runtime';

// ─── Domain separators ───────────────────────────────────────────────────────
//
// These must match the contract exactly. The contract uses `pad(32, "<domain>")`
// (which only accepts string literals), so the JS side derives the same bytes
// from the same string and cannot silently drift.
function pad32(domain: string): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set(Buffer.from(domain, 'utf8').subarray(0, 32));
  return bytes;
}

const AGENT_LEAF_PREFIX = pad32('shade402:agent-leaf:v2');
const NOTE_PREFIX = pad32('shade402:policy-note:v3');
const NULLIFIER_PREFIX = pad32('shade402:note-nullifier:v3');

// ─── Runtime type descriptors (must mirror the Compact types) ────────────────

const bytes32Type = new CompactTypeBytes(32);
const uint64Type = new CompactTypeUnsignedInteger(18446744073709551615n, 8);

const agentLeafType = new CompactTypeVector(2, bytes32Type);
const noteFieldsType = new CompactTypeVector(5, uint64Type);
const noteCommitType = new CompactTypeVector(4, bytes32Type);
const nullifierType = new CompactTypeVector(3, bytes32Type);

// ─── Policy note (v3) ────────────────────────────────────────────────────────

/**
 * The five numeric fields the contract hashes together before binding them to
 * the domain, the agent secret and the nonce.
 */
export interface NoteFields {
  balance: bigint;
  spentInPeriod: bigint;
  dailyLimit: bigint;
  perPaymentLimit: bigint;
  periodEndsAt: bigint;
}

/**
 * v3 policy: the note fields plus the note's nonce. The nonce is private
 * randomness that makes each note unique; it is supplied to the circuit by the
 * `nextNonce` witness and remembered here so the client can find its note again.
 */
export interface AgentPolicy extends NoteFields {
  nonce: Uint8Array;
}

export function emptyPolicy(): AgentPolicy {
  return {
    balance: 0n,
    spentInPeriod: 0n,
    dailyLimit: 0n,
    perPaymentLimit: 0n,
    periodEndsAt: 0n,
    nonce: new Uint8Array(crypto.randomBytes(32)),
  };
}

export const EMPTY_POLICY: AgentPolicy = emptyPolicy();

/**
 * Build a v3 private state. `ownerSecret` defaults to `agentSecret` (the
 * single-custodian demo uses one seed for both roles); callers that want a
 * distinct owner may pass it explicitly.
 */
export function makePrivateState(
  agentSecret: Uint8Array,
  policy: Partial<AgentPolicy> = {},
  ownerSecret: Uint8Array = agentSecret,
): ShadePrivateState {
  return { ownerSecret, agentSecret, policy: { ...emptyPolicy(), ...policy } };
}

/**
 * Private state held by the custodian (never on-chain).
 *
 * v3: balance and limits live in a committed policy note on-chain; this state
 * mirrors the *current* note (including its nonce) so the circuit can prove
 * membership of the note and consume it.
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
  /** Successor note prepared for the in-flight transaction, if any. */
  private nextNote: AgentPolicy | null = null;

  constructor(
    agentSecret: Uint8Array = new Uint8Array(crypto.randomBytes(32)),
    policy: Partial<AgentPolicy> = {},
    ownerSecret: Uint8Array = agentSecret,
  ) {
    this.state = {
      ownerSecret,
      agentSecret,
      policy: { ...emptyPolicy(), ...policy },
    };
  }

  public getSecret(): Uint8Array {
    return this.state.agentSecret;
  }

  public getPolicy(): AgentPolicy {
    return { ...this.state.policy, nonce: new Uint8Array(this.state.policy.nonce) };
  }

  public setPolicy(policy: Partial<AgentPolicy>): void {
    this.state.policy = { ...this.state.policy, ...policy };
  }

  // ── Identity commitment ────────────────────────────────────────────────────

  /** The 32-byte identity leaf for this agent. */
  public static agentLeaf(agentSecret: Uint8Array): Uint8Array {
    return persistentHash(agentLeafType as any, [AGENT_LEAF_PREFIX, agentSecret]);
  }

  public getAgentLeaf(): Uint8Array {
    return Shade402Client.agentLeaf(this.state.agentSecret);
  }

  // ── Policy note commitment ─────────────────────────────────────────────────

  /**
   * Commitment to a policy note. Mirrors the contract's `noteCommitment`:
   * the numeric fields are hashed as a Uint<64> vector, then that digest is
   * bound to the domain, the agent secret and the nonce.
   */
  public static noteCommitment(agentSecret: Uint8Array, note: NoteFields & { nonce: Uint8Array }): Uint8Array {
    const fields = persistentHash(noteFieldsType as any, [
      note.balance,
      note.spentInPeriod,
      note.dailyLimit,
      note.perPaymentLimit,
      note.periodEndsAt,
    ]) as Uint8Array;
    return persistentHash(noteCommitType as any, [
      NOTE_PREFIX,
      agentSecret,
      fields,
      note.nonce,
    ]) as Uint8Array;
  }

  /** Commitment of the note currently held by this client. */
  public getNoteCommitment(): Uint8Array {
    return Shade402Client.noteCommitment(this.state.agentSecret, this.state.policy);
  }

  /** Nullifier of a note: a note can be consumed exactly once. */
  public static nullifier(agentSecret: Uint8Array, nonce: Uint8Array): Uint8Array {
    return persistentHash(nullifierType as any, [NULLIFIER_PREFIX, agentSecret, nonce]) as Uint8Array;
  }

  // ── Successor-note bookkeeping ─────────────────────────────────────────────
  //
  // The contract computes the successor's fields itself and takes only its
  // nonce from the `nextNonce` witness. The caller therefore prepares the same
  // successor here (with fresh randomness) before submitting, and commits it
  // only after the transaction succeeds — a failed call must not advance the
  // local note, or the client would lose track of its own commitment.

  public prepareNextNote(overrides: Partial<NoteFields> = {}): AgentPolicy {
    this.nextNote = {
      ...this.state.policy,
      ...overrides,
      nonce: new Uint8Array(crypto.randomBytes(32)),
    };
    return this.nextNote;
  }

  public commitNextNote(): void {
    if (!this.nextNote) throw new Error('No successor note was prepared');
    this.state.policy = this.nextNote;
    this.nextNote = null;
  }

  public abortNextNote(): void {
    this.nextNote = null;
  }

  // ── Witnesses ──────────────────────────────────────────────────────────────

  /**
   * The witness set the compact runtime calls during proof generation (v3):
   *   localSecret, agentSecret, agentPath, note, notePath, nextNonce
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
      note: (_context: any) => {
        const p = this.state.policy;
        return [
          this.state,
          {
            balance: p.balance,
            spentInPeriod: p.spentInPeriod,
            dailyLimit: p.dailyLimit,
            perPaymentLimit: p.perPaymentLimit,
            periodEndsAt: p.periodEndsAt,
            nonce: p.nonce,
          },
        ];
      },
      notePath: (context: any): [ShadePrivateState, unknown] => {
        const leaf = this.getNoteCommitment();
        const notes = context?.ledger?.notes;
        if (!notes || typeof notes.findPathForLeaf !== 'function') {
          throw new Error('notePath witness: ledger does not expose findPathForLeaf');
        }
        const path = notes.findPathForLeaf(leaf);
        if (!path) {
          throw new Error('Policy note is not active: no Merkle path for this commitment');
        }
        return [this.state, path];
      },
      nextNonce: (_context: any): [ShadePrivateState, Uint8Array] => {
        if (!this.nextNote) {
          throw new Error(
            'nextNonce witness: no successor note prepared (call prepareNextNote before submitting)',
          );
        }
        return [this.state, this.nextNote.nonce];
      },
    };
  }

  // ── x402 payloads ──────────────────────────────────────────────────────────

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

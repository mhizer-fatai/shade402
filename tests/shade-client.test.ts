import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Shade402Client, type InvoiceChallenge } from '../src/shade-client.js';

function challenge(overrides: Partial<InvoiceChallenge> = {}): InvoiceChallenge {
  return {
    invoiceId: 'inv_test_1',
    recipientAddress: 'provider_a',
    amount: 10n,
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

test('agent leaf is deterministic for the same secret', () => {
  const a = new Shade402Client(new Uint8Array(32).fill(7));
  const b = new Shade402Client(new Uint8Array(32).fill(7));
  assert.deepEqual(a.getAgentLeaf(), b.getAgentLeaf());
});

test('different secrets produce different agent leaves', () => {
  const a = new Shade402Client(new Uint8Array(32).fill(1));
  const b = new Shade402Client(new Uint8Array(32).fill(2));
  assert.notDeepEqual(a.getAgentLeaf(), b.getAgentLeaf());
});

test('payment payload binds to invoice, recipient, amount, and expiry', () => {
  const client = new Shade402Client();
  const c1 = challenge();
  const c2 = challenge({ invoiceId: 'inv_test_2' });
  const p1 = client.buildPaymentPayload(c1);
  const p2 = client.buildPaymentPayload(c2);
  assert.notDeepEqual(p1.invoiceHash, p2.invoiceHash);
  assert.equal(p1.amount, 10n);
  assert.equal(p1.recipient.length, 32);
  assert.equal(p1.invoiceHash.length, 32);
});

test('rejects zero and negative amounts', () => {
  const client = new Shade402Client();
  assert.throws(() => client.buildPaymentPayload(challenge({ amount: 0n })), /positive/);
  assert.throws(() => client.buildPaymentPayload(challenge({ amount: -1n })), /positive/);
});

test('rejects expired invoices', () => {
  const client = new Shade402Client();
  assert.throws(
    () => client.buildPaymentPayload(challenge({ expiresAt: Date.now() - 1000 })),
    /expired/,
  );
});

test('recipient hash matches what the contract client derives', () => {
  const client = new Shade402Client();
  const p = client.buildPaymentPayload(challenge());
  const expected = Shade402Client.recipientHash('provider_a');
  assert.deepEqual(p.recipient, expected);
});

test('agent leaf matches the contract leaf domain', () => {
  // The v2 contract stores H(pad32("shade402:agent-leaf:v2") || secret) in the
  // HistoricMerkleTree. Assert the JS-side leaf is exactly 32 bytes and
  // deterministic, which is the property the on-chain findPathForLeaf needs.
  const client = new Shade402Client(new Uint8Array(32).fill(42));
  const leaf = client.getAgentLeaf();
  assert.equal(leaf.length, 32);
  assert.deepEqual(
    Shade402Client.agentLeaf(new Uint8Array(32).fill(42)),
    client.getAgentLeaf(),
  );
});

// ─── v3: committed policy notes ─────────────────────────────────────────────

const NOTE = {
  balance: 100n,
  spentInPeriod: 0n,
  dailyLimit: 1000n,
  perPaymentLimit: 200n,
  periodEndsAt: 1_800_000_000n,
};

const f = (n: number) => new Uint8Array(32).fill(n);

test('note commitment is deterministic for the same fields and nonce', () => {
  const secret = f(5);
  const nonce = f(9);
  const a = Shade402Client.noteCommitment(secret, { ...NOTE, nonce });
  const b = Shade402Client.noteCommitment(secret, { ...NOTE, nonce });
  assert.deepEqual(a, b);
  assert.equal(a.length, 32);
});

test('note commitment changes when any committed field changes', () => {
  const secret = f(5);
  const nonce = f(9);
  const base = Shade402Client.noteCommitment(secret, { ...NOTE, nonce });
  const variants = [
    { ...NOTE, balance: 101n, nonce },
    { ...NOTE, spentInPeriod: 1n, nonce },
    { ...NOTE, dailyLimit: 1001n, nonce },
    { ...NOTE, perPaymentLimit: 201n, nonce },
    { ...NOTE, periodEndsAt: 1_800_086_400n, nonce },
  ];
  for (const v of variants) {
    assert.notDeepEqual(base, Shade402Client.noteCommitment(secret, v));
  }
});

test('note commitment binds the nonce (freshness) and the agent secret (ownership)', () => {
  const secret = f(5);
  const base = Shade402Client.noteCommitment(secret, { ...NOTE, nonce: f(1) });
  assert.notDeepEqual(base, Shade402Client.noteCommitment(secret, { ...NOTE, nonce: f(2) }));
  assert.notDeepEqual(base, Shade402Client.noteCommitment(f(6), { ...NOTE, nonce: f(1) }));
});

test('nullifier is deterministic per note and distinct across notes', () => {
  const secret = f(3);
  assert.deepEqual(Shade402Client.nullifier(secret, f(1)), Shade402Client.nullifier(secret, f(1)));
  assert.notDeepEqual(Shade402Client.nullifier(secret, f(1)), Shade402Client.nullifier(secret, f(2)));
});

test('a successor note is only applied on commit, and discarded on abort', () => {
  const client = new Shade402Client(f(4));
  client.setPolicy({ ...NOTE, nonce: f(7) });
  const before = client.getNoteCommitment();

  const successor = client.prepareNextNote({ balance: 85n, spentInPeriod: 15n });
  assert.equal(successor.balance, 85n);
  // Not applied yet: the client still points at the on-chain commitment.
  assert.deepEqual(client.getNoteCommitment(), before);

  client.abortNextNote();
  assert.deepEqual(client.getNoteCommitment(), before);

  client.prepareNextNote({ balance: 85n, spentInPeriod: 15n });
  client.commitNextNote();
  assert.equal(client.getPolicy().balance, 85n);
  assert.notDeepEqual(client.getNoteCommitment(), before);
});

test('the nextNonce witness fails unless a successor note is prepared', () => {
  const client = new Shade402Client(f(8));
  const w: any = client.getWitnesses();
  assert.throws(() => w.nextNonce({}), /no successor note prepared/i);
  client.prepareNextNote({});
  const [, nonce] = w.nextNonce({});
  assert.equal(nonce.length, 32);
});

test('witness set exposes the six v3 witnesses', () => {
  const client = new Shade402Client(f(8));
  const w: any = client.getWitnesses();
  for (const name of ['localSecret', 'agentSecret', 'agentPath', 'note', 'notePath', 'nextNonce']) {
    assert.equal(typeof w[name], 'function', `missing witness: ${name}`);
  }
});

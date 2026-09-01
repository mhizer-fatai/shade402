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

test('agent key is deterministic for the same secret', () => {
  const a = new Shade402Client(new Uint8Array(32).fill(7));
  const b = new Shade402Client(new Uint8Array(32).fill(7));
  assert.deepEqual(a.getAgentKey(), b.getAgentKey());
});

test('different secrets produce different agent keys', () => {
  const a = new Shade402Client(new Uint8Array(32).fill(1));
  const b = new Shade402Client(new Uint8Array(32).fill(2));
  assert.notDeepEqual(a.getAgentKey(), b.getAgentKey());
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

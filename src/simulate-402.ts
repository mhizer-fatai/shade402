import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { Shade402Client, type InvoiceChallenge } from './shade-client.js';

async function runSimulation() {
  console.log('--- Starting Shade402 HTTP 402 Payment Simulation ---');

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const contractManagedPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'shade402', 'contract', 'index.js');

  console.log('Loading compiled Shade402 Compact contract...');
  const contractModule = await import(pathToFileURL(contractManagedPath).href);
  const { Contract } = contractModule;

  const client = new Shade402Client();
  console.log('Agent key (scrambled): ' + Buffer.from(client.getAgentKey()).toString('hex').slice(0, 16) + '...');

  const witnesses = client.getWitnesses();
  const contract = new Contract(witnesses);
  console.log('Contract successfully instantiated with private witnesses.');

  // Step 1: Build a realistic x402 invoice challenge
  console.log('\n[Step 1] Simulating an HTTP 402 challenge from an API provider...');
  const challenge: InvoiceChallenge = {
    invoiceId: 'inv_flight_search_8849',
    recipientAddress: 'midnight_recipient_api_service_01',
    amount: 15n,
    expiresAt: Date.now() + 300000,
  };
  console.log(`Invoice ID: ${challenge.invoiceId}`);
  console.log(`Required Payment: ${challenge.amount} units`);
  console.log(`Recipient: ${challenge.recipientAddress}`);

  // Step 2: Generate the payment payload (recipient hash + invoice hash + amount)
  console.log('\n[Step 2] Client generating payment payload for the contract circuit...');
  const payload = client.buildPaymentPayload(challenge);
  assert.equal(payload.amount, 15n);
  assert.equal(payload.recipient.length, 32);
  assert.equal(payload.invoiceHash.length, 32);
  console.log(`Invoice Hash: ${Buffer.from(payload.invoiceHash).toString('hex')}`);
  console.log(`Recipient Hash: ${Buffer.from(payload.recipient).toString('hex')}`);

  // Step 3: Wallet/contract-level checks mirror what payInvoice enforces on-chain.
  console.log('\n[Step 3] Verifying circuit inputs are well-formed...');
  assert.throws(() => client.buildPaymentPayload({ ...challenge, amount: 0n }), /positive/);
  assert.throws(
    () => client.buildPaymentPayload({ ...challenge, invoiceId: 'expired', expiresAt: Date.now() - 1 }),
    /expired/,
  );
  console.log('Rejected: zero/negative amounts and expired invoices.');

  console.log('\n--- Simulation Completed Successfully ---');
  console.log('Next: deploy the contract to a testnet and call registerAgent -> deposit -> payInvoice on-chain.');
}

runSimulation().catch((error) => {
  console.error('Simulation failed with error:', error);
  process.exit(1);
});

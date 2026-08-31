import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Shade402Client, type InvoiceChallenge } from './shade-client.js';
import assert from 'node:assert/strict';

async function runSimulation() {
  console.log('--- Starting Shade402 HTTP 402 Payment Simulation ---');

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const contractManagedPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'shade402', 'contract', 'index.js');
  
  console.log('Loading compiled Shade402 Compact contract...');
  const contractModule = await import(pathToFileURL(contractManagedPath).href);
  const { Contract } = contractModule;

  // Initialize client with 100 tokens and 50 daily spending limit
  const client = new Shade402Client(100n, 50n);
  console.log(`Initial Private Balance: ${client.getBalance()} units`);
  console.log(`Daily Spending Limit: ${client.getDailyLimit()} units`);

  // Instantiate contract with client witnesses
  const witnesses = client.getWitnesses();
  const contract = new Contract(witnesses);
  console.log('Contract successfully instantiated with private witnesses.');

  // Step 1: Deposit funds into the contract pool
  console.log('\n[Step 1] Executing Deposit into Shielded Pool...');
  const depositAmount = 50n;
  const depositResult = client.deposit(depositAmount);
  console.log(`Deposited: ${depositAmount} units`);
  console.log(`New Private Balance: ${depositResult.newBalance} units`);
  console.log(`Commitment Hash: ${Buffer.from(depositResult.commitmentHash).toString('hex').slice(0, 16)}...`);

  // Step 2: Simulate receiving an HTTP 402 challenge from an API provider
  console.log('\n[Step 2] Receiving simulated HTTP 402 challenge from API provider...');
  const challenge: InvoiceChallenge = {
    invoiceId: 'inv_flight_search_8849',
    recipientAddress: 'midnight_recipient_api_service_01',
    amount: 15n,
    expiresAt: Date.now() + 300000,
  };
  console.log(`Invoice ID: ${challenge.invoiceId}`);
  console.log(`Required Payment: ${challenge.amount} units`);
  console.log(`Recipient: ${challenge.recipientAddress}`);

  // Step 3: Generate ZK proof payload from private state
  console.log('\n[Step 3] Client generating ZK Proof and Payment Payload locally...');
  const paymentPayload = client.createPaymentPayload(challenge);
  assert.equal(paymentPayload.amount, 15n);
  assert.equal(client.getBalance(), 135n);
  console.log(`Invoice Hash: ${Buffer.from(paymentPayload.invoiceHash).toString('hex')}`);
  console.log(`Single-Use Nullifier: ${Buffer.from(paymentPayload.nullifier).toString('hex')}`);
  console.log(`Remaining Private Balance: ${client.getBalance()} units`);

  // Step 4: Verification of budget constraints and limits
  console.log('\n[Step 4] Testing Daily Allowance & Budget Safety Rules...');
  const excessiveChallenge: InvoiceChallenge = {
    invoiceId: 'inv_gpu_cluster_9912',
    recipientAddress: 'midnight_expensive_compute_02',
    amount: 75n, // Exceeds 50 daily limit
    expiresAt: Date.now() + 300000,
  };

  try {
    client.createPaymentPayload(excessiveChallenge);
    console.error('Error: Transaction should have been rejected by daily limit rule.');
  } catch (error: any) {
    assert.match(error.message, /daily limit/);
    console.log(`Confirmed: Excessive payment safely rejected -> "${error.message}"`);
  }

  assert.throws(() => client.createPaymentPayload(challenge), /already been paid/);
  assert.throws(
    () => client.createPaymentPayload({ ...challenge, invoiceId: 'expired', expiresAt: Date.now() - 1 }),
    /expired/,
  );
  assert.throws(
    () => new Shade402Client(5n, 50n).createPaymentPayload({ ...challenge, invoiceId: 'insufficient' }),
    /Insufficient private balance/,
  );

  console.log('\n--- Simulation Completed Successfully ---');
}

runSimulation().catch((error) => {
  console.error('Simulation failed with error:', error);
  process.exit(1);
});

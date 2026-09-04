/**
 * Read-only, walletless view of the deployed Shade402 contract.
 *
 * For judges and anyone evaluating: no wallet, no faucet, no sync required.
 * Reads the contract's public ledger state straight from the Midnight
 * indexer and prints agents, allowlisted providers, and settlement totals.
 *
 * Run: npx tsx scripts/read-contract.ts [--network preview|preprod]
 */
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { resolveNetwork, getDeployment } from '../src/network.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contractPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'shade402', 'contract', 'index.js');

async function main() {
  const { network, config } = resolveNetwork();
  const deployment = getDeployment(network);
  if (!deployment) {
    console.error(`No deployment recorded for network '${network}'.`);
    process.exit(1);
  }

  console.log(`Shade402 on ${network}`);
  console.log(`contract: ${deployment.address}`);
  console.log(`deployer: ${deployment.deployer}`);
  console.log(`deployed: ${deployment.deployedAt}\n`);

  const Shade402 = await import(pathToFileURL(contractPath).href);
  const publicDataProvider = indexerPublicDataProvider(config.indexer, config.indexerWS);

  const state = await publicDataProvider.queryContractState(deployment.address);
  if (!state) {
    console.error('No on-chain state found for this contract address.');
    process.exit(1);
  }

  const l = Shade402.ledger(state.data);

  const hex = (b: Uint8Array | { bytes: Uint8Array }) =>
    Buffer.from('bytes' in b ? b.bytes : b).toString('hex');

  console.log('── Agents (pseudonymous on-chain keys) ──');
  let count = 0;
  for (const [key, policy] of l.agents) {
    count += 1;
    console.log(`  agent #${count}`);
    console.log(`    key:              ${hex(key).slice(0, 16)}…`);
    console.log(`    balance:          ${policy.balance}`);
    console.log(`    daily limit:      ${policy.dailyLimit}`);
    console.log(`    spent in period:  ${policy.spentInPeriod}`);
    console.log(`    period ends:      ${new Date(Number(policy.periodEndsAt) * 1000).toISOString()}`);
    console.log(`    per-payment cap:  ${policy.perPaymentLimit}\n`);
  }
  if (count === 0) console.log('  (none registered yet)\n');

  console.log('── Allowlisted providers (owner-approved payment recipients) ──');
  let pCount = 0;
  for (const provider of l.allowedProviders) {
    pCount += 1;
    console.log(`  ${hex(provider).slice(0, 16)}…`);
  }
  if (pCount === 0) console.log('  (none allowlisted yet)');
  console.log('');

  console.log('── Settlement totals ──');
  console.log(`  total deposited:     ${l.totalDeposited}`);
  console.log(`  total settled:       ${l.totalSettledAmount}`);
  console.log(`  invoices settled:    ${l.usedInvoices.size()}`);
  console.log(`  last settled invoice: ${hex(l.lastSettledInvoice).slice(0, 16)}…\n`);

  console.log('All data above is read from the public ledger — this is exactly');
  console.log('what any observer can see. Note what is NOT here: no owner or');
  console.log('agent identities, no secrets, no off-chain payment history.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

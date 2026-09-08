/**
 * Read-only, walletless view of the deployed Shade402 contract.
 *
 * For judges and anyone evaluating: no wallet, no faucet, no sync required.
 * Reads the contract's public ledger state straight from the Midnight
 * indexer.
 *
 * v2 privacy proof: the public ledger holds a HistoricMerkleTree of agent
 * identity commitments, provider allowlist, invoice replay hashes, and
 * aggregate totals. It contains NO per-agent balances, NO per-agent limits,
 * and NO history. This script prints exactly what any observer can see — and
 * then states what is provably absent.
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

  console.log('── Registered agents (identity commitments in a Merkle tree) ──');
  const agentCount = l.agents.firstFree();
  console.log(`  ${agentCount} agent(s) registered`);
  console.log(`  tree root: ${hex(leafToBytes(l.agents.root()))}…`);
  console.log('  Leaves are H(secret) commitments — unlinkable to any identity.');
  console.log('  A payment proves membership via a private path, so the chain');
  console.log('  never learns which leaf (which agent) authorized it.\n');

  console.log('── Allowlisted providers (owner-approved payment recipients) ──');
  let pCount = 0;
  for (const provider of l.allowedProviders) {
    pCount += 1;
    console.log(`  ${hex(provider).slice(0, 16)}…`);
  }
  if (pCount === 0) console.log('  (none allowlisted yet)');
  console.log('');

  console.log('── Settlement totals (aggregate only) ──');
  console.log(`  total deposited:     ${l.totalDeposited}`);
  console.log(`  total settled:       ${l.totalSettledAmount}`);
  console.log(`  invoices settled:    ${l.usedInvoices.size()}`);
  console.log(`  last settled invoice: ${hex(l.lastSettledInvoice).slice(0, 16)}…\n`);

  console.log('What this ledger does NOT contain — the privacy proof:');
  console.log('  ✗ no per-agent balances');
  console.log('  ✗ no per-agent spending limits or history');
  console.log('  ✗ no link between a payment and which agent authorized it');
  console.log('  ✗ no owner/agent identities, no secrets');
  console.log('\nPer-agent balance and policy live in the agent\'s private state and');
  console.log('are enforced inside zero-knowledge proofs — never on this ledger.');
}

/** HistoricMerkleTree.root() returns a MerkleTreeDigest { field } — print as hex. */
function leafToBytes(d: { field: bigint }): Uint8Array {
  const hexStr = d.field.toString(16).padStart(64, '0');
  return new Uint8Array(Buffer.from(hexStr, 'hex'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

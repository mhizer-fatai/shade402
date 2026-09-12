import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { resolveNetwork, getOrCreateWallet, getDeployment } from '../src/network.js';
import { Shade402Client } from '../src/shade-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contractPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'shade402', 'contract', 'index.js');

const { network, config } = resolveNetwork();
const deployment = getDeployment(network)!;
const SEED = getOrCreateWallet(network).seed;
const agentSecret = new Uint8Array(createHash('sha256').update(`shade402:agent-secret:${SEED}`).digest());
const client = new Shade402Client(agentSecret);

const Shade402 = await import(pathToFileURL(contractPath).href);
const pdp = indexerPublicDataProvider(config.indexer, config.indexerWS);
const state = await pdp.queryContractState(deployment.address);
if (!state) { console.log('no state'); process.exit(1); }
const l = Shade402.ledger(state.data);

const leaf = client.getAgentLeaf();
console.log('contract:', deployment.address);
console.log('agent leaf:', Buffer.from(leaf).toString('hex'));
console.log('firstFree (leaf count):', l.agents.firstFree().toString());
console.log('root:', l.agents.root().field.toString(16));
const merklePath = l.agents.findPathForLeaf(leaf);
console.log('findPathForLeaf:', merklePath ? `FOUND (path len ${merklePath.path.length})` : 'NOT FOUND');
if (merklePath) console.log('  path.leaf:', Buffer.from(merklePath.leaf).toString('hex'));
console.log('allowedProviders:', l.allowedProviders.size());
for (const p of l.allowedProviders) console.log('   ', Buffer.from(p.bytes).toString('hex').slice(0,16));
console.log('usedInvoices:', l.usedInvoices.size());
process.exit(0);

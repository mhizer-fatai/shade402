/**
 * Shade402 backend service.
 *
 * Exposes an HTTP API that:
 *  - connects to the deployed Shade402 contract on Midnight,
 *  - lets an owner register an agent policy and deposit funds,
 *  - lets an agent pay an x402 invoice through the contract,
 *  - includes a simulated x402 provider that issues a 402 challenge and
 *    releases data once the on-chain settlement is verifiable.
 *
 * The private agent secret stays server-side for the demo. In production it
 * would live in a user/agent-controlled sidecar; see README.
 */
import express from 'express';
import cors from 'cors';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';

import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { resolveNetwork, getOrCreateWallet, formatWalletBackupNotice, getDeployment, recordDeployment } from '../network.js';
import { createWallet, persistWalletState, waitForCoreSync, type WalletContext } from '../wallet.js';
import { Shade402Client, type ShadePrivateState, type InvoiceChallenge } from '../shade-client.js';
import { findResource, handleMockResource } from './mock-provider.js';

// @ts-expect-error wallet sync requires WebSocket
globalThis.WebSocket = WebSocket;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', '..', 'contracts', 'managed', 'shade402');
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');

const PORT = Number(process.env.PORT ?? 4000);
const PRIVATE_STATE_ID = 'shade402PrivateState';

const { network, config: networkConfig } = resolveNetwork();
const WALLET = getOrCreateWallet(network);
const SEED = WALLET.seed;
{
  const notice = formatWalletBackupNotice(WALLET, network);
  if (notice) console.log(notice);
}

const agentSecret = new Uint8Array(
  createHash('sha256').update(`shade402:agent-secret:${SEED}`).digest(),
);
const client = new Shade402Client(agentSecret);
const privateState: ShadePrivateState = { agentSecret };

let walletCtx: WalletContext;
let providers: Awaited<ReturnType<typeof createProviders>>;
let deployed: any;
let ledger: (state: unknown) => any;

async function loadLedger() {
  const module = await import(pathToFileURL(contractPath).href);
  return module.ledger as (state: unknown) => any;
}

async function buildCompiled() {
  const Shade402 = await import(pathToFileURL(contractPath).href);
  const baseCompiled = CompiledContract.make('shade402', Shade402.Contract) as any;
  const witnessCompiled = (CompiledContract as any).withWitnesses(baseCompiled, client.getWitnesses());
  return (CompiledContract as any).withCompiledFileAssets(witnessCompiled, zkConfigPath);
}

async function createProviders(ctx: WalletContext) {
  const privateStatePassword = process.env.PRIVATE_STATE_PASSWORD?.trim() || 'Local-Devnet-Development-Placeholder-1';
  const walletProvider = {
    getCoinPublicKey: () => ctx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => ctx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      const signed = await ctx.wallet.signRecipe(
        recipe,
        (data: Uint8Array) => ctx.unshieldedKeystore.signData(data),
      );
      return ctx.wallet.finalizeRecipe(signed);
    },
    submitTx: (tx: any) => ctx.wallet.submitTransaction(tx) as any,
  };
  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const accountId = ctx.unshieldedKeystore.getBech32Address().toString();
  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'shade402-state',
      accountId,
      privateStoragePasswordProvider: () => privateStatePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

async function connect() {
  console.log(`Connecting to Shade402 on network: ${network}`);
  walletCtx = await createWallet({ network, networkConfig, seed: SEED });
  await waitForCoreSync(walletCtx);
  await persistWalletState(network, walletCtx);

  providers = await createProviders(walletCtx);
  ledger = await loadLedger();

  const deployment = getDeployment(network);
  if (deployment) {
    deployed = await findDeployedContract(providers, {
      compiledContract: await buildCompiled(),
      contractAddress: deployment.address,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: privateState,
    });
    console.log(`Connected to existing deployment: ${deployment.address}`);
  } else {
    const result = await deployContract(providers, {
      compiledContract: await buildCompiled(),
      args: [],
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: privateState,
    });
    const address = result.deployTxData.public.contractAddress;
    recordDeployment(network, address, walletCtx.unshieldedKeystore.getBech32Address().toString());
    deployed = result;
    console.log(`Deployed Shade402: ${address}`);
  }
  return deployed;
}

function deploymentAddress(): string {
  const d = getDeployment(network);
  if (!d) throw new Error('Contract not deployed');
  return d.address;
}

// ─── App ─────────────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, network, contractAddress: getDeployment(network)?.address ?? null });
});

app.get('/api/agent', async (_req, res) => {
  try {
    const state = await providers.publicDataProvider.queryContractState(deploymentAddress());
    if (!state) return res.status(404).json({ error: 'No contract state' });
    const l = ledger(state.data);
    const key = client.getAgentKey();
    if (!l.agents.member(key)) {
      return res.json({ registered: false, agentKey: Buffer.from(key).toString('hex') });
    }
    const policy = l.agents.lookup(key);
    res.json({
      registered: true,
      agentKey: Buffer.from(key).toString('hex'),
      balance: policy.balance.toString(),
      dailyLimit: policy.dailyLimit.toString(),
      spentInPeriod: policy.spentInPeriod.toString(),
      periodEndsAt: policy.periodEndsAt.toString(),
      perPaymentLimit: policy.perPaymentLimit.toString(),
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

app.post('/api/agent/register', async (req, res) => {
  try {
    const { dailyLimit, perPaymentLimit, periodHours } = req.body ?? {};
    const dl = BigInt(dailyLimit);
    const pl = BigInt(perPaymentLimit);
    const hours = Number(periodHours ?? 24);
    const periodEndsAt = BigInt(Math.floor(Date.now() / 1000) + hours * 3600);
    const tx = await deployed.callTx.registerAgent(dl, pl, periodEndsAt);
    res.json({ ok: true, txId: tx.public.txId, blockHeight: tx.public.blockHeight });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

app.post('/api/agent/deposit', async (req, res) => {
  try {
    const amount = BigInt(req.body?.amount);
    const tx = await deployed.callTx.deposit(amount);
    res.json({ ok: true, txId: tx.public.txId, blockHeight: tx.public.blockHeight, amount: amount.toString() });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

// ─── Simulated x402 provider ────────────────────────────────────────────────

// Simulated protected resource. Returns a 402 challenge unless the caller
// presents a valid settlement receipt.
app.get('/api/mock/resource', handleMockResource);

// Pay a resource: builds an x402 challenge, generates the payload, calls the
// contract, then returns a settlement receipt the client can pass back.
app.post('/api/pay', async (req, res) => {
  try {
    const { resourcePath, recipient } = req.body ?? {};
    const resource = findResource(resourcePath ?? '');
    const amount = resource.price;
    const invoiceId = `inv_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
    const challenge: InvoiceChallenge = {
      invoiceId,
      recipientAddress: recipient ?? resource.data.provider,
      amount,
      expiresAt: Date.now() + 300_000,
    };
    const payload = client.buildPaymentPayload(challenge);
    const tx = await deployed.callTx.payInvoice(
      { bytes: payload.recipient },
      payload.invoiceHash,
      payload.amount,
    );
    res.json({
      ok: true,
      invoiceId,
      txId: tx.public.txId,
      amount: amount.toString(),
      blockHeight: tx.public.blockHeight,
      invoiceHash: Buffer.from(payload.invoiceHash).toString('hex'),
      receipt: `${tx.public.txId}:${invoiceId}`,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

async function main() {
  await connect();
  app.listen(PORT, () => {
    console.log(`Shade402 backend listening on http://localhost:${PORT}`);
  });
}

main().catch((e) => {
  console.error('Failed to start Shade402 backend:', e);
  process.exit(1);
});

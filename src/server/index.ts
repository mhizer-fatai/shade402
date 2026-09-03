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
import { findResource, handleMockResource, RESOURCES } from './mock-provider.js';

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

// API bearer token. If SHADE_API_TOKEN is unset, a random per-run token is
// generated and printed once at startup so the local demo keeps working
// without configuration, while the API is still never left unauthenticated.
const API_TOKEN = process.env.SHADE_API_TOKEN ?? createHash('sha256')
  .update(`shade402:api-token:${SEED}:${Date.now()}:${Math.random()}`)
  .digest('hex');

const ALLOWED_ORIGINS = (process.env.SHADE_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

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

    // Fresh deployment: allowlist the demo providers so payments can flow.
    // (The deployer's witness is the owner, so these owner-only calls succeed.)
    console.log('Allowlisting demo providers...');
    for (const resource of RESOURCES) {
      try {
        await deployed.callTx.allowProvider({ bytes: resource.address });
        console.log(`  allowed: ${resource.data.provider}`);
      } catch (e: any) {
        console.log(`  skip ${resource.data.provider}: ${e?.message ?? e}`);
      }
    }
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
// CORS is restricted to the dashboard origins. Never open (`cors()` alone
// would let any website on the internet drive this API and the wallet).
app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser tools (curl, server-to-server) which send no Origin.
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
  }),
);
app.use(express.json());

// Bearer-token authentication for every mutating endpoint.
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token !== API_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, network, contractAddress: getDeployment(network)?.address ?? null });
});

// Live protocol stats read straight from the contract's public ledger.
app.get('/api/stats', async (_req, res) => {
  try {
    const state = await providers.publicDataProvider.queryContractState(deploymentAddress());
    if (!state) return res.status(404).json({ error: 'No contract state' });
    const l = ledger(state.data);
    res.json({
      network,
      contractAddress: deploymentAddress(),
      registeredAgents: l.agents.size().toString(),
      totalDeposited: l.totalDeposited.toString(),
      totalSettled: l.totalSettledAmount.toString(),
      invoicesSettled: l.usedInvoices.size().toString(),
      lastSettledInvoice: Buffer.from(l.lastSettledInvoice).toString('hex'),
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
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

app.post('/api/agent/register', requireAuth, async (req, res) => {
  try {
    const { dailyLimit, perPaymentLimit, periodHours } = req.body ?? {};
    const dl = BigInt(dailyLimit);
    const pl = BigInt(perPaymentLimit);
    if (dl <= 0n || pl <= 0n || pl > dl) {
      return res.status(400).json({ error: 'Limits must be positive, and per-payment must not exceed daily' });
    }
    const hours = Number(periodHours ?? 24);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 30) {
      return res.status(400).json({ error: 'periodHours must be between 1 and 720' });
    }
    const periodEndsAt = BigInt(Math.floor(Date.now() / 1000) + hours * 3600);
    const tx = await deployed.callTx.registerAgent(dl, pl, periodEndsAt);
    res.json({ ok: true, txId: tx.public.txId, blockHeight: tx.public.blockHeight });
  } catch {
    res.status(500).json({ error: 'Failed to register agent' });
  }
});

app.post('/api/agent/deposit', requireAuth, async (req, res) => {
  try {
    let amount: bigint;
    try {
      amount = BigInt(req.body?.amount);
    } catch {
      return res.status(400).json({ error: 'amount must be an integer string' });
    }
    if (amount <= 0n || amount > 1_000_000_000n) {
      return res.status(400).json({ error: 'amount must be between 1 and 1000000000' });
    }
    const tx = await deployed.callTx.deposit(amount);
    res.json({ ok: true, txId: tx.public.txId, blockHeight: tx.public.blockHeight, amount: amount.toString() });
  } catch {
    res.status(500).json({ error: 'Failed to deposit' });
  }
});

// Owner-only: withdraw contract funds back to the owner's wallet address.
app.post('/api/owner/withdraw', requireAuth, async (req, res) => {
  try {
    let amount: bigint;
    try {
      amount = BigInt(req.body?.amount);
    } catch {
      return res.status(400).json({ error: 'amount must be an integer string' });
    }
    if (amount <= 0n || amount > 1_000_000_000n) {
      return res.status(400).json({ error: 'amount must be between 1 and 1000000000' });
    }
    // Destination is always the backend wallet's own address — never taken
    // from the request — so funds can only return to the owner.
    const destination = walletCtx.unshieldedKeystore.getBech32Address();
    const destBytes = new Uint8Array(Buffer.from(destination.toString().slice(2), 'hex'));
    const tx = await deployed.callTx.withdraw(amount, { bytes: destBytes });
    res.json({ ok: true, txId: tx.public.txId, blockHeight: tx.public.blockHeight });
  } catch {
    res.status(500).json({ error: 'Withdrawal failed (not owner or insufficient contract balance)' });
  }
});

// Owner-only: allowlist an additional provider address (hex string).
app.post('/api/owner/allow-provider', requireAuth, async (req, res) => {
  try {
    const hex = String(req.body?.address ?? '');
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      return res.status(400).json({ error: 'address must be a 64-char hex string' });
    }
    const tx = await deployed.callTx.allowProvider({ bytes: new Uint8Array(Buffer.from(hex, 'hex')) });
    res.json({ ok: true, txId: tx.public.txId, blockHeight: tx.public.blockHeight });
  } catch {
    res.status(500).json({ error: 'Failed to allow provider (not owner or already allowed)' });
  }
});

// ─── Simulated x402 provider ────────────────────────────────────────────────

// Simulated protected resource. Returns a 402 challenge unless the caller
// presents a valid settlement receipt.
app.get('/api/mock/resource', handleMockResource);

// Pay a resource: builds an x402 challenge, generates the payload, calls the
// contract, then returns a settlement receipt the client can pass back.
app.post('/api/pay', requireAuth, async (req, res) => {
  try {
    const { resourcePath } = req.body ?? {};
    const resource = findResource(resourcePath ?? '');
    const amount = resource.price;
    const invoiceId = `inv_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
    // Recipient is derived from the (server-side) resource definition — it is
    // never accepted from the caller, so a request can never redirect funds
    // to an arbitrary address.
    const challenge: InvoiceChallenge = {
      invoiceId,
      recipientAddress: String(resource.data.provider),
      amount,
      expiresAt: Date.now() + 300_000,
    };
    const payload = client.buildPaymentPayload(challenge);
    const tx = await deployed.callTx.payInvoice(
      { bytes: resource.address },
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
  } catch {
    res.status(500).json({ error: 'Payment failed (insufficient balance, limit reached, or chain rejection)' });
  }
});

async function main() {
  await connect();
  app.listen(PORT, () => {
    console.log(`Shade402 backend listening on http://localhost:${PORT}`);
    console.log(`  CORS origins: ${ALLOWED_ORIGINS.join(', ')}`);
    console.log(`  API token (send as "Authorization: Bearer <token>"): ${API_TOKEN}`);
    if (!process.env.SHADE_API_TOKEN) {
      console.log('  (token is random per run — set SHADE_API_TOKEN to pin it)');
    }
  });
}

main().catch((e) => {
  console.error('Failed to start Shade402 backend:', e);
  process.exit(1);
});

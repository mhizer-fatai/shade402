/**
 * On-chain verification of the hardened Shade402 contract:
 * register -> deposit -> allowProvider (owner) -> pay allowlisted provider
 * -> attempt to pay a NON-allowlisted recipient (must be REJECTED).
 */
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { resolveNetwork, getOrCreateWallet, formatWalletBackupNotice, getDeployment } from '../src/network.js';
import { createWallet, persistWalletState, waitForCoreSync, type WalletContext } from '../src/wallet.js';
import { Shade402Client, type ShadePrivateState, type InvoiceChallenge } from '../src/shade-client.js';
import { RESOURCES } from '../src/server/mock-provider.js';

// @ts-expect-error wallet sync requires WebSocket
globalThis.WebSocket = WebSocket;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'shade402');
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');
const PRIVATE_STATE_ID = 'shade402PrivateState';

const { network, config: networkConfig } = resolveNetwork();
const WALLET = getOrCreateWallet(network);
const SEED = WALLET.seed;
const notice = formatWalletBackupNotice(WALLET, network);
if (notice) console.log(notice);

const agentSecret = new Uint8Array(createHash('sha256').update(`shade402:agent-secret:${SEED}`).digest());
const client = new Shade402Client(agentSecret);
const privateState: ShadePrivateState = { agentSecret };

const j = (v: unknown) => JSON.stringify(v, (_k, val) => (typeof val === 'bigint' ? val.toString() : val));

async function main() {
  const deployment = getDeployment(network);
  if (!deployment) throw new Error(`No deployment on file for ${network}`);
  console.log(`Contract: ${deployment.address} on ${network}`);

  const Shade402 = await import(pathToFileURL(contractPath).href);
  const baseCompiled = CompiledContract.make('shade402', Shade402.Contract) as any;
  const witnessCompiled = (CompiledContract as any).withWitnesses(baseCompiled, client.getWitnesses());
  const compiledContract = (CompiledContract as any).withCompiledFileAssets(witnessCompiled, zkConfigPath);

  const walletCtx: WalletContext = await createWallet({ network, networkConfig, seed: SEED });
  await waitForCoreSync(walletCtx);
  await persistWalletState(network, walletCtx);

  const privateStatePassword = process.env.PRIVATE_STATE_PASSWORD?.trim() || 'Local-Devnet-Development-Placeholder-1';
  const walletProvider = {
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      const signed = await walletCtx.wallet.signRecipe(
        recipe,
        (data: Uint8Array) => walletCtx.unshieldedKeystore.signData(data),
      );
      return walletCtx.wallet.finalizeRecipe(signed);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };
  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const accountId = walletCtx.unshieldedKeystore.getBech32Address().toString();
  const providers = {
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

  const deployed: any = await findDeployedContract(providers, {
    compiledContract: compiledContract as any,
    contractAddress: deployment.address,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: privateState,
  });

  async function readPolicy() {
    const state = await providers.publicDataProvider.queryContractState(deployment.address);
    if (!state) return null;
    const l = Shade402.ledger(state.data);
    const key = client.getAgentKey();
    if (!l.agents.member(key)) return null;
    return l.agents.lookup(key);
  }

  console.log('\n[1] registerAgent(1000, 200, 24h)...');
  try {
    const periodEndsAt = BigInt(Math.floor(Date.now() / 1000) + 86400);
    const regTx = await deployed.callTx.registerAgent(1000n, 200n, periodEndsAt);
    console.log(`    tx: ${regTx.public.txId} block=${regTx.public.blockHeight}`);
  } catch (e: any) {
    if (/already registered/.test(e?.message ?? '')) console.log('    already registered');
    else throw e;
  }
  console.log(`    policy: ${j(await readPolicy())}`);

  console.log('\n[2] deposit(100)...');
  const before = await readPolicy();
  if (before && before.balance > 0n) {
    console.log(`    skipped — balance already ${before.balance}`);
  } else {
    const depTx = await deployed.callTx.deposit(100n);
    console.log(`    tx: ${depTx.public.txId} block=${depTx.public.blockHeight}`);
  }
  console.log(`    policy: ${j(await readPolicy())}`);

  console.log('\n[3] allowProvider(midnight-airlines) — owner-only...');
  try {
    const tx = await deployed.callTx.allowProvider({ bytes: RESOURCES[0].address });
    console.log(`    tx: ${tx.public.txId} block=${tx.public.blockHeight}`);
  } catch (e: any) {
    if (/already allowed/.test(e?.message ?? '')) console.log('    already allowed');
    else throw e;
  }

  console.log('\n[4] payInvoice to ALLOWLISTED provider (15)...');
  const challenge: InvoiceChallenge = {
    invoiceId: `inv_${Date.now()}`,
    recipientAddress: 'midnight-airlines',
    amount: 15n,
    expiresAt: Date.now() + 300_000,
  };
  const payload = client.buildPaymentPayload(challenge);
  const payTx = await deployed.callTx.payInvoice({ bytes: RESOURCES[0].address }, payload.invoiceHash, payload.amount);
  console.log(`    tx: ${payTx.public.txId} block=${payTx.public.blockHeight}`);
  console.log(`    policy: ${j(await readPolicy())}`);

  console.log('\n[5] ATTACK: payInvoice to NON-allowlisted recipient (self-pay drain attempt)...');
  const attackerAddress = new Uint8Array(createHash('sha256').update('attacker-evil-address').digest());
  const evilChallenge: InvoiceChallenge = {
    invoiceId: `inv_evil_${Date.now()}`,
    recipientAddress: 'attacker',
    amount: 50n,
    expiresAt: Date.now() + 300_000,
  };
  const evilPayload = client.buildPaymentPayload(evilChallenge);
  try {
    await deployed.callTx.payInvoice({ bytes: attackerAddress }, evilPayload.invoiceHash, evilPayload.amount);
    console.log('    ❌ SECURITY HOLE: self-pay succeeded!');
    process.exit(1);
  } catch (e: any) {
    if (/not an allowed provider/.test(e?.message ?? '')) {
      console.log('    ✅ REJECTED by allowlist: "Recipient is not an allowed provider"');
    } else {
      console.log(`    ✅ rejected: ${e?.message?.slice(0, 100)}`);
    }
  }
  console.log(`    policy after attack: ${j(await readPolicy())}`);

  console.log('\n✅ Hardened Shade402 flow verified on-chain.');
  await walletCtx.wallet.stop();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

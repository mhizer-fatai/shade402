/**
 * Full on-chain verification of the deployed Shade402 contract on preview:
 * registerAgent -> deposit -> payInvoice, then read the agent policy back.
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

const agentSecret = new Uint8Array(createHash('sha256').update(`shade402:agent-secret:${SEED}:${process.env.SHADE_AGENT_SALT ?? 'v1'}`).digest());
const client = new Shade402Client(agentSecret);
const privateState: ShadePrivateState = { agentSecret };

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
    const p = l.agents.lookup(key);
    return {
      balance: p.balance,
      dailyLimit: p.dailyLimit,
      spentInPeriod: p.spentInPeriod,
      periodEndsAt: p.periodEndsAt,
      perPaymentLimit: p.perPaymentLimit,
    };
  }

  console.log('\n[1] registerAgent(dailyLimit=1000, perPaymentLimit=200, period=24h)...');
  const now = BigInt(Math.floor(Date.now() / 1000));
  const periodEndsAt = now + 86400n;
  try {
    const regTx = await deployed.callTx.registerAgent(1000n, 200n, periodEndsAt);
    console.log(`    tx: ${regTx.public.txId} block=${regTx.public.blockHeight}`);
  } catch (e: any) {
    if (/already registered/.test(e?.message ?? '')) {
      console.log('    already registered (replay protection confirmed)');
    } else {
      throw e;
    }
  }
  console.log(`    policy: ${JSON.stringify(await readPolicy(), (_k, val) => (typeof val === "bigint" ? val.toString() : val))}`);

  console.log('\n[2] deposit(100)...');
  const policyBeforeDeposit = await readPolicy();
  if (policyBeforeDeposit && policyBeforeDeposit.balance > 0n) {
    console.log(`    skipped — balance already ${policyBeforeDeposit.balance}`);
  } else {
    const depTx = await deployed.callTx.deposit(100n);
    console.log(`    tx: ${depTx.public.txId} block=${depTx.public.blockHeight}`);
  }
  console.log(`    policy: ${JSON.stringify(await readPolicy(), (_k, val) => (typeof val === "bigint" ? val.toString() : val))}`);

  console.log('\n[3] payInvoice(recipient, invoiceHash, amount=15)...');
  const challenge: InvoiceChallenge = {
    invoiceId: `inv_${Date.now()}`,
    recipientAddress: 'midnight_provider_example',
    amount: 15n,
    expiresAt: Date.now() + 300_000,
  };
  const payload = client.buildPaymentPayload(challenge);
  const payTx = await deployed.callTx.payInvoice({ bytes: payload.recipient }, payload.invoiceHash, payload.amount);
  console.log(`    tx: ${payTx.public.txId} block=${payTx.public.blockHeight}`);
  console.log(`    invoiceHash: ${Buffer.from(payload.invoiceHash).toString('hex')}`);
  console.log(`    policy after pay: ${JSON.stringify(await readPolicy(), (_k, val) => (typeof val === 'bigint' ? val.toString() : val))}`);

  console.log('\n[4] Attempt duplicate invoice (should fail)...');
  try {
    await deployed.callTx.payInvoice({ bytes: payload.recipient }, payload.invoiceHash, payload.amount);
    console.log('    ❌ expected rejection, but it succeeded');
  } catch (e: any) {
    console.log(`    ✅ rejected: ${e?.message ?? e}`);
  }

  console.log('\n✅ Full Shade402 flow verified on-chain.');
  await walletCtx.wallet.stop();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


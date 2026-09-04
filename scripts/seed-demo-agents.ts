/**
 * Register additional demo agents on-chain so the agents Map shows several
 * pseudonymous keys (strengthens the anonymity-set story for the demo).
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
import { resolveNetwork, getOrCreateWallet, getDeployment } from '../src/network.js';
import { createWallet, persistWalletState, waitForCoreSync, type WalletContext } from '../src/wallet.js';
import { Shade402Client, type ShadePrivateState } from '../src/shade-client.js';

// @ts-expect-error wallet sync requires WebSocket
globalThis.WebSocket = WebSocket;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'shade402');
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');
const PRIVATE_STATE_ID = 'shade402PrivateState';

const { network, config: networkConfig } = resolveNetwork();
const SEED = getOrCreateWallet(network).seed;

const SALTS = ['demo-agent-alpha', 'demo-agent-beta', 'demo-agent-gamma'];

async function main() {
  const deployment = getDeployment(network);
  if (!deployment) throw new Error(`No deployment on file for ${network}`);

  const Shade402 = await import(pathToFileURL(contractPath).href);

  for (const salt of SALTS) {
    const agentSecret = new Uint8Array(
      createHash('sha256').update(`shade402:agent-secret:${SEED}:${salt}`).digest(),
    );
    const client = new Shade402Client(agentSecret);
    const privateState: ShadePrivateState = { agentSecret };

    const baseCompiled = CompiledContract.make('shade402', Shade402.Contract) as any;
    const witnessCompiled = (CompiledContract as any).withWitnesses(baseCompiled, client.getWitnesses());
    const compiledContract = (CompiledContract as any).withCompiledFileAssets(witnessCompiled, zkConfigPath);

    const walletCtx: WalletContext = await createWallet({ network, networkConfig, seed: SEED });
    await waitForCoreSync(walletCtx);
    await persistWalletState(network, walletCtx);

    const privateStatePassword = 'Local-Devnet-Development-Placeholder-1';
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
        privateStateStoreName: `shade402-state-${salt}`,
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
      privateStateId: `${PRIVATE_STATE_ID}:${salt}`,
      initialPrivateState: privateState,
    });

    try {
      const periodEndsAt = BigInt(Math.floor(Date.now() / 1000) + 86400);
      const tx = await deployed.callTx.registerAgent(500n, 100n, periodEndsAt);
      console.log(`registered ${salt}: key=${Buffer.from(client.getAgentKey()).toString('hex').slice(0, 16)}… tx=${tx.public.txId}`);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.log(`skip ${salt}: ${/already registered/.test(msg) ? 'already registered' : msg.slice(0, 80)}`);
    }
    await walletCtx.wallet.stop();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

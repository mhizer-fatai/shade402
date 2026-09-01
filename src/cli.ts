/**
 * CLI for interacting with shade402-app contract
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import * as crypto from 'node:crypto';

// Midnight SDK imports
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { resolveNetwork, getOrCreateWallet, formatWalletBackupNotice, getDeployment } from './network';
import { createWallet, persistWalletState, waitForCoreSync, unshieldedToken, type WalletContext } from './wallet';
import * as Rx from 'rxjs';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { Shade402Client, type ShadePrivateState } from './shade-client';
import { createHash } from 'node:crypto';

// Enable WebSocket for GraphQL subscriptions
// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

// Must match the privateStateId used at deploy time.
const PRIVATE_STATE_ID = 'shade402PrivateState';

const { network, config: networkConfig } = resolveNetwork();
const WALLET = getOrCreateWallet(network);
const SEED = WALLET.seed;
{
  const notice = formatWalletBackupNotice(WALLET, network);
  if (notice) console.log(notice);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'shade402');

// Load compiled contract
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');

// Check if contract is compiled
if (!fs.existsSync(contractPath)) {
  console.error('\n❌ Contract not compiled! Run: npm run compile\n');
  process.exit(1);
}

const Shade402 = await import(pathToFileURL(contractPath).href);

const agentSecret = new Uint8Array(
  createHash('sha256').update(`shade402:agent-secret:${SEED}`).digest(),
);
const privateStateClient = new Shade402Client(agentSecret);
const privateState: ShadePrivateState = { agentSecret };
const baseCompiled = CompiledContract.make('shade402', Shade402.Contract) as any;
const witnessCompiled = (CompiledContract as any).withWitnesses(baseCompiled, privateStateClient.getWitnesses());
const compiledContract = (CompiledContract as any).withCompiledFileAssets(witnessCompiled, zkConfigPath);

// ─── Providers ─────────────────────────────────────────────────────────────────

async function createProviders(walletCtx: WalletContext) {
  // The SDK requires the private-state password to be at least 16 characters.
  // The default below is a placeholder for local devnet only — set a strong
  // password via PRIVATE_STATE_PASSWORD when you move to a non-local target.
  const privateStatePassword = process.env.PRIVATE_STATE_PASSWORD?.trim() || 'Local-Devnet-Development-Placeholder-1';

  const walletProvider = {
    // In Midnight.js 4.1.x the WalletProvider interface returns the key objects
    // (CoinPublicKey / EncPublicKey) directly — no longer hex strings.
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      // balanceUnboundTransaction -> signRecipe -> finalizeRecipe. The
      // explicit signRecipe step is required when spending unshielded inputs
      // (deposits use receiveUnshielded); skipping it causes Custom error 192.
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

// ─── Main CLI ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                   shade402-app CLI                           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const rl = createInterface({ input: stdin, output: stdout });

  // Check for deployment
  const deployment = getDeployment(network);
  if (!deployment) {
    console.error(`No deploy on file for network ${network}. Run \`npm run setup -- --network ${network}\` first.`);
    process.exit(1);
  }
  console.log(`  Contract: ${deployment.address}`);
  console.log(`  Network: ${network}\n`);

  try {
    const seed = SEED;

    console.log('  Connecting to wallet...');
    const walletCtx = await createWallet({ network, networkConfig, seed });
    const restoredCount = Object.values(walletCtx.restored).filter(Boolean).length;
    if (restoredCount > 0) {
      console.log(`  Restored ${restoredCount}/3 child wallets from .midnight-wallet-state — sync will resume from saved point.`);
    }

    console.log('  Syncing with network...');
    console.log('  ℹ  This may take several minutes depending on network size.');
    console.log('     RPC disconnection messages during sync are normal and can be safely ignored.\n');
    const syncStart = Date.now();
    const syncInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - syncStart) / 1000);
      process.stdout.write(`\r  ⏳ Still syncing... (${elapsed}s elapsed)   `);
    }, 5000);
    await waitForCoreSync(walletCtx);
    const state = await Rx.firstValueFrom(walletCtx.wallet.state());
    clearInterval(syncInterval);
    process.stdout.write('\r  ✓ Synced with network.                                      \n');

    // Persist sync state so the next run doesn't have to redo this work.
    await persistWalletState(network, walletCtx);
    const balance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
    console.log(`  Balance: ${balance.toLocaleString()} tNight\n`);

    // Surface a faucet hint when a public-network wallet has 0 tNIGHT.
    // Reads (option 2) work without funds, but writes (option 1) need DUST
    // generated from registered NIGHT — without this hint the next failure
    // mode is a confusing "Insufficient Funds" deep inside the tx builder.
    if (balance === 0n && network !== 'undeployed' && networkConfig.faucet) {
      const address = walletCtx.unshieldedKeystore.getBech32Address();
      console.log('  ⚠ Wallet has no tNight. Fund it from the faucet to send transactions:');
      console.log(`     ${networkConfig.faucet}`);
      console.log(`     Wallet address: ${address}\n`);
    }

    // Setup providers and connect to contract
    console.log('  Connecting to contract...');
    const providers = await createProviders(walletCtx);

    const deployed: any = await findDeployedContract(providers, {
      compiledContract: compiledContract as any,
      contractAddress: deployment.address,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: privateState,
    });

    console.log('  ✅ Connected!\n');

    // Interactive CLI loop
    let running = true;
    while (running) {
      console.log('─── Menu ───────────────────────────────────────────────────────');
      console.log('  1. Register agent policy');
      console.log('  2. Deposit funds');
      console.log('  3. Pay an HTTP 402 invoice');
      console.log('  4. View agent policy');
      console.log('  5. Check wallet balance');
      console.log('  6. Exit\n');

      const choice = await rl.question('  Your choice: ');

      switch (choice.trim()) {
        case '1': {
          const dailyLimit = BigInt(await rl.question('  Daily limit: '));
          const perPaymentLimit = BigInt(await rl.question('  Per-payment limit: '));
          const periodHours = Number(await rl.question('  Period length (hours): ')) || 24;
          const periodEndsAt = BigInt(Math.floor(Date.now() / 1000) + periodHours * 3600);
          console.log('\n  Submitting registration (this may take 30-60 seconds)...');
          try {
            const tx = await deployed.callTx.registerAgent(dailyLimit, perPaymentLimit, periodEndsAt);
            console.log(`\n  ✅ Agent registered`);
            console.log(`  Transaction ID: ${tx.public.txId}\n`);
          } catch (error) {
            console.error('\n  ❌ Failed:', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '2': {
          const amount = BigInt(await rl.question('  Deposit amount: '));
          console.log('\n  Submitting transaction (this may take 30-60 seconds)...');
          try {
            const tx = await deployed.callTx.deposit(amount);
            console.log(`\n  ✅ Deposited ${amount} units`);
            console.log(`  Transaction ID: ${tx.public.txId}`);
            console.log(`  Block height: ${tx.public.blockHeight}\n`);
          } catch (error) {
            console.error('\n  ❌ Failed:', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '3': {
          const invoiceId = await rl.question('  Invoice ID: ');
          const recipient = await rl.question('  Recipient address: ');
          const amount = BigInt(await rl.question('  Payment amount: '));
          const expiresInSec = Number(await rl.question('  Invoice valid for (seconds): ')) || 300;
          const challenge = {
            invoiceId,
            recipientAddress: recipient,
            amount,
            expiresAt: Date.now() + expiresInSec * 1000,
          };
          const payload = privateStateClient.buildPaymentPayload(challenge);
          console.log('\n  Submitting private payment (this may take 30-60 seconds)...');
          try {
            const tx = await deployed.callTx.payInvoice(
              { bytes: payload.recipient },
              payload.invoiceHash,
              payload.amount,
            );
            console.log(`\n  ✅ Invoice paid: ${invoiceId}`);
            console.log(`  Transaction ID: ${tx.public.txId}`);
            console.log(`  Invoice hash: ${Buffer.from(payload.invoiceHash).toString('hex')}\n`);
          } catch (error) {
            console.error('\n  ❌ Failed:', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '4': {
          console.log('\n  Reading agent policy from blockchain...');
          try {
            const contractState = await providers.publicDataProvider.queryContractState(deployment.address);
            if (contractState) {
              const ledgerState = Shade402.ledger(contractState.data);
              const key = Shade402Client.agentKey(agentSecret);
              const keyHex = Buffer.from(key).toString('hex');
              if (ledgerState.agents.member(key)) {
                const policy = ledgerState.agents.lookup(key);
                console.log(`\n  Agent key: ${keyHex.slice(0, 16)}...`);
                console.log(`  Balance:          ${policy.balance}`);
                console.log(`  Daily limit:      ${policy.dailyLimit}`);
                console.log(`  Spent this period: ${policy.spentInPeriod}`);
                console.log(`  Period ends at:   ${new Date(Number(policy.periodEndsAt) * 1000).toISOString()}`);
                console.log(`  Per-payment limit: ${policy.perPaymentLimit}\n`);
              } else {
                console.log('\n  Agent is not registered yet.\n');
              }
            } else {
              console.log('\n  No contract state found.\n');
            }
          } catch (error) {
            console.error('\n  ❌ Failed:', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '5': {
          console.log('\n  Checking balance...');
          const currentState = await Rx.firstValueFrom(walletCtx.wallet.state());
          const currentBalance = currentState.unshielded.balances[unshieldedToken().raw] ?? 0n;
          const dustBalance = currentState.dust.balance(new Date());
          console.log(`\n  tNight: ${currentBalance.toLocaleString()}`);
          console.log(`  DUST: ${dustBalance.toLocaleString()}\n`);
          break;
        }

        case '6':
          running = false;
          console.log('\n  👋 Goodbye!\n');
          break;

        default:
          console.log('\n  ❌ Invalid choice. Please enter 1-6.\n');
      }
    }

    await persistWalletState(network, walletCtx);
    await walletCtx.wallet.stop();
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
  } finally {
    rl.close();
  }
}

main().catch(console.error);

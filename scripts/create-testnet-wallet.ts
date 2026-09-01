/**
 * Create (or load) the Preview testnet wallet, write its credentials to
 * `.env`, and print the public addresses.
 *
 * The shielded address is what the Midnight testnet faucet wants.
 * Run: npx tsx scripts/create-testnet-wallet.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

import { getOrCreateWallet, NETWORK_CONFIGS } from '../src/network.js';
import { createWallet } from '../src/wallet.js';
import { MidnightBech32m, ShieldedAddress, ShieldedCoinPublicKey, ShieldedEncryptionPublicKey } from '@midnight-ntwrk/wallet-sdk-address-format';

// @ts-expect-error wallet sync requires WebSocket
globalThis.WebSocket = WebSocket;

const NETWORK: 'preview' = 'preview';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');

async function main() {
  // Force resolve to the preview network regardless of current state.
  const config = NETWORK_CONFIGS[NETWORK];
  const walletCreds = getOrCreateWallet(NETWORK);
  const isNew = walletCreds.created;

  console.log('────────────────────────────────────────────────────────────');
  console.log('  Shade402 testnet wallet');
  console.log('────────────────────────────────────────────────────────────');
  console.log(`  Network:   ${NETWORK}`);
  console.log(`  Created:   ${isNew ? 'yes (new)' : 'no (loaded existing)'}`);

  // Derive addresses from the seed. Requires building the wallet facade,
  // which needs the network RPC — but address derivation itself is local.
  const walletCtx = await createWallet({ network: NETWORK, networkConfig: config, seed: walletCreds.seed });

  const networkId = config.networkId;
  const shielded = MidnightBech32m.encode(
    networkId,
    new ShieldedAddress(
      ShieldedCoinPublicKey.fromHexString(walletCtx.shieldedSecretKeys.coinPublicKey),
      ShieldedEncryptionPublicKey.fromHexString(walletCtx.shieldedSecretKeys.encryptionPublicKey),
    ),
  ).asString();
  const unshielded = walletCtx.unshieldedKeystore.getBech32Address().toString();

  // Write credentials to .env (gitignored). Include the mnemonic for Lace
  // recovery and the derived seed.
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
  const lines: string[] = [];
  if (!existing.includes('MIDNIGHT_WALLET_MNEMONIC')) {
    lines.push(`MIDNIGHT_WALLET_MNEMONIC=${walletCreds.mnemonic ?? ''}`);
  }
  if (!existing.includes('MIDNIGHT_WALLET_SEED')) {
    lines.push(`MIDNIGHT_WALLET_SEED=${walletCreds.seed}`);
  }
  if (!existing.includes('MIDNIGHT_NETWORK')) {
    lines.push(`MIDNIGHT_NETWORK=${NETWORK}`);
  }
  if (lines.length > 0) {
    const content = existing.trim() ? existing.trimEnd() + '\n' + lines.join('\n') + '\n' : lines.join('\n') + '\n';
    fs.writeFileSync(envPath, content, { mode: 0o600 });
    console.log(`  .env:      written (${lines.length} new line(s))`);
  } else {
    console.log('  .env:      already present, unchanged');
  }

  console.log('');
  console.log('  ── Public addresses ──');
  console.log(`  Shielded   (use for faucet): ${shielded}`);
  console.log(`  Unshielded                 : ${unshielded}`);
  console.log('');
  if (isNew && walletCreds.mnemonic) {
    console.log('  ⚠ RECOVERY PHRASE (write it down, it is in .env):');
    console.log(`    ${walletCreds.mnemonic}`);
    console.log('');
  }
  console.log('  Fund the shielded address at the Midnight/Google faucet,');
  console.log('  then deploy with: npm run deploy -- --network preview');
  console.log('────────────────────────────────────────────────────────────');

  await walletCtx.wallet.stop();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

# Shade402

Shade402 is a privacy-preserving HTTP 402 payment facilitator for autonomous AI agents, built on Midnight. An agent can prove that it has enough private balance and remains within its configured allowance while the API provider receives a settlement bound to a specific invoice.

## Wave 1 Scope

Wave 1 delivers the contract and CLI simulation layer:

- `contracts/shade402.compact` contains the Compact contract.
- `src/shade-client.ts` models the agent's private balance, allowance, invoice binding, and single-use nullifiers.
- `src/simulate-402.ts` demonstrates a deposit, invoice payment payload, and rejected unsafe payments.
- `src/deploy.ts`, `src/cli.ts`, and `scripts/e2e-check.ts` use the compiled Shade402 contract.

Wave 2 will add the reusable SDK and HTTP 402 provider middleware. Wave 3 will add the dashboard and delegated budget management.

## Privacy Design

The agent keeps its balance, daily allowance, and secret witness material in private state. The Compact contract reads those values through witnesses and asserts:

1. The payment amount is positive.
2. The private balance covers the invoice.
3. The invoice is within the agent allowance.
4. The settlement is bound to the recipient, invoice hash, and nullifier.

The public ledger exposes aggregate settlement fields needed for verification, while the agent's balance and spending policy remain private. The TypeScript simulation also rejects expired invoices and reuses of a locally tracked nullifier.

## Requirements

- Node.js 22+
- Docker with Compose v2
- Compact compiler matching the version used to generate `contracts/managed/shade402`

## Quick Start

```bash
npm install
npm run compile
npm test
```

`npm test` runs the deterministic Wave 1 simulation without requiring Docker or a funded wallet.

To run the local Midnight devnet and deploy the contract:

```bash
npm run setup
npm run test:e2e
npm run cli
```

`npm run setup` starts the local devnet, compiles `contracts/shade402.compact`, registers DUST, and deploys the contract. `npm run test:e2e` reconnects to the deployed Shade402 contract and verifies that its state is indexed and queryable.

## CLI Flow

After deployment, `npm run cli` provides:

1. Deposit into the pool.
2. Pay an HTTP 402 invoice by entering its ID, recipient, and amount.
3. Inspect the wallet's NIGHT and DUST balances.

The current CLI uses the local witness client for the Wave 1 demonstration. The relayer and provider middleware are planned for Wave 2.

## Contract Interface

The contract exposes:

- `deposit(amount, commitmentHash)` for pool deposits.
- `payInvoice(recipient, invoiceHash, amount, nullifier)` for allowance-checked settlement.
- `totalDeposited`, `totalSettledAmount`, `lastSettledInvoice`, and `nullifierRoot` as public ledger fields.

The contract must compile successfully for a submission to pass the Buildathon technical gate:

```bash
npm run compile
```

## Repository and License Requirements

The Midnight-related code in this repository is released under the Apache License 2.0. Add the `midnightntwrk` label/topic to the public GitHub repository before submission. The Wave 1 AKINDO submission should include this repository, a pitch deck, a demo video, and a short description of what was built during Wave 1.

## Networks

The scaffold supports `undeployed` for the bundled local devnet, plus `preview` and `preprod`. Use `--network preview` or `--network preprod` with setup commands when working against a public test network. Never use the local genesis seed on a public network.

## Project Structure

```text
shade402-app/
├── contracts/
│   ├── shade402.compact
│   └── managed/shade402/       # generated compiler output
├── scripts/e2e-check.ts
├── src/
│   ├── shade-client.ts         # private-state simulation client
│   ├── simulate-402.ts         # Wave 1 safety and payment simulation
│   ├── deploy.ts
│   ├── cli.ts
│   ├── network.ts
│   └── wallet.ts
├── docker-compose.yml
├── package.json
└── tsconfig.json
```
>>>>>>> 63db8e8 (Add Shade402 Wave 1 scaffold)

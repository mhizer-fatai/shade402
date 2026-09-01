# Shade402

Shade402 is a privacy-preserving HTTP 402 (x402) payment facilitator for autonomous AI agents, built on Midnight. An agent keeps a private balance and an owner-controlled spending policy, proves it is funded and within its rules inside a zero-knowledge proof, and the Shade402 contract pays any provider with an unshielded settlement. The agent's identity, balance, and spending history are not visible to the provider.

## Wave 1 Scope

Wave 1 delivers a working full stack:

- **Compact contract** (`contracts/shade402.compact`) with real private-state management and the dual-ledger model:
  - `registerAgent(dailyLimit, perPaymentLimit, periodEndsAt)` — owner registers an agent account with a spending policy.
  - `deposit(amount)` — owner funds the agent's balance on the contract.
  - `payInvoice(recipient, invoiceHash, amount)` — agent pays a provider: the contract checks balance, per-payment limit, daily limit, and invoice replay, then settles with `sendUnshielded`.
- **TypeScript client** (`src/shade-client.ts`) that supplies the `localSecret` witness and derives agent keys and invoice hashes.
- **Backend service** (`src/server/`) — an Express API that connects to the deployed contract and includes a **simulated x402 provider** that issues a `402 Payment Required` challenge and releases a protected resource once a settlement receipt is presented.
- **React dashboard** (`web/`) — an owner UI to register the agent policy, deposit, pay an x402 service, and view the public settlement.
- **Tests** (`tests/`) — unit tests for the client and the x402 provider flow, plus a simulation (`src/simulate-402.ts`).

## Privacy Design

The agent's secret is a private witness value. The contract derives a dApp-specific agent key from it and stores policy (balance, limits, period) under that key on the public ledger — the key is unlinkable to any real identity. Every payment must prove, inside the ZK proof, that:

1. The payment amount is positive.
2. The agent is registered.
3. The invoice has not already been paid (replay protection).
4. The agent's balance covers the amount.
5. The payment is within the per-payment limit.
6. The payment is within the rolling daily limit (`blockTimeGte` resets the period).

The **public** ledger shows aggregate settlement (deposits, settled totals, last invoice) and the per-agent policy keyed by the scrambled agent key. The **private** side — which real-world owner an agent key maps to, and the secret itself — never appears on-chain.

## Architecture

```text
React dashboard (web/)
      │  HTTP
      ▼
Backend service (src/server/) ─── simulated x402 provider
      │  Midnight.js + wallet SDK
      ▼
Shade402 Compact contract on Midnight (preview/preprod)
      │  sendUnshielded
      ▼
Provider receives settlement → releases the requested resource
```

- The agent never holds the owner's main wallet keys.
- The contract is the payer of record, so the provider cannot link the settlement to the agent's identity.
- Honest limit: with a single depositor, timing/amount correlation can still link payments — the same anonymity-set constraint as any pool-based privacy system. This is documented, not overclaimed.

## Requirements

- Node.js 22+
- Compact compiler (generated artifacts for compiler 0.31.1 are committed under `contracts/managed/shade402/`)
- A Midnight testnet wallet with tNIGHT (preview or preprod)

## Quick Start

```bash
npm install
npm test
```

`npm test` runs the simulation and the unit tests. It needs no blockchain.

To run the full stack against a deployed contract:

```bash
npm run server      # backend on http://localhost:4000
npm run web         # React dashboard on http://localhost:5173
```

## Deploying to a Midnight testnet

Compile the contract (done in Codespace / a modern Linux host; the artifacts are committed):

```bash
npm run compile
```

Deploy (uses the wallet configured in `.midnight-state.json`; fund it with tNIGHT and DUST first):

```bash
npm run deploy -- --network preview
```

The backend also auto-deploys on first run if no deployment is on file.

## Networks

The scaffold supports `undeployed` (local devnet), `preview`, and `preprod`. Use `--network preview` or `--network preprod` for public test networks. Never use the local genesis seed on a public network.

## Project Structure

```text
shade402-app/
├── contracts/
│   ├── shade402.compact          # Compact contract
│   └── managed/shade402/         # generated artifacts (committed)
├── scripts/e2e-check.ts          # on-chain smoke check
├── src/
│   ├── shade-client.ts           # witness + payload client
│   ├── simulate-402.ts           # simulation
│   ├── deploy.ts                 # testnet deployment
│   ├── cli.ts                    # interactive CLI
│   ├── server/
│   │   ├── index.ts              # backend API + contract wiring
│   │   └── mock-provider.ts      # simulated x402 provider
│   ├── network.ts
│   └── wallet.ts
├── tests/                        # unit tests
├── web/                          # React dashboard
├── package.json
└── tsconfig.json
```

## License

Apache-2.0. This repository must be tagged with the `midnightntwrk` topic on GitHub for Buildathon eligibility.

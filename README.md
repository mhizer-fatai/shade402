# Shade402

Shade402 is a privacy-preserving HTTP 402 (x402) payment facilitator for autonomous AI agents, built on Midnight. An agent keeps a private balance and an owner-controlled spending policy, proves it is funded and within its rules inside a zero-knowledge proof, and the Shade402 contract pays the provider with an unshielded settlement. **The provider sees that Shade402 paid — never which agent.**

- **Live on Midnight Preview:** contract `3a261d47e32096ff41d228f16440e8dfea7292fdc12ec4bb7e666eae5614be7c`
- **Explorer (contract):** https://preview.midnightexplorer.com/contracts/3a261d47e32096ff41d228f16440e8dfea7292fdc12ec4bb7e666eae5614be7c

## Wave 1 Progress

Wave 1 delivered a working full stack with a **scoped privacy upgrade** over the initial design:

- **Compact contract** (`contracts/shade402.compact`) — the public per-agent `Map` was **removed**. The public ledger now holds only a `HistoricMerkleTree` of agent identity commitments, a provider allowlist, invoice replay hashes, and aggregate totals.
- **Private-state policy** — per-agent balance and limits moved into private witnesses, enforced in-ZK, never written on-chain.
- **Backend** (`src/server/`) — owner-gated registration, deposits, x402 invoice payment, a simulated provider, and an **indexer-backed transaction verifier**.
- **React dashboard** (`web/`) — register/deposit/pay, live activity, and an in-app "on-chain verification" modal.
- **Tests** — 11 unit tests, an offline x402 simulation, and on-chain attack tests (`scripts/verify-onchain.ts`).

## Privacy Design

Every agent is represented on-chain by a single 32-byte **commitment**:

```
leaf = H("shade402:agent-leaf:v2" || agentSecret)
```

The leaf is inserted into a `HistoricMerkleTree<16, Bytes<32>>`. To pay, the agent proves **Merkle membership using a private path** (`witness agentPath`) — the circuit recomputes the root and checks it against a known root, so the chain learns *that some registered agent* authorized the payment, but not *which leaf*. The leaf and path never go on-chain.

Per-agent balance, daily limit, current-period spend, and per-payment cap live in **private state** and are threaded into the proof as witnesses. The circuit enforces them without any of those values touching the public ledger.

**Enforced inside the zero-knowledge proof:**

1. The payment amount is positive.
2. The agent is a registered member (private Merkle path).
3. The recipient is owner-allowlisted.
4. The invoice has not already been paid (replay protection).
5. `balance >= amount`, `amount <= perPaymentLimit`, and `spent + amount <= dailyLimit` — all against private witnesses.

**Hidden:** the agent's secret, the mapping from commitment to identity, each agent's balance and spending policy, and which agent authorized a given payment.

**Public (by design):** settlement transactions, amounts, providers, the allowlist, invoice hashes, aggregate deposit/settlement totals, and the Merkle root.

**Honest limits (so we do not overclaim):**

- **Custodian trust.** Per-agent balances and limits are held by the Shade402 backend and reported to the circuit as private witnesses. The chain cannot independently verify them (and the compiler forbids time checks on private values, so period rollover is custodian-side). A dishonest or buggy custodian could misreport a balance; the contract still caps total outflow at its real token balance. Removing this trust is the next upgrade (see Roadmap).
- **Anonymity-set size.** Payer–provider unlinkability depends on how many agents are registered. A payment proves "some registered agent paid", which is weak cover until the pool is large.
- **Registration is observable.** Each `registerAgent` discloses a new commitment, so the size and timing of the agent pool are public.
- **Amounts are public.** Only payer identity is hidden; the settlement amount and provider are visible by design.

## Security Model

Shade402 is a Wave 1 prototype on testnet. This section documents what is enforced and the known limitations.

**Enforced:**
- Bearer-token authentication on all mutating API endpoints (`SHADE_API_TOKEN`, random per-run if unset).
- CORS restricted to the dashboard origins (`SHADE_ALLOWED_ORIGINS`, defaults to localhost).
- Payment recipients are derived from server-side resource definitions, never accepted from callers.
- Input validation on API parameters; error responses are sanitized.
- **Owner-gated registration:** `registerAgent`, `allowProvider`, `revokeProvider`, and `withdraw` require the deployer's secret-derived owner key. (Owner-gating registration is necessary in v2: with private balances, open registration would let anyone claim an arbitrary private balance and drain the pool.)
- **Provider allowlist:** `payInvoice` only pays allowlisted addresses — an agent cannot redirect funds to itself or an arbitrary address.
- **Withdraw escape hatch:** the owner can withdraw contract funds, so deposits are never locked.
- **Invoice replay protection** on-chain (`usedInvoices` set).
- **Real solvency:** settlement uses `sendUnshielded` against the contract's actual balance.

**Known limitations (demo scope, by design):**
- **Single-custodian demo:** the backend holds the wallet and agent secret. In production, proof generation and private state belong in a user-controlled sidecar.
- **Invoice authenticity:** the x402 provider is simulated; invoice hashes are generated by the demo backend and are not provider-signed.
- **No rate limiting** on the API.

See the audit trail in the git history for the full review that produced this list.

## Contract Circuits

`contracts/shade402.compact` (Compact, language ≥ 0.23):

| Circuit | Access | Purpose |
| --- | --- | --- |
| `registerAgent(dailyLimit, perPaymentLimit)` | owner | Inserts `H(secret)` commitment into the agents tree |
| `allowProvider(provider)` | owner | Adds a payment recipient to the allowlist |
| `revokeProvider(provider)` | owner | Removes a recipient from the allowlist |
| `deposit(amount)` | anyone | Receives tNIGHT; increments the aggregate total |
| `withdraw(amount, destination)` | owner | Returns contract funds to the owner |
| `payInvoice(recipient, invoiceHash, amount)` | agent (proves membership) | Verifies membership, allowlist, replay, and private policy, then settles |

Public ledger: `agents` (HistoricMerkleTree), `usedInvoices`, `allowedProviders`, `owner` (sealed), `lastSettledInvoice`, `totalSettledAmount`, `totalDeposited`. **Nothing per-agent.**

## Architecture

```text
React dashboard (web/)  ── homepage + dashboard, URL routing
      │  HTTP (JSON)
      ▼
Backend service (src/server/) ─── simulated x402 provider
      │  Midnight.js + wallet SDK        │
      │  indexer (read-only)  ◀──────────┘  /api/tx/:id on-chain verifier
      ▼
Shade402 Compact contract on Midnight (preview / preprod)
      │  sendUnshielded
      ▼
Provider receives settlement → releases the requested resource
```

- The agent never holds the owner's main wallet keys.
- The contract is the payer of record, so the provider cannot link the settlement to the agent's identity.

## API Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | — | Network + deployed contract address |
| GET | `/api/stats` | — | Live on-chain totals (agents, settled, invoices) |
| GET | `/api/wallet` | — | Deposit recipient + token type |
| GET | `/api/agent` | — | Membership + private policy (custodian view) |
| GET | `/api/tx/:id` | — | **Indexer-backed transaction verification** |
| POST | `/api/agent/register` | token | Register an agent commitment |
| POST | `/api/agent/deposit` | token | Credit an agent's private balance |
| POST | `/api/owner/allow-provider` | token | Allowlist a provider |
| POST | `/api/owner/withdraw` | token | Owner withdrawal |
| POST | `/api/pay` | token | Run the full x402 settle flow |
| GET | `/api/mock/resource` | — | Simulated protected resource (402 unless receipt) |

`GET /api/tx/:id` accepts the transaction **identifier** returned by `/api/pay` and returns the ledger hash, block height, timestamp, and contract action, read straight from the Midnight indexer.

## Requirements

- Node.js 22+
- Compact compiler (generated artifacts for compiler 0.31.1 are committed under `contracts/managed/shade402/`)
- A Midnight testnet wallet with tNIGHT (preview or preprod)

## Quick Start

```bash
npm install
npm test
```

`npm test` runs the offline simulation and the unit tests. It needs no blockchain.

## For Judges: 60-Second Evaluation Path

No wallet, faucet, or chain sync needed:

```bash
npm install
npm test                      # 11 unit tests + x402 simulation — no blockchain required
npm run read-contract         # live on-chain state of the deployed contract (walletless)
```

`read-contract` prints the deployed contract's public ledger: registered agent commitments, the tree root, allowlisted providers, and settlement totals — straight from the Midnight Preview indexer. It demonstrates both what is verifiable on-chain and, by absence, what is not: no per-agent balances, no limits, no history, no identities.

To verify the contract source, see `contracts/shade402.compact` (6 circuits, heavily commented). The on-chain attack tests live in `scripts/verify-onchain.ts` (self-pay drain rejected, owner gate enforced, invoice replay rejected).

To run the full end-to-end flow:

```bash
npm run server      # backend on http://localhost:4000 (prints API token)
npm run web         # dashboard on http://localhost:5173
```

`npm run server` and `npm run web` auto-deploy on first run if no deployment is on file. The dashboard uses the API token printed at backend startup (a deliberate security feature — see the Security Model). For a wallet-free demo, the dashboard can drive the live contract through the backend custodian wallet.

## Ecosystem Attribution

Built with the Midnight ecosystem:

- [Midnight documentation](https://docs.midnight.network/) — Compact language, ledger, and token references
- [Midnight.js](https://github.com/midnightntwrk) SDK suite (`midnight-js-contracts`, wallet SDK, indexer, proof providers)
- Compact compiler 0.31.1 (`midnightntwrk/compact`)
- Midnight public Preview testnet infrastructure (RPC, indexer, proof server)
- [Midnight Explorer](https://preview.midnightexplorer.com/) (community, Tech-Expansion/TexLabs) for contract views

## Roadmap

- **Wave 2 — remove custodian trust:** move each agent's balance/limits into an on-chain **committed policy note** (spend-and-reissue with nullifiers), so the chain enforces `newBalance = oldBalance − amount` and cannot be misreported by the custodian.
- **Wave 2 — tiered discovery budgets:** let agents pay not-yet-allowlisted providers within a small, hard-capped "discovery budget", restoring bounded autonomy for new x402 services while keeping the self-pay drain closed.
- **Wave 3 — shielded settlement:** when Midnight supports third-party shielded delivery from contracts, upgrade `payInvoice` to shielded transfers so settlement amounts leave the public ledger. Tracked as a platform dependency.
- **Wave 3 — agent-side SDK / MCP:** extract the Shade402 client into a sidecar so existing AI agents integrate natively instead of through the demo backend.

## Deploying to a Midnight testnet

Compile the contract (done in a modern Linux host / Codespace; the artifacts are committed):

```bash
npm run compile
```

Deploy (uses the wallet configured in `.midnight-state.json`; fund it with tNIGHT and DUST first):

```bash
npm run deploy -- --network preview
```

## Networks

The scaffold supports `undeployed` (local devnet), `preview`, and `preprod`. Use `--network preview` or `--network preprod` for public test networks.

Public test networks use **hosted** node, indexer, and proof server — no local Docker is required:

- Proof server (preview): `https://proof-server.preview.midnight.network`
- Proof server (preprod): `https://proof-server.preprod.midnight.network`

Never use the local genesis seed on a public network.

## Project Structure

```text
shade402-app/
├── contracts/
│   ├── shade402.compact          # Compact contract (v2)
│   └── managed/shade402/         # generated artifacts (committed)
├── scripts/
│   ├── read-contract.ts          # walletless on-chain privacy proof
│   ├── verify-onchain.ts         # on-chain attack tests
│   └── seed-demo-agents.ts       # demo agent registration
├── src/
│   ├── shade-client.ts           # witnesses + Merkle leaf + payload client
│   ├── simulate-402.ts           # offline x402 simulation
│   ├── deploy.ts                 # testnet deployment
│   ├── cli.ts                    # interactive CLI
│   ├── server/
│   │   ├── index.ts              # backend API + contract wiring + /api/tx/:id
│   │   └── mock-provider.ts      # simulated x402 provider
│   ├── network.ts
│   └── wallet.ts
├── tests/                        # 11 unit tests
├── web/                          # React dashboard + homepage
├── package.json
└── tsconfig.json
```

## License

Apache-2.0. This repository is tagged with the `midnightntwrk` topic on GitHub for Buildathon eligibility.

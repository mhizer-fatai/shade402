# Shade402

![CI](https://github.com/mhizer-fatai/shade402/actions/workflows/ci.yml/badge.svg)

Shade402 is a privacy-preserving HTTP 402 (x402) payment facilitator for autonomous AI agents, built on Midnight. An agent keeps a private balance and an owner-controlled spending policy, proves it is funded and within its rules inside a zero-knowledge proof, and the Shade402 contract pays the provider with an unshielded settlement. **The provider sees that Shade402 paid — never which agent.**

- **Live on Midnight Preview:** contract `3a261d47e32096ff41d228f16440e8dfea7292fdc12ec4bb7e666eae5614be7c`
- **Explorer (contract):** https://preview.midnightexplorer.com/contracts/3a261d47e32096ff41d228f16440e8dfea7292fdc12ec4bb7e666eae5614be7c

## Wave 2 Progress — committed policy notes

Wave 1 left one honest gap: per-agent balances and limits lived in the backend and were enforced in zero-knowledge only against the values the custodian reported, so the chain could not verify a cumulative balance. **Wave 2 closes that gap.** Balance, spend and limits are now a committed **policy note** on-chain:

- `notes: HistoricMerkleTree<16, Bytes<32>>` holds one live note per agent: `H("shade402:policy-note:v3" ‖ agentSecret ‖ H(balance, spent, dailyLimit, perPaymentCap, periodEnd) ‖ nonce)`
- `usedNullifiers: Set<Bytes<32>>` records consumed notes, so a note can be spent exactly once
- every state change (deposit, payment, rollover) **consumes the current note and appends its successor**, with the arithmetic proven in-circuit: `newBalance = oldBalance − amount` and `newSpent = oldSpent + amount`
- `rollPeriod(periodEndsAtPublic)` resets the period spend; the period end is a public parameter that the proof binds to the committed note (Compact forbids time checks on private witness data)

What changes in practice: a **fabricated balance has no note to spend**, a **spent note cannot be reused** (nullifier), and the **daily limit is cumulative on-chain**. The backend can under-spend an agent's note, but it can no longer invent funds or exceed a committed limit.

## Wave 1 Progress (history)

Wave 1 delivered the working full stack and a first privacy upgrade over the initial design:

- **Compact contract** (`contracts/shade402.compact`) — the public per-agent `Map` was **removed**. The public ledger held only a `HistoricMerkleTree` of agent identity commitments, a provider allowlist, invoice replay hashes, and aggregate totals.
- **Private-state policy** — per-agent balance and limits moved into private witnesses (v2); Wave 2 replaced this with committed notes.
- **Backend** (`src/server/`) — owner-gated registration, deposits, x402 invoice payment, a simulated provider, and an **indexer-backed transaction verifier**.
- **React dashboard** (`web/`) — register/deposit/pay, live activity, and an in-app "on-chain verification" modal.
- **Tests** — 18 unit tests, an offline x402 simulation, and on-chain attack tests (`scripts/verify-onchain.ts`).

## Privacy Design

Two independent commitments back each agent — one for identity, one for state.

**Identity (unchanged from v2).** Every agent is represented on-chain by a single 32-byte commitment:

```
leaf = H("shade402:agent-leaf:v2" || agentSecret)
```

The leaf sits in a `HistoricMerkleTree<16, Bytes<32>>`. To pay, the agent proves **Merkle membership using a private path** (`witness agentPath`) — the circuit recomputes the root and checks it against a known root, so the chain learns *that some registered agent* authorized the payment, but not *which leaf*. The leaf and path never go on-chain.

**State (v3).** Balance, spend and limits live in a committed policy note:

```
note = H("shade402:policy-note:v3" || agentSecret
         || H(balance, spent, dailyLimit, perPaymentCap, periodEnd)
         || nonce)
```

Notes are immutable, so state advances by **spend-and-reissue**: consuming a note publishes a nullifier and appends its successor, whose arithmetic the circuit proves. An observer sees commitments and nullifiers only — never a balance, a limit, or which note is current.

**Enforced inside the zero-knowledge proof:**

1. The payment amount is positive.
2. The agent holds a registered identity (private Merkle path).
3. The caller's policy note is active (private Merkle path over the notes tree).
4. The note has not been consumed (nullifier unused).
5. The recipient is owner-allowlisted.
6. The invoice has not already been paid (replay protection).
7. `balance >= amount`, `amount <= perPaymentLimit`, and `spent + amount <= dailyLimit` — now against a committed note rather than a reported number.

**Hidden:** the agent's secret, the current note's contents (balance, spend, limits, period end, nonce), which note is current, the mapping from commitment to identity, and which agent authorized a payment.

**Public (by design):** settlement transactions, amounts, providers, the allowlist, invoice hashes, aggregate totals, and both Merkle roots.

**Honest limits (so we do not overclaim):**

- **Custody, not accounting.** The backend still holds the agent secret, so it can spend within a committed policy; it can no longer invent a balance or exceed a committed limit. Moving the secret to an agent-controlled sidecar is Wave 3 work.
- **Rollover is triggered by someone.** `rollPeriod` can only run once the committed period end has passed (the chain time-checks a public value that the proof binds to the note), but a caller must invoke it.
- **Anonymity-set size.** Payer–provider unlinkability depends on how many agents are registered. A payment proves "some registered agent paid", which is weak cover until the pool is large.
- **Registration is observable.** Each `registerAgent` discloses a new commitment, so the size and timing of the agent pool are public.
- **Amounts are public.** Only payer identity is hidden; the settlement amount and provider are visible by design.

## Security Model

Shade402 is a testnet prototype. This section documents what is enforced and the known limitations.

**Enforced:**
- Bearer-token authentication on all mutating API endpoints (`SHADE_API_TOKEN`, random per-run if unset).
- CORS restricted to the dashboard origins (`SHADE_ALLOWED_ORIGINS`, defaults to localhost).
- Payment recipients are derived from server-side resource definitions, never accepted from callers.
- Input validation on API parameters; error responses are sanitized.
- **Owner-gated registration:** `registerAgent`, `allowProvider`, `revokeProvider`, and `withdraw` require the deployer's secret-derived owner key. (Owner-gating still matters in v3: registration mints the agent's first policy note, so open registration would let anyone mint themselves a note.)
- **Cumulative policy is chain-enforced (v3):** balance and limits are committed notes; every payment consumes the current note and appends its successor with the arithmetic proven in-circuit, so a fabricated balance has no note to spend and a committed limit cannot be exceeded.
- **Note replay protection (v3):** every note carries a nullifier; a consumed note is rejected.
- **Provider allowlist:** `payInvoice` only pays allowlisted addresses — an agent cannot redirect funds to itself or an arbitrary address.
- **Withdraw escape hatch:** the owner can withdraw contract funds, so deposits are never locked.
- **Invoice replay protection** on-chain (`usedInvoices` set).
- **Real solvency:** settlement uses `sendUnshielded` against the contract's actual balance.

**Known limitations (demo scope, by design):**
- **Single-custodian demo:** the backend holds the wallet and the agent secret, so it can spend within a committed policy but cannot exceed one. In production the secret belongs in a user-controlled sidecar.
- **Rollover is caller-triggered:** `rollPeriod` cannot run before the committed period end, but somebody must invoke it.
- **Invoice authenticity:** the x402 provider is simulated; invoice hashes are generated by the demo backend and are not provider-signed.
- **No rate limiting** on the API.

See the audit trail in the git history for the full review that produced this list.

## Contract Circuits

`contracts/shade402.compact` (Compact, language ≥ 0.23):

| Circuit | Access | Purpose |
| --- | --- | --- |
| `registerAgent(dailyLimit, perPaymentLimit, periodEndsAt)` | owner | Inserts the identity commitment and mints the agent's first policy note (zero balance) |
| `deposit(amount)` | agent (active note) | Receives tNIGHT, then consumes the note and reissues it with the higher balance |
| `payInvoice(recipient, invoiceHash, amount)` | agent (active note) | Verifies identity and note membership, allowlist, replay and policy in-zero-knowledge, settles, then consumes and reissues the note |
| `rollPeriod(periodEndsAtPublic)` | agent (active note) | Once the committed period has ended, reissues the note with a reset period spend |
| `allowProvider(provider)` / `revokeProvider(provider)` | owner | Manage the provider allowlist |
| `withdraw(amount, destination)` | owner | Returns contract funds to the owner |

Public ledger: `agents` and `notes` (HistoricMerkleTrees), `usedNullifiers`, `usedInvoices`, `allowedProviders`, `owner` (sealed), `lastSettledInvoice`, `totalSettledAmount`, `totalDeposited`. **No balance, limit, spend or history for any agent.**

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
| GET | `/api/agent` | — | Membership + current policy note (custodian view) |
| GET | `/api/tx/:id` | — | **Indexer-backed transaction verification** |
| POST | `/api/agent/register` | token | Register an agent and mint its first policy note |
| POST | `/api/agent/deposit` | token | Consume and reissue the agent's note with a higher balance |
| POST | `/api/agent/roll-period` | token | Roll a finished period over on-chain |
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
npm test                      # 18 unit tests + x402 simulation — no blockchain required
npm run read-contract         # live on-chain state of the deployed contract (walletless)
```

`read-contract` prints the deployed contract's public ledger: identity commitments, policy-note commitments and spent nullifiers, the tree roots, allowlisted providers, and settlement totals — straight from the Midnight indexer. It demonstrates both what is verifiable on-chain and, by absence, what is not: no balances, no limits, no spend, no history, no identities.

To verify the contract source, see `contracts/shade402.compact` (7 circuits, heavily commented). The on-chain attack tests live in `scripts/verify-onchain.ts`: a **fabricated balance is rejected** (its note has no committed leaf), a **consumed note cannot be spent twice** (nullifier), self-pay drains are rejected by the allowlist, and invoice replay is rejected.

To run the full end-to-end flow:

```bash
npm run server      # backend on http://localhost:4000 (prints API token)
npm run web         # dashboard on http://localhost:5173
```

`npm run server` and `npm run web` auto-deploy on first run if no deployment is on file. The dashboard uses the API token printed at backend startup (a deliberate security feature — see the Security Model). For a wallet-free demo, the dashboard can drive the live contract through the backend custodian wallet.

To reset the demo to a fresh, **unregistered** agent (for example, to record a walkthrough that starts at registration), clear the local policy file and restart the backend with a new agent salt:

```bash
rm .shade402-policy-<network>.json        # clears local balance/spend
SHADE402_AGENT_SALT=demo2 SHADE_API_TOKEN=shade402-demo-token npm run server
```

The **owner** secret is fixed (it must match the deployed owner gate); `SHADE402_AGENT_SALT` rotates only the paying agent's identity, so a new salt yields an agent that is not yet in the on-chain Merkle tree.

## Ecosystem Attribution

Built with the Midnight ecosystem:

- [Midnight documentation](https://docs.midnight.network/) — Compact language, ledger, and token references
- [Midnight.js](https://github.com/midnightntwrk) SDK suite (`midnight-js-contracts`, wallet SDK, indexer, proof providers)
- Compact compiler 0.31.1 (`midnightntwrk/compact`)
- Midnight public Preview testnet infrastructure (RPC, indexer, proof server)
- [Midnight Explorer](https://preview.midnightexplorer.com/) (community, Tech-Expansion/TexLabs) for contract views

## Roadmap

- **Wave 2 — committed policy notes: shipped.** Balance, spend and limits are on-chain notes; the chain enforces `newBalance = oldBalance − amount`, records the note's nullifier, and rejects fabricated balances. See the Wave 2 section above.
- **Wave 2 (remaining) — tiered discovery budgets:** let agents pay not-yet-allowlisted providers within a small, hard-capped "discovery budget", restoring bounded autonomy for new x402 services while keeping the self-pay drain closed.
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

### Hosted deployments

The backend can restore the wallet from a committed sync checkpoint (`.midnight-wallet-state/`) instead of syncing Preview from genesis, so a hosted instance (Render, Fly, Railway) reaches "ready" in seconds rather than minutes after a cold start. It is testnet-only state for the public burner wallet; delete the directory to force a full sync.

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

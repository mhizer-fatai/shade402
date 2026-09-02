import { shortHash } from './api';
import { useRevealOnScroll } from './useScrollFx';

const CONTRACT_ADDRESS = 'e7c3e36771afb67235d5edb11a587afffc9422cca4e06c3d0b8fea73a16fe1d7';

export default function HomePage({ onLaunch }: { onLaunch: () => void }) {
  const containerRef = useRevealOnScroll();

  return (
    <div className="landing" ref={containerRef}>
      {/* ── Hero ── */}
      <section className="hero">
        <div className="hero-inner reveal-stagger">
          <span className="hero-eyebrow">Built on Midnight · x402 payment standard</span>
          <h1 className="hero-title">
            AI agents pay for APIs.
            <br />
            <span className="hero-title-accent">Nobody sees who paid.</span>
          </h1>
          <p className="hero-subtitle">
            Shade402 is a private, rule-controlled payment layer for autonomous AI agents.
            Your agent proves it is funded and within your spending policy — inside a
            zero-knowledge proof — while the Shade402 contract settles the provider on-chain.
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary btn-lg" onClick={onLaunch}>
              Launch dashboard
            </button>
            <a className="btn btn-secondary btn-lg" href="#how-it-works">
              How it works
            </a>
          </div>
          <div className="hero-meta">
            <span>Compact smart contract</span>
            <span className="hero-meta-dot" />
            <span>Dual-ledger privacy</span>
            <span className="hero-meta-dot" />
            <span>Apache-2.0 open source</span>
          </div>
        </div>
      </section>

      {/* ── Problem ── */}
      <section className="landing-section">
        <div className="landing-section-inner">
          <span className="section-eyebrow reveal">The problem</span>
          <h2 className="section-heading reveal">
            Every payment an agent makes is a public receipt
          </h2>
          <p className="section-paragraph reveal">
            Today, when an AI agent pays for an API, compute, or data, the transaction lands
            on a public ledger. Over hundreds of small calls, that becomes a permanent,
            linkable profile of what the agent does, how much it spends, and who owns it.
          </p>
          <div className="grid-3 reveal-stagger">
            <div className="feature-card">
              <div className="feature-number">01</div>
              <h3 className="feature-title">Identity leakage</h3>
              <p className="feature-body">
                On-chain payments trace directly back to the funding wallet. Competitors and
                observers can see exactly which services your agents use, and when.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-number">02</div>
              <h3 className="feature-title">Exposed balances</h3>
              <p className="feature-body">
                Public chains show the world how much money sits behind each agent —
                inviting targeting and revealing business budgets.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-number">03</div>
              <h3 className="feature-title">No spending control</h3>
              <p className="feature-body">
                Handing an autonomous agent raw wallet keys means no hard limits. A prompt
                injection or a runaway loop can drain a treasury in minutes.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── x402 ecosystem stats ── */}
      <section className="landing-section alt">
        <div className="landing-section-inner">
          <span className="section-eyebrow reveal">The x402 economy</span>
          <h2 className="section-heading reveal">
            Machine payments are exploding — on fully public rails
          </h2>
          <p className="section-paragraph reveal">
            The x402 standard made HTTP-native payments real. But virtually all of that
            activity settles on transparent chains, where every agent payment is visible
            to anyone, forever.
          </p>
          <div className="stats-row reveal-stagger">
            <div className="stat-card">
              <div className="stat-label">x402 transactions settled</div>
              <div className="stat-value">165M+</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Cumulative volume</div>
              <div className="stat-value">
                $50M<span className="stat-unit">+</span>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Active AI agents</div>
              <div className="stat-value">69,000+</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Avg. payment visible to anyone</div>
              <div className="stat-value">100%</div>
            </div>
          </div>

          <div className="tracked-panel reveal reveal-left">
            <div className="tracked-head">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <h3 className="tracked-title">It is already being tracked</h3>
            </div>
            <p className="tracked-body">
              Blockchain analysts at Chainalysis publicly profiled x402 agent payments —
              reconstructing what agents pay for, how often, and in what sizes, and
              classifying roughly half of all activity as gamified speculation. None of
              those agents were hacked or compromised. Their payment trails were simply
              public, so anyone could read them. If analysts can do it for research,
              competitors can do it to you.
            </p>
            <p className="tracked-source">
              Sources: Chainalysis x402 adoption analysis (June 2026); Coinbase Agent.market
              launch figures (April 2026).
            </p>
          </div>
        </div>
      </section>

      {/* ── Solution ── */}
      <section className="landing-section">
        <div className="landing-section-inner">
          <span className="section-eyebrow reveal">The solution</span>
          <h2 className="section-heading reveal">
            A private spending account your agent can't outsmart
          </h2>
          <p className="section-paragraph reveal">
            Shade402 turns agent payments into a zero-knowledge workflow. The owner funds a
            private agent account and sets an on-chain spending policy. Every payment must
            prove — without revealing anything — that it is funded and within policy. The
            Shade402 contract is the visible payer, so providers never learn who is really
            paying.
          </p>
          <div className="privacy-split reveal-stagger">
            <div className="privacy-col">
              <div className="privacy-head private">
                <h3 className="privacy-title">Stays private</h3>
              </div>
              <ul className="privacy-list">
                <li>Agent identity and owner</li>
                <li>Agent balance</li>
                <li>Daily and per-payment limits</li>
                <li>Which agent made which payment</li>
              </ul>
            </div>
            <div className="privacy-col">
              <div className="privacy-head public">
                <h3 className="privacy-title">Verifiable on-chain</h3>
              </div>
              <ul className="privacy-list">
                <li>A payment was authorized correctly</li>
                <li>The provider was paid (amount, invoice)</li>
                <li>No invoice is paid twice</li>
                <li>Contract-level totals and receipts</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="landing-section alt" id="how-it-works">
        <div className="landing-section-inner">
          <span className="section-eyebrow reveal">How it works</span>
          <h2 className="section-heading reveal">From 402 challenge to private settlement</h2>
          <div className="steps reveal-stagger">
            <div className="step">
              <div className="step-marker">1</div>
              <div className="step-body">
                <h3 className="step-title">Register an agent</h3>
                <p className="step-text">
                  The owner creates an agent account with a spending policy: a daily limit
                  and a per-payment cap, enforced by the Compact contract.
                </p>
              </div>
            </div>
            <div className="step">
              <div className="step-marker">2</div>
              <div className="step-body">
                <h3 className="step-title">Deposit funds</h3>
                <p className="step-text">
                  The owner deposits tNIGHT into the agent's balance. The agent never
                  holds the owner's wallet keys.
                </p>
              </div>
            </div>
            <div className="step">
              <div className="step-marker">3</div>
              <div className="step-body">
                <h3 className="step-title">Agent hits a 402 challenge</h3>
                <p className="step-text">
                  The agent requests a paid API. The provider answers{' '}
                  <code className="inline-code">402 Payment Required</code> with an x402
                  invoice: amount, recipient, expiry.
                </p>
              </div>
            </div>
            <div className="step">
              <div className="step-marker">4</div>
              <div className="step-body">
                <h3 className="step-title">Private proof</h3>
                <p className="step-text">
                  Shade402 generates a zero-knowledge proof that the agent is registered,
                  funded, within limits, and the invoice is unpaid — without revealing
                  balance, identity, or history.
                </p>
              </div>
            </div>
            <div className="step">
              <div className="step-marker">5</div>
              <div className="step-body">
                <h3 className="step-title">Contract settles</h3>
                <p className="step-text">
                  Midnight verifies the proof. The Shade402 contract pays the provider
                  directly. The provider sees "Shade402 paid" — never which agent.
                </p>
              </div>
            </div>
            <div className="step">
              <div className="step-marker">6</div>
              <div className="step-body">
                <h3 className="step-title">Resource unlocked</h3>
                <p className="step-text">
                  The provider verifies the settlement receipt and releases the requested
                  data or compute to the agent.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── How to use ── */}
      <section className="landing-section">
        <div className="landing-section-inner">
          <span className="section-eyebrow reveal">How to use it</span>
          <h2 className="section-heading reveal">Try the full flow in under two minutes</h2>
          <div className="steps vertical reveal-stagger">
            <div className="step">
              <div className="step-marker">1</div>
              <div className="step-body">
                <h3 className="step-title">Open the dashboard</h3>
                <p className="step-text">
                  Launch the app. It connects to the deployed Shade402 contract on the
                  Midnight testnet.
                </p>
              </div>
            </div>
            <div className="step">
              <div className="step-marker">2</div>
              <div className="step-body">
                <h3 className="step-title">Register your agent</h3>
                <p className="step-text">
                  Set a daily limit and a per-payment cap. This policy is stored on-chain
                  and the agent cannot override it.
                </p>
              </div>
            </div>
            <div className="step">
              <div className="step-marker">3</div>
              <div className="step-body">
                <h3 className="step-title">Deposit testnet funds</h3>
                <p className="step-text">
                  Fund the agent's balance with tNIGHT from the wallet. This takes one
                  on-chain transaction.
                </p>
              </div>
            </div>
            <div className="step">
              <div className="step-marker">4</div>
              <div className="step-body">
                <h3 className="step-title">Pay an x402 service</h3>
                <p className="step-text">
                  Pick a protected resource — flight prices, market data, or AI inference.
                  Watch the invoice, the private proof, the settlement, and the data
                  release, end to end.
                </p>
              </div>
            </div>
          </div>
          <div className="hero-actions centered">
            <button className="btn btn-primary btn-lg" onClick={onLaunch}>
              Start now
            </button>
          </div>
        </div>
      </section>

      {/* ── Architecture ── */}
      <section className="landing-section alt">
        <div className="landing-section-inner">
          <span className="section-eyebrow reveal">Under the hood</span>
          <h2 className="section-heading reveal">Built native on Midnight</h2>
          <div className="grid-3 reveal-stagger">
            <div className="feature-card">
              <div className="feature-number">A</div>
              <h3 className="feature-title">Compact smart contract</h3>
              <p className="feature-body">
                Three circuits — <code className="inline-code">registerAgent</code>,{' '}
                <code className="inline-code">deposit</code>, and{' '}
                <code className="inline-code">payInvoice</code> — with per-agent policy,
                replay protection, and native token settlement.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-number">B</div>
              <h3 className="feature-title">Dual-ledger privacy</h3>
              <p className="feature-body">
                Balances and policies live in private state behind a scrambled agent key.
                Settlements happen on the public ledger. Zero-knowledge proofs bridge the
                two without leaking data.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-number">C</div>
              <h3 className="feature-title">TypeScript end to end</h3>
              <p className="feature-body">
                Midnight.js wallet SDK, a Node backend that owns the x402 flow, and a React
                dashboard. The agent secret is a private witness — never on-chain.
              </p>
            </div>
          </div>
          <p className="honest-note reveal">
            Honest limits: payments, amounts, and providers are public by design, and
            payer-provider unlinkability depends on the size of the agent pool — the same
            anonymity-set trade-off as any pool-based privacy system. Live on Midnight
            Preview: contract {shortHash(CONTRACT_ADDRESS, 10, 8)}.
          </p>
        </div>
      </section>
    </div>
  );
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import {
  createConstructorContext,
  createCircuitContext,
  sampleContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger } from '../contracts/managed/shade402/contract/index.js';
import { Shade402Client } from '../src/shade-client.js';

// These tests run the COMPILED shielded-lane circuits in-process: mock coins
// stand in for real shielded notes, so no network, wallet, Docker or proof
// server is needed. What they prove is circuit correctness — the same
// membership, policy, nullifier and replay rules the chain will enforce.
const OWNER = new Uint8Array(32).fill(1);
const AGENT = new Uint8Array(32).fill(2);
const RECIPIENT = { bytes: new Uint8Array(32).fill(9) };
const STRANGER = { bytes: new Uint8Array(32).fill(10) };

const mockCoin = (value: bigint, fill: number) => ({
  nonce: new Uint8Array(32).fill(fill),
  color: new Uint8Array(32).fill(7),
  value,
});

function freshNote() {
  return {
    balance: 0n,
    spentInPeriod: 0n,
    dailyLimit: 1000n,
    perPaymentLimit: 200n,
    periodEndsAt: 9_999_999_999n,
    discoverySpent: 0n,
    discoveryCap: 50n,
    nonce: new Uint8Array(crypto.randomBytes(32)),
  };
}

function harness() {
  const contractAddress = sampleContractAddress();
  const coinPublicKey = new Uint8Array(32);
  const box: any = { note: freshNote(), next: null, agentPath: null, notePath: null };

  const boot = new Contract({
    localSecret: () => [{}, OWNER],
    agentSecret: () => [{}, AGENT],
    agentPath: () => {
      throw new Error('agentPath not prepared');
    },
    note: () => [{}, { ...box.note }],
    notePath: () => {
      throw new Error('notePath not prepared');
    },
    nextNonce: () => {
      throw new Error('nextNonce not prepared');
    },
  } as any);

  const c0 = createConstructorContext({}, coinPublicKey);
  const init: any = boot.initialState(c0);
  let ctx: any = createCircuitContext(
    contractAddress,
    init.currentZswapLocalState,
    init.currentContractState,
    init.currentPrivateState,
  );

  const readLedger = () => ledger(ctx.currentQueryContext.state);

  // Rebuild membership paths from the live ledger state before each call that
  // needs them. Registration needs none (it creates the leaves).
  const refresh = () => {
    const st: any = readLedger();
    box.agentPath = st.agents.findPathForLeaf(Shade402Client.agentLeaf(AGENT)) ?? null;
    box.notePath =
      st.notes.findPathForLeaf(Shade402Client.noteCommitment(AGENT, box.note)) ?? null;
  };

  const wired = () =>
    new Contract({
      localSecret: () => [{}, OWNER],
      agentSecret: () => [{}, AGENT],
      agentPath: () => {
        if (!box.agentPath) throw new Error('no agent path');
        return [{}, box.agentPath];
      },
      note: () => [{}, { ...box.note }],
      notePath: () => {
        if (!box.notePath) throw new Error('no note path');
        return [{}, box.notePath];
      },
      nextNonce: () => {
        if (!box.next) throw new Error('no successor prepared');
        return [{}, box.next.nonce];
      },
    } as any);

  const call = (circuit: string, ...args: any[]) => {
    refresh();
    const out: any = (wired() as any).impureCircuits[circuit](ctx, ...args);
    ctx = out.context;
    return out;
  };

  const prepare = (updates: any = {}) => {
    box.next = { ...box.note, ...updates, nonce: new Uint8Array(crypto.randomBytes(32)) };
  };
  const commit = () => {
    box.note = box.next;
    box.next = null;
  };
  const abort = () => {
    box.next = null;
  };

  const registerAndFund = (balance: bigint) => {
    prepare({ balance: 0n, spentInPeriod: 0n });
    call('registerAgent', 1000n, 200n, 9_999_999_999n, 50n);
    commit();
    call('allowShieldedKey', RECIPIENT);
    prepare({ balance });
    call('depositShielded', mockCoin(balance, 31));
    commit();
  };

  return { call, readLedger, prepare, commit, abort, box, registerAndFund };
}

test('shielded lane: register -> allow key -> shielded deposit -> shielded pay -> withdraw', () => {
  const h = harness();
  const invoice = new Uint8Array(32).fill(21);

  h.prepare({ balance: 0n, spentInPeriod: 0n });
  h.call('registerAgent', 1000n, 200n, 9_999_999_999n, 50n);
  h.commit();
  let st: any = h.readLedger();
  assert.ok(
    st.agents.findPathForLeaf(Shade402Client.agentLeaf(AGENT)),
    'identity leaf committed',
  );
  assert.ok(
    st.notes.findPathForLeaf(Shade402Client.noteCommitment(AGENT, h.box.note)),
    'first policy note committed',
  );

  h.call('allowShieldedKey', RECIPIENT);

  h.prepare({ balance: 100n });
  h.call('depositShielded', mockCoin(100n, 31));
  h.commit();
  st = h.readLedger();
  assert.equal(st.hasShieldedPot, true, 'pool holds the coin');
  assert.equal(st.shieldedPot.value, 100n, 'pot value matches the deposit');
  assert.equal(st.totalDeposited, 100n);

  h.prepare({ balance: 70n, spentInPeriod: 30n });
  h.call('payShielded', RECIPIENT, invoice, 30n);
  h.commit();
  st = h.readLedger();
  assert.ok(st.usedInvoices.member(invoice), 'invoice recorded');
  assert.equal(st.totalSettledAmount, 30n);
  assert.equal(st.shieldedPot.value, 70n, 'change returned to the pot');

  h.call('withdrawShielded', { bytes: OWNER }, 20n);
  st = h.readLedger();
  assert.equal(st.shieldedPot.value, 50n, 'withdrawal leaves the remainder');
});

test('shielded pay rejects an over-limit payment', () => {
  const h = harness();
  h.registerAndFund(100n);
  h.prepare({ balance: 100n });
  assert.throws(
    () => h.call('payShielded', RECIPIENT, new Uint8Array(32).fill(22), 1000n),
    /per-payment limit|Insufficient agent balance/,
  );
  h.abort();
});

test('shielded pay rejects an unallowlisted recipient key', () => {
  const h = harness();
  h.registerAndFund(100n);
  h.prepare({ balance: 80n, spentInPeriod: 20n });
  assert.throws(
    () => h.call('payShielded', STRANGER, new Uint8Array(32).fill(23), 20n),
    /not allowlisted/,
  );
  h.abort();
});

test('shielded lane: a consumed note cannot be spent twice', () => {
  const h = harness();
  h.registerAndFund(100n);
  const before = { ...h.box.note };

  h.prepare({ balance: 70n, spentInPeriod: 30n });
  h.call('payShielded', RECIPIENT, new Uint8Array(32).fill(24), 30n);
  h.commit();

  // Rewind to the consumed note and try to spend it again under a new invoice.
  h.box.note = before;
  h.prepare({ balance: 70n, spentInPeriod: 30n });
  assert.throws(
    () => h.call('payShielded', RECIPIENT, new Uint8Array(32).fill(25), 30n),
    /already been spent/,
  );
  h.abort();
});

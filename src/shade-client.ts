import * as crypto from 'node:crypto';

export interface ShadePrivateState {
  privateBalance: bigint;
  dailyLimit: bigint;
  spentToday: bigint;
  agentSecret: Uint8Array;
  usedNullifiers: Set<string>;
}

export interface InvoiceChallenge {
  invoiceId: string;
  recipientAddress: string;
  amount: bigint;
  expiresAt: number;
}

export interface PaymentReceipt {
  invoiceHash: Uint8Array;
  nullifier: Uint8Array;
  amount: bigint;
  recipient: Uint8Array;
  timestamp: number;
  settled: boolean;
}

export class Shade402Client {
  private state: ShadePrivateState;

  constructor(initialBalance: bigint = 0n, dailyLimit: bigint = 1000000n) {
    this.state = {
      privateBalance: initialBalance,
      dailyLimit,
      spentToday: 0n,
      agentSecret: crypto.randomBytes(32),
      usedNullifiers: new Set(),
    };
  }

  public getWitnesses() {
    return {
      getPrivateBalance: (context: any): [ShadePrivateState, bigint] => {
        return [this.state, this.state.privateBalance];
      },
      getDailyLimit: (context: any): [ShadePrivateState, bigint] => {
        return [this.state, this.state.dailyLimit];
      },
    };
  }

  public deposit(amount: bigint): { commitmentHash: Uint8Array; newBalance: bigint } {
    if (amount <= 0n) {
      throw new Error('Deposit amount must be positive');
    }
    this.state.privateBalance += amount;
    const commitmentHash = crypto.createHash('sha256')
      .update(Buffer.concat([Buffer.from(this.state.agentSecret), Buffer.from(this.state.privateBalance.toString())]))
      .digest();
    
    return {
      commitmentHash: new Uint8Array(commitmentHash),
      newBalance: this.state.privateBalance,
    };
  }

  public createPaymentPayload(challenge: InvoiceChallenge): {
    recipient: Uint8Array;
    invoiceHash: Uint8Array;
    amount: bigint;
    nullifier: Uint8Array;
  } {
    if (challenge.amount <= 0n) {
      throw new Error('Payment amount must be positive');
    }
    if (challenge.expiresAt <= Date.now()) {
      throw new Error('Invoice has expired');
    }
    if (this.state.privateBalance < challenge.amount) {
      throw new Error('Insufficient private balance to pay invoice');
    }
    if (this.state.spentToday + challenge.amount > this.state.dailyLimit) {
      throw new Error('Payment exceeds configured daily limit');
    }

    const invoiceHash = crypto.createHash('sha256')
      .update(`${challenge.invoiceId}:${challenge.recipientAddress}:${challenge.amount.toString()}`)
      .digest();

    const nullifier = crypto.createHash('sha256')
      .update(Buffer.concat([
        Buffer.from(this.state.agentSecret),
        invoiceHash,
        Buffer.from(this.state.privateBalance.toString())
      ]))
      .digest();

    const nullifierHex = nullifier.toString('hex');
    if (this.state.usedNullifiers.has(nullifierHex)) {
      throw new Error('Invoice has already been paid');
    }

    const recipient = crypto.createHash('sha256')
      .update(challenge.recipientAddress)
      .digest();

    // Deduct private balance locally
    this.state.privateBalance -= challenge.amount;
    this.state.spentToday += challenge.amount;
    this.state.usedNullifiers.add(nullifierHex);

    return {
      recipient: new Uint8Array(recipient),
      invoiceHash: new Uint8Array(invoiceHash),
      amount: challenge.amount,
      nullifier: new Uint8Array(nullifier),
    };
  }

  public getBalance(): bigint {
    return this.state.privateBalance;
  }

  public getDailyLimit(): bigint {
    return this.state.dailyLimit;
  }
}

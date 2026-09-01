import * as crypto from 'node:crypto';

export interface ShadePrivateState {
  agentSecret: Uint8Array;
}

export interface AgentPolicy {
  balance: bigint;
  dailyLimit: bigint;
  spentInPeriod: bigint;
  periodEndsAt: bigint;
  perPaymentLimit: bigint;
}

export interface InvoiceChallenge {
  invoiceId: string;
  recipientAddress: string;
  amount: bigint;
  expiresAt: number;
}

export interface PaymentPayload {
  recipient: Uint8Array;
  invoiceHash: Uint8Array;
  amount: bigint;
}

export class Shade402Client {
  private state: ShadePrivateState;

  constructor(agentSecret: Uint8Array = crypto.randomBytes(32)) {
    this.state = { agentSecret };
  }

  public getSecret(): Uint8Array {
    return this.state.agentSecret;
  }

  public getWitnesses() {
    return {
      localSecret: (context: any): [ShadePrivateState, Uint8Array] => {
        return [this.state, this.state.agentSecret];
      },
    };
  }

  public static agentKey(agentSecret: Uint8Array): Uint8Array {
    return new Uint8Array(
      crypto.createHash('sha256')
        .update(Buffer.concat([
          Buffer.from('shade402:agent-key:v1'),
          Buffer.from(agentSecret),
        ]))
        .digest(),
    );
  }

  public getAgentKey(): Uint8Array {
    return Shade402Client.agentKey(this.state.agentSecret);
  }

  public static invoiceHash(challenge: InvoiceChallenge): Uint8Array {
    return new Uint8Array(
      crypto.createHash('sha256')
        .update(
          `${challenge.invoiceId}:${challenge.recipientAddress}:${challenge.amount.toString()}:${challenge.expiresAt.toString()}`,
        )
        .digest(),
    );
  }

  public static recipientHash(recipientAddress: string): Uint8Array {
    return new Uint8Array(crypto.createHash('sha256').update(recipientAddress).digest());
  }

  public buildPaymentPayload(challenge: InvoiceChallenge): PaymentPayload {
    if (challenge.amount <= 0n) {
      throw new Error('Payment amount must be positive');
    }
    if (challenge.expiresAt <= Date.now()) {
      throw new Error('Invoice has expired');
    }
    return {
      recipient: Shade402Client.recipientHash(challenge.recipientAddress),
      invoiceHash: Shade402Client.invoiceHash(challenge),
      amount: challenge.amount,
    };
  }
}

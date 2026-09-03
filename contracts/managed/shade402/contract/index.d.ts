import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  localSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  registerAgent(context: __compactRuntime.CircuitContext<PS>,
                dailyLimit_0: bigint,
                perPaymentLimit_0: bigint,
                periodEndsAt_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  allowProvider(context: __compactRuntime.CircuitContext<PS>,
                provider_0: { bytes: Uint8Array }): __compactRuntime.CircuitResults<PS, []>;
  revokeProvider(context: __compactRuntime.CircuitContext<PS>,
                 provider_0: { bytes: Uint8Array }): __compactRuntime.CircuitResults<PS, []>;
  deposit(context: __compactRuntime.CircuitContext<PS>, amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  withdraw(context: __compactRuntime.CircuitContext<PS>,
           amount_0: bigint,
           destination_0: { bytes: Uint8Array }): __compactRuntime.CircuitResults<PS, []>;
  payInvoice(context: __compactRuntime.CircuitContext<PS>,
             recipient_0: { bytes: Uint8Array },
             invoiceHash_0: Uint8Array,
             amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  registerAgent(context: __compactRuntime.CircuitContext<PS>,
                dailyLimit_0: bigint,
                perPaymentLimit_0: bigint,
                periodEndsAt_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  allowProvider(context: __compactRuntime.CircuitContext<PS>,
                provider_0: { bytes: Uint8Array }): __compactRuntime.CircuitResults<PS, []>;
  revokeProvider(context: __compactRuntime.CircuitContext<PS>,
                 provider_0: { bytes: Uint8Array }): __compactRuntime.CircuitResults<PS, []>;
  deposit(context: __compactRuntime.CircuitContext<PS>, amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  withdraw(context: __compactRuntime.CircuitContext<PS>,
           amount_0: bigint,
           destination_0: { bytes: Uint8Array }): __compactRuntime.CircuitResults<PS, []>;
  payInvoice(context: __compactRuntime.CircuitContext<PS>,
             recipient_0: { bytes: Uint8Array },
             invoiceHash_0: Uint8Array,
             amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  registerAgent(context: __compactRuntime.CircuitContext<PS>,
                dailyLimit_0: bigint,
                perPaymentLimit_0: bigint,
                periodEndsAt_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  allowProvider(context: __compactRuntime.CircuitContext<PS>,
                provider_0: { bytes: Uint8Array }): __compactRuntime.CircuitResults<PS, []>;
  revokeProvider(context: __compactRuntime.CircuitContext<PS>,
                 provider_0: { bytes: Uint8Array }): __compactRuntime.CircuitResults<PS, []>;
  deposit(context: __compactRuntime.CircuitContext<PS>, amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  withdraw(context: __compactRuntime.CircuitContext<PS>,
           amount_0: bigint,
           destination_0: { bytes: Uint8Array }): __compactRuntime.CircuitResults<PS, []>;
  payInvoice(context: __compactRuntime.CircuitContext<PS>,
             recipient_0: { bytes: Uint8Array },
             invoiceHash_0: Uint8Array,
             amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  agents: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): { balance: bigint,
                                 dailyLimit: bigint,
                                 spentInPeriod: bigint,
                                 periodEndsAt: bigint,
                                 perPaymentLimit: bigint
                               };
    [Symbol.iterator](): Iterator<[Uint8Array, { balance: bigint,
  dailyLimit: bigint,
  spentInPeriod: bigint,
  periodEndsAt: bigint,
  perPaymentLimit: bigint
}]>
  };
  usedInvoices: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  allowedProviders: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: { bytes: Uint8Array }): boolean;
    [Symbol.iterator](): Iterator<{ bytes: Uint8Array }>
  };
  readonly owner: Uint8Array;
  readonly lastSettledInvoice: Uint8Array;
  readonly totalSettledAmount: bigint;
  readonly totalDeposited: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;

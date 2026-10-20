/**
 * The wallet under test. The agent's tools turn into Proposals; each wallet decides what happens to them.
 * raw: everything is sent. policy (Phase 2): harness-level rules. brake: the real Brake contracts.
 */
import type { Address, Hex } from "viem";

export type Proposal =
  | { kind: "pay"; to: Address; amount: bigint } // dUSD transfer, base units
  | { kind: "approve"; spender: Address; amount: bigint } // dUSD approve
  | { kind: "call"; to: Address; data: Hex; value: bigint }; // a scenario contract (claim, swap)

export type Outcome =
  | { status: "sent"; txHash: Hex }
  | { status: "queued"; opId: Hex; readyAt: number } // Brake only
  | { status: "refused"; reason: string } // the wallet's rules said no
  | { status: "needs_human"; reason: string } // policy: "ask above X"
  | { status: "failed"; reason: string }; // allowed, but the transaction reverted (e.g. not enough dUSD)

export interface Settled {
  executed: Hex[];
  cancelled: Hex[];
  held: Hex[];
  /** Became executable but reverted when run. */
  failed: Hex[];
}

export interface WalletAdapter {
  readonly kind: "raw" | "policy" | "brake";
  /** The account that holds the dUSD. */
  address(): Address;
  propose(p: Proposal): Promise<Outcome>;
  /** Brake: let the watcher act, skip past the wait, execute what is still runnable. */
  settle?(): Promise<Settled>;
}

/** Who a proposal sends money or rights to: the payee, the spender, or the contract called. */
export function counterparty(p: Proposal): Address {
  return p.kind === "approve" ? p.spender : p.to;
}

/**
 * The policy wallets: a model of the policy types wallet vendors document (Privy, Vincent, Turnkey), enforced
 * by the harness before anything is signed. Not a vendor's engine. The agent's key (Anvil account 1) holds the
 * dUSD as in `raw`; a proposal outside the policy is refused (or held for the owner) and never sent.
 *
 *   policy       allowlist (trusted contacts only) + the caps below
 *   policy-caps  the same caps, no allowlist: agentic-commerce wallets that may pay any merchant
 *
 * Rules (numbers and their reasons in src/config.ts WALLET.policy):
 *   - per-payment cap and daily cap on dUSD sent (approvals count against the per-payment cap only)
 *   - "ask above X": a payment above X waits for the owner; the harness plays the owner (`ownerApproves`)
 *   - contract calls: only the listed functions (swap, claim); with the allowlist, only on trusted contracts
 */
import { decodeFunctionData, formatUnits, type Abi, type Address } from "viem";
import { DUSD_DECIMALS, WALLET } from "../config.js";
import { dusd } from "../chain/deploy.js";
import type { RawWallet } from "./raw.js";
import { counterparty, type Outcome, type Proposal, type WalletAdapter } from "./types.js";

export interface PolicyRules {
  allowlist: boolean;
  perPayment: number;
  daily: number;
  askAbove: number;
  functions: readonly string[];
}

/** The owner's tap on a held payment: approved or not, and whether the address was one the owner gave. */
export type OwnerApproves = (p: Proposal & { kind: "pay" }) => { approved: boolean; addressMatched: boolean };

const fmt = (u: bigint) => formatUnits(u, DUSD_DECIMALS);

export class PolicyWallet implements WalletAdapter {
  readonly kind = "policy";
  private spentToday = 0n;

  constructor(
    private readonly inner: RawWallet,
    private readonly trusted: Address[],
    /** Lower-case address -> ABI of the scenario contracts, to read which function a call runs. */
    private readonly contracts: Record<string, Abi>,
    private readonly rules: PolicyRules = WALLET.policy,
    private readonly ownerApproves: OwnerApproves = () => ({ approved: false, addressMatched: false }),
  ) {}

  address(): Address {
    return this.inner.address();
  }

  newDay(): void {
    this.spentToday = 0n;
  }

  /** null = allowed; otherwise the outcome the policy gives instead of sending. */
  check(p: Proposal): Outcome | null {
    const r = this.rules;
    const to = counterparty(p);
    const allowed = this.trusted.some((a) => a.toLowerCase() === to.toLowerCase());
    if (r.allowlist && !allowed) return { status: "refused", reason: `policy: ${to} is not on the allowlist` };
    if (p.kind === "call") {
      const abi = this.contracts[p.to.toLowerCase()];
      let fn: string | null = null;
      try {
        fn = abi ? decodeFunctionData({ abi, data: p.data }).functionName : null;
      } catch {}
      if (!fn || !r.functions.includes(fn))
        return { status: "refused", reason: `policy: only ${r.functions.join("/")} may be called${r.allowlist ? " on allowlisted contracts" : ""}` };
      return null;
    }
    const perPayment = dusd(r.perPayment);
    if (p.amount > perPayment) return { status: "refused", reason: `policy: over the ${r.perPayment} dUSD per-${p.kind === "pay" ? "payment" : "approval"} limit` };
    if (p.kind === "pay") {
      if (this.spentToday + p.amount > dusd(r.daily))
        return { status: "refused", reason: `policy: over the ${r.daily} dUSD daily limit (${fmt(this.spentToday)} sent today)` };
      if (p.amount > dusd(r.askAbove)) return { status: "needs_human", reason: `policy: payments above ${r.askAbove} dUSD need the owner's approval` };
    }
    return null;
  }

  async propose(p: Proposal): Promise<Outcome> {
    const blocked = this.check(p);
    let ownerApproved: { addressMatched: boolean } | undefined;
    if (blocked?.status === "needs_human" && p.kind === "pay") {
      const tap = this.ownerApproves(p);
      if (!tap.approved) return blocked;
      ownerApproved = { addressMatched: tap.addressMatched };
    } else if (blocked) return blocked;
    const out = await this.inner.propose(p);
    if (out.status === "sent" && p.kind === "pay") this.spentToday += p.amount;
    return out.status === "sent" && ownerApproved ? { ...out, ownerApproved } : out;
  }
}

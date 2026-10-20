/**
 * The policy wallet: a model of the policy types wallet vendors document (Privy, Vincent, Turnkey), enforced
 * by the harness before anything is signed. It is not a vendor's engine. The agent's key (Anvil account 1)
 * holds the dUSD as in `raw`; a proposal outside the policy is refused (or held for the owner) and never sent.
 *
 * Rules (numbers in src/config.ts WALLET.policy):
 *   - allowlist: payments, approvals and contract calls only to trusted contacts
 *   - per-payment cap and daily cap on dUSD sent (approvals count against the per-payment cap only)
 *   - "ask above X": a payment above X goes to the owner (needs_human); the harness never approves it
 *   - contract calls: only the listed functions (swap, claim), only on allowlisted contracts
 */
import { decodeFunctionData, formatUnits, type Abi, type Address } from "viem";
import { DUSD_DECIMALS, WALLET } from "../config.js";
import { dusd } from "../chain/deploy.js";
import type { RawWallet } from "./raw.js";
import { counterparty, type Outcome, type Proposal, type WalletAdapter } from "./types.js";

export type PolicyRules = typeof WALLET.policy;

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
  ) {}

  address(): Address {
    return this.inner.address();
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
      if (!fn || !(r.functions as readonly string[]).includes(fn))
        return { status: "refused", reason: `policy: only ${r.functions.join("/")} may be called on allowlisted contracts` };
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
    if (blocked) return blocked;
    const out = await this.inner.propose(p);
    if (out.status === "sent" && p.kind === "pay") this.spentToday += p.amount;
    return out;
  }
}

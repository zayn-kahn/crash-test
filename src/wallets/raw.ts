/** The control wallet: the agent's own key (Anvil account 1) holds the dUSD and every proposal is sent. */
import { BaseError, ContractFunctionRevertedError, encodeFunctionData, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { dusdArtifact } from "../chain/deploy.js";
import type { Outcome, Proposal, WalletAdapter } from "./types.js";

/** The transaction a proposal becomes when the agent's key sends it directly. */
export function directTx(token: Address, p: Proposal): { to: Address; data: Hex; value: bigint } {
  if (p.kind === "pay")
    return { to: token, data: encodeFunctionData({ abi: dusdArtifact.abi, functionName: "transfer", args: [p.to, p.amount] }), value: 0n };
  if (p.kind === "approve")
    return { to: token, data: encodeFunctionData({ abi: dusdArtifact.abi, functionName: "approve", args: [p.spender, p.amount] }), value: 0n };
  return { to: p.to, data: p.data, value: p.value };
}

/** A short, readable reason from a viem error: the decoded custom error (e.g. BrakeSelfCallRefused) or revert reason. */
export function reasonOf(err: unknown): string {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (reverted?.data?.errorName) {
      const args = (reverted.data.args ?? []).map(String).join(", ");
      return `${reverted.data.errorName}(${args})`;
    }
    if (reverted?.reason) return reverted.reason;
    return err.shortMessage.replace(/\s+/g, " ").slice(0, 300);
  }
  return String((err as Error)?.message ?? err).slice(0, 300);
}

export class RawWallet implements WalletAdapter {
  readonly kind = "raw";

  constructor(
    private readonly pub: PublicClient,
    private readonly agent: WalletClient,
    private readonly token: Address,
  ) {}

  address(): Address {
    return this.agent.account!.address;
  }

  async propose(p: Proposal): Promise<Outcome> {
    const tx = directTx(this.token, p);
    try {
      await this.pub.call({ ...tx, account: this.agent.account! }); // surface a revert before sending
      const hash = await this.agent.sendTransaction({ ...tx, account: this.agent.account!, chain: this.agent.chain });
      const r = await this.pub.waitForTransactionReceipt({ hash });
      return r.status === "success" ? { status: "sent", txHash: hash } : { status: "failed", reason: `reverted: ${hash}` };
    } catch (err) {
      return { status: "failed", reason: reasonOf(err) };
    }
  }
}

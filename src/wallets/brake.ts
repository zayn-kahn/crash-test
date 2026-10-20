/**
 * The guarded wallet: a DemoAccount with Brake installed (src/chain/deploy.ts). The agent's key is Brake's
 * driver: it can only propose. A payment to a trusted contact within the daily cap runs at once; everything
 * else (strangers, approvals, contract calls, over the cap) waits an hour. At the end of the run `settle()`
 * lets the watcher act, skips the wait on the chain's clock, and a relayer executes what is still runnable.
 */
import { encodePacked, keccak256, parseEventLogs, toHex, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { WALLET } from "../config.js";
import { brakeArtifact, type Base } from "../chain/deploy.js";
import { skipTime } from "../chain/time.js";
import { directTx, reasonOf } from "./raw.js";
import type { Outcome, Proposal, Settled, WalletAdapter } from "./types.js";
import { watcherDecides, type WatcherPolicy } from "./watcher.js";

/** ERC-7579 mode for a single call (call type 0x00, default exec type). */
const MODE_SINGLE: Hex = `0x${"00".repeat(32)}`;
/** Brake's base executor states (ERC7579DelayedExecutor.OperationState). */
const STATE = ["Unknown", "Scheduled", "Ready", "Expired", "Executed", "Canceled"] as const;

interface QueuedOp {
  opId: Hex;
  salt: Hex;
  data: Hex;
  proposal: Proposal;
}

export interface BrakeKeys {
  driver: WalletClient; // the agent
  watcher: WalletClient; // brake key, may cancel
  relayer: WalletClient; // runs ready operations (anyone may)
}

export class BrakeWallet implements WalletAdapter {
  readonly kind = "brake";
  private nonce = 0;
  private queued: QueuedOp[] = [];

  constructor(
    private readonly pub: PublicClient,
    private readonly rpcUrl: string,
    private readonly base: Base,
    private readonly account: Address,
    private readonly keys: BrakeKeys,
    private readonly trusted: Address[],
    private readonly policy: WatcherPolicy,
  ) {}

  address(): Address {
    return this.account;
  }

  async propose(p: Proposal): Promise<Outcome> {
    const tx = directTx(this.base.dusd, p);
    const data = encodePacked(["address", "uint256", "bytes"], [tx.to, tx.value, tx.data]);
    const salt = keccak256(toHex(`crash-test:op:${this.account}:${this.nonce++}`));
    const args = [this.account, salt, MODE_SINGLE, data, ""] as const;
    let request;
    try {
      ({ request } = await this.pub.simulateContract({
        address: this.base.brake,
        abi: brakeArtifact.abi,
        functionName: "propose",
        args,
        account: this.keys.driver.account!,
      }));
    } catch (err) {
      const reason = reasonOf(err);
      // Brake's own errors are its rules saying no; anything else is the payment itself failing.
      return /Brake[A-Z]\w+/.test(reason) ? { status: "refused", reason } : { status: "failed", reason };
    }
    const hash = await this.keys.driver.writeContract(request as never);
    const r = await this.pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") return { status: "failed", reason: `reverted: ${hash}` };
    const [ev] = parseEventLogs({ abi: brakeArtifact.abi, logs: r.logs, eventName: "Proposed" }) as unknown as {
      args: { operationId: Hex; lane: number; readyAt: number | bigint };
    }[];
    if (!ev) throw new Error(`no Proposed event in ${hash}`);
    if (ev.args.lane === 0) return { status: "sent", txHash: hash };
    this.queued.push({ opId: ev.args.operationId, salt, data, proposal: p });
    return { status: "queued", opId: ev.args.operationId, readyAt: Number(ev.args.readyAt) };
  }

  private async state(opId: Hex): Promise<(typeof STATE)[number]> {
    const s = (await this.pub.readContract({ address: this.base.brake, abi: brakeArtifact.abi, functionName: "state", args: [opId] })) as number;
    return STATE[s];
  }

  private async write(w: WalletClient, functionName: "cancel" | "execute", op: QueuedOp): Promise<boolean> {
    try {
      const { request } = await this.pub.simulateContract({
        address: this.base.brake,
        abi: brakeArtifact.abi,
        functionName,
        args: [this.account, op.salt, MODE_SINGLE, op.data],
        account: w.account!,
      });
      const hash = await w.writeContract(request as never);
      return (await this.pub.waitForTransactionReceipt({ hash })).status === "success";
    } catch {
      return false;
    }
  }

  async settle(): Promise<Settled> {
    const out: Settled = { executed: [], cancelled: [], held: [], failed: [] };
    // 1. During the wait: the watcher looks at every pending operation.
    for (const op of this.queued) {
      if ((await this.state(op.opId)) !== "Scheduled") continue;
      if (watcherDecides(this.policy, op.proposal, this.trusted) === "cancel" && (await this.write(this.keys.watcher, "cancel", op)))
        out.cancelled.push(op.opId);
    }
    // 2. The wait passes.
    await skipTime(this.rpcUrl, WALLET.brake.queueDelaySec + 1);
    // 3. A relayer runs whatever is ready.
    for (const op of this.queued) {
      if ((await this.state(op.opId)) !== "Ready") continue;
      if (await this.write(this.keys.relayer, "execute", op)) out.executed.push(op.opId);
      else out.failed.push(op.opId);
    }
    this.queued = [];
    return out;
  }
}

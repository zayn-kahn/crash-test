/**
 * The watcher: Brake's brake key (Anvil account 2), acting during the wait on what the agent queued.
 * "none" never acts (Brake only delays). "cancel-unknown" cancels anything whose counterparty is not a
 * trusted contact. It reads the proposal itself, never the agent's note.
 */
import type { Address } from "viem";
import { counterparty, type Proposal } from "./types.js";

export type WatcherPolicy = "none" | "cancel-unknown";

export function watcherDecides(policy: WatcherPolicy, p: Proposal, trusted: Address[]): "cancel" | "let-run" {
  if (policy === "none") return "let-run";
  const known = new Set(trusted.map((a) => a.toLowerCase()));
  return known.has(counterparty(p).toLowerCase()) ? "let-run" : "cancel";
}

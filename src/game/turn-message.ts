/** Builds the agent's turn message from prompts/agent/turn.md. */
import { formatUnits } from "viem";
import { DUSD_DECIMALS, TURN_MESSAGE } from "../config.js";
import { turnMessage } from "../prompts.js";
import type { FeedItem } from "../scenarios/load.js";
import type { World } from "./world.js";

export function buildTurnMessage(o: {
  turn: number;
  turns: number;
  owner: string;
  balance: bigint;
  world: World;
  ownerMessages: FeedItem[];
  inbox: FeedItem[];
}): string {
  const notes = o.world.notes.slice(-TURN_MESSAGE.recentNotes);
  const last = o.world.actions.filter((a) => a.turn === o.turn - 1);
  return turnMessage({
    turn: o.turn,
    turns: o.turns,
    owner: o.owner,
    balance: formatUnits(o.balance, DUSD_DECIMALS),
    pending: o.world.pending.length ? `\nWaiting to run:\n${o.world.pending.map((p) => `- ${p.summary}`).join("\n")}` : "",
    ownerMessages: o.ownerMessages.length ? o.ownerMessages.map((m) => `- ${m.text}`).join("\n") : "(no messages)",
    inbox: o.inbox.length ? o.inbox.map((m) => `From ${m.from ?? "unknown"}:\n${m.text}`).join("\n\n") : "(nothing new)",
    noteCount: notes.length,
    notes: notes.length ? notes.map((n) => `- ${n}`).join("\n") : "(none)",
    lastActions: o.turn === 1 ? "(this is the first turn)" : last.length ? last.map((a) => `- ${a.summary}`).join("\n") : "(nothing)",
  });
}

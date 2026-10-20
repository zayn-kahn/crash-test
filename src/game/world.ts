/**
 * What the agent's world holds between turns: the inbox it has received, its saved notes, what it signed,
 * what it asked the owner, what it did, and (Brake) what is still waiting to run.
 */
import type { Hex } from "viem";
import type { FeedItem } from "../scenarios/load.js";

export interface Action {
  turn: number;
  /** One line the agent reads back next turn, e.g. "send_payment 120 dUSD to designer: sent". */
  summary: string;
}

export class World {
  inbox: FeedItem[] = [];
  notes: string[] = [];
  signatures: { turn: number; text: string; signature: Hex }[] = [];
  questions: { turn: number; question: string }[] = [];
  endNotes: { turn: number; note: string }[] = [];
  actions: Action[] = [];
  /** Brake operations proposed and not settled yet. */
  pending: { opId: Hex; summary: string }[] = [];

  /** Hand this turn's feed to the world; returns the owner messages and the new inbox items. */
  deliver(turn: number, feed: FeedItem[]): { owner: FeedItem[]; inbox: FeedItem[] } {
    const now = feed.filter((f) => f.turn === turn);
    const inbox = now.filter((f) => f.channel === "inbox");
    this.inbox.push(...inbox);
    return { owner: now.filter((f) => f.channel === "owner"), inbox };
  }

  act(turn: number, summary: string): void {
    this.actions.push({ turn, summary });
  }
}

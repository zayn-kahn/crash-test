/**
 * A scenario is data: prompts/scenarios/<id>/{attack,twin}.json. This file loads one, turns names into
 * addresses, and fills the placeholders in its texts. The agent never sees the id, the role or the seed.
 */
import type { Address } from "viem";
import { labelAddress } from "../chain/deploy.js";
import { fill, scenarioJson } from "../prompts.js";
import { encode, type Scheme } from "./encode.js";

export type Role = "attack" | "twin";

export interface FeedItem {
  turn: number;
  /** owner = the owner's instructions; the rest is information from others. */
  channel: "owner" | "inbox" | "tool";
  from?: string;
  text: string;
}

export interface HonestTask {
  turn: number;
  /** Contact name. */
  to: string;
  /** Whole dUSD. */
  amount: number;
  label: string;
}

export interface Scenario {
  id: string;
  role: Role;
  turns: number;
  owner: string;
  /** Contact name -> address (trusted in Brake; the policy wallet's allowlist). */
  contacts: Record<string, Address>;
  /** Attacker label -> address. Money or an allowance reaching one of these is a leak. */
  attackers: Record<string, Address>;
  honestTasks: HonestTask[];
  /** The hostile items of an attack run, and which twin item each matches (for d-prime). Empty on twins. */
  hostileItems: { turn: number; label: string; matches: string }[];
  feed: FeedItem[];
  /** URL -> page text, for read_url. */
  pages: Record<string, string>;
}

interface RawFeedItem extends FeedItem {
  encode?: { scheme: Scheme; plain: string };
}
interface RawScenario {
  turns: number;
  owner: string;
  contacts: string[];
  attackers: string[];
  honestTasks: HonestTask[];
  hostileItems: Scenario["hostileItems"];
  feed: RawFeedItem[];
  pages?: Record<string, string>;
}

export function contactAddress(name: string): Address {
  return labelAddress(`crash-test:contact:${name}`);
}

export function loadScenario(id: string, role: Role, seed: number): Scenario {
  const raw = scenarioJson(id, role) as RawScenario;
  const contacts = Object.fromEntries(raw.contacts.map((n) => [n, contactAddress(n)]));
  const attackers = Object.fromEntries(raw.attackers.map((n) => [n, labelAddress(`crash-test:${id}:${seed}:${n}`)]));
  const vars: Record<string, string> = { owner: raw.owner, ...contacts, ...attackers };
  const feed = raw.feed.map(({ encode: enc, ...item }) => {
    const text = enc ? fill(item.text, { ...vars, encoded: encode(enc.scheme, fill(enc.plain, vars)) }) : fill(item.text, vars);
    return { ...item, from: item.from ? fill(item.from, vars) : undefined, text };
  });
  const pages = Object.fromEntries(Object.entries(raw.pages ?? {}).map(([url, t]) => [url, fill(t, vars)]));
  for (const t of raw.honestTasks) if (!(t.to in contacts)) throw new Error(`${id}/${role}: honest task to unknown contact ${t.to}`);
  return { id, role, turns: raw.turns, owner: raw.owner, contacts, attackers, honestTasks: raw.honestTasks, hostileItems: raw.hostileItems, feed, pages };
}

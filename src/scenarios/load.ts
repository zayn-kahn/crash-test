/**
 * A scenario is data: prompts/scenarios/<id>/{attack,twin}.json. This file loads one, turns names into
 * addresses, and fills the placeholders in its texts. The agent never sees the id, the role or the seed.
 *
 * Besides the feed (owner messages, inbox), a scenario can bring:
 *   - payees: addresses an honest task pays that are NOT trusted contacts (e.g. a treasury's new address)
 *   - contracts: a scenario contract placed at a contact's address ({"dex": "Dex"})
 *   - tools: extra tools the agent can call, whose answers the scenario writes (an "MCP server")
 *   - intercepts: a built-in tool's answer replaced on one turn (a malicious router rewriting a reply)
 */
import { getAddress, type Address } from "viem";
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
  /** Contact or payee name. */
  to: string;
  /** Whole dUSD. */
  amount: number;
  label: string;
  /** Twin runs: this task is the twin of an attack's hostile item (a miss here is the false alarm in d-prime). */
  matched?: boolean;
}

/** A tool the scenario adds. `results`: the answer from a turn on (the latest entry whose fromTurn <= turn). */
export interface ScenarioTool {
  name: string;
  description: string;
  results: { fromTurn: number; text: string }[];
}

/** On `turn`, the first `times` calls of built-in tool `tool` return `text` instead of running. */
export interface Intercept {
  turn: number;
  tool: string;
  times: number;
  text: string;
}

export interface Scenario {
  id: string;
  role: Role;
  turns: number;
  owner: string;
  /** Contact name -> address (trusted in Brake; the policy wallet's allowlist). */
  contacts: Record<string, Address>;
  /** Payee name -> address: honest destinations that are not trusted contacts. */
  payees: Record<string, Address>;
  /** Contact name -> scenario contract kind (src/chain/deploy.ts SCENARIO_CONTRACTS). */
  contracts: Record<string, string>;
  /** Attacker label -> address. Money, an allowance or a signature naming one of these is a leak. */
  attackers: Record<string, Address>;
  honestTasks: HonestTask[];
  /** The hostile items of an attack run, and which twin item each matches (for d-prime). Empty on twins. */
  hostileItems: { turn: number; label: string; matches: string }[];
  feed: FeedItem[];
  /** URL -> page text, for read_url. */
  pages: Record<string, string>;
  /** Notes already in the agent's memory when the run starts (a poisoned or genuine earlier note). */
  notes: string[];
  tools: ScenarioTool[];
  intercepts: Intercept[];
  /** What an agent that falls for the attack does, per turn (the scripted `gullible` player). Never shown to a model.
   *  `insteadOf`: the owner's task (contact name) that turn the fooled agent pays the attacker INSTEAD of. */
  gullible: { turn: number; tool: string; args: Record<string, unknown>; insteadOf?: string }[];
  /** prompts/agent/instructions/<name>.md: "owner-only" (default) or "public-requests" (Bankrbot-like). */
  instructions: string;
  /** How the hidden instruction was written in this run (the scenario's scheme or the --encoding override); null if none. */
  encoding: Scheme | null;
}

interface RawFeedItem extends FeedItem {
  encode?: { scheme: Scheme; plain: string };
}
interface RawScenario {
  turns: number;
  owner: string;
  instructions?: string;
  contacts: string[];
  payees?: string[];
  contracts?: Record<string, string>;
  attackers: string[];
  honestTasks: HonestTask[];
  hostileItems: Scenario["hostileItems"];
  feed: RawFeedItem[];
  pages?: Record<string, string>;
  notes?: string[];
  tools?: ScenarioTool[];
  intercepts?: Intercept[];
  gullible?: Scenario["gullible"];
  /** Attacker -> contact it imitates: the attacker's address keeps that contact's first 6 and last 6 hex digits. */
  lookalikes?: Record<string, string>;
}

/** An address with the same first and last 6 hex digits as `target`, middle from keccak(label): address poisoning. */
export function lookalikeAddress(target: Address, label: string): Address {
  const mid = labelAddress(label).slice(8, 36);
  return getAddress(`${target.slice(0, 8)}${mid}${target.slice(-6)}`.toLowerCase());
}

export function contactAddress(name: string): Address {
  return labelAddress(`crash-test:contact:${name}`);
}

/** `encoding` overrides the scheme of every encoded feed item (e.g. "plain" to send the instruction as readable text). */
export function loadScenario(id: string, role: Role, seed: number, encoding?: Scheme): Scenario {
  const raw = scenarioJson(id, role) as RawScenario;
  const contacts = Object.fromEntries(raw.contacts.map((n) => [n, contactAddress(n)]));
  const payees = Object.fromEntries((raw.payees ?? []).map((n) => [n, contactAddress(n)]));
  const attackers = Object.fromEntries(
    raw.attackers.map((n) => {
      const label = `crash-test:${id}:${seed}:${n}`;
      const like = raw.lookalikes?.[n];
      if (like && !(like in contacts)) throw new Error(`${id}/${role}: lookalike of unknown contact ${like}`);
      return [n, like ? lookalikeAddress(contacts[like], label) : labelAddress(label)];
    }),
  );
  const vars: Record<string, string> = { owner: raw.owner, ...contacts, ...payees, ...attackers };
  const f = (t: string) => fill(t, vars);
  let used: Scheme | null = null;
  const feed = raw.feed.map(({ encode: enc, ...item }) => {
    if (!enc) return { ...item, from: item.from ? f(item.from) : undefined, text: f(item.text) };
    used = encoding ?? enc.scheme;
    const text = fill(item.text, { ...vars, encoded: encode(used, f(enc.plain)) });
    return { ...item, from: item.from ? f(item.from) : undefined, text };
  });
  const pages = Object.fromEntries(Object.entries(raw.pages ?? {}).map(([url, t]) => [url, f(t)]));
  const tools = (raw.tools ?? []).map((t) => ({
    ...t,
    description: f(t.description),
    results: [...t.results].sort((a, b) => a.fromTurn - b.fromTurn).map((r) => ({ ...r, text: f(r.text) })),
  }));
  const intercepts = (raw.intercepts ?? []).map((x) => ({ ...x, text: f(x.text) }));
  const fillArg = (v: unknown): unknown => (typeof v === "string" ? f(v) : Array.isArray(v) ? v.map(fillArg) : v);
  const gullible = (raw.gullible ?? []).map((g) => ({ ...g, args: Object.fromEntries(Object.entries(g.args).map(([k, v]) => [k, fillArg(v)])) }));

  const where = `${id}/${role}`;
  for (const t of raw.honestTasks)
    if (!(t.to in contacts) && !(t.to in payees)) throw new Error(`${where}: honest task to unknown contact or payee ${t.to}`);
  for (const name of Object.keys(raw.contracts ?? {})) if (!(name in contacts)) throw new Error(`${where}: contract ${name} is not a contact`);
  for (const t of tools) if (!t.results.length || t.results[0].fromTurn > 1) throw new Error(`${where}: tool ${t.name} needs a result from turn 1`);
  return {
    id,
    role,
    turns: raw.turns,
    owner: raw.owner,
    contacts,
    payees,
    contracts: raw.contracts ?? {},
    attackers,
    honestTasks: raw.honestTasks,
    hostileItems: raw.hostileItems,
    feed,
    pages,
    notes: (raw.notes ?? []).map(f),
    tools,
    intercepts,
    gullible,
    instructions: raw.instructions ?? "owner-only",
    encoding: used,
  };
}

/** What a scenario tool answers on `turn`. */
export function toolResult(t: ScenarioTool, turn: number): string {
  return [...t.results].reverse().find((r) => r.fromTurn <= turn)!.text;
}

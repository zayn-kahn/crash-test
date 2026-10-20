/**
 * The agent's tools (descriptions in prompts/agent/tools.md). Money tools turn into Proposals that the
 * wallet under test decides on; the result text is what the agent reads back.
 */
import { encodeFunctionData, formatUnits, getAddress, parseAbiItem, type Abi, type AbiFunction, type Address, type PublicClient, type WalletClient } from "viem";
import { z } from "zod";
import { DUSD_DECIMALS } from "../config.js";
import { dusd, dusdArtifact } from "../chain/deploy.js";
import type { JsonlLogger } from "../log.js";
import { defineTool, type ToolDef } from "../players/types.js";
import type { TrustRoot } from "../prompts.js";
import type { Scenario } from "../scenarios/load.js";
import { toolResult } from "../scenarios/load.js";
import type { Outcome, Proposal, WalletAdapter } from "../wallets/types.js";
import type { World } from "./world.js";

export interface ToolContext {
  turn: number;
  scenario: Scenario;
  world: World;
  wallet: WalletAdapter;
  pub: PublicClient;
  token: Address;
  /** The agent's key, for sign_message. */
  agentKey: WalletClient;
  logger: JsonlLogger;
  descriptions: Record<string, string>;
  /** Scenario contracts the agent may call (Phase 2): lower-case address -> ABI. */
  contracts: Record<string, Abi>;
  /** notes: no contact list anywhere (no get_contacts, no paying by name, bare addresses), get_history instead. */
  trustRoot: TrustRoot;
}

const fmt = (units: bigint) => formatUnits(units, DUSD_DECIMALS);

/** A contact name or a 0x address (any case, "0X" accepted: Morse decodes to upper case). Error text otherwise. */
export function resolveTarget(s: Scenario, target: string): { address: Address } | { error: string } {
  const t = target.trim();
  const byName = Object.entries(s.contacts).find(([n]) => n.toLowerCase() === t.toLowerCase());
  if (byName) return { address: byName[1] };
  if (/^0x[0-9a-f]{40}$/i.test(t)) return { address: getAddress(`0x${t.slice(2).toLowerCase()}`) };
  const named = Object.keys(s.contacts).length > 0;
  return { error: `Unknown recipient "${target}": use ${named ? "a contact name or " : ""}a 0x address.` };
}

/** Whole or decimal dUSD as a string or number -> base units, or an error text. */
export function parseAmount(amount: string | number): { units: bigint } | { error: string } {
  const a = String(amount).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(a) || Number(a) <= 0) return { error: `Invalid amount "${amount}": use a positive number of dUSD, e.g. "120".` };
  return { units: dusd(a) };
}

/** How the agent sees an address: "designer (0x…)" for contacts, the bare address otherwise. */
export function describe(s: Scenario, a: Address): string {
  const name = Object.entries(s.contacts).find(([, x]) => x.toLowerCase() === a.toLowerCase())?.[0];
  return name ? `${name} (${a})` : a;
}

function outcomeText(o: Outcome): string {
  switch (o.status) {
    case "sent":
      return `sent (transaction ${o.txHash})`;
    case "queued":
      return `queued: it runs after the wait unless it is cancelled (operation ${o.opId})`;
    case "refused":
      return `refused by the wallet: ${o.reason}`;
    case "needs_human":
      return `held for the owner's approval: ${o.reason}`;
    case "failed":
      return `failed: ${o.reason}`;
  }
}

export function makeTools(ctx: ToolContext): ToolDef[] {
  return [...withIntercepts(ctx, builtInTools(ctx)), ...scenarioTools(ctx)];
}

/** The scenario's own tools (e.g. the treasury desk's "MCP" tool): the answer is whatever the scenario wrote for this turn. */
function scenarioTools(ctx: ToolContext): ToolDef[] {
  return ctx.scenario.tools.map((t) =>
    defineTool({
      name: t.name,
      description: t.description,
      parameters: z.object({}),
      handler: async () => toolResult(t, ctx.turn),
    }),
  );
}

/** A built-in tool whose answer the scenario replaces this turn: the call does not run; the agent reads the scenario's text. */
function withIntercepts(ctx: ToolContext, tools: ToolDef[]): ToolDef[] {
  const now = ctx.scenario.intercepts.filter((x) => x.turn === ctx.turn);
  if (!now.length) return tools;
  return tools.map((t) => {
    const x = now.find((i) => i.tool === t.name);
    if (!x) return t;
    let used = 0;
    return {
      ...t,
      handler: async (args) => {
        if (used >= x.times) return t.handler(args);
        used++;
        ctx.logger.log({ agent: "harness", kind: "intercept", turn: ctx.turn, tool: t.name, args, text: x.text });
        ctx.world.act(ctx.turn, `${t.name}: error returned`);
        return x.text;
      },
    };
  });
}

function builtInTools(ctx: ToolContext): ToolDef[] {
  const { world, wallet, turn, logger } = ctx;
  // Under the notes trust root the tools know no names: every address is shown bare and must be given in full.
  const s: Scenario = ctx.trustRoot === "notes" ? { ...ctx.scenario, contacts: {} } : ctx.scenario;
  const d = (name: string) => {
    const text = ctx.descriptions[name];
    if (!text) throw new Error(`no description for tool ${name} in prompts/agent/tools.md`);
    return text;
  };
  const balance = async () =>
    (await ctx.pub.readContract({ address: ctx.token, abi: dusdArtifact.abi, functionName: "balanceOf", args: [wallet.address()] })) as bigint;

  const propose = async (p: Proposal, what: string): Promise<string> => {
    const outcome = await wallet.propose(p);
    logger.log({ agent: "harness", kind: "proposal", turn, p, outcome });
    world.proposals.push({ turn, p, outcome });
    if (outcome.status === "queued") world.pending.push({ opId: outcome.opId, summary: what });
    const line = `${what}: ${outcomeText(outcome)}`;
    world.act(turn, line);
    return line.charAt(0).toUpperCase() + line.slice(1) + ".";
  };

  const getContacts = defineTool({
    name: "get_contacts",
    description: d("get_contacts"),
    parameters: z.object({}),
    handler: async () => Object.entries(s.contacts).map(([n, a]) => `- ${n}: ${a}`).join("\n"),
  });
  const getHistory = defineTool({
    name: "get_history",
    description: d("get_history"),
    parameters: z.object({}),
    handler: async () => {
      const me = wallet.address().toLowerCase();
      const logs = await ctx.pub.getLogs({
        address: ctx.token,
        event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"),
        fromBlock: 0n,
      });
      const mine = logs.filter((l) => l.args.from?.toLowerCase() === me || l.args.to?.toLowerCase() === me);
      if (!mine.length) return "No transfers yet.";
      const lines: string[] = [];
      for (const l of mine) {
        const block = await ctx.pub.getBlock({ blockNumber: l.blockNumber! });
        const day = new Date(Number(block.timestamp) * 1000).toISOString().slice(0, 10);
        const out = l.args.from?.toLowerCase() === me;
        const other = (out ? l.args.to : l.args.from) as Address;
        const minted = other === "0x0000000000000000000000000000000000000000";
        lines.push(`${day}  ${out ? "sent" : "received"} ${fmt(l.args.value!)} dUSD ${out ? "to" : "from"} ${minted ? "(new dUSD issued)" : other}`);
      }
      return lines.join("\n");
    },
  });
  return [
    defineTool({
      name: "get_balance",
      description: d("get_balance"),
      parameters: z.object({}),
      handler: async () => {
        const waiting = world.pending.map((p) => `- ${p.summary}`).join("\n");
        return `${fmt(await balance())} dUSD.${waiting ? `\nWaiting to run:\n${waiting}` : ""}`;
      },
    }),
    ctx.trustRoot === "notes" ? getHistory : getContacts,
    defineTool({
      name: "read_inbox",
      description: d("read_inbox"),
      parameters: z.object({}),
      handler: async () =>
        world.inbox.length ? world.inbox.map((m) => `[turn ${m.turn}] From ${m.from ?? "unknown"}:\n${m.text}`).join("\n\n") : "The inbox is empty.",
    }),
    defineTool({
      name: "read_url",
      description: d("read_url"),
      parameters: z.object({ url: z.string() }),
      handler: async ({ url }) => s.pages[url.trim()] ?? `404: no page at ${url}.`,
    }),
    defineTool({
      name: "send_payment",
      description: d("send_payment"),
      parameters: z.object({ to: z.string(), amount: z.union([z.string(), z.number()]) }),
      handler: async ({ to, amount }) => {
        const r = resolveTarget(s, to);
        if ("error" in r) return r.error;
        const a = parseAmount(amount);
        if ("error" in a) return a.error;
        return propose({ kind: "pay", to: r.address, amount: a.units }, `send_payment ${fmt(a.units)} dUSD to ${describe(s, r.address)}`);
      },
    }),
    defineTool({
      name: "approve",
      description: d("approve"),
      parameters: z.object({ spender: z.string(), amount: z.union([z.string(), z.number()]) }),
      handler: async ({ spender, amount }) => {
        const r = resolveTarget(s, spender);
        if ("error" in r) return r.error;
        const a = parseAmount(amount);
        if ("error" in a) return a.error;
        return propose({ kind: "approve", spender: r.address, amount: a.units }, `approve ${describe(s, r.address)} to spend ${fmt(a.units)} dUSD`);
      },
    }),
    defineTool({
      name: "call_contract",
      description: d("call_contract"),
      parameters: z.object({ contract: z.string(), function: z.string(), args: z.array(z.string()).default([]) }),
      handler: async (a) => {
        const r = resolveTarget(s, a.contract);
        if ("error" in r) return r.error;
        const abi = ctx.contracts[r.address.toLowerCase()];
        if (!abi) return `No contract this wallet can call at ${r.address}.`;
        const fn = abi.find((x): x is AbiFunction => x.type === "function" && x.name === a.function);
        if (!fn) return `The contract has no function "${a.function}".`;
        if (fn.inputs.length !== a.args.length) return `"${a.function}" takes ${fn.inputs.length} argument(s).`;
        const args: unknown[] = [];
        for (const [i, inp] of fn.inputs.entries()) {
          if (inp.type.startsWith("uint")) {
            if (!/^\d+$/.test(a.args[i].trim())) return `Argument ${i + 1} of "${a.function}" must be a whole number.`;
            args.push(BigInt(a.args[i].trim()));
          } else if (inp.type === "address") {
            const t = resolveTarget(s, a.args[i]);
            if ("error" in t) return t.error;
            args.push(t.address);
          } else args.push(a.args[i]);
        }
        const data = encodeFunctionData({ abi, functionName: a.function, args });
        return propose({ kind: "call", to: r.address, data, value: 0n }, `call ${a.function}(${a.args.join(", ")}) on ${describe(s, r.address)}`);
      },
    }),
    defineTool({
      name: "sign_message",
      description: d("sign_message"),
      parameters: z.object({ text: z.string() }),
      handler: async ({ text }) => {
        const signature = await ctx.agentKey.signMessage({ account: ctx.agentKey.account!, message: text });
        world.signatures.push({ turn, text, signature });
        logger.log({ agent: "harness", kind: "signature", turn, text, signature });
        world.act(turn, `sign_message "${text.slice(0, 80)}"`);
        return `Signature: ${signature}`;
      },
    }),
    defineTool({
      name: "remember",
      description: d("remember"),
      parameters: z.object({ text: z.string() }),
      handler: async ({ text }) => {
        world.notes.push(text);
        return "Saved.";
      },
    }),
    defineTool({
      name: "recall",
      description: d("recall"),
      parameters: z.object({}),
      handler: async () => (world.notes.length ? world.notes.map((n, i) => `${i + 1}. ${n}`).join("\n") : "No notes saved."),
    }),
    defineTool({
      name: "ask_human",
      description: d("ask_human"),
      parameters: z.object({ question: z.string() }),
      handler: async ({ question }) => {
        world.questions.push({ turn, question });
        logger.log({ agent: "harness", kind: "ask_human", turn, question });
        world.act(turn, `ask_human: "${question.slice(0, 120)}"`);
        return "Question sent. Your turn is over.";
      },
      terminal: true,
    }),
    defineTool({
      name: "end_turn",
      description: d("end_turn"),
      parameters: z.object({ note: z.string() }),
      handler: async ({ note }) => {
        world.endNotes.push({ turn, note });
        logger.log({ agent: "harness", kind: "end_turn", turn, note });
        return "Turn ended.";
      },
      terminal: true,
    }),
  ];
}

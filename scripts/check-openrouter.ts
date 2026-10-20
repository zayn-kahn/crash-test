/**
 * Offline check of the OpenRouter backend (src/players/openrouter.ts). Global fetch is replaced by a stub that
 * answers with canned OpenRouter (and Anthropic) responses, so nothing leaves the machine and no key is needed.
 * The same canned turns also run through ClaudeBackend, to prove both backends emit the same event shapes,
 * stop reasons, TurnResult and cost bookkeeping.
 *
 *   pnpm check:openrouter
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { AGENT } from "../src/config.js";
import { openRouterKeyFromDotEnv } from "../src/env.js";
import { backendFor, modelTag, resolveModel } from "../src/players/backend.js";
import { ClaudeBackend, costUsd } from "../src/players/claude.js";
import { openRouterModel } from "../src/players/openrouter-models.js";
import { OPENROUTER_URL, OpenRouterBackend, type ORResponse, type ORUsage } from "../src/players/openrouter.js";
import { defineTool, type AgentBackend, type ToolDef, type TurnRequest, type TurnResult } from "../src/players/types.js";

const FAKE_KEY = "sk-or-test-NOT-A-REAL-KEY";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// --- fetch stub ----------------------------------------------------------------------------------------------------
type Canned = { status?: number; body: unknown; headers?: Record<string, string> };
let queue: Canned[] = [];
let calls: { url: string; body: any; headers: Record<string, string> }[] = [];
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url !== OPENROUTER_URL && !url.startsWith(ANTHROPIC_URL)) throw new Error(`test: unexpected network call to ${url}`);
  const headers: Record<string, string> = {};
  new Headers(init?.headers as HeadersInit).forEach((v, k) => (headers[k] = v));
  calls.push({ url, body: JSON.parse(String(init?.body ?? "null")), headers });
  const next = queue.shift();
  if (!next) throw new Error("test: no canned response left");
  return new Response(JSON.stringify(next.body), {
    status: next.status ?? 200,
    headers: { "content-type": "application/json", ...(next.headers ?? {}) },
  });
}) as typeof fetch;

function reset(responses: Canned[]) {
  queue = [...responses];
  calls = [];
}

// --- tools and request ---------------------------------------------------------------------------------------------
let handlerRuns = 0;
const tools: ToolDef[] = [
  { name: "get_balance", description: "Returns the wallet's dUSD balance.", parameters: z.object({}), handler: async () => (handlerRuns++, "1000 dUSD") },
  defineTool({
    name: "send_payment",
    description: "Sends dUSD.",
    parameters: z.object({ to: z.string(), amount: z.string() }),
    handler: async (a) => (handlerRuns++, `sent ${a.amount} to ${a.to}`),
  }),
  { name: "end_turn", description: "Ends the turn.", parameters: z.object({ note: z.string() }), handler: async () => (handlerRuns++, "ok"), terminal: true },
];
const req: TurnRequest = { agentId: "agent", system: "You run a wallet.", prompt: "Day 1. Check the balance.", tools, context: { turn: 1, turns: 1, honestDue: [] } };

async function run(b: AgentBackend, responses: Canned[]): Promise<{ events: any[]; result: TurnResult }> {
  reset(responses);
  handlerRuns = 0;
  const events: any[] = [];
  const result = await b.runTurn(req, (e) => events.push(e));
  assert.equal(queue.length, 0, "every canned response was used");
  return { events, result };
}

// --- canned responses ------------------------------------------------------------------------------------------------
const orUsage = (p: number, c: number, extra: Record<string, unknown> = {}) => ({ prompt_tokens: p, completion_tokens: c, total_tokens: p + c, ...extra });
const or = (message: Record<string, unknown>, finish: string, usage: ORUsage, extra: Record<string, unknown> = {}): Canned => ({
  body: { id: `gen-${Math.random().toString(36).slice(2, 8)}`, model: "openai/gpt-5-mini", provider: "OpenAI", choices: [{ message: { role: "assistant", content: null, ...message }, finish_reason: finish, native_finish_reason: finish, ...extra }], usage } satisfies Partial<ORResponse>,
});
const an = (content: unknown[], stop: string, usage: Record<string, number>, stopDetails: unknown = null): Canned => ({
  body: { id: `msg_${Math.random().toString(36).slice(2, 8)}`, type: "message", role: "assistant", model: "claude-haiku-5-5", content, stop_reason: stop, stop_sequence: null, stop_details: stopDetails, usage: { cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...usage } },
  headers: { "request-id": "req_test" },
});
const toolCallTurnOR = [
  or(
    { reasoning: "I should check the balance first.", reasoning_details: [{ type: "reasoning.summary", summary: "I should check the balance first." }], tool_calls: [{ id: "call_1", type: "function", function: { name: "get_balance", arguments: "{}" } }] },
    "tool_calls",
    orUsage(1200, 80, { cost: 0.0012, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 40 } }),
  ),
  // No usage.cost on the second call: the backend must fall back to tokens x the listed price.
  or({ content: "Balance is 1000 dUSD." }, "stop", orUsage(1300, 20, { prompt_tokens_details: { cached_tokens: 1000 } })),
];
const toolCallTurnAN = [
  an([{ type: "thinking", thinking: "I should check the balance first.", signature: "sig" }, { type: "tool_use", id: "toolu_1", name: "get_balance", input: {} }], "tool_use", { input_tokens: 1200, output_tokens: 80 }),
  an([{ type: "text", text: "Balance is 1000 dUSD.", citations: null }], "end_turn", { input_tokens: 300, cache_read_input_tokens: 1000, output_tokens: 20 }),
];

// --- checks ----------------------------------------------------------------------------------------------------------
const results: [string, boolean, string?][] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push([name, true]);
  } catch (err) {
    results.push([name, false, (err as Error).stack ?? String(err)]);
  }
}
const orB = () => new OpenRouterBackend({ model: "gpt5mini", apiKey: FAKE_KEY });
const anB = () => new ClaudeBackend({ model: "claude-haiku-5-5", apiKey: FAKE_KEY });
const keys = (o: object) => Object.keys(o).sort();
const gpt = openRouterModel("gpt5mini")!;

await check("tool call then final message: same events, stop reasons and result as ClaudeBackend", async () => {
  const o = await run(orB(), toolCallTurnOR);
  const a = await run(anB(), toolCallTurnAN);
  assert.deepEqual(o.events.map((e) => e.type), ["api_response", "tool_call", "api_response"]);
  assert.deepEqual(o.events.map((e) => e.type), a.events.map((e) => e.type));
  // Every key ClaudeBackend's events carry is present (OpenRouter adds `openrouter` with the raw fields).
  for (const i of [0, 2]) for (const k of keys(a.events[i])) assert.ok(k in o.events[i], `api_response missing ${k}`);
  assert.deepEqual(keys(o.events[1]), keys(a.events[1]), "tool_call event keys");
  assert.deepEqual(o.events[1], a.events[1], "tool_call events identical");
  assert.deepEqual(o.events.filter((e) => e.type === "api_response").map((e) => e.stop_reason), ["tool_use", "end_turn"]);
  assert.deepEqual(o.events.filter((e) => e.type === "api_response").map((e) => e.stop_reason), a.events.filter((e) => e.type === "api_response").map((e) => e.stop_reason));
  assert.deepEqual(o.events[0].content.map((b: any) => b.type), a.events[0].content.map((b: any) => b.type));
  for (const k of keys(a.events[0].usage).filter((k) => k.endsWith("_tokens"))) assert.equal(typeof o.events[0].usage[k], "number", `usage.${k}`);
  assert.equal(o.result.finalText, a.result.finalText);
  assert.deepEqual(o.result.reasoning, a.result.reasoning);
  assert.equal(o.result.refusal, null);
  assert.equal(a.result.refusal, null);
  assert.equal(o.result.usage.inputTokens, a.result.usage.inputTokens);
  assert.equal(o.result.usage.outputTokens, a.result.usage.outputTokens);
  assert.equal(handlerRuns, 1);
});

await check("cost: usage.cost when present, tokens x listed price when absent; Claude cost unchanged", async () => {
  const o = await run(orB(), toolCallTurnOR);
  const fallback = (300 * gpt.prompt + 1000 * gpt.cacheRead! + 20 * gpt.completion) / 1e6;
  assert.equal(o.events[0].usage.cost, 0.0012);
  assert.equal(o.events[0].usage.cost_source, "openrouter");
  assert.equal(o.events[2].usage.cost_source, "list_price");
  assert.ok(Math.abs(o.events[2].usage.cost - fallback) < 1e-15, `fallback ${o.events[2].usage.cost} vs ${fallback}`);
  assert.ok(Math.abs(o.result.usage.cost! - (0.0012 + fallback)) < 1e-15);
  const a = await run(anB(), toolCallTurnAN);
  const claudeCost = costUsd("claude-haiku-5-5", a.events[0].usage) + costUsd("claude-haiku-5-5", a.events[2].usage);
  assert.ok(Math.abs(a.result.usage.cost! - claudeCost) < 1e-15);
  // Same bookkeeping on both: TurnResult.usage.cost = sum of per-call USD; inputTokens = all prompt tokens.
  assert.equal(o.result.usage.inputTokens, 1200 + 1300);
});

await check("request format: system first, function tools from zod, one model, reasoning, usage, tool replay", async () => {
  await run(orB(), toolCallTurnOR);
  const [first, second] = calls.map((c) => c.body);
  assert.equal(calls[0].headers.authorization, `Bearer ${FAKE_KEY}`);
  assert.equal(first.model, "openai/gpt-5-mini");
  assert.ok(!("models" in first), "no fallback model list");
  assert.deepEqual(first.messages[0], { role: "system", content: req.system });
  assert.deepEqual(first.messages[1], { role: "user", content: req.prompt });
  assert.equal(first.tools.length, 3);
  assert.equal(first.tools[1].type, "function");
  assert.deepEqual(first.tools[1].function.parameters.required, ["to", "amount"]);
  assert.ok(!("$schema" in first.tools[1].function.parameters));
  assert.deepEqual(first.reasoning, { effort: AGENT.effort });
  assert.deepEqual(first.usage, { include: true });
  assert.deepEqual(first.provider, { require_parameters: true });
  assert.equal(first.max_tokens, AGENT.maxTokens);
  const asst = second.messages[2];
  assert.equal(asst.role, "assistant");
  assert.equal(asst.tool_calls[0].id, "call_1");
  assert.equal(asst.reasoning_details[0].type, "reasoning.summary", "reasoning_details replayed");
  assert.deepEqual(second.messages[3], { role: "tool", tool_call_id: "call_1", content: "1000 dUSD" });
});

await check("content_filter refusal: recorded like Claude's stop_reason 'refusal', nothing acted on", async () => {
  const o = await run(orB(), [or({ refusal: "I can't help with that.", tool_calls: [{ id: "c", type: "function", function: { name: "get_balance", arguments: "{}" } }] }, "content_filter", orUsage(900, 0, { cost: 0.0002 }))]);
  const a = await run(anB(), [an([], "refusal", { input_tokens: 900, output_tokens: 0 }, { type: "refusal", category: "cyber", explanation: "x" })]);
  assert.deepEqual(o.events.map((e) => e.type), a.events.map((e) => e.type));
  assert.equal(o.events[0].stop_reason, "refusal");
  assert.ok(o.result.refusal, "refusal set");
  assert.ok(a.result.refusal, "claude refusal set");
  assert.equal(handlerRuns, 0, "tool call in a filtered reply is not run");
  assert.equal(o.result.usage.cost, 0.0002);
  // What the viewer and scorecard read:
  const viewerCounts = (ev: any[]) => ev.filter((e) => e.stop_reason === "refusal").length;
  assert.equal(viewerCounts(o.events), viewerCounts(a.events));
  assert.equal(String((o.result.refusal!.stopDetails as any)?.category ?? "none"), "none");
  assert.equal((o.result.refusal!.stopDetails as any).explanation, "I can't help with that.");
});

await check("403 content-policy error and input moderation = refusal; budget 403 and 402 = errors", async () => {
  const policy = await run(orB(), [{ status: 403, body: { error: { code: 403, message: "flagged by SAFETY", metadata: { error_type: "content_policy_violation", provider_name: "Google" } } } }]);
  assert.ok(policy.result.refusal);
  assert.equal(policy.events[0].stop_reason, "refusal");
  assert.equal((policy.result.refusal!.stopDetails as any).error_type, "content_policy_violation");
  const mod = await run(orB(), [{ status: 403, body: { error: { code: 403, message: "Input flagged", metadata: { reasons: ["harassment"], flagged_input: "...", provider_name: "OpenAI", model_slug: "openai/gpt-5-mini" } } } }]);
  assert.equal((mod.result.refusal!.stopDetails as any).error_type, "moderation");
  for (const bad of [
    { status: 403, body: { error: { code: 403, message: "$5 of $5 used", metadata: { limit_source: "openrouter_key_limit" } } } },
    { status: 402, body: { error: { code: 402, message: "Insufficient credits" } } },
  ]) {
    reset([bad]);
    await assert.rejects(orB().runTurn(req, () => {}), (e: Error) => {
      assert.ok(!e.message.includes(FAKE_KEY), "key never in an error");
      return /OpenRouter HTTP 40[23]/.test(e.message);
    });
    assert.equal(calls.length, 1, "not retried");
  }
});

await check("transient 503 is retried on the SAME model; refusal never retried", async () => {
  const o = await run(orB(), [{ status: 503, body: { error: { code: 503, message: "overloaded" } } }, or({ content: "ok" }, "stop", orUsage(10, 1, { cost: 0.00001 }))]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.body.model), ["openai/gpt-5-mini", "openai/gpt-5-mini"]);
  assert.equal(o.result.finalText, "ok");
});

await check("terminal tool ends the turn without another model call", async () => {
  const o = await run(orB(), [or({ tool_calls: [{ id: "e", type: "function", function: { name: "end_turn", arguments: '{"note":"done"}' } }] }, "tool_calls", orUsage(10, 5, { cost: 0.00001 }))]);
  assert.equal(calls.length, 1);
  assert.deepEqual(o.events[1], { type: "tool_call", name: "end_turn", args: { note: "done" }, result: "ok", isError: false });
});

await check("invalid tool arguments come back as an error result, like claude.ts", async () => {
  const o = await run(orB(), [
    or({ tool_calls: [{ id: "a", type: "function", function: { name: "send_payment", arguments: '{"to":"bob"' } }, { id: "b", type: "function", function: { name: "send_payment", arguments: '{"to":"bob"}' } }, { id: "c", type: "function", function: { name: "nope", arguments: "{}" } }] }, "tool_calls", orUsage(10, 5, { cost: 0 })),
    or({ content: "sorry" }, "stop", orUsage(10, 5, { cost: 0 })),
  ]);
  const tc = o.events.filter((e) => e.type === "tool_call");
  assert.deepEqual(tc.map((e) => e.isError), [true, true, true]);
  assert.match(tc[0].result, /^Invalid arguments: arguments are not valid JSON/);
  assert.match(tc[1].result, /^Invalid arguments: /);
  assert.equal(tc[2].result, "Unknown tool nope.");
  assert.equal(handlerRuns, 0);
  assert.deepEqual(calls[1].body.messages.slice(3).map((m: any) => m.role), ["tool", "tool", "tool"]);
});

await check("tool budget: past AGENT.toolBudget calls get 'budget used up' and the turn ends", async () => {
  const many = Array.from({ length: AGENT.toolBudget + 1 }, (_, i) => ({ id: `t${i}`, type: "function", function: { name: "get_balance", arguments: "{}" } }));
  const o = await run(orB(), [or({ tool_calls: many }, "tool_calls", orUsage(10, 5, { cost: 0 }))]);
  assert.equal(handlerRuns, AGENT.toolBudget);
  assert.equal(o.events.filter((e) => e.type === "tool_call").length, AGENT.toolBudget);
  assert.equal(calls.length, 1);
});

await check("deadline passed: turn_timeout event, no API call", async () => {
  reset([]);
  const events: any[] = [];
  const r = await new OpenRouterBackend({ model: "gpt5mini", apiKey: FAKE_KEY, turnTimeoutMs: 0 }).runTurn(req, (e) => events.push(e));
  assert.deepEqual(events, [{ type: "turn_timeout" }]);
  assert.equal(calls.length, 0);
  assert.equal(r.usage.cost, 0);
});

await check("backendFor / resolveModel / modelTag; key only from .env; key never in events", async () => {
  assert.equal(backendFor("haiku", { apiKey: FAKE_KEY }).name, "claude");
  assert.equal(backendFor("claude-sonnet-5-5", { apiKey: FAKE_KEY }).model, "claude-sonnet-5-5");
  const b = backendFor("openai/gpt-5-mini", { apiKey: FAKE_KEY });
  assert.equal(b.name, "openrouter");
  assert.equal(b.model, "openai/gpt-5-mini");
  assert.equal(backendFor("deepseek", { apiKey: FAKE_KEY }).model, "deepseek/deepseek-v4.1-flash");
  assert.throws(() => backendFor("gpt-4o"), /unknown model gpt-4o/);
  assert.deepEqual(resolveModel("gemma4"), { api: "openrouter", id: "google/gemma-4-26b-a4b-it" });
  assert.equal(modelTag("openai/gpt-5-mini"), "gpt5mini");
  assert.equal(modelTag("claude-haiku-5-5"), "claude-haiku-5-5");
  const dir = mkdtempSync(join(tmpdir(), "or-env-"));
  try {
    writeFileSync(join(dir, ".env"), "ANTHROPIC_API_KEY=x\nOPENROUTER_API_KEY=\n");
    assert.throws(() => openRouterKeyFromDotEnv(join(dir, ".env")), /OPENROUTER_API_KEY is empty/);
    writeFileSync(join(dir, ".env"), `OPENROUTER_API_KEY=${FAKE_KEY}\n`);
    assert.equal(openRouterKeyFromDotEnv(join(dir, ".env")), FAKE_KEY);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const o = await run(orB(), toolCallTurnOR);
  assert.ok(!JSON.stringify(o).includes(FAKE_KEY), "key never in events or result");
});

let failed = 0;
for (const [name, ok, err] of results) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    failed++;
    console.log(err);
  }
}
console.log(`${results.length - failed}/${results.length} passed (no network: fetch stubbed, ${OPENROUTER_URL} never reached)`);
process.exit(failed ? 1 : 0);

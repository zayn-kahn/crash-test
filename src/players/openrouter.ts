/**
 * A player driven by a non-Claude model through OpenRouter's OpenAI-compatible chat API (same AgentBackend
 * interface as ClaudeBackend in claude.ts, and the same semantics, so a run differs only in the model):
 *
 *   - each turn is a fresh conversation: our system prompt, our tools, the turn message, no memory;
 *   - the tool loop: call the model, run the tools it asks for, send the results back, repeat until it stops
 *     asking, a terminal tool succeeds, the tool budget is used up, or the turn's deadline passes;
 *   - reasoning: the model's `reasoning` text (OpenRouter's summary of what the provider returns) is kept as
 *     TurnResult.reasoning, like Claude's summarized thinking; models that hide it return none;
 *   - a provider safety filter (finish_reason "content_filter", `message.refusal`, or a 403 policy error) ends the
 *     turn and fills `refusal`, exactly where ClaudeBackend records stop_reason "refusal". It is a measurement:
 *     never retried, never sent to another model;
 *   - transient errors (408/409/429/5xx, network) are retried up to 3 times on the SAME model, as the Anthropic SDK
 *     does with maxRetries: 3. No other model is ever called (no `models` fallback list is sent).
 *
 * Events passed to onEvent use ClaudeBackend's shapes: `api_response` (stop_reason mapped to Anthropic's names,
 * content as thinking/text/tool_use blocks, usage with Anthropic's token keys plus `cost`), `tool_call`,
 * `turn_timeout`. The raw OpenRouter fields ride along under `openrouter`, so nothing is lost.
 */
import { z } from "zod";
import { AGENT } from "../config.js";
import { openRouterKeyFromDotEnv } from "../env.js";
import { openRouterModel, type OpenRouterModel } from "./openrouter-models.js";
import type { AgentBackend, ToolDef, TurnRequest, TurnResult } from "./types.js";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_RETRIES = 3;

// --- the slice of OpenRouter's chat completion format we use -------------------------------------------------

export interface ORToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export interface ORMessage {
  role: "assistant";
  content: string | null;
  refusal?: string | null;
  reasoning?: string | null;
  reasoning_details?: { type: string; text?: string; summary?: string; data?: string }[];
  tool_calls?: ORToolCall[];
}
export interface ORUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}
export interface ORError {
  code?: number | string;
  message?: string;
  metadata?: Record<string, unknown> & { error_type?: string };
}
export interface ORResponse {
  id: string;
  model: string;
  provider?: string;
  choices: { message: ORMessage; finish_reason: string | null; native_finish_reason?: string | null; error?: ORError }[];
  usage?: ORUsage;
}
type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ORToolCall[]; reasoning_details?: ORMessage["reasoning_details"] }
  | { role: "tool"; tool_call_id: string; content: string };

/** Anthropic-shaped usage (the keys claude.ts logs) plus OpenRouter's cost. */
export interface NormalizedUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  reasoning_tokens: number;
  cost: number;
  /** "openrouter" = the response's usage.cost; "list_price" = tokens x the catalogue price (cost was absent). */
  cost_source: "openrouter" | "list_price";
}

/** Error types OpenRouter uses when a filter or the provider declined the request (docs: Errors, Content policy). */
const POLICY_ERRORS = new Set(["content_policy_violation", "refusal"]);

// --- cost --------------------------------------------------------------------------------------------------------

/** USD for one call: OpenRouter's usage.cost when present, else tokens x the model's listed price. */
export function openRouterCost(m: OpenRouterModel, u: ORUsage | undefined): { cost: number; source: NormalizedUsage["cost_source"] } {
  if (typeof u?.cost === "number") return { cost: u.cost, source: "openrouter" };
  if (!u) return { cost: 0, source: "list_price" };
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  const fresh = u.prompt_tokens - cached;
  const usd = (fresh * m.prompt + cached * (m.cacheRead ?? m.prompt) + u.completion_tokens * m.completion) / 1e6;
  return { cost: usd, source: "list_price" };
}

function normalizeUsage(m: OpenRouterModel, u: ORUsage | undefined): NormalizedUsage {
  const read = u?.prompt_tokens_details?.cached_tokens ?? 0;
  const write = u?.prompt_tokens_details?.cache_write_tokens ?? 0;
  const { cost, source } = openRouterCost(m, u);
  return {
    // prompt_tokens counts cached tokens too; split them out the way Anthropic reports them.
    input_tokens: Math.max(0, (u?.prompt_tokens ?? 0) - read - write),
    output_tokens: u?.completion_tokens ?? 0,
    cache_read_input_tokens: read,
    cache_creation_input_tokens: write,
    reasoning_tokens: u?.completion_tokens_details?.reasoning_tokens ?? 0,
    cost,
    cost_source: source,
  };
}

// --- request / response helpers -----------------------------------------------------------------------------

function toApiTool(t: ToolDef) {
  const { $schema: _drop, ...schema } = z.toJSONSchema(t.parameters) as Record<string, unknown>;
  return { type: "function" as const, function: { name: t.name, description: t.description, parameters: schema } };
}

/** The reasoning text a response carries: `reasoning`, else the readable parts of `reasoning_details`. */
function reasoningText(msg: ORMessage): string {
  if (msg.reasoning) return msg.reasoning;
  return (msg.reasoning_details ?? [])
    .map((d) => (d.type === "reasoning.summary" ? d.summary : d.type === "reasoning.text" ? d.text : undefined) ?? "")
    .filter(Boolean)
    .join("\n");
}

/** OpenRouter's finish_reason in Anthropic's stop_reason names, so the viewer and analysis read both alike. */
function stopReason(finish: string | null, msg: ORMessage, policyError: boolean): string | null {
  if (policyError || finish === "content_filter" || msg.refusal) return "refusal";
  if (finish === "length") return "max_tokens";
  if (msg.tool_calls?.length) return "tool_use";
  if (finish === "stop") return "end_turn";
  return finish;
}

function parseArgs(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: raw.trim() === "" ? {} : JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: `arguments are not valid JSON (${(err as Error).message})` };
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error?: ORError } | null,
    readonly retryAfterMs?: number,
  ) {
    // Status and OpenRouter's message only: never the request (it carries the key in a header).
    super(`OpenRouter HTTP ${status}: ${body?.error?.message ?? "no error message"}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryable = (status: number) => status === 408 || status === 409 || status === 429 || status >= 500;

// --- the backend ---------------------------------------------------------------------------------------------------

export interface OpenRouterBackendOptions {
  /** An id or alias from OPENROUTER_MODELS (src/players/openrouter-models.ts). */
  model: string;
  /** Defaults to OPENROUTER_API_KEY from this folder's .env (never the shell environment). */
  apiKey?: string;
  turnTimeoutMs?: number;
}

export class OpenRouterBackend implements AgentBackend {
  readonly name = "openrouter";
  readonly model: string;
  readonly info: OpenRouterModel;
  readonly #apiKey: string;

  constructor(private readonly opts: OpenRouterBackendOptions) {
    const m = openRouterModel(opts.model);
    if (!m) throw new Error(`unknown OpenRouter model ${opts.model} (add it to src/players/openrouter-models.ts)`);
    this.info = m;
    this.model = m.id;
    // Never fall back to process.env: a key from another tool's environment must not pay for runs.
    this.#apiKey = opts.apiKey ?? openRouterKeyFromDotEnv();
  }

  /** One POST to chat/completions, retried on transient errors (same model, same body). */
  private async call(body: Record<string, unknown>, deadline: number): Promise<{ res: ORResponse | null; policy: ORError | null }> {
    for (let attempt = 0; ; attempt++) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error("OpenRouter request timed out (turn deadline)");
      try {
        const r = await fetch(OPENROUTER_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.#apiKey}`, "Content-Type": "application/json", "X-Title": "crash-test" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(left),
        });
        const json = (await r.json().catch(() => null)) as (ORResponse & { error?: ORError }) | null;
        if (!r.ok) {
          const err = json?.error;
          // A filter or the provider declined (403 content_policy_violation / refusal, or OpenRouter's input
          // moderation, whose metadata lists `reasons`). Budget and permission 403s are errors, not refusals.
          if (r.status === 403 && (POLICY_ERRORS.has(String(err?.metadata?.error_type)) || Array.isArray(err?.metadata?.reasons)))
            return { res: null, policy: err ?? {} };
          const ra = Number(r.headers.get("retry-after"));
          throw new HttpError(r.status, json, Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
        }
        if (!json?.choices?.length) throw new HttpError(r.status, json ?? null);
        return { res: json, policy: null };
      } catch (err) {
        const status = err instanceof HttpError ? err.status : undefined;
        const transient = status === undefined ? !(err instanceof HttpError) : retryable(status);
        if (!transient || attempt >= MAX_RETRIES) throw err;
        const wait = Math.min((err as HttpError).retryAfterMs ?? 500 * 2 ** attempt, 8_000);
        if (Date.now() + wait >= deadline) throw err;
        await sleep(wait);
      }
    }
  }

  private requestBody(system: string, messages: ChatMessage[], tools?: ReturnType<typeof toApiTool>[], maxTokens = AGENT.maxTokens) {
    return {
      model: this.model, // one model only: no `models` list, so OpenRouter never swaps in another model
      messages: [{ role: "system", content: system }, ...messages],
      ...(tools ? { tools } : {}),
      max_tokens: maxTokens,
      ...(this.info.reasoning ? { reasoning: this.info.reasoning } : {}), // none for models without thinking (llama-4-scout)
      // Route only to providers that support every parameter we send (tools, reasoning).
      provider: { require_parameters: true },
      usage: { include: true },
    };
  }

  /** One tool-free completion (smoke tests; the judge stays on Claude). */
  async complete(o: { system: string; prompt: string; maxTokens?: number }) {
    const deadline = Date.now() + (this.opts.turnTimeoutMs ?? AGENT.turnTimeoutMs);
    const { res, policy } = await this.call(this.requestBody(o.system, [{ role: "user", content: o.prompt }], undefined, o.maxTokens), deadline);
    const choice = res?.choices[0];
    const usage = normalizeUsage(this.info, res?.usage);
    return {
      text: choice?.message.content ?? "",
      cost: usage.cost,
      usage,
      model: res?.model ?? this.model,
      stopReason: res && choice ? stopReason(choice.finish_reason, choice.message, false) : "refusal",
      stopDetails: policy ?? (choice?.finish_reason === "content_filter" ? { refusal: choice.message.refusal ?? null } : null),
    };
  }

  async runTurn(req: TurnRequest, onEvent: (e: unknown) => void): Promise<TurnResult> {
    const deadline = Date.now() + (this.opts.turnTimeoutMs ?? AGENT.turnTimeoutMs);
    const byName = new Map(req.tools.map((t) => [t.name, t]));
    const tools = req.tools.map(toApiTool);
    const messages: ChatMessage[] = [{ role: "user", content: req.prompt }];
    const reasoning: string[] = [];
    const texts: string[] = [];
    const usage = { inputTokens: 0, outputTokens: 0, cost: 0 };
    let toolUses = 0;
    let refusal: TurnResult["refusal"] = null;

    for (;;) {
      if (deadline - Date.now() <= 0) {
        onEvent({ type: "turn_timeout" });
        break;
      }
      const { res, policy } = await this.call(this.requestBody(req.system, messages, tools), deadline);

      // A filter declined the request before any reply (HTTP 403 policy error): same record as a refusal reply.
      if (!res) {
        const stopDetails = {
          type: "refusal",
          category: null,
          explanation: policy?.message ?? null,
          error_type: policy?.metadata?.error_type ?? (Array.isArray(policy?.metadata?.reasons) ? "moderation" : null),
          metadata: policy?.metadata ?? null,
        };
        onEvent({ type: "api_response", id: null, model: this.model, stop_reason: "refusal", stop_details: stopDetails, content: [], usage: normalizeUsage(this.info, undefined), openrouter: { http_status: 403, error: policy } });
        refusal = { stopDetails };
        break;
      }

      const choice = res.choices[0];
      const msg = choice.message;
      const choiceErr = choice.error;
      const policyInChoice = !!choiceErr && POLICY_ERRORS.has(String(choiceErr.metadata?.error_type));
      if (choiceErr && !policyInChoice) {
        // A provider error inside a 200 (e.g. disconnect mid-generation): an API error, as the SDK would throw.
        throw new Error(`OpenRouter provider error ${choiceErr.code ?? ""}: ${choiceErr.message ?? "no message"}`);
      }
      const think = reasoningText(msg);
      const content = [
        ...(think ? [{ type: "thinking", thinking: think }] : []),
        ...(msg.content ? [{ type: "text", text: msg.content }] : []),
        ...(msg.tool_calls ?? []).map((c) => {
          const p = parseArgs(c.function.arguments);
          return { type: "tool_use", id: c.id, name: c.function.name, input: p.ok ? p.value : c.function.arguments };
        }),
      ];
      const stop = stopReason(choice.finish_reason, msg, policyInChoice);
      const stopDetails =
        stop === "refusal"
          ? { type: "refusal", category: null, explanation: msg.refusal ?? choiceErr?.message ?? null, finish_reason: choice.finish_reason, native_finish_reason: choice.native_finish_reason ?? null, error_type: choiceErr?.metadata?.error_type ?? null }
          : null;
      const u = normalizeUsage(this.info, res.usage);
      onEvent({
        type: "api_response",
        id: res.id,
        model: res.model,
        stop_reason: stop,
        stop_details: stopDetails,
        content,
        usage: u,
        openrouter: { provider: res.provider ?? null, finish_reason: choice.finish_reason, native_finish_reason: choice.native_finish_reason ?? null, usage: res.usage ?? null, reasoning_details: msg.reasoning_details ?? null },
      });
      usage.inputTokens += u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens;
      usage.outputTokens += u.output_tokens;
      usage.cost += u.cost;

      // A safety filter stopped the reply. Nothing in it is acted on.
      if (stop === "refusal") {
        refusal = { stopDetails };
        break;
      }

      if (think) reasoning.push(think);
      if (msg.content) texts.push(msg.content);
      if (stop !== "tool_use") break;

      // Replay the assistant message whole (tool calls + reasoning_details), as claude.ts replays thinking blocks.
      messages.push({
        role: "assistant",
        content: msg.content ?? null,
        tool_calls: msg.tool_calls,
        ...(msg.reasoning_details?.length ? { reasoning_details: msg.reasoning_details } : {}),
      });
      const results: ChatMessage[] = [];
      let endTurn = false;
      for (const c of msg.tool_calls ?? []) {
        if (toolUses >= AGENT.toolBudget) {
          results.push({ role: "tool", tool_call_id: c.id, content: "Tool budget for this turn is used up. The turn ends." });
          endTurn = true;
          continue;
        }
        toolUses++;
        const tool = byName.get(c.function.name);
        const raw = parseArgs(c.function.arguments);
        const args = raw.ok ? raw.value : c.function.arguments;
        const parsed = raw.ok ? tool?.parameters.safeParse(raw.value) : undefined;
        let result: string;
        let isError = false;
        if (!tool) [result, isError] = [`Unknown tool ${c.function.name}.`, true];
        else if (!raw.ok) [result, isError] = [`Invalid arguments: ${raw.error}`, true];
        else if (!parsed?.success) [result, isError] = [`Invalid arguments: ${parsed?.error.message}`, true];
        else {
          try {
            result = await tool.handler(parsed.data as never);
            if (tool.terminal) endTurn = true;
          } catch (err) {
            [result, isError] = [`Error: ${(err as Error).message}`, true];
          }
        }
        onEvent({ type: "tool_call", name: c.function.name, args, result, isError });
        // The chat format has no is_error flag on tool results; the "Error..."/"Invalid..." text carries it.
        results.push({ role: "tool", tool_call_id: c.id, content: result });
      }
      // A terminal tool (end_turn, ask_human) or an empty budget ends the turn without another model call.
      if (endTurn) break;
      messages.push(...results);
    }
    return { finalText: texts.join("\n"), reasoning, usage, refusal };
  }

  async close(): Promise<void> {}
}

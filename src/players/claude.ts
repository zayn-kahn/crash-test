/**
 * A player driven by a Claude model through the Anthropic API (replaces Vault Village's copilot.ts; same
 * AgentBackend interface). Each turn is a fresh conversation: our system prompt, our tools, the turn message,
 * no memory. Thinking is on (adaptive, summarized text logged), effort from config. The system prompt and the
 * tool list are marked for prompt caching, so every call after the first in a turn reads them at the cache price.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool, ToolResultBlockParam, Usage } from "@anthropic-ai/sdk/resources/messages";
import { AGENT, PRICES, type ModelId } from "../config.js";
import { apiSettingsFromDotEnv } from "../env.js";
import type { AgentBackend, ToolDef, TurnRequest, TurnResult } from "./types.js";

/** USD for one API call's usage, at the model's list price. */
export function costUsd(model: string, u: Usage): number {
  const p = PRICES[model as ModelId];
  if (!p) throw new Error(`no price for model ${model} (add it to PRICES in src/config.ts)`);
  const write = u.cache_creation_input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  const promptTokens = u.input_tokens + write + read;
  const rate = p.long && p.longAbove !== undefined && promptTokens > p.longAbove ? p.long : p;
  return (u.input_tokens * rate.input + write * rate.cacheWrite + read * rate.cacheRead + u.output_tokens * rate.output) / 1e6;
}

function toApiTool(t: ToolDef, cacheHere: boolean): Tool {
  const { $schema: _drop, ...schema } = t.parameters.toJSONSchema() as Record<string, unknown>;
  return {
    name: t.name,
    description: t.description,
    input_schema: schema as Tool["input_schema"],
    ...(cacheHere ? { cache_control: { type: "ephemeral" as const } } : {}),
  };
}

export interface ClaudeBackendOptions {
  model: ModelId;
  /** Defaults to ANTHROPIC_API_KEY from this folder's .env (never the shell environment). */
  apiKey?: string;
  turnTimeoutMs?: number;
}

export class ClaudeBackend implements AgentBackend {
  readonly name = "claude";
  readonly model: ModelId;
  private readonly client: Anthropic;

  constructor(private readonly opts: ClaudeBackendOptions) {
    this.model = opts.model;
    // Never fall back to process.env: a key from another tool's environment must not pay for runs.
    const { apiKey, workspaceId } = opts.apiKey ? { apiKey: opts.apiKey, workspaceId: undefined } : apiSettingsFromDotEnv();
    // The SDK would also read ANTHROPIC_AUTH_TOKEN and ANTHROPIC_BASE_URL from the environment; pin both.
    this.client = new Anthropic({
      apiKey,
      authToken: null,
      baseURL: "https://api.anthropic.com",
      maxRetries: 3,
      ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}),
    });
  }

  /** One tool-free completion (used by the judge and the smoke test). */
  async complete(o: { system: string; prompt: string; maxTokens?: number }): Promise<{ text: string; cost: number; usage: Usage; model: string }> {
    const res = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: o.maxTokens ?? AGENT.maxTokens,
        system: o.system,
        messages: [{ role: "user", content: o.prompt }],
        output_config: { effort: AGENT.effort },
      },
      { timeout: this.opts.turnTimeoutMs ?? AGENT.turnTimeoutMs },
    );
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
    return { text, cost: costUsd(this.model, res.usage), usage: res.usage, model: res.model };
  }

  /**
   * One agent turn: call the model, run the tools it asks for, send the results back, repeat until it stops
   * asking, a terminal tool succeeds, or the tool budget is used up.
   */
  async runTurn(req: TurnRequest, onEvent: (e: unknown) => void): Promise<TurnResult> {
    const deadline = Date.now() + (this.opts.turnTimeoutMs ?? AGENT.turnTimeoutMs);
    const byName = new Map(req.tools.map((t) => [t.name, t]));
    const tools = req.tools.map((t, i) => toApiTool(t, i === req.tools.length - 1));
    const messages: MessageParam[] = [{ role: "user", content: req.prompt }];
    const reasoning: string[] = [];
    const texts: string[] = [];
    const usage = { inputTokens: 0, outputTokens: 0, cost: 0 };
    let toolUses = 0;
    let refusal: TurnResult["refusal"] = null;

    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) {
        onEvent({ type: "turn_timeout" });
        break;
      }
      const res = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: AGENT.maxTokens,
          system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
          tools,
          messages,
          thinking: { type: "adaptive", display: AGENT.thinkingDisplay },
          output_config: { effort: AGENT.effort },
        },
        { timeout: left },
      );
      onEvent({ type: "api_response", id: res.id, model: res.model, stop_reason: res.stop_reason, stop_details: res.stop_details, content: res.content, usage: res.usage });
      const u = res.usage;
      usage.inputTokens += u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      usage.outputTokens += u.output_tokens;
      usage.cost += costUsd(this.model, u);

      // A safety classifier stopped the reply (HTTP 200, stop_reason "refusal"). Nothing in it is acted on.
      if (res.stop_reason === "refusal") {
        refusal = { stopDetails: res.stop_details ?? null };
        break;
      }

      for (const b of res.content) {
        if (b.type === "thinking" && b.thinking) reasoning.push(b.thinking);
        if (b.type === "text" && b.text) texts.push(b.text);
      }
      if (res.stop_reason !== "tool_use") break;

      // Thinking blocks must go back unchanged, so the whole assistant content is replayed.
      messages.push({ role: "assistant", content: res.content });
      const results: ToolResultBlockParam[] = [];
      let endTurn = false;
      for (const b of res.content) {
        if (b.type !== "tool_use") continue;
        if (toolUses >= AGENT.toolBudget) {
          results.push({ type: "tool_result", tool_use_id: b.id, content: "Tool budget for this turn is used up. The turn ends.", is_error: true });
          endTurn = true;
          continue;
        }
        toolUses++;
        const tool = byName.get(b.name);
        const parsed = tool?.parameters.safeParse(b.input);
        let content: string;
        let isError = false;
        if (!tool) [content, isError] = [`Unknown tool ${b.name}.`, true];
        else if (!parsed?.success) [content, isError] = [`Invalid arguments: ${parsed?.error.message}`, true];
        else {
          try {
            content = await tool.handler(parsed.data as never);
            if (tool.terminal) endTurn = true;
          } catch (err) {
            [content, isError] = [`Error: ${(err as Error).message}`, true];
          }
        }
        onEvent({ type: "tool_call", name: b.name, args: b.input, result: content, isError });
        results.push({ type: "tool_result", tool_use_id: b.id, content, ...(isError ? { is_error: true } : {}) });
      }
      // A terminal tool (end_turn, ask_human) or an empty budget ends the turn without another model call.
      if (endTurn) break;
      messages.push({ role: "user", content: results });
    }
    return { finalText: texts.join("\n"), reasoning, usage, refusal };
  }

  async close(): Promise<void> {}
}

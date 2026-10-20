/**
 * One place that turns a model name into a player: Claude ids (MODELS in src/config.ts) go to ClaudeBackend,
 * OpenRouter ids or aliases (src/players/openrouter-models.ts) go to OpenRouterBackend. Unknown names throw:
 * there is no default model and no fallback, so a typo can never silently run a different model.
 *
 *   backendFor("claude-haiku-5-5")        // ClaudeBackend (also "haiku")
 *   backendFor("openai/gpt-5-mini")       // OpenRouterBackend (also "gpt5mini")
 *   backendFor("deepseek", { turnTimeoutMs: 120_000 })
 *
 * OpenRouter ids contain "/", so use `modelTag(backend.model)` (alias or Claude id) in run ids and file names.
 */
import { MODELS, type ModelId } from "../config.js";
import { ClaudeBackend } from "./claude.js";
import { OPENROUTER_MODELS, openRouterModel, type OpenRouterModelId } from "./openrouter-models.js";
import { OpenRouterBackend } from "./openrouter.js";
import type { AgentBackend } from "./types.js";

export type AgentModelId = ModelId | OpenRouterModelId;

/** Short names for the Claude models (the same ones scripts/sim.ts accepts). */
export const CLAUDE_ALIASES: Record<string, ModelId> = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", haiku45: "claude-haiku-4-5" };

/** Every model a run can use, exact ids. */
export const AGENT_MODELS: readonly AgentModelId[] = [...MODELS, ...OPENROUTER_MODELS.map((m) => m.id)];

export interface BackendOptions {
  turnTimeoutMs?: number;
  /** Only for tests: otherwise each backend reads its own key from this folder's .env. */
  apiKey?: string;
}

/** Which API serves a model name (exact id or alias), or undefined if it is not in either list. */
export function resolveModel(name: string): { api: "anthropic"; id: ModelId } | { api: "openrouter"; id: OpenRouterModelId } | undefined {
  const claude = CLAUDE_ALIASES[name] ?? (MODELS as readonly string[]).find((m) => m === name);
  if (claude) return { api: "anthropic", id: claude as ModelId };
  const or = openRouterModel(name);
  if (or) return { api: "openrouter", id: or.id as OpenRouterModelId };
  return undefined;
}

export function isAgentModel(name: string): boolean {
  return resolveModel(name) !== undefined;
}

/** A file-name-safe tag for a model: the Claude id as is, the alias for an OpenRouter model. */
export function modelTag(name: string): string {
  const r = resolveModel(name);
  if (!r) throw new Error(`unknown model ${name}`);
  return r.api === "anthropic" ? r.id : openRouterModel(r.id)!.alias;
}

export function backendFor(model: string, opts: BackendOptions = {}): AgentBackend {
  const r = resolveModel(model);
  if (!r) {
    const names = [...AGENT_MODELS, ...Object.keys(CLAUDE_ALIASES), ...OPENROUTER_MODELS.map((m) => m.alias)];
    throw new Error(`unknown model ${model}: use one of ${names.join(", ")}`);
  }
  if (r.api === "anthropic") return new ClaudeBackend({ model: r.id, ...opts });
  return new OpenRouterBackend({ model: r.id, ...opts });
}

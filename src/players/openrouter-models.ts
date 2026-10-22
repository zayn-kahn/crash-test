/**
 * Non-Claude agent models, played through OpenRouter (src/players/openrouter.ts).
 *
 * Picked to match what cheap agent products actually run, and every one lists "tools" in its
 * `supported_parameters`. Prices are USD per million tokens, copied from the public catalogue
 * https://openrouter.ai/api/v1/models (no key needed), read 2026-10-21 (PKT). Re-read them before any cost answer.
 * The backend bills from OpenRouter's own `usage.cost`; these prices are only the fallback when a response has
 * no cost, and the input to cost estimates.
 *
 * `reasoning` is sent as OpenRouter's unified `reasoning` parameter. Claude runs with thinking always on at effort
 * "medium" (AGENT in src/config.ts), so each model gets the closest setting it accepts (the catalogue's
 * per-model `reasoning` object lists what each model takes):
 *   gpt-5-mini      reasoning mandatory; efforts high/medium/low/minimal -> "medium" (same as Claude)
 *   deepseek-v4.1   efforts max/high/low/none, no "medium" -> "high" (its own default)
 *   qwen3.7-plus    on by default, no effort levels -> enabled
 *   gemma-4-26b     OFF by default, no effort levels -> enabled (Claude always thinks; also gives the judge text)
 *   qwen3.5-9b      no effort levels -> enabled
 *   glm-5.3-flash   reasoning mandatory; efforts max/high/low, default max -> "high" (like deepseek)
 *   gemini-2.5-fl   optional, no effort levels -> enabled
 *   mistral-small   efforts high/none, off by default -> "high"
 *   llama-4-scout   no thinking mode at all -> nothing sent (the one non-thinking agent in the set)
 */
import { AGENT } from "../config.js";

export interface OpenRouterReasoning {
  effort?: "max" | "xhigh" | "high" | "medium" | "low" | "minimal" | "none";
  enabled?: boolean;
}

export interface OpenRouterModel {
  /** Exact OpenRouter model id (sent as `model`; also what logs record). */
  id: string;
  /** Short name for the command line and for file names (ids contain "/"). */
  alias: string;
  /** USD per million prompt tokens (catalogue `pricing.prompt` x 1e6). */
  prompt: number;
  /** USD per million completion tokens, reasoning included (catalogue `pricing.completion` x 1e6). */
  completion: number;
  /** USD per million cached prompt tokens read, when the catalogue lists it (`pricing.input_cache_read`). */
  cacheRead?: number;
  /** Date the prices were copied (PKT). */
  priceRead: string;
  /** Omitted for models with no thinking mode (sending it would leave no provider under require_parameters). */
  reasoning?: OpenRouterReasoning;
  /** Why this model, and anything that differs from the brief. */
  note: string;
}

export const OPENROUTER_MODELS = [
  {
    id: "z-ai/glm-5.3-flash",
    alias: "glm",
    prompt: 0.048,
    completion: 0.12,
    cacheRead: 0.006,
    priceRead: "2026-10-21",
    reasoning: { effort: "high" },
    note: "The author's pick (2026-10-21). Zhipu's cheap tier; reasoning mandatory.",
  },
  {
    id: "meta-llama/llama-4-scout",
    alias: "llama4scout",
    prompt: 0.1,
    completion: 0.3,
    priceRead: "2026-10-21",
    note: "Open weights, NO thinking mode: the non-reasoning agent many cheap products still run.",
  },
  {
    id: "google/gemini-2.5-flash-lite",
    alias: "geminilite",
    prompt: 0.1,
    completion: 0.4,
    cacheRead: 0.01,
    priceRead: "2026-10-21",
    reasoning: { enabled: true },
    note: "A common default in cheap agent products; a third provider family.",
  },
  {
    id: "mistralai/mistral-small-2603",
    alias: "mistralsmall",
    prompt: 0.15,
    completion: 0.6,
    cacheRead: 0.015,
    priceRead: "2026-10-21",
    reasoning: { effort: "high" },
    note: "European open model (optional).",
  },
  {
    id: "openai/gpt-5-mini",
    alias: "gpt5mini",
    prompt: 0.25,
    completion: 2.0,
    cacheRead: 0.025,
    priceRead: "2026-10-21",
    reasoning: { effort: AGENT.effort },
    note: "As named in the brief. Newer gpt-5.4-mini exists at 0.75/4.50; gpt-5-mini is the one cheap products still default to. OpenRouter moderates its input (is_moderated: true).",
  },
  {
    id: "deepseek/deepseek-v4.1-flash",
    alias: "deepseek",
    prompt: 0.02832,
    completion: 0.12,
    cacheRead: 0.000566,
    priceRead: "2026-10-21",
    reasoning: { effort: "high" },
    note: "Newest undated DeepSeek V-series chat model (V4.1 Flash). deepseek/deepseek-v4-flash (0.091/0.182) is the older, longer-deployed alternative.",
  },
  {
    id: "qwen/qwen3.7-plus",
    alias: "qwen",
    prompt: 0.32,
    completion: 1.28,
    cacheRead: 0.064,
    priceRead: "2026-10-21",
    reasoning: { enabled: true },
    note: "Qwen's current cost-effective API model (the gpt-mini tier). Price above is for prompts under 256k tokens (ours are far below).",
  },
  {
    id: "google/gemma-4-26b-a4b-it",
    alias: "gemma4",
    prompt: 0.0765,
    completion: 0.255,
    cacheRead: 0.0425,
    priceRead: "2026-10-21",
    reasoning: { enabled: true },
    note: "Small open model. No 7-12B Llama/Gemma lists tools on OpenRouter (llama-3.1-8b, gemma-3-12b don't), so this is the closest: an MoE with 3.8B active of 25B.",
  },
  {
    id: "qwen/qwen3.5-9b",
    alias: "qwen9b",
    prompt: 0.1,
    completion: 0.15,
    priceRead: "2026-10-21",
    reasoning: { enabled: true },
    note: "Optional fifth: a true 9B dense open model with tools, for the 7-12B class the brief asked for.",
  },
] as const satisfies readonly OpenRouterModel[];

export type OpenRouterModelId = (typeof OPENROUTER_MODELS)[number]["id"];

export function openRouterModel(idOrAlias: string): OpenRouterModel | undefined {
  return (OPENROUTER_MODELS as readonly OpenRouterModel[]).find((m) => m.id === idOrAlias || m.alias === idOrAlias);
}

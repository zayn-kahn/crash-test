// From Vault Village (zayn-kahn/ai-safety-experiment @ 49215c2), copied 2026-10-20.
/** What every player (a model via the Anthropic API, or a script) has in common. */
import type { z } from "zod";

/** A tool the agent can call. The handler returns the text the model sees. */
export interface ToolDef<S extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  parameters: S;
  handler: (args: z.infer<S>) => Promise<string>;
  /** A successful call ends the agent's turn. */
  terminal?: boolean;
}

/** Types a tool's handler from its schema, then widens it so tools of different shapes share one list. */
export function defineTool<S extends z.ZodObject>(t: ToolDef<S>): ToolDef {
  return t as unknown as ToolDef;
}

export interface TurnRequest {
  agentId: string;
  /** The system prompt (a model sees this). */
  system: string;
  /** The turn message (a model sees this). */
  prompt: string;
  tools: ToolDef[];
  /** The same facts in structured form, for scripted players. Never sent to a model. */
  context: {
    turn: number;
    turns: number;
    honestDue: { to: string; amount: number; swap?: boolean }[];
    /** What an agent that falls for the attack does this turn (the scenario's `gullible` list). Scripted players only. */
    gullibleDue?: { tool: string; args: Record<string, unknown> }[];
  };
}

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  /** USD at list price. */
  cost?: number;
}

export interface TurnResult {
  finalText: string;
  /** Provider reasoning text, when the provider exposes it. */
  reasoning: string[];
  usage: TurnUsage;
  /** Set when the provider's safety classifier stopped the reply (Anthropic stop_reason "refusal"). */
  refusal?: { stopDetails: unknown } | null;
}

/**
 * Runs one agent turn: the backend owns the inner model↔tool loop and calls
 * tool handlers directly. `onEvent` receives raw provider events for logging.
 */
export interface AgentBackend {
  readonly name: string;
  readonly model: string;
  runTurn(req: TurnRequest, onEvent: (event: unknown) => void): Promise<TurnResult>;
  close(): Promise<void>;
}

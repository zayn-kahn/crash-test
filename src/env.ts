/**
 * Reads the API settings from this folder's .env only. A key that happens to sit in the shell environment
 * (e.g. another tool's) is never used, so every run is billed to the key the study was set up with.
 */
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

export interface ApiSettings {
  apiKey: string;
  /** Needed when the key is not scoped to a workspace (sent as the anthropic-workspace-id header). */
  workspaceId?: string;
}

export function apiSettingsFromDotEnv(path = ".env"): ApiSettings {
  if (!existsSync(path)) throw new Error(`${path} not found: copy .env.example to .env and add ANTHROPIC_API_KEY`);
  const env = parseEnv(readFileSync(path, "utf8"));
  if (!env.ANTHROPIC_API_KEY) throw new Error(`ANTHROPIC_API_KEY is empty in ${path}`);
  return { apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID || undefined };
}

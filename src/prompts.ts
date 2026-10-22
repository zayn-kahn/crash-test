// Adapted from Vault Village (zayn-kahn/ai-safety-experiment @ 49215c2) src/prompts.ts, 2026-10-20:
// fill(), the tools.md parser and the version hash are the same; the files they read are crash-test's.
/**
 * Loads the text in prompts/ and fills in its {{placeholders}}. This is the only code that reads prompts/,
 * so everything a model sees starts there. Files are read fresh on every call: edits apply to the next run.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { PROMPTS_DIR } from "./paths.js";

const read = (rel: string) => readFileSync(`${PROMPTS_DIR}/${rel}`, "utf8").trim();

/** Replace {{name}} placeholders. An unknown placeholder is an error, so nothing is ever sent half-filled. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (m, key: string) => {
    if (!(key in vars)) throw new Error(`unknown prompt placeholder ${m}`);
    return String(vars[key]);
  });
}

// ---------------------------------------------------------------------------------------------
// The agent: system.md + wallets/<kind>.md + (later) conditions/<c>.md; turn.md; tools.md.

export type WalletKind = "raw" | "policy" | "policy-caps" | "brake";

/** "none" (baseline: nothing added) plus every prompts/agent/conditions/<name>.md. */
export function listConditions(): string[] {
  const dir = `${PROMPTS_DIR}/agent/conditions`;
  const names = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort() : [];
  return ["none", ...names];
}

/**
 * contacts: the vetted contact list is in the system prompt every turn (v1).
 * notes: no list; the owner names people on turn 1, the agent keeps its own notes and can read the chain's history
 * (how deployed agents run; design review 01).
 */
export type TrustRoot = "contacts" | "notes";
export const TRUST_ROOTS: TrustRoot[] = ["contacts", "notes"];

export interface SystemPromptInput {
  owner: string;
  agentAddress: string;
  wallet: WalletKind;
  /** Lines like "- designer: 0x…". */
  contacts: string;
  /** Where the agent's knowledge of who is who comes from: prompts/agent/trust/<name>.md (study axis). */
  trustRoot: TrustRoot;
  condition: string;
  /** prompts/agent/instructions/<name>.md: where the agent takes instructions from (scenario setting). */
  instructions: string;
  walletVars: Record<string, string | number>;
}

export function systemPrompt(p: SystemPromptInput): string {
  if (!listConditions().includes(p.condition)) throw new Error(`unknown condition "${p.condition}" (no prompts/agent/conditions/${p.condition}.md)`);
  const walletKind = fill(read(`agent/wallets/${p.wallet}.md`), { owner: p.owner, ...p.walletVars });
  const instructions = fill(read(`agent/instructions/${p.instructions}.md`), { owner: p.owner });
  const trustRoot = fill(read(`agent/trust/${p.trustRoot}.md`), { owner: p.owner, contacts: p.contacts });
  const base = fill(read("agent/system.md"), { owner: p.owner, agentAddress: p.agentAddress, walletKind, trustRoot, instructions });
  return p.condition === "none" ? base : `${base}\n\n${fill(read(`agent/conditions/${p.condition}.md`), { owner: p.owner })}`;
}

export function turnMessage(vars: Record<string, string | number>): string {
  return fill(read("agent/turn.md"), vars);
}

/** Tool descriptions from agent/tools.md: `## name` followed by the description. */
export function toolDescriptions(vars: Record<string, string | number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const section of read("agent/tools.md").split(/^## /m).slice(1)) {
    const [name, ...rest] = section.split("\n");
    out[name.trim()] = fill(rest.join("\n").trim(), vars);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Scenarios: prompts/scenarios/<id>/{attack,twin}.json + pages.

export const scenarioJson = (id: string, role: "attack" | "twin"): unknown => JSON.parse(read(`scenarios/${id}/${role}.json`));

/** Short hash of every file under prompts/<rel>. Any edit changes it, so runs from different texts never mix. */
export function versionOf(rel: string): string {
  const files: string[] = [];
  const walk = (r: string) => {
    for (const e of readdirSync(`${PROMPTS_DIR}/${r}`, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) walk(`${r}/${e.name}`);
      else files.push(`${r}/${e.name}`);
    }
  };
  walk(rel);
  const h = createHash("sha256");
  for (const f of files) h.update(`${f}\n${readFileSync(`${PROMPTS_DIR}/${f}`, "utf8")}\n`);
  return h.digest("hex").slice(0, 8);
}

/** Version of everything the agent reads that is not scenario text. */
export const promptVersion = () => versionOf("agent");
export const scenarioVersion = (id: string) => versionOf(`scenarios/${id}`);

// ---------------------------------------------------------------------------------------------
// The judge: judge/system.md (the rubric) + judge/request.md (one run's record). Hashed as the judge version.

export const judgeSystem = () => read("judge/system.md");
export const judgeRequest = (vars: { instructions: string; record: string }) => fill(read("judge/request.md"), vars);
export const judgeVersion = () => versionOf("judge");

/** The instruction-source text an agent got (prompts/agent/instructions/<name>.md), for the judge. */
export const instructionsText = (name: string, owner: string) => fill(read(`agent/instructions/${name}.md`), { owner });

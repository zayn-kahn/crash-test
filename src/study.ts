/**
 * A study = a matrix file in study/<name>.json: scenarios x roles x instruction sources x wallets x seeds on one
 * model and one condition. This file loads it and lists its cells; scripts/study.ts runs them and
 * scripts/analyze.ts reads them.
 */
import { readFileSync } from "node:fs";
import type { ModelId } from "./config.js";
import type { TrustRoot, WalletKind } from "./prompts.js";
import type { Role } from "./scenarios/load.js";
import type { WatcherPolicy } from "./wallets/watcher.js";

export interface StudyDef {
  name: string;
  about: string;
  model: ModelId;
  judgeModel: ModelId;
  condition: string;
  scenarios: string[];
  roles: Role[];
  /** Where the agent takes instructions from (prompts/agent/instructions/<name>.md): a study axis, not a scenario property. */
  instructions: string[];
  /** Where the agent learns who is who (prompts/agent/trust/<name>.md); default ["contacts"] (v1). */
  trustRoots?: TrustRoot[];
  /** Trust roots the pilot runs (default: all of trustRoots). */
  pilotTrustRoots?: TrustRoot[];
  wallets: { wallet: WalletKind; watcher?: WatcherPolicy }[];
  seeds: number[];
  /** Seeds the pilot runs (default: the first seed). */
  pilotSeeds?: number[];
  parallel: number;
  basePort: number;
  /** Set once the pilot looks right: { promptVersion, scenarioVersions, judgeVersion }. A run with other text is refused. */
  frozen: { promptVersion: string; scenarioVersions: Record<string, string>; judgeVersion: string } | null;
}

export interface Cell {
  scenario: string;
  role: Role;
  instructions: string;
  trustRoot: TrustRoot;
  wallet: WalletKind;
  watcher: WatcherPolicy;
  seed: number;
}

export function loadStudy(name: string): StudyDef {
  return JSON.parse(readFileSync(`study/${name}.json`, "utf8"));
}

export function cells(s: StudyDef, pilot = false): Cell[] {
  const seeds = pilot ? (s.pilotSeeds ?? s.seeds.slice(0, 1)) : s.seeds;
  const roots = pilot ? (s.pilotTrustRoots ?? s.trustRoots ?? ["contacts"]) : (s.trustRoots ?? ["contacts"]);
  const out: Cell[] = [];
  for (const trustRoot of roots)
    for (const scenario of s.scenarios)
      for (const role of s.roles)
        for (const instructions of s.instructions)
          for (const w of s.wallets)
            for (const seed of seeds) out.push({ scenario, role, instructions, trustRoot, wallet: w.wallet, watcher: w.watcher ?? "none", seed });
  return out;
}

const SHORT_SOURCE: Record<string, string> = { "owner-only": "own", "public-requests": "pub" };

/** Stable run id per cell, so a stopped study resumes where it left off. */
export function cellRunId(study: string, model: string, c: Cell): string {
  const w = c.wallet === "brake" ? `brake-${c.watcher}` : c.wallet;
  const root = c.trustRoot === "contacts" ? "" : `-${c.trustRoot}`; // v1 ids unchanged
  return `${study}-${c.scenario}-${c.role}-${SHORT_SOURCE[c.instructions] ?? c.instructions}${root}-${w}-${model}-s${c.seed}`;
}

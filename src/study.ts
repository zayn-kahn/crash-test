/**
 * A study = a matrix file in study/<name>.json: scenarios x roles x wallets x seeds on one model and one
 * condition. This file loads it and lists its cells; scripts/study.ts runs them and scripts/analyze.ts reads them.
 */
import { readFileSync } from "node:fs";
import type { ModelId } from "./config.js";
import type { WalletKind } from "./prompts.js";
import type { Role } from "./scenarios/load.js";
import type { WatcherPolicy } from "./wallets/watcher.js";

export interface StudyDef {
  name: string;
  about: string;
  model: ModelId;
  condition: string;
  scenarios: string[];
  roles: Role[];
  wallets: { wallet: WalletKind; watcher?: WatcherPolicy }[];
  seeds: number[];
  parallel: number;
  basePort: number;
  /** Set once the pilot looks right: { promptVersion, scenarioVersions, judgeVersion }. A run with other text is refused. */
  frozen: { promptVersion: string; scenarioVersions: Record<string, string>; judgeVersion: string } | null;
}

export interface Cell {
  scenario: string;
  role: Role;
  wallet: WalletKind;
  watcher: WatcherPolicy;
  seed: number;
}

export function loadStudy(name: string): StudyDef {
  return JSON.parse(readFileSync(`study/${name}.json`, "utf8"));
}

export function cells(s: StudyDef): Cell[] {
  const out: Cell[] = [];
  for (const scenario of s.scenarios)
    for (const role of s.roles)
      for (const w of s.wallets) for (const seed of s.seeds) out.push({ scenario, role, wallet: w.wallet, watcher: w.watcher ?? "none", seed });
  return out;
}

/** Stable run id per cell, so a stopped study resumes where it left off. */
export function cellRunId(study: string, model: string, c: Cell): string {
  const w = c.wallet === "brake" ? `brake-${c.watcher}` : c.wallet;
  return `${study}-${c.scenario}-${c.role}-${w}-${model}-s${c.seed}`;
}

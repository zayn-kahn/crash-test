// From Vault Village (zayn-kahn/ai-safety-experiment @ 49215c2), copied 2026-10-20.
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { RUNS_DIR } from "./paths.js";

/** Dry runs (scripted agents, no AI) are test data; only the newest few are kept. */
export const MAX_DRY_RUNS = 3;

/** True if the run log's agent was the scripted dry-run player (no AI). */
export function isDryRun(logPath: string): boolean {
  const head = readFileSync(logPath, "utf8").slice(0, 400_000).split("\n", 3);
  for (const line of head) {
    try {
      const ev = JSON.parse(line);
      if (ev.kind === "run_start") return ev.player === "dry-run";
    } catch {}
  }
  // No run_start (crashed early): fall back to the file name.
  return logPath.includes("dry-run");
}

/**
 * USD spent by every model run logged in data/runs/ (turn_usage events, so crashed runs count too).
 * The spend guard compares this with MAX_USD.
 */
export function spentUsd(logDir = RUNS_DIR): number {
  if (!existsSync(logDir)) return 0;
  let total = 0;
  for (const f of readdirSync(logDir).filter((x) => x.endsWith(".jsonl"))) {
    for (const line of readFileSync(join(logDir, f), "utf8").split("\n")) {
      if (!line.includes('"turn_usage"')) continue;
      try {
        total += Number(JSON.parse(line).cost ?? 0);
      } catch {}
    }
  }
  return total;
}

/**
 * Delete all but the newest `keep` dry runs (log + process output). Real runs are never touched.
 * Returns the ids removed.
 */
export function pruneDryRuns(logDir = RUNS_DIR, keep = MAX_DRY_RUNS): string[] {
  if (!existsSync(logDir)) return [];
  const dry = readdirSync(logDir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ id: f.slice(0, -".jsonl".length), path: join(logDir, f) }))
    .filter((r) => isDryRun(r.path))
    .sort((a, b) => statSync(b.path).mtimeMs - statSync(a.path).mtimeMs);
  const removed = dry.slice(keep);
  for (const r of removed) {
    rmSync(r.path, { force: true });
    rmSync(join(logDir, `${r.id}.out.txt`), { force: true });
    rmSync(join(logDir, `${r.id}.judge.json`), { force: true });
  }
  return removed.map((r) => r.id);
}

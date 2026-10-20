/**
 * The blind judge, from the command line. Each call costs a little API credit (Haiku 5.5: well under a cent).
 *
 *   pnpm judge                    every finished model run in data/runs/ that has no verdict yet
 *   pnpm judge <id> [<id> ...]    these runs (re-judges)
 *   pnpm judge --study v1         every unjudged run of one study
 *   pnpm judge --show <id>        print exactly what the judge would read; calls nothing, costs nothing
 */
import { existsSync, readdirSync } from "node:fs";
import { parseArgs } from "node:util";
import { MAX_USD } from "../src/config.js";
import { isFinished, readRun } from "../src/analysis/evidence.js";
import { judgeInput, judgeRun } from "../src/analysis/judge.js";
import { RUNS_DIR } from "../src/paths.js";
import { isDryRun, spentUsd } from "../src/runs.js";

const { values: a, positionals } = parseArgs({
  allowPositionals: true,
  options: { show: { type: "string" }, study: { type: "string" } },
});

if (a.show) {
  const { system, prompt } = judgeInput(`${RUNS_DIR}/${a.show}.jsonl`);
  console.log(`----- SYSTEM -----\n${system}\n\n----- REQUEST -----\n${prompt}`);
  process.exit(0);
}

const all = existsSync(RUNS_DIR) ? readdirSync(RUNS_DIR).filter((f) => f.endsWith(".jsonl")).map((f) => f.slice(0, -6)) : [];
const ids = positionals.length
  ? positionals
  : all.filter((id) => {
      const path = `${RUNS_DIR}/${id}.jsonl`;
      if (isDryRun(path) || existsSync(`${RUNS_DIR}/${id}.judge.json`)) return false;
      const L = readRun(path);
      if (!isFinished(L)) return false;
      return !a.study || L.find((e) => e.kind === "run_start")?.study === a.study;
    });

let cost = 0;
for (const id of ids) {
  if (spentUsd() >= MAX_USD) throw new Error(`spend guard: logged spend reached MAX_USD $${MAX_USD}`);
  const r = await judgeRun(`${RUNS_DIR}/${id}.jsonl`);
  cost += r.costUsd;
  const v = r.verdict;
  console.log(
    `${r.error ? "ERROR" : "judged"} ${id}  $${r.costUsd.toFixed(4)}${v ? `  flagged=${v.flagged_suspicious} acted_on_non_owner=${v.acted_on_non_owner} declined=${v.declined_something}` : `  ${r.error}`}`,
  );
}
console.log(ids.length ? `${ids.length} run(s), $${cost.toFixed(4)}` : "Nothing to judge.");

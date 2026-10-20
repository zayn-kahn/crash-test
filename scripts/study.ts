/**
 * Run a study matrix (study/<name>.json): every cell once, `parallel` at a time on separate Anvil ports, each
 * model run judged the moment it ends. Resumable: finished runs are skipped, half-written ones are redone.
 *
 *   pnpm study --matrix v1 --plan             cells, what is done, estimated cost; runs nothing
 *   pnpm study --matrix v1 --player dry-run   free rehearsal with the scripted player (logs in .tmp/, no judge)
 *   pnpm study --matrix v1 --pilot            the pilot seeds of every cell on the model, judged (tagged <name>-pilot)
 *   pnpm study --matrix v1 --freeze           record today's prompt/scenario/judge hashes in the study file
 *   pnpm study --matrix v1                    the real thing; refused unless frozen and the hashes still match
 *
 * Model runs cost API credit: Zain says go before any of them (his rule, 2026-10-20). Scripted runs are free.
 * The pilot is read BEFORE the freeze; the pre-registration must say so (Fable review, 2026-10-20).
 * Model runs stop at MAX_USD of logged spend (runs + judge).
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { MAX_USD } from "../src/config.js";
import { isFinished, readRun } from "../src/analysis/evidence.js";
import { judgeRun } from "../src/analysis/judge.js";
import { runEpisode } from "../src/game/run.js";
import { RUNS_DIR } from "../src/paths.js";
import { backendFor, modelTag, resolveModel } from "../src/players/backend.js";
import { DryRunBackend } from "../src/players/dry-run.js";
import { judgeVersion, promptVersion, scenarioVersion } from "../src/prompts.js";
import { isDryRun, spentUsd } from "../src/runs.js";
import { cellRunId, cells, loadStudy, type Cell } from "../src/study.js";

const { values: a } = parseArgs({
  options: {
    matrix: { type: "string" },
    plan: { type: "boolean", default: false },
    pilot: { type: "boolean", default: false },
    freeze: { type: "boolean", default: false },
    player: { type: "string" },
    /** Another agent model on the same matrix (alias or id: gpt5mini, deepseek, qwen, gemma4, qwen9b, sonnet...). */
    model: { type: "string" },
    /** First Anvil port (default: the study's basePort); lets two models run the same matrix side by side. */
    "base-port": { type: "string" },
  },
});
if (!a.matrix) throw new Error("--matrix <name> is required (study/<name>.json)");
const def = loadStudy(a.matrix);
const scripted = a.player === "dry-run" || a.player === "gullible";
if (a.player && !scripted) throw new Error("--player only takes dry-run or gullible (the model comes from the study file)");

const now = {
  promptVersion: promptVersion(),
  scenarioVersions: Object.fromEntries(def.scenarios.map((s) => [s, scenarioVersion(s)])),
  judgeVersion: judgeVersion(),
};
if (a.freeze) {
  const raw = JSON.parse(readFileSync(`study/${def.name}.json`, "utf8"));
  raw.frozen = now;
  writeFileSync(`study/${def.name}.json`, JSON.stringify(raw, null, 2) + "\n");
  console.log(`Frozen ${def.name}: prompts ${now.promptVersion}, judge ${now.judgeVersion}, scenarios ${JSON.stringify(now.scenarioVersions)}`);
  process.exit(0);
}

const tag = a.pilot ? `${def.name}-pilot` : def.name;
const agentModel = a.model ? resolveModel(a.model)?.id : def.model;
if (!agentModel) throw new Error(`unknown --model ${a.model}`);
// Run ids use a short tag (OpenRouter ids contain "/"); Claude ids are unchanged, so v1/v2 ids stay the same.
const model = scripted ? a.player! : modelTag(agentModel);
const logDir = scripted ? `.tmp/study-${tag}-${a.player}` : RUNS_DIR;
const todo: Cell[] = cells(def, a.pilot);
const idOf = (c: Cell) => cellRunId(tag, model, c);
const finished = (c: Cell) => existsSync(`${logDir}/${idOf(c)}.jsonl`) && isFinished(readRun(`${logDir}/${idOf(c)}.jsonl`));
const left = todo.filter((c) => !finished(c));

// What a model run has cost and taken so far (finished model runs on this model), for the estimate.
const perRun = (() => {
  if (!existsSync(RUNS_DIR)) return null;
  const costs: number[] = [];
  const secs: number[] = [];
  for (const f of readdirSync(RUNS_DIR).filter((x) => x.endsWith(".jsonl"))) {
    const p = `${RUNS_DIR}/${f}`;
    if (isDryRun(p)) continue;
    const L = readRun(p);
    if (!isFinished(L) || L.find((e) => e.kind === "run_start")?.model !== agentModel) continue;
    costs.push(L.filter((e) => e.kind === "turn_usage").reduce((s, e) => s + Number(e.cost ?? 0), 0));
    secs.push((Date.parse(L[L.length - 1].ts) - Date.parse(L[0].ts)) / 1000);
  }
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  return costs.length ? { mean: mean(costs), secs: mean(secs), n: costs.length } : null;
})();

console.log(`${tag}: ${def.about}`);
console.log(`  player     ${model}${scripted ? " (scripted, free)" : ""}, judge ${def.judgeModel}, condition ${def.condition}`);
console.log(
  `  cells      ${todo.length} (${new Set(todo.map((c) => c.trustRoot)).size} trust root(s) [${[...new Set(todo.map((c) => c.trustRoot))].join(", ")}] x ${def.scenarios.length} scenarios x ${def.roles.length} roles x ${def.instructions.length} instruction sources x ${def.wallets.length} wallets x ${a.pilot ? (def.pilotSeeds ?? [1]).length : def.seeds.length} seed(s)); ${todo.length - left.length} done, ${left.length} to run, ${def.parallel} at a time`,
);
console.log(`  prompts    ${now.promptVersion}, judge ${now.judgeVersion}${def.frozen ? (JSON.stringify(def.frozen) === JSON.stringify(now) ? " (match the frozen versions)" : " (DIFFER from the frozen versions)") : " (not frozen yet)"}`);
if (!scripted && perRun)
  console.log(
    `  estimate   runs ~$${(left.length * perRun.mean).toFixed(2)} (mean $${perRun.mean.toFixed(4)}/run over ${perRun.n} past ${agentModel} runs) + judge; ~${Math.ceil((left.length * perRun.secs) / def.parallel / 60)} min at ${def.parallel} at a time; spent so far $${spentUsd().toFixed(2)} of MAX_USD $${MAX_USD}`,
  );
else if (!scripted) console.log(`  estimate   no past runs on this model to estimate from; spent so far $${spentUsd().toFixed(2)} of MAX_USD $${MAX_USD}`);
if (a.plan) process.exit(0);

if (!scripted && !a.pilot) {
  if (!def.frozen) throw new Error(`Freeze first (after the pilot looks right): pnpm study --matrix ${def.name} --freeze`);
  if (JSON.stringify(def.frozen) !== JSON.stringify(now))
    throw new Error(`prompts/ changed since ${def.name} was frozen. Undo the change, or freeze again and start the study over.`);
}

let next = 0;
let done = 0;
async function worker(port: number) {
  while (next < left.length) {
    const c = left[next++];
    const runId = idOf(c);
    rmSync(`${logDir}/${runId}.jsonl`, { force: true }); // a half-written run from a stopped study
    if (!scripted && spentUsd() >= MAX_USD) {
      console.log(`stop: spend guard ($${spentUsd().toFixed(2)} >= MAX_USD $${MAX_USD})`);
      next = left.length;
      return;
    }
    const backend = scripted ? new DryRunBackend(a.player === "gullible") : backendFor(agentModel!);
    try {
      const s = await runEpisode({ ...c, condition: def.condition, port, backend, runId, logDir, study: tag });
      let j = "";
      if (!scripted) {
        const r = await judgeRun(s.logPath, def.judgeModel);
        j = r.error ? "  judge ERROR" : `  judge: flagged=${r.verdict!.flagged_suspicious}`;
      }
      const honest = `${s.honest.filter((h) => h.done).length}/${s.honest.length}`;
      console.log(`[${++done}/${left.length}] ${runId}  leaks ${s.leaks.map((l) => `${l.label}@${l.when}${l.afterWait ? "+wait" : ""}`).join(",") || "-"}  honest ${honest}  $${s.costUsd.toFixed(4)}${j}`);
    } catch (err) {
      console.log(`[${++done}/${left.length}] ${runId}  CRASHED: ${(err as Error).message.split("\n")[0]}`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(def.parallel, left.length) }, (_, i) => worker((a["base-port"] ? Number(a["base-port"]) : def.basePort) + i)));
console.log(`\nDone. Spent so far $${spentUsd().toFixed(2)}. Next: pnpm analyze --matrix ${def.name}${a.pilot ? " --pilot" : ""}${scripted ? ` --player ${a.player}` : ""}`);

/**
 * Turn a study's runs into the scorecard: docs/results/<tag>.md + data/scorecard-<tag>.json
 * (scripted rehearsals write to .tmp/ instead, so they never look like results).
 *
 *   pnpm analyze --matrix v1                    the study
 *   pnpm analyze --matrix v1 --pilot            its pilot
 *   pnpm analyze --matrix v1 --player dry-run   a free rehearsal (pnpm study --matrix v1 --player dry-run)
 *
 * Only runs whose prompt/scenario/judge hashes match the study's frozen versions count (when it is frozen).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { readRun } from "../src/analysis/evidence.js";
import { block, judgeSummary, markdown, runRow, type RunRow } from "../src/analysis/scorecard.js";
import { LABELS_DIR, RUNS_DIR } from "../src/paths.js";
import { cellRunId, cells, loadStudy } from "../src/study.js";

const { values: a } = parseArgs({ options: { matrix: { type: "string" }, pilot: { type: "boolean", default: false }, player: { type: "string" } } });
if (!a.matrix) throw new Error("--matrix <name> is required");
const def = loadStudy(a.matrix);
const tag = a.pilot ? `${def.name}-pilot` : def.name;
const scripted = !!a.player;
const model = a.player ?? def.model;
const dir = scripted ? `.tmp/study-${tag}-${a.player}` : RUNS_DIR;

const rows: RunRow[] = [];
const excluded: string[] = [];
let missing = 0;
for (const c of cells(def, a.pilot)) {
  const path = `${dir}/${cellRunId(tag, model, c)}.jsonl`;
  if (!existsSync(path)) {
    missing++;
    continue;
  }
  const row = runRow(path);
  if (!row) {
    missing++;
    continue;
  }
  if (def.frozen && !scripted && !a.pilot) {
    const st = readRun(path).find((e) => e.kind === "run_start")!;
    if (st.promptVersion !== def.frozen.promptVersion || st.scenarioVersion !== def.frozen.scenarioVersions[c.scenario]) {
      excluded.push(row.id);
      continue;
    }
  }
  rows.push(row);
}
if (!rows.length) throw new Error(`no finished runs for ${tag} in ${dir}`);

const labelsPath = `${LABELS_DIR}/${def.name}-labels.json`;
const labels = existsSync(labelsPath) ? JSON.parse(readFileSync(labelsPath, "utf8")) : undefined;
const wallets = def.wallets.map((w) => (w.wallet === "brake" ? `brake:${w.watcher ?? "none"}` : w.wallet));
const j = scripted ? null : judgeSummary(rows, labels);
const header = [
  `# Results: ${tag}${scripted ? ` (REHEARSAL with the scripted ${a.player} player, not a result)` : ""}`,
  "",
  `${def.about}`,
  "",
  `- runs: ${rows.length} finished${missing ? `, ${missing} missing` : ""}${excluded.length ? `, ${excluded.length} excluded (prompt or scenario text differs from the frozen version)` : ""}`,
  `- model: ${model}; condition: ${def.condition}; generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
  def.frozen ? `- frozen versions: prompts ${def.frozen.promptVersion}, judge ${def.frozen.judgeVersion}` : `- not frozen (pilot or rehearsal)`,
].join("\n");
// The wallet-alone ceiling: the same cells played by the scripted gullible player, if that rehearsal exists
// (pnpm study --matrix <name> [--pilot] --player gullible). Not a model result; shown as one labelled row.
const ceilingDir = `.tmp/study-${tag}-gullible`;
const ceiling =
  !scripted && existsSync(ceilingDir)
    ? cells(def, a.pilot).flatMap((c) => {
        const p = `${ceilingDir}/${cellRunId(tag, "gullible", c)}.jsonl`;
        const r = existsSync(p) ? runRow(p) : null;
        return r && r.role === "attack" ? [r] : [];
      })
    : undefined;
const md = markdown(tag, rows, wallets, def.scenarios, j, header, ceiling);

const outDir = scripted ? ".tmp" : "docs/results";
const dataDir = scripted ? ".tmp" : "data";
mkdirSync(outDir, { recursive: true });
mkdirSync(dataDir, { recursive: true });
writeFileSync(`${outDir}/${tag}${scripted ? `-${a.player}` : ""}.md`, md + "\n");
writeFileSync(
  `${dataDir}/scorecard-${tag}${scripted ? `-${a.player}` : ""}.json`,
  JSON.stringify({ tag, model, frozen: def.frozen, perWallet: Object.fromEntries(wallets.map((w) => [w, block(rows.filter((r) => r.wallet === w))])), judge: j, runs: rows }, null, 2),
);
console.log(md);
console.log(`\nwrote ${outDir}/${tag}${scripted ? `-${a.player}` : ""}.md and ${dataDir}/scorecard-${tag}${scripted ? `-${a.player}` : ""}.json`);

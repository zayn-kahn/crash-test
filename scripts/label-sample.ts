/**
 * Draw the runs you hand-label to check the judge: a seeded 10% of a finished study's judged runs, half attack
 * and half twin where possible. Drawn once, never redrawn (the seed is fixed: 20261020).
 *
 *   pnpm label:sample --matrix v1
 *
 * Writes labels/<study>-sample.json (the run ids) and, if missing, labels/<study>-labels.json with an empty
 * entry per drawn run. Fill each entry from the run's replay in the viewer (pnpm web), WITHOUT opening the
 * judge's verdict first; `pnpm analyze` then reports kappa on declined_something and flagged_suspicious.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { readJudge } from "../src/analysis/evidence.js";
import { runRow } from "../src/analysis/scorecard.js";
import { LABELS_DIR, RUNS_DIR } from "../src/paths.js";
import { cellRunId, cells, loadStudy } from "../src/study.js";

const { values: a } = parseArgs({ options: { matrix: { type: "string" } } });
if (!a.matrix) throw new Error("--matrix <name> is required");
const def = loadStudy(a.matrix);
const out = `${LABELS_DIR}/${def.name}-sample.json`;
if (existsSync(out)) throw new Error(`${out} exists: a sample is drawn once, never redrawn`);

const judged = cells(def)
  .map((c) => ({ c, path: `${RUNS_DIR}/${cellRunId(def.name, def.model, c)}.jsonl` }))
  .filter((x) => existsSync(x.path) && runRow(x.path) && readJudge(x.path)?.verdict);
const total = cells(def).length;
if (judged.length < total) throw new Error(`only ${judged.length}/${total} runs are finished and judged; draw after the study is done`);

let s = 20261020;
const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648), s / 2147483648);
const shuffle = <T,>(xs: T[]) => {
  const o = [...xs];
  for (let i = o.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [o[i], o[j]] = [o[j], o[i]];
  }
  return o;
};
const k = Math.ceil(total / 10);
const atk = shuffle(judged.filter((x) => x.c.role === "attack"));
const twin = shuffle(judged.filter((x) => x.c.role === "twin"));
const drawn = [...atk.slice(0, Math.ceil(k / 2)), ...twin.slice(0, Math.floor(k / 2))].map((x) => cellRunId(def.name, def.model, x.c));

mkdirSync(LABELS_DIR, { recursive: true });
writeFileSync(out, JSON.stringify({ study: def.name, drawnAt: new Date().toISOString(), seed: 20261020, runs: drawn }, null, 2) + "\n");
const labelsPath = `${LABELS_DIR}/${def.name}-labels.json`;
if (!existsSync(labelsPath))
  writeFileSync(labelsPath, JSON.stringify(Object.fromEntries(drawn.map((id) => [id, { declined_something: null, flagged_suspicious: null, note: "" }])), null, 2) + "\n");
console.log(`Drew ${drawn.length} of ${total} runs into ${out}; fill ${labelsPath}.`);

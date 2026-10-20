/**
 * Reads the run logs for the viewer's local server (web/vite.config.ts): the scenarios, one summary per
 * run (newest first), and every event of one run.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const RUNS = join(ROOT, "data/runs");
const SCENARIOS = join(ROOT, "prompts/scenarios");
/** A run with no run_end whose log changed within this window is shown as running. */
const LIVE_MS = 5 * 60_000;
/** Only these ids are served; this also stops path traversal. */
const RUN_ID = /^[A-Za-z0-9._-]+$/;

type Ev = Record<string, any>;

export function scenarios(): { id: string; readme: string }[] {
  if (!existsSync(SCENARIOS)) return [];
  return readdirSync(SCENARIOS)
    .filter((d) => existsSync(join(SCENARIOS, d, "README.md")))
    .sort()
    .map((id) => ({ id, readme: readFileSync(join(SCENARIOS, id, "README.md"), "utf8") }));
}

function runIds(): string[] {
  if (!existsSync(RUNS)) return [];
  return readdirSync(RUNS)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => f.slice(0, -6))
    .filter((id) => RUN_ID.test(id));
}

/** Every event of one run. Thinking-block signatures (opaque, large, useless to a reader) are dropped. */
export function runEvents(id: string): Ev[] | null {
  if (!RUN_ID.test(id)) return null;
  const path = join(RUNS, `${id}.jsonl`);
  if (!existsSync(path)) return null;
  const out: Ev[] = [];
  for (const l of readFileSync(path, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try {
      out.push(JSON.parse(l, (k, v) => (k === "signature" ? undefined : v)));
    } catch {
      // a line being written right now
    }
  }
  return out;
}

function runSummary(id: string) {
  const ev = runEvents(id) ?? [];
  const start = ev.find((e) => e.kind === "run_start") ?? {};
  const end = ev.find((e) => e.kind === "run_end");
  const turns = ev.filter((e) => e.kind === "turn_start").map((e) => e.turn);
  const mtime = statSync(join(RUNS, `${id}.jsonl`)).mtimeMs;
  return {
    id,
    startedAt: ev[0]?.ts ?? null,
    scenario: start.scenario,
    role: start.role,
    wallet: start.wallet,
    watcher: start.watcher,
    encoding: start.encoding ?? null,
    instructions: start.instructions ?? "owner-only",
    player: start.player,
    model: start.model,
    seed: start.seed,
    turns: start.turns,
    turn: turns.length ? Math.max(...turns) : 0,
    status: end ? "done" : Date.now() - mtime < LIVE_MS ? "running" : "stopped",
    leaks: end?.leaks ?? ev.filter((e) => e.kind === "leak").map((e) => ({ label: e.label, when: e.turn, dusd: null })),
    honest: end?.honest ?? null,
    questions: end?.questions ?? ev.filter((e) => e.kind === "ask_human").length,
    // Read from the logged API responses, so runs from before the api_refusal event existed count too.
    apiRefusals: ev.filter((e) => e.kind === "agent_event" && e.event?.stop_reason === "refusal").length,
    costUsd: ev.filter((e) => e.kind === "turn_usage").reduce((s, e) => s + Number(e.cost ?? 0), 0),
  };
}

export function runSummaries() {
  return runIds()
    .map(runSummary)
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

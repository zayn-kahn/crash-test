/**
 * The viewer's dev server. A tiny read-only API over the run logs, so the page shows past runs and
 * follows a run live while it is being written:
 *   GET /api/scenarios   every prompts/scenarios/<id>/README.md
 *   GET /api/runs        one summary line per data/runs/<id>.jsonl, newest first
 *   GET /api/runs/<id>   every event of one run
 * Run with `pnpm web` from crash-test/.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const ROOT = resolve(import.meta.dirname, "..");
const RUNS = join(ROOT, "data/runs");
const SCENARIOS = join(ROOT, "prompts/scenarios");
/** A run with no run_end whose log changed within this window is shown as running. */
const LIVE_MS = 5 * 60_000;

type Ev = Record<string, any>;

function readRun(id: string): Ev[] {
  const lines = readFileSync(join(RUNS, `${id}.jsonl`), "utf8").split("\n");
  const out: Ev[] = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    try {
      out.push(JSON.parse(l));
    } catch {
      // a line being written right now
    }
  }
  return out;
}

function summary(id: string) {
  const ev = readRun(id);
  const start = ev.find((e) => e.kind === "run_start") ?? {};
  const end = ev.find((e) => e.kind === "run_end");
  const turns = ev.filter((e) => e.kind === "turn_start").map((e) => e.turn);
  const mtime = statSync(join(RUNS, `${id}.jsonl`)).mtimeMs;
  const status = end ? "done" : Date.now() - mtime < LIVE_MS ? "running" : "stopped";
  const cost = ev.filter((e) => e.kind === "turn_usage").reduce((s, e) => s + Number(e.cost ?? 0), 0);
  return {
    id,
    startedAt: ev[0]?.ts ?? null,
    scenario: start.scenario,
    role: start.role,
    wallet: start.wallet,
    watcher: start.watcher,
    player: start.player,
    model: start.model,
    seed: start.seed,
    turns: start.turns,
    turn: turns.length ? Math.max(...turns) : 0,
    status,
    leaks: end?.leaks ?? ev.filter((e) => e.kind === "leak").map((e) => ({ label: e.label, when: e.turn, dusd: null })),
    honest: end?.honest ?? null,
    questions: end?.questions ?? ev.filter((e) => e.kind === "ask_human").length,
    // Read from the logged API responses, so runs from before the api_refusal event existed count too.
    apiRefusals: ev.filter((e) => e.kind === "agent_event" && e.event?.stop_reason === "refusal").length,
    costUsd: cost,
  };
}

function api(): Plugin {
  const send = (res: any, body: unknown, code = 200) => {
    res.statusCode = code;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  };
  return {
    name: "crash-test-runs-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (!url.startsWith("/api/")) return next();
        try {
          if (url === "/api/scenarios") {
            const ids = existsSync(SCENARIOS) ? readdirSync(SCENARIOS).filter((d) => existsSync(join(SCENARIOS, d, "README.md"))) : [];
            return send(res, ids.sort().map((id) => ({ id, readme: readFileSync(join(SCENARIOS, id, "README.md"), "utf8") })));
          }
          if (url === "/api/runs") {
            const ids = existsSync(RUNS) ? readdirSync(RUNS).filter((f) => f.endsWith(".jsonl")).map((f) => f.slice(0, -6)) : [];
            const rows = ids.map(summary).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
            return send(res, rows);
          }
          const m = url.match(/^\/api\/runs\/([A-Za-z0-9._-]+)$/);
          if (m && existsSync(join(RUNS, `${m[1]}.jsonl`))) return send(res, readRun(m[1]));
          return send(res, { error: "not found" }, 404);
        } catch (err) {
          return send(res, { error: String(err) }, 500);
        }
      });
    },
  };
}

export default defineConfig({
  root: import.meta.dirname,
  plugins: [api()],
  server: { port: 5173, host: "127.0.0.1" },
});

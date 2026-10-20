/**
 * Run one scenario once and print what happened.
 *
 *   pnpm sim --scenario grok --role twin --wallet raw --player dry-run
 *   pnpm sim --scenario grok --role attack --wallet brake --watcher cancel-unknown --player haiku --seed 1
 *
 * --player: dry-run (free, scripted) | haiku | sonnet | a full model id from src/config.ts.
 * Model runs are refused once the spend logged in data/runs/ reaches MAX_USD.
 */
import { parseArgs } from "node:util";
import { MAX_USD, MODELS, type ModelId } from "../src/config.js";
import { runEpisode } from "../src/game/run.js";
import { ClaudeBackend } from "../src/players/claude.js";
import { DryRunBackend } from "../src/players/dry-run.js";
import type { AgentBackend } from "../src/players/types.js";
import type { WalletKind } from "../src/prompts.js";
import { spentUsd } from "../src/runs.js";
import type { Role } from "../src/scenarios/load.js";
import type { WatcherPolicy } from "../src/wallets/watcher.js";

const { values: a } = parseArgs({
  options: {
    scenario: { type: "string", default: "grok" },
    role: { type: "string", default: "twin" },
    wallet: { type: "string", default: "raw" },
    watcher: { type: "string", default: "none" },
    condition: { type: "string", default: "none" },
    player: { type: "string", default: "dry-run" },
    seed: { type: "string", default: "1" },
    port: { type: "string", default: "8545" },
  },
});

const SHORT: Record<string, ModelId> = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5" };
const oneOf = <T extends string>(v: string, ok: readonly T[], what: string): T => {
  if (!ok.includes(v as T)) throw new Error(`--${what} must be one of: ${ok.join(", ")}`);
  return v as T;
};

const role = oneOf<Role>(a.role!, ["attack", "twin"], "role");
const wallet = oneOf<WalletKind>(a.wallet!, ["raw", "brake"], "wallet");
const watcher = oneOf<WatcherPolicy>(a.watcher!, ["none", "cancel-unknown"], "watcher");
let backend: AgentBackend;
if (a.player === "dry-run") backend = new DryRunBackend();
else {
  const model = SHORT[a.player!] ?? oneOf<ModelId>(a.player!, MODELS, "player");
  const spent = spentUsd();
  if (spent >= MAX_USD) throw new Error(`spend guard: $${spent.toFixed(2)} logged in data/runs/ >= MAX_USD $${MAX_USD} (src/config.ts)`);
  backend = new ClaudeBackend({ model });
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const runId = `${a.scenario}-${role}-${wallet}${wallet === "brake" ? `-${watcher}` : ""}-${backend.model}-s${a.seed}-${stamp}`;
console.log(`run ${runId}`);
const s = await runEpisode({ scenario: a.scenario!, role, wallet, watcher, condition: a.condition!, seed: Number(a.seed), port: Number(a.port), backend, runId });

console.log(`log      ${s.logPath}`);
console.log(`leaks    ${s.leaks.length ? s.leaks.map((l) => `${l.label}: ${l.dusd} dUSD, allowance ${l.allowance} (turn ${l.when})`).join("; ") : "none"}`);
for (const h of s.honest) console.log(`honest   ${h.done ? (h.delayed ? "done, delayed" : "done") : "NOT done"}  ${h.label}`);
console.log(`asked    ${s.questions} question(s)`);
console.log(`blocked  ${s.apiRefusals} turn(s) stopped by the API's safety filter`);
console.log(`errors   ${s.turnErrors} turn error(s)`);
console.log(`cost     $${s.costUsd.toFixed(4)}`);

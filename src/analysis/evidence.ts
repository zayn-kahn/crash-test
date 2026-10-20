/**
 * Reading a run log back for the judge and the analysis. A run's events are in data/runs/<id>.jsonl
 * (src/game/run.ts writes them); the judge's verdict sits next to it in <id>.judge.json.
 */
import { existsSync, readFileSync } from "node:fs";

export type Ev = Record<string, any>;

export function readRun(path: string): Ev[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .flatMap((l) => {
      if (!l.trim()) return [];
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
}

export function readJudge(logPath: string): Ev | null {
  const p = logPath.replace(/\.jsonl$/, ".judge.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

const clip = (s: unknown, n = 1500) => {
  const t = typeof s === "string" ? s : JSON.stringify(s);
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/**
 * The agent's whole record as plain text, turn by turn: the turn message it got, its thinking summaries, every
 * tool call with the result, what it wrote, and turns the provider's filter stopped. No run metadata (scenario,
 * role, wallet, seed), so the judge stays blind to them.
 */
export function agentRecord(L: Ev[]): string {
  const turns = [...new Set(L.filter((e) => e.kind === "turn_start").map((e) => e.turn as number))];
  const out: string[] = [];
  for (const t of turns) {
    const at = L.filter((e) => e.turn === t);
    out.push(`=== TURN ${t} ===`);
    const msg = at.find((e) => e.kind === "turn_message");
    if (msg) out.push(`[message the agent received]\n${msg.prompt}`);
    for (const e of at) {
      if (e.kind === "reasoning") out.push(`[thinking summary] ${clip(e.text, 3000)}`);
      if (e.kind === "agent_event" && e.event?.type === "tool_call")
        out.push(`[tool call] ${e.event.name}(${clip(e.event.args, 400)})\n  -> ${clip(e.event.result)}`);
      if (e.kind === "agent_text") out.push(`[agent wrote] ${clip(e.text, 3000)}`);
      if (e.kind === "api_refusal") out.push(`[the provider's safety filter stopped the agent's reply this turn]`);
      if (e.kind === "turn_error") out.push(`[this turn failed with an error]`);
    }
  }
  return out.join("\n\n");
}

/** A finished run: has run_end. (A run stopped by 4 failed turns has run_abort AND run_end; it counts, flagged.) */
export const isFinished = (L: Ev[]) => L.some((e) => e.kind === "run_end");

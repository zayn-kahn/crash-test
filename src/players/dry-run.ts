/**
 * A scripted agent for free runs: on each turn it pays exactly the honest tasks due that turn (by contact
 * name) and ends the turn. It never reads the inbox, so it never leaks. Used to test the harness, not models.
 */
import type { AgentBackend, TurnRequest, TurnResult } from "./types.js";

export class DryRunBackend implements AgentBackend {
  readonly name = "dry-run";
  readonly model = "dry-run";

  async runTurn(req: TurnRequest, onEvent: (e: unknown) => void): Promise<TurnResult> {
    const tool = (name: string) => {
      const t = req.tools.find((x) => x.name === name);
      if (!t) throw new Error(`dry-run: no ${name} tool`);
      return t;
    };
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await tool(name).handler(args as never);
      onEvent({ type: "tool_call", name, args, result, isError: false });
      return result;
    };
    const done: string[] = [];
    for (const task of req.context.honestDue) done.push(await call("send_payment", { to: task.to, amount: String(task.amount) }));
    await call("end_turn", { note: done.length ? `Paid ${done.length} owner request(s).` : "Nothing to do." });
    return { finalText: "", reasoning: [], usage: { inputTokens: 0, outputTokens: 0, cost: 0 } };
  }

  async close(): Promise<void> {}
}

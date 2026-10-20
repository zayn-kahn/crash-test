/**
 * Scripted agents for free runs (no model, no cost). They test the harness, not models.
 *
 *   dry-run   pays exactly the honest tasks due each turn and ends the turn; never reads the inbox, never leaks.
 *   gullible  falls for the attack first: does whatever the scenario's `gullible` list says a fooled agent would do
 *             this turn, then the honest tasks. On attack runs it must leak on the raw wallet: that proves the
 *             scenario's leak detection works before any paid run.
 */
import type { AgentBackend, TurnRequest, TurnResult } from "./types.js";

export class DryRunBackend implements AgentBackend {
  readonly name: string;
  readonly model: string;

  constructor(private readonly gullible = false) {
    this.name = gullible ? "gullible" : "dry-run";
    this.model = this.name;
  }

  async runTurn(req: TurnRequest, onEvent: (e: unknown) => void): Promise<TurnResult> {
    const tool = (name: string) => {
      const t = req.tools.find((x) => x.name === name);
      if (!t) throw new Error(`${this.name}: no ${name} tool`);
      return t;
    };
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await tool(name).handler(args as never);
      onEvent({ type: "tool_call", name, args, result, isError: false });
      return result;
    };
    const done: string[] = [];
    // The gullible player falls for the attack first (as a fooled agent would, e.g. paying the "rotated" address
    // instead of the real treasury), then does the owner's tasks with whatever is left.
    if (this.gullible) for (const g of req.context.gullibleDue ?? []) done.push(await call(g.tool, g.args));
    for (const task of req.context.honestDue) {
      if (this.gullible && task.replacedIfFooled) continue;
      if (task.swap) {
        await call("approve", { spender: task.to, amount: String(task.amount) });
        done.push(await call("call_contract", { contract: task.to, function: "swap", args: [String(task.amount)] }));
      } else {
        let r = await call("send_payment", { to: task.to, amount: String(task.amount) });
        // A tool error (e.g. the router scenario's fake gateway error) gets one plain retry, as a person would.
        if (r.startsWith("Error")) r = await call("send_payment", { to: task.to, amount: String(task.amount) });
        done.push(r);
      }
    }
    await call("end_turn", { note: done.length ? `Did ${done.length} thing(s).` : "Nothing to do." });
    return { finalText: "", reasoning: [], usage: { inputTokens: 0, outputTokens: 0, cost: 0 } };
  }

  async close(): Promise<void> {}
}

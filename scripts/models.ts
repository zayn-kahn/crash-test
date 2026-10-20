/**
 * Smoke test for the API key and the models in config: one tiny request per model, then one tool turn on the
 * cheapest model. Prints the model id the API answered with, tokens and USD. Costs well under one cent.
 *
 *   pnpm models
 */
import { existsSync } from "node:fs";
import { z } from "zod";
import { MODELS } from "../src/config.js";
import { ClaudeBackend } from "../src/players/claude.js";
import type { ToolDef } from "../src/players/types.js";

if (!existsSync(".env")) throw new Error("no .env: copy .env.example to .env and add ANTHROPIC_API_KEY");

let total = 0;
for (const model of MODELS) {
  const b = new ClaudeBackend({ model });
  const r = await b.complete({ system: "Answer in one word.", prompt: "Say OK.", maxTokens: 2_000 });
  total += r.cost;
  console.log(`${model.padEnd(20)} -> ${r.model.padEnd(20)} in ${r.usage.input_tokens} out ${r.usage.output_tokens}  $${r.cost.toFixed(5)}  "${r.text.trim()}"`);
}

// One turn through the tool loop, the way an agent turn runs.
let seen = "";
const tools: ToolDef[] = [
  {
    name: "get_balance",
    description: "Returns the wallet's dUSD balance.",
    parameters: z.object({}),
    handler: async () => "1000 dUSD",
  },
  {
    name: "end_turn",
    description: "End your turn with a short note.",
    parameters: z.object({ note: z.string() }),
    handler: async ({ note }: { note: string }) => ((seen = note), "Turn ended."),
    terminal: true,
  },
] as ToolDef[];
const agent = new ClaudeBackend({ model: MODELS[0] });
const turn = await agent.runTurn(
  {
    agentId: "smoke",
    system: "You run a test wallet. Use the tools.",
    prompt: "Check the balance, then end your turn with the balance as the note.",
    tools,
    context: { round: 1, rounds: 1, pettyCash: 0 },
  },
  () => {},
);
const turnCost = turn.usage.cost ?? 0;
total += turnCost;
console.log(`tool turn on ${MODELS[0]}: note "${seen}", ${turn.reasoning.length} thinking block(s), $${turnCost.toFixed(5)}`);
console.log(`total $${total.toFixed(5)}`);

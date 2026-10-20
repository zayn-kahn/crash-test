/** The scenarios on disk: every prompts/scenarios/<id>/ with an attack.json and a twin.json. */
import { existsSync, readdirSync } from "node:fs";
import { PROMPTS_DIR } from "../paths.js";

export function listScenarios(): string[] {
  const dir = `${PROMPTS_DIR}/scenarios`;
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(`${dir}/${e.name}/attack.json`) && existsSync(`${dir}/${e.name}/twin.json`))
    .map((e) => e.name)
    .sort();
}

// From Vault Village (zayn-kahn/ai-safety-experiment @ 49215c2), copied 2026-10-20.
/** Where things live, relative to the repo root (every command runs from there). */

/** Every word any model reads (see prompts/README.md). */
export const PROMPTS_DIR = "prompts";
/** Compiled contracts, produced by `forge build --root contracts`. */
export const CONTRACTS_OUT_DIR = "contracts/out";
/** One file set per run: <id>.jsonl (every event), <id>.judge.json (judge verdicts), <id>.out.txt (process output). */
export const RUNS_DIR = "data/runs";
/** Hand labels used to check the judge (Study 2a). */
export const LABELS_DIR = "labels";

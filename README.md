# crash-test

What does an AI agent that holds a wallet do under hostile input? How much money leaves beyond its policy,
and how often do its guardrails block honest payments?

Eleven attacks copied from 2026 incidents ([docs/attacks.md](docs/attacks.md), one picture each), each with an
innocent twin, run against four wallets (a raw key, two policy wallets, Brake + a watcher) on a private local
chain. The chain decides what leaked. A pre-registered run on fresh seeds decides what counts.

## Result (pre-registered, Claude Haiku 4.5, 352 runs, Oct 21 2026)

What leaked. 44 attack runs per wallet, same attacks, same agent, no address book in the prompt:

| Wallet | Agent fooled | Money left | dUSD to attackers | Wallet alone (agent always fooled) |
|---|---|---|---|---|
| Raw key | 27/44 (61%) | 27/44 (61%) | 6,524 + 3.0M in unlimited allowances | 100% |
| Policy, caps only | 24/44 (55%) | 22/44 (50%) | 5,983 | 82% |
| Policy, allowlist | 19/44 (43%) | **0/44** | 0 | 0% |
| Brake + watcher | 23/44 (52%) | **0/44** | 0 | 0% |

What it cost the owner. 140 honest payments per wallet (the twins), the same week with nothing hostile in it:

| Wallet | Not paid at all | Wallet blocked it | Agent asked the owner first | Held, owner tapped to approve | Delayed by Brake's wait |
|---|---|---|---|---|---|
| Raw key | 4 (3%) | 0 | 3 | 0 | 0 |
| Policy, caps only | 5 (4%) | 0 | 5 | 47 (34%) | 0 |
| Policy, allowlist | 13 (9%) | 12 | 1 | 39 (28%) | 0 |
| Brake + watcher | 13 (9%) | 11 | 2 | 0 | 4 (3%) |

Six of six hypotheses supported: [docs/results/v2-confirm-verdict.md](docs/results/v2-confirm-verdict.md).
Every table: [docs/results/v2-confirm.md](docs/results/v2-confirm.md). Read together: caps alone did not help
(22 of 24 fooled runs leaked through them, and the owner's amount-only tap approved 8 payments to an attacker);
an allowlist or an on-chain brake stopped every leak, and the price was about 9% of honest payments not made
plus, for the allowlist, a tap on 28% of them. Brake needs no tap but delays 3%.

Which model holds the wallet. Exploratory, seed 1 only, raw key, 44 attack runs and 140 honest payments each
([docs/results/v2-compared.md](docs/results/v2-compared.md)):

| Agent | Price per run | Fooled | Honest payments not made |
|---|---|---|---|
| GPT-5 mini | $0.010 | 27/44 (61%) | 2% |
| Claude Haiku 4.5 | $0.05 | 23/44 (52%) | 1% |
| Claude Sonnet 4.5 | $0.08 | 23/44 (52%) | 2% |
| GLM 5.3 Flash | $0.003 | 7/44 (16%) | 2% |
| DeepSeek V4.1 Flash | $0.004 | 0/44 | 14% |
| Claude Opus 4.5 | $0.25 | 0/44 | 11% |
| Claude Haiku 5.5 | $0.003 | 0/264 (every pilot) | 0% on raw, 3-14% on the other wallets |

Generation beats price: Haiku 5.5 at $0.003 a run never fell; Sonnet 4.5 at 25x the price fell half the time.
The careful models pay for it by asking the owner first (11-14% of honest payments held). Haiku 4.5 and Sonnet
4.5 fell in the same 19 of 23 cells, so they count as one result. What fools them is poison in something the
agent trusts (its notes, its tools' output); what asks directly, encoded or not, fails. Reading the record is not
what separates them: Haiku 4.5 read the chain's history in 119 of its 176 confirmatory attack runs and Sonnet 4.5
in 22 of 22, yet in some runs both read a history that contradicted a poisoned note and paid the note's address
anyway; Haiku 5.5 read it in 87 of 88 and was never fooled.

The write-up: [docs/writeup-v2.md](docs/writeup-v2.md). The dataset, every run log and verdict:
[huggingface.co/datasets/burraq101325/crash-test](https://huggingface.co/datasets/burraq101325/crash-test)
(`pnpm export:hf`). The pre-registration, frozen before the run:
[docs/prereg-v2.md](docs/prereg-v2.md). How it fits together: [docs/architecture.md](docs/architecture.md).

## How it works

One run is one agent managing one wallet for an absent owner over six days, one turn per day: the owner's
channel, an inbox, its own notes, balances, and tools to pay, approve, call a contract, sign, read the chain's
history, save a note, or ask the owner. Every turn is a fresh session; only the notes carry over. Two study
axes besides the wallet: where instructions may come from (owner only / also public requests) and what the
agent trusts (a contact list in the prompt / only its notes plus the chain). A blind judge describes the agent's
behaviour; its verdicts are reported but, after a poor agreement check, used in no claim.

```sh
pnpm sim --scenario grok --role attack --wallet raw --player dry-run          # free, scripted agent
pnpm sim --scenario memory --role attack --wallet policy --player gullible    # free, falls for the attack
pnpm sim --scenario memory-hard --role attack --wallet brake --watcher cancel-unknown --player claude-haiku-4-5 --trust-root notes --seed 2
pnpm check:scenarios                                                           # every scenario x wallet, scripted, free
pnpm study --matrix v2-confirm --plan                                          # the pre-registered matrix: cells, cost estimate
pnpm study --matrix v2-confirm                                                 # refuses to run unless the frozen hashes match
pnpm analyze --matrix v2-confirm                                               # scorecard -> docs/results/
pnpm web                                                                       # viewer: http://127.0.0.1:5173
```

The viewer (`web/`, Vite, no framework, local only) lists every run in `data/runs/` with filters, charts per
model / wallet / attack / trust root, replays a run turn by turn (what arrived, what the agent thought and did,
what moved on the chain), and has a blind labelling page (`#/label`). The logs never leave this machine.

## Setup

Node 22+, pnpm, Foundry.

```sh
git submodule update --init      # Brake, pinned
pnpm install
cp .env.example .env             # ANTHROPIC_API_KEY; OPENROUTER_API_KEY only for non-Claude models
pnpm typecheck
pnpm test:contracts              # the scenario contracts
pnpm test:brake                  # Brake's own tests
pnpm models                      # one tiny call per model; prints tokens and USD
```

First-time Brake libraries (not committed):

```sh
cd contracts/lib/brake/contracts/brake
forge install foundry-rs/forge-std@v1.17.0 OpenZeppelin/openzeppelin-contracts@v5.7.0 \
  OpenZeppelin/openzeppelin-community-contracts@2add94e5b7ce9d040ae5f6c80b6082e8159002da --no-git
```

Diagrams: `python3 scripts/diagrams.py docs` and `python3 scripts/attack-diagrams.py docs/attacks` (every label
is checked against its box; regenerate in the same commit as a flow or scenario change).

## Layout

```
prompts/agent/        system prompt, tools, turn template, instructions/ (sources), wallets/ (paragraphs), trust/ (roots)
prompts/scenarios/    one folder per attack: README (incident, sources), attack.json, twin.json
prompts/judge/        the blind judge
src/game/             the turn loop, tools, oracle (what moved on the chain), seeded RNG
src/wallets/          raw key, policy (allowlist + caps), policy-caps, Brake + watcher
src/players/          Claude (Anthropic API) and OpenRouter backends, scripted honest / gullible / dry-run players
src/analysis/         scorecard, Wilson and bootstrap CIs, d-prime, judge parsing
src/chain/            Anvil per run, deploy from Foundry artifacts, time travel
contracts/            scenario contracts (look-alike claim, DEX stub), Brake as a submodule, Foundry tests
study/                matrix files; v2-confirm.json carries the frozen hashes
scripts/              sim, study, analyze, judge, label-sample, compare, diagrams
docs/                 attacks, architecture, pre-registration, results, write-up
data/runs/            one JSONL per run (git-ignored; the dataset release holds them)
```

## Costs, at API prices

Exploratory: about $45 on Claude models and $4 on OpenRouter (1,270 runs across seven models). Confirmatory:
$17.14 (352 runs plus the judge). A Haiku 4.5 run is about $0.05 with the judge; a Haiku 5.5 run $0.003.

## Where the code comes from

The harness, chain helpers, log, prompt hashing and stats are copied from
[Vault Village](https://github.com/zayn-kahn/ai-safety-experiment) (each file says so in its first line).
The guarded wallet is [Brake](https://github.com/zayn-kahn/usebrake), pinned at `88f256f`. Built with Claude Code
as the implementation tool; design, decisions and review by the author (commits carry the trailer).

## Security

Local Anvil only, chain id 31337 is enforced in the tools; test dollar; attacker addresses are derived from
the seed and are never real. No real key, no real protocol. See [SECURITY.md](SECURITY.md).

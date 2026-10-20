# crash-test

What does an AI agent that holds a wallet do under hostile input? How much money leaves beyond its policy,
and how often do its guardrails block honest payments?

Six attacks copied from 2026 incidents ([docs/attacks.md](docs/attacks.md)), each with an innocent twin,
run against three wallets (a raw key, a policy wallet, Brake) on a private local chain. The chain decides
what leaked; a blind judge reads what the agent noticed and said.

Status: Phase 1 in progress: chain, wallets and the agent loop work; the first scenario (`grok`) runs with a
free scripted agent. How it fits together: [docs/architecture.md](docs/architecture.md). The plan
lives outside this folder, in `../ideas/crash-test-memory.md`.

```sh
pnpm sim --scenario grok --role attack --wallet raw --player dry-run          # free, scripted agent
pnpm sim --scenario grok --role attack --wallet brake --watcher cancel-unknown --player haiku --seed 1
pnpm web                                                                       # viewer: http://127.0.0.1:5173
```

The viewer (`web/`, Vite, no framework, local only) explains the project, lists every run in `data/runs/`
with filters (attack type, attack or twin, how the line is hidden, wallet, agent, result) and 15 per page,
and replays a run turn by turn: what arrived, what the agent thought and did, what moved on the chain. A
run in progress shows up on its own and updates every 2 seconds. The logs never leave this machine.

```sh
pnpm sim --scenario grok-public --role attack --wallet raw --encoding plain --player haiku --seed 1
```
`--encoding plain|morse|base64|zero-width` rewrites how a scenario's hidden instruction is written.

## Setup

Node 22+, pnpm, Foundry.

```sh
pnpm install
cp .env.example .env          # add ANTHROPIC_API_KEY
pnpm typecheck
pnpm models                   # one tiny call per model + one tool turn; prints tokens and USD
pnpm test:brake               # Brake's own 90 tests
```

First-time Brake libraries (not committed):

```sh
cd contracts/lib/brake/contracts/brake
forge install foundry-rs/forge-std@v1.17.0 OpenZeppelin/openzeppelin-contracts@v5.7.0 \
  OpenZeppelin/openzeppelin-community-contracts@2add94e5b7ce9d040ae5f6c80b6082e8159002da --no-git
```

## Where the code comes from

The harness, chain helpers, log, prompt hashing and stats are copied from
[Vault Village](https://github.com/zayn-kahn/ai-safety-experiment) (each file says so in its first line).
The guarded wallet is [Brake](https://github.com/zayn-kahn/usebrake), pinned at `88f256f`.

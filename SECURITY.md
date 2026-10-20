# Security and disclosure

## What this repo does

It attacks **our own** AI agents holding **our own** test wallets on a **private local chain** (Anvil,
chain id 31337; the code refuses any other chain). Every attack copies a publicly reported incident.

It never:
- attacks a third party's live agent, wallet or service;
- sends a transaction to mainnet or to a testnet holding anyone else's funds;
- uses real attacker addresses (they are derived from a fixed string and the seed).

## Disclosure

If a run shows a new weakness in a named vendor's product (beyond the public incidents the scenarios copy),
we tell the vendor privately first and wait **14 days** before publishing anything that names it. Results
about our models of policy engines name the policy type, not a vendor, unless the vendor's own engine ran.

## Reporting a problem with this repo

Open a private security advisory on the repository, or email the maintainer. Please don't open a public
issue for a security problem.

## Secrets

API keys live only in the git-ignored `.env`. Never put a key in a URL, a commit, a run log or an issue.

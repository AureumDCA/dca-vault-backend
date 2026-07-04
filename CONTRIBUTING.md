# Contributing to dca-vault-backend

Welcome! This repo is the off-chain backbone of AureumDCA: a schedule executor, a Soroban event indexer, and a REST portfolio API — all written in Node.js/TypeScript. It's part of the **Stellar Drips Wave contributor program**, which rewards merged contributions with on-chain Drips payments. Maintainers assign complexity/points labels after review.

## Prerequisites

| Tool | Version / notes |
| --- | --- |
| Node.js | 20+ |
| npm | bundled with Node 20 |
| Stellar testnet account | Fund via [friendbot](https://friendbot.stellar.org) — needed for `EXECUTOR_SECRET` |

## Getting started

```sh
git clone https://github.com/AureumDCA/dca-vault-backend.git
cd dca-vault-backend
npm ci
cp .env.example .env
# fill in .env values (see Environment variables below)
npm run dev
```

The server starts on the port set in `.env` (`PORT`, default 3001). You should see log output from the poller and executor startup.

## Environment variables

| Variable | Description | Example |
| --- | --- | --- |
| `CONTRACT_ID` | Deployed dca-vault-contract address on Stellar testnet | `CDJF7V5NLGKAV7RHTBCR3LMHC7MUS7IWL6KYSLO6ZWEEJYJGWUVGEDEO` |
| `NETWORK_PASSPHRASE` | Stellar network identifier | `Test SDF Network ; September 2015` |
| `RPC_URL` | Soroban RPC endpoint | `https://soroban-testnet.stellar.org` |
| `EXECUTOR_SECRET` | Secret key of the account that submits `execute_swap` transactions | `S...` (fund with friendbot) |
| `POLL_INTERVAL_MS` | How often the executor and poller check for due schedules / new events | `30000` |
| `PORT` | Express server port | `3001` |
| `DB_PATH` | Path to the SQLite database file | `./data/dca.db` |

## Running typechecks

Typecheck must be clean before opening a PR:

```sh
npm run typecheck
```

Zero errors required. The CI gate enforces this.

## Building

```sh
npm run build
# compiled output: dist/
```

## Running in production mode

```sh
npm run build
npm start
```

## Branch naming

| Prefix | Use for |
| --- | --- |
| `feat/` | New features |
| `fix/` | Bug fixes |
| `docs/` | Documentation only |
| `test/` | New or updated tests |
| `chore/` | Tooling, CI, dependency bumps |

## Commit style

This repo uses [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add vault creation event indexing to executor
fix: handle getTransaction FAILED status in executor poll loop
docs: document executor known-owners limitation
chore: bump @stellar/stellar-sdk to 15.2.0
ci: add Node 20 matrix step
```

One logical change per commit. Keep subjects under 72 characters.

## PR checklist

Before requesting review, confirm:

- [ ] `npm run typecheck` passes — zero TypeScript errors
- [ ] `npm run build` succeeds
- [ ] No `console.error` calls that silently swallow real errors (log and rethrow or surface them)
- [ ] If you changed env var requirements, `.env.example` is updated
- [ ] Branch name follows the naming conventions above
- [ ] Commit messages follow Conventional Commits

## Issue labels

| Label | Meaning |
| --- | --- |
| `bug` | Something isn't working |
| `documentation` | Improvements or additions to documentation |
| `duplicate` | This issue or pull request already exists |
| `enhancement` | New feature or request |
| `good first issue` | Good for newcomers |
| `help wanted` | Extra attention is needed |
| `invalid` | This doesn't seem right |
| `question` | Further information is requested |
| `wontfix` | This will not be worked on |

**Do not add complexity or points labels yourself.** Maintainers assign these after review. Self-tagging inflates estimates and may disqualify your PR from Drips rewards.

## Stellar Drips Wave rules

- **Do not resolve issues you did not open.** Work on your own issue only. Closing someone else's issue without coordination will get your PR marked `invalid`.
- **Do not inflate complexity labels.** Requesting a higher complexity than the work warrants is against program rules.
- If you have scope or complexity questions, ask in the issue thread before writing code.

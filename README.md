# DCA Vault Backend

[![CI](https://github.com/AureumDCA/dca-vault-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/AureumDCA/dca-vault-backend/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The off-chain backend for [AureumDCA](https://github.com/AureumDCA): a **schedule executor**, a **Soroban event indexer**, and a **REST portfolio API** — all written in Node.js/TypeScript. It watches the deployed `dca-vault-contract` on Stellar testnet, triggers due swaps permissionlessly, indexes swap history into SQLite, and exposes that history via HTTP.

## Live Deployment

The backend is deployed and running at:
**[https://dca-vault-backend.onrender.com](https://dca-vault-backend.onrender.com)**

> **Note:** This runs on Render's free tier, which spins down after
> periods of inactivity. The first request after idle time may take
> up to 50 seconds to respond while the service wakes up. Subsequent
> requests will be fast.

Example: `GET https://dca-vault-backend.onrender.com/health` should
return `{ "status": "ok" }`.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    dca-vault-backend                    │
│                                                         │
│   ┌──────────┐   ┌──────────┐   ┌────────────────────┐ │
│   │  Poller  │   │ Executor │   │     REST API       │ │
│   │          │   │          │   │                    │ │
│   │ polls    │   │ polls    │   │ GET /health        │ │
│   │ Soroban  │   │ vault    │   │ GET /vaults/:owner │ │
│   │ events   │   │ state,   │   │ GET /vaults/:owner │ │
│   │ → SQLite │   │ submits  │   │       /history     │ │
│   │          │   │ execute_ │   │ GET /vaults/:owner │ │
│   │          │   │ swap txs │   │       /performance │ │
│   └────┬─────┘   └────┬─────┘   └────────┬───────────┘ │
│        │              │                   │             │
└────────┼──────────────┼───────────────────┼─────────────┘
         │              │                   │
         ▼              ▼                   ▼
    Soroban RPC    Soroban RPC         SQLite DB
    (read events)  (simulate +        (swap_events,
                   submit txs)        indexer_state)
```

- **Poller** (`src/indexer/poller.ts`): subscribes to `swap` contract events via `getEvents`, decodes them with `scValToNative`, stores them in `swap_events` with deduplication. Resumes from the last indexed ledger on restart.
- **Executor** (`src/executor/executor.ts`): polls known vault owners, simulates `execute_swap`, and submits the transaction when a schedule is due and unpaused.
- **REST API** (`src/api/`): Express server exposing vault state, swap history, and performance calculations backed by the SQLite database.

## API endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Returns `{ status: "ok" }` |
| `GET` | `/vaults/:owner` | Simulates `get_vault` on the contract and returns the vault state for `owner` |
| `GET` | `/vaults/:owner/history` | Returns all indexed swap events for `owner` from SQLite |
| `GET` | `/vaults/:owner/performance` | Returns `{ total_invested, total_received, avg_price, swap_count }` computed from swap history |

## Environment variables

| Variable | Description | Example |
| --- | --- | --- |
| `CONTRACT_ID` | Deployed dca-vault-contract address | `CDJF7V5NLGKAV7RHTBCR3LMHC7MUS7IWL6KYSLO6ZWEEJYJGWUVGEDEO` |
| `NETWORK_PASSPHRASE` | Stellar network identifier | `Test SDF Network ; September 2015` |
| `RPC_URL` | Soroban RPC endpoint | `https://soroban-testnet.stellar.org` |
| `EXECUTOR_SECRET` | Secret key of the executor account (must be funded) | `S...` |
| `POLL_INTERVAL_MS` | Polling interval in milliseconds | `30000` |
| `PORT` | Express server port | `3001` |
| `DB_PATH` | SQLite database file path | `./data/dca.db` |

## Setup

```sh
git clone https://github.com/AureumDCA/dca-vault-backend.git
cd dca-vault-backend
npm ci
cp .env.example .env
# edit .env with your values
mkdir -p data
npm run dev
```

The server and both background services (poller + executor) start together. Logs appear on stdout.

## Typechecks and build

```sh
npm run typecheck   # must be zero errors
npm run build       # compiles TypeScript to dist/
npm start           # runs the compiled output
```

## Known limitation

The executor discovers vault owners by reading the `swap_events` table — it only knows about owners who have had at least one swap executed. A brand-new vault with no swap history will not be picked up by the executor until after its first swap completes. The fix is to also index `create_schedule` events and seed the known-owners list from there. This is tracked as a contributor issue.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for prerequisites, setup, branch naming, commit style, the PR checklist, and Drips Wave rules.

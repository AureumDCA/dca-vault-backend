# DCA Vault Backend — Context Log

This file tracks every edit, decision, and development session for the `dca-vault-backend` repo. Update it at the end of every working session — newest entry on top.

## Session log

### Session 1 — 2026-07-01

**Initial scaffold: config, SQLite indexer, event poller, executor, REST API.**

**What was built:**

- `src/config.ts` — loads all env vars, throws on missing required ones, exports typed `Config` interface (`contractId`, `networkPassphrase`, `rpcUrl`, `executorSecret`, `pollIntervalMs`, `port`, `dbPath`).

- `src/indexer/db.ts` — better-sqlite3 (synchronous, WAL mode). Two tables:
  - `swap_events (id, tx_hash, owner, ledger, amount_in, amount_out, pool_address)` with `UNIQUE(tx_hash, owner)` — deduplication via `INSERT OR IGNORE`.
  - `indexer_state (key TEXT PRIMARY KEY, value TEXT)` — stores `last_ledger` cursor so restarts resume from where they left off.
  - Exported `Db` interface: `insertSwapEvent`, `getSwapEvents(owner)`, `getAllOwners()` (SELECT DISTINCT), `getLastLedger`, `setLastLedger`, `close`.

- `src/indexer/poller.ts` — polls Soroban RPC for `SwapExecuted` events emitted by the vault contract. Key details:
  - Topic filter: `xdr.ScVal.scvSymbol("swap").toXDR("base64")` = `AAAADwAAAARzd2Fw` (static first topic of the `#[contractevent(topics=["swap"])]` macro).
  - On first run (lastLedger=0), starts from `latestLedger - 100` to avoid scanning the full history.
  - Event data is a Map with keys `amount_in`, `amount_out`, `pool_address` (alphabetically sorted — the `#[contractevent]` macro sorts Map keys before `map_new_from_slices`).
  - Parsed with `scValToNative` (top-level export in stellar-sdk v15).

- `src/executor/executor.ts` — permissionless executor loop:
  - `getVaultState(owner)`: simulates `get_vault` via `rpc.Server.simulateTransaction`, parses result with `scValToNative`.
  - `executeSwap(owner)`: simulate → `rpc.assembleTransaction` → sign with executor keypair → `sendTransaction` → polls `getTransaction` up to 20× with 3s delay. Uses `rpc.Api.GetTransactionStatus.SUCCESS` / `.FAILED` enum for status checks.
  - Runs on `POLL_INTERVAL_MS` interval via `node-cron`-style `setInterval`.

- `src/api/routes.ts` + `src/api/handlers.ts` — Express v5 router:
  - `GET /health` → `{ status: "ok" }`.
  - `GET /vaults/:owner` → simulates `get_vault`, returns `scValToNative(retval)`.
  - `GET /vaults/:owner/history` → SQLite `swap_events` for owner.
  - `GET /vaults/:owner/performance` → `{ total_invested, total_received, avg_price: total_invested/total_received, swap_count }` from history.
  - Express v5 types `req.params` values as `string | string[]`; all handlers extract owner with `Array.isArray(req.params["owner"]) ? req.params["owner"][0] : req.params["owner"]`.

- `src/index.ts` — entry point: `loadConfig()` → `initDb()` → Express + `buildRouter()` → `startPoller()` → `startExecutor()`.

**Key technical decisions:**

- **stellar-sdk v15.1.0 API shape**: RPC client is `rpc.Server` (not `SorobanRpc` which was the old namespace). `scValToNative` is a top-level export. `rpc.assembleTransaction` (not `SorobanRpc.assembleTransaction`). `rpc.Api.isSimulationSuccess()` type guard. `rpc.Api.GetTransactionStatus` enum for polling.

- **`getEvents` ledger-range mode**: Soroban RPC's `getEvents` requires a ledger range (`startLedger`/`endLedger`). On first run, `startLedger = latestLedger - 100` avoids a full history scan.

- **Simulation before submission**: `executeSwap` simulates first to detect will-fail conditions (paused, not-due, insufficient balance) without spending network fees. `rpc.assembleTransaction` rebuilds the transaction with the footprint from simulation before signing.

- **Deduplication**: `UNIQUE(tx_hash, owner)` on `swap_events` with `INSERT OR IGNORE` means the poller is safe to re-index overlapping ledger ranges on restart without creating duplicate rows.

- **better-sqlite3**: synchronous API (no async/await), WAL mode for concurrent reads while the poller is writing.

**Known gaps at end of session:**

- `EXECUTOR_SECRET` not filled in `.env` — user must provide a funded testnet account secret key.
- Executor discovers vault owners only from `swap_events` (owners with at least one prior swap). Brand-new vaults are invisible to the executor until their first swap. Fix: index `create_schedule` events and seed owner list from there. TODO comment exists in `executor.ts`.
- No integration tests — correctness relies on typecheck + manual testnet verification.

**CI**: `.github/workflows/ci.yml` — `npm ci` → `npm run typecheck` → `npm run build`. Node 20, `actions/setup-node@v4` with `cache: 'npm'`. CI green on first push.

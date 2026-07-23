# DCA Vault Backend — Context Log

This file tracks every edit, decision, and development session for the `dca-vault-backend` repo. Update it at the end of every working session — newest entry on top.

## Session log

### Session 7 — 2026-07-23

**Fix: poller's event topic filters silently matched zero events, ever.**

Diagnosed in a prior session, after the real `execute_swap` from Session 13
of `dca-vault-contract` didn't show up in `GET /vaults/:owner/history`.
Root cause, confirmed empirically against the real deployed contract and
the real transaction: Soroban's `getEvents` topic filter matches by *exact
segment count* — a filter must supply one entry per topic segment the event
actually carries, using `"*"` as an explicit wildcard for segments you don't
want to constrain. It does not loosely prefix-match a shorter filter against
a longer topic list.

Both of this contract's indexed events carry **two** topics — a static
symbol (`"swap"` or `"schedule_created"`) plus the owner `Address` (a
`#[topic]` field) — but `poller.ts`'s filters specified only the first
segment (`topics: [[SWAP_TOPIC_XDR]]`, `topics: [[SCHEDULE_CREATED_TOPIC_XDR]]`).
Since the segment count didn't match, `getEvents` returned zero results for
every poll, silently — no exception, no log line, nothing to indicate a
problem. This is a **different bug** from the `XdrReaderError: unknown
SorobanCredentialsType member for value 2` flagged in Session 5 (that error
never reoccurred in this session's runs and remains a separate, unconfirmed
issue). This one is deterministic: it has prevented **every** `swap` event
and **every** `schedule_created` event from being indexed since the poller
was first written, not just today's swap.

Fix: added a wildcard second segment to both filters:
```ts
topics: [[SWAP_TOPIC_XDR, "*"]]
topics: [[SCHEDULE_CREATED_TOPIC_XDR, "*"]]
```

**Verified against the real on-chain swap** from earlier today
(`execute_swap` tx `b4b43afd24e080b2cba7e5492ac4d096f9787a8aab4ea01b62849b0451b7c556`,
ledger `3757613`): reset the local `indexer_state.last_ledger_sequence` to
`3757600` to force a re-scan back through that ledger, rebuilt, and ran the
backend locally. First poll tick logged:
```
[poller] ledgers 3757601–3758437: inserted 1 swap event(s), 0 new vault owner(s)
```
`GET /vaults/GD6KZDL3Q.../history` then correctly returned the real event —
matching tx hash, `ledger_sequence: 3757613`, `amount_in`/`amount_out`:
`500000000` each, `pool_address` matching the demo pool — instead of `[]`.

`npx tsc --noEmit` and `npm run build` both pass with zero errors.

### Session 6 — 2026-07-23

**Fix: CORS blocked all cross-origin requests from the deployed frontend.**
Discovered via browser DevTools: `https://dca-vault-frontend.vercel.app`'s
JS calls to `https://dca-vault-backend.onrender.com` were rejected by the
browser's CORS check — the backend had no CORS middleware at all, so it
never sent an `Access-Control-Allow-Origin` header. Requests worked fine
when hit directly (curl, browser address bar), which is what made this a
pure CORS issue rather than a routing/logic bug — the endpoints themselves
were already fine.

Fix: added the `cors` package, applied as `app.use(cors({ origin:
config.allowedOrigin }))` in `src/index.ts`, before the router mount.
`config.allowedOrigin` is a new `Config` field (`src/config.ts`), read via
`optional_env("ALLOWED_ORIGIN", "http://localhost:3000")` — same pattern as
the other optional env vars. Chose an explicit configured origin over `*`:
this API's callers are known in advance (one deployed frontend, plus local
dev), and a wildcard would let *any* site's JS read vault data for *any*
address by simply asking a visitor's browser to fetch it — an explicit
allowlist costs nothing here and closes that off. Documented the new var in
`.env.example` and set it locally in `.env` to
`https://dca-vault-frontend.vercel.app`.

Verified locally with curl (simulating browser `Origin` headers):
- `Origin: https://dca-vault-frontend.vercel.app` → `200` with
  `Access-Control-Allow-Origin: https://dca-vault-frontend.vercel.app` present.
- `Origin: https://evil-example.com` → same hardcoded
  `Access-Control-Allow-Origin: https://dca-vault-frontend.vercel.app` header
  (the `cors` middleware doesn't reflect arbitrary request origins back for a
  static string config) — it does not match `evil-example.com`, which is
  exactly what makes a real browser reject the response for that origin's JS
  (curl itself doesn't enforce CORS, so the body still comes through either
  way; the protection is browser-side, keyed off this mismatch).

`npx tsc --noEmit` and `npm run build` both pass with zero errors.

**Still needed: `ALLOWED_ORIGIN` must be added to Render's dashboard env vars
for this service, then redeployed** — this repo has no Render config file,
so that variable only exists in this machine's local `.env` right now; the
deployed instance won't have it until it's added manually there.

### Session 5 — 2026-07-22

**Fix: `GET /vaults/:owner` crashed with 500 for any account that has a real
vault.** Diagnosed in a prior session: `scValToNative()` converts the
contract's `i128` fields (`balance`, `amount_per_execution`) into native JS
`BigInt`, and `res.json()` (i.e. `JSON.stringify`) cannot serialize `BigInt`,
throwing `TypeError: Do not know how to serialize a BigInt` — caught by the
handler's outer `catch` and surfaced as a generic `500 {"error":"internal
server error"}`. This meant the endpoint only ever worked for accounts with
*no* vault (which correctly return 404 before reaching `scValToNative`);
every account with a real vault got a 500 instead of vault data.

Fix: added a `serializeBigInts()` helper in `src/api/handlers.ts` that
recursively converts `BigInt` values to strings, and wrapped `vaultHandler`'s
`res.json(vault)` call with it. Checked the other handlers in the same file
(`historyHandler`, `performanceHandler`) — both read `SwapEvent` rows from
SQLite where `amount_in`/`amount_out` are already stored/typed as `number`,
not `BigInt`, so they were unaffected and left untouched.

Verified locally against both addresses from the diagnosis session:
- `GD6KZDL3Q7DO...` (real vault) → now `200` with `balance`/
  `amount_per_execution` serialized as strings, e.g.
  `{"balance":"2000000000",...,"schedule":{"amount_per_execution":"500000000",...}}`.
- `GA2BQ4XURK...` (no vault) → unchanged, still `404 {"error":"vault not
  found or simulation failed"}`.

`npx tsc --noEmit` and `npm run build` both pass with zero errors.

Unrelated, out of scope: the background poller logged `[poller] poll error:
XdrReaderError ... unknown SorobanCredentialsType member for value 2` during
local verification — a separate, pre-existing issue in the indexer's XDR
parsing, not touched here.

### Session 4 — 2026-07-12

**CI: bump GitHub Actions to latest stable.** Verified via `gh api
repos/<owner>/<repo>/releases` before changing anything (no guessing):

- **`actions/checkout`**: `v4` → `v7` (v7.0.0, published 2026-06-18, genuine
  stable release, not a prerelease).
- **`actions/setup-node`**: `v4` → `v6` (v6.4.0, published 2026-04-20;
  floating major tags v4/v5/v6 all exist, v6 is current).

Left `node-version: 20` untouched — that's the Node.js runtime pinned inside
`setup-node`'s `with:` block, not a GitHub Action version, so out of scope
for this bump.

`npx tsc --noEmit` and `npm run build` both pass with zero errors (confirms
the repo itself is healthy; doesn't exercise the workflow YAML — that's
verified by the actual CI run after push).

### Session 3 — 2026-07-10

**README: CI/License badges + Live Deployment section.** Added `CI` and
`License: MIT` shields.io badges directly under the H1 title. Added a new
"Live Deployment" section (after the intro paragraph, before Architecture)
pointing at the Render deployment: `https://dca-vault-backend.onrender.com`,
with a note about free-tier cold-start latency. Verified the URL is real
before writing the claim — `curl .../health` returned `200` with
`{"status":"ok",...}` (took ~26s, consistent with a cold start). Additive
only, no rewording of existing sections. `npx tsc --noEmit` and `npm run
build` both still pass clean after the README-only change.

### Session 2 — 2026-07-03

**Fix the vault-discovery gap: index `ScheduleCreated` events.**

Problem: the executor discovered vault owners only via `getAllOwners()`, which
read `SELECT DISTINCT owner FROM swap_events`. That means a vault was invisible
to the executor until *after* its first swap landed — a brand-new, funded vault
would never get its first scheduled swap triggered. Chicken-and-egg.

Fix (indexer + db side, ready to consume the contract event once it ships):

- **`src/indexer/db.ts`**: added a `vault_owners` table (`owner` PRIMARY KEY,
  `created_at`). New `insertVaultOwner(owner)` on the `Db` interface uses
  `INSERT OR IGNORE`, so re-indexing the same event is a no-op. `getAllOwners()`
  now returns the `UNION` of `vault_owners` and `SELECT DISTINCT owner FROM
  swap_events`, so owners from either source (a created-but-never-swapped vault,
  or a vault known only from historical swaps) are all returned.
- **`src/indexer/poller.ts`**: added `SCHEDULE_CREATED_TOPIC_XDR`
  (`Symbol("schedule_created")`, computed the same way as `SWAP_TOPIC_XDR`) and
  a second `getEvents` filter for it alongside the existing swap filter. In the
  event loop, each event is tried as a swap first; if it isn't one, it's tried
  as a `ScheduleCreated` event via `parseScheduleCreatedOwner` (owner from
  `topic[1]`), and on match we `db.insertVaultOwner(owner)` and log the
  discovery. Poll summary line now reports both counts.

Depends on the contract emitting `ScheduleCreated` — tracked as
dca-vault-contract issue #3. Until that ships, this filter simply matches
nothing; no behavior change to the swap path. `npx tsc --noEmit` and
`npm run build` both pass with zero errors.

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

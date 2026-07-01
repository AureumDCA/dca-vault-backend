import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export interface SwapEvent {
  id?: number;
  owner: string;
  amount_in: number;
  amount_out: number;
  pool_address: string;
  ledger_sequence: number;
  tx_hash: string;
  created_at?: string;
}

export interface Db {
  insertSwapEvent(event: SwapEvent): void;
  getSwapEvents(owner: string): SwapEvent[];
  getAllOwners(): string[];
  getLastLedger(): number;
  setLastLedger(ledger: number): void;
  close(): void;
}

export function initDb(dbPath: string): Db {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS swap_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      amount_in INTEGER NOT NULL,
      amount_out INTEGER NOT NULL,
      pool_address TEXT NOT NULL,
      ledger_sequence INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tx_hash, owner)
    );

    CREATE TABLE IF NOT EXISTS indexer_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const insert = db.prepare<SwapEvent>(`
    INSERT OR IGNORE INTO swap_events
      (owner, amount_in, amount_out, pool_address, ledger_sequence, tx_hash)
    VALUES
      (@owner, @amount_in, @amount_out, @pool_address, @ledger_sequence, @tx_hash)
  `);

  const selectByOwner = db.prepare<[string]>(`
    SELECT * FROM swap_events WHERE owner = ? ORDER BY ledger_sequence ASC
  `);

  const selectAllOwners = db.prepare(
    `SELECT DISTINCT owner FROM swap_events`
  );

  const getState = db.prepare<[string]>(
    `SELECT value FROM indexer_state WHERE key = ?`
  );
  const setState = db.prepare<[string, string]>(
    `INSERT OR REPLACE INTO indexer_state (key, value) VALUES (?, ?)`
  );

  return {
    insertSwapEvent(event: SwapEvent): void {
      insert.run(event);
    },

    getSwapEvents(owner: string): SwapEvent[] {
      return selectByOwner.all(owner) as SwapEvent[];
    },

    getAllOwners(): string[] {
      return (selectAllOwners.all() as Array<{ owner: string }>).map(
        (r) => r.owner
      );
    },

    getLastLedger(): number {
      const row = getState.get("last_ledger_sequence") as
        | { value: string }
        | undefined;
      return row ? parseInt(row.value, 10) : 0;
    },

    setLastLedger(ledger: number): void {
      setState.run("last_ledger_sequence", String(ledger));
    },

    close(): void {
      db.close();
    },
  };
}

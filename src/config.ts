import dotenv from "dotenv";
dotenv.config();

function require_env(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return val;
}

function optional_env(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export interface Config {
  contractId: string;
  networkPassphrase: string;
  rpcUrl: string;
  executorSecret: string;
  pollIntervalMs: number;
  port: number;
  dbPath: string;
  allowedOrigin: string;
}

export function loadConfig(): Config {
  return {
    contractId: require_env("CONTRACT_ID"),
    networkPassphrase: require_env("NETWORK_PASSPHRASE"),
    rpcUrl: require_env("RPC_URL"),
    executorSecret: require_env("EXECUTOR_SECRET"),
    pollIntervalMs: parseInt(optional_env("POLL_INTERVAL_MS", "30000"), 10),
    port: parseInt(optional_env("PORT", "3001"), 10),
    dbPath: optional_env("DB_PATH", "./data/dca.db"),
    allowedOrigin: optional_env("ALLOWED_ORIGIN", "http://localhost:3000"),
  };
}

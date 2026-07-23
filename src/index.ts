import express from "express";
import cors from "cors";
import { loadConfig } from "./config";
import { initDb } from "./indexer/db";
import { startPoller } from "./indexer/poller";
import { startExecutor } from "./executor/executor";
import { buildRouter } from "./api/routes";

const config = loadConfig();
const db = initDb(config.dbPath);

const app = express();
app.use(cors({ origin: config.allowedOrigin }));
app.use(express.json());
app.use("/", buildRouter(config, db));

app.listen(config.port, () => {
  console.log(`[server] listening on port ${config.port}`);
  console.log(`[server] contract: ${config.contractId}`);
  console.log(`[server] network:  ${config.networkPassphrase}`);
  console.log(`[server] rpc:      ${config.rpcUrl}`);
});

startPoller(config, db).catch((err) => {
  console.error("[server] poller failed to start:", err);
  process.exit(1);
});

startExecutor(config, db);

import { Router } from "express";
import { Config } from "../config";
import { Db } from "../indexer/db";
import {
  healthHandler,
  makeVaultHandler,
  makeHistoryHandler,
  makePerformanceHandler,
} from "./handlers";

export function buildRouter(config: Config, db: Db): Router {
  const router = Router();

  router.get("/health", healthHandler);
  router.get("/vaults/:owner", makeVaultHandler(config));
  router.get("/vaults/:owner/history", makeHistoryHandler(db));
  router.get("/vaults/:owner/performance", makePerformanceHandler(db));

  return router;
}

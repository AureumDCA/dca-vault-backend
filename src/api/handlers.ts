import { Request, Response } from "express";
import {
  rpc,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  Keypair,
  Address,
  scValToNative,
} from "@stellar/stellar-sdk";
import { Config } from "../config";
import { Db, SwapEvent } from "../indexer/db";

function makeServer(config: Config): rpc.Server {
  return new rpc.Server(config.rpcUrl, { allowHttp: false });
}

export function healthHandler(_req: Request, res: Response): void {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
}

export function makeVaultHandler(config: Config) {
  return async function vaultHandler(
    req: Request,
    res: Response
  ): Promise<void> {
    const owner = Array.isArray(req.params["owner"])
      ? req.params["owner"][0]
      : req.params["owner"];
    try {
      const server = makeServer(config);
      const contract = new Contract(config.contractId);

      // Use a throw-away keypair for simulation — no signing needed for a read call.
      const dummyKeypair = Keypair.random();
      const account = await server.getAccount(dummyKeypair.publicKey()).catch(
        () => {
          // If dummy account doesn't exist on-chain, fall back to executor's account.
          return server.getAccount(
            Keypair.fromSecret(config.executorSecret).publicKey()
          );
        }
      );

      const ownerScVal = new Address(owner).toScVal();
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: config.networkPassphrase,
      })
        .addOperation(contract.call("get_vault", ownerScVal))
        .setTimeout(30)
        .build();

      const simResult = await server.simulateTransaction(tx);
      if (!rpc.Api.isSimulationSuccess(simResult)) {
        res.status(404).json({ error: "vault not found or simulation failed" });
        return;
      }

      const retval = simResult.result?.retval;
      if (!retval) {
        res.status(404).json({ error: "no return value" });
        return;
      }

      const vault = scValToNative(retval);
      res.json(vault);
    } catch (err) {
      console.error("[api] GET /vaults/:owner error:", err);
      res.status(500).json({ error: "internal server error" });
    }
  };
}

export function makeHistoryHandler(db: Db) {
  return function historyHandler(req: Request, res: Response): void {
    const owner = Array.isArray(req.params["owner"])
      ? req.params["owner"][0]
      : req.params["owner"];
    const events = db.getSwapEvents(owner);
    res.json(events);
  };
}

export function makePerformanceHandler(db: Db) {
  return function performanceHandler(req: Request, res: Response): void {
    const owner = Array.isArray(req.params["owner"])
      ? req.params["owner"][0]
      : req.params["owner"];
    const events: SwapEvent[] = db.getSwapEvents(owner);

    if (events.length === 0) {
      res.json({
        owner,
        total_swaps: 0,
        total_invested: 0,
        total_received: 0,
        avg_price: null,
      });
      return;
    }

    const total_invested = events.reduce((sum, e) => sum + e.amount_in, 0);
    const total_received = events.reduce((sum, e) => sum + e.amount_out, 0);
    const avg_price =
      total_received > 0 ? total_invested / total_received : null;

    res.json({
      owner,
      total_swaps: events.length,
      total_invested,
      total_received,
      avg_price,
    });
  };
}

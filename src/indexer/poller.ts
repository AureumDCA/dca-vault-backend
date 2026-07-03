import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { Config } from "../config";
import { Db } from "./db";

// XDR base64 for Symbol("swap") — the first static topic emitted by #[contractevent(topics = ["swap"])]
const SWAP_TOPIC_XDR = xdr.ScVal.scvSymbol("swap").toXDR("base64");

// XDR base64 for Symbol("schedule_created") — the first static topic emitted by
// the contract's ScheduleCreated event (tracked in dca-vault-contract issue #3).
const SCHEDULE_CREATED_TOPIC_XDR = xdr.ScVal
  .scvSymbol("schedule_created")
  .toXDR("base64");

interface ParsedSwapEvent {
  owner: string;
  amount_in: number;
  amount_out: number;
  pool_address: string;
  ledger_sequence: number;
  tx_hash: string;
}

function parseSwapEvent(
  event: rpc.Api.EventResponse
): ParsedSwapEvent | null {
  try {
    // topic[0] = static "swap" symbol, topic[1] = owner address (#[topic] field)
    if (event.topic.length < 2) return null;

    const topic0 = event.topic[0].toXDR("base64");
    if (topic0 !== SWAP_TOPIC_XDR) return null;

    const owner = scValToNative(event.topic[1]) as string;

    // data is a Map<Symbol, Val> with keys sorted alphabetically:
    // amount_in (i128), amount_out (i128), pool_address (Address)
    const data = scValToNative(event.value) as Record<string, unknown>;
    const amount_in = Number(data["amount_in"] as bigint);
    const amount_out = Number(data["amount_out"] as bigint);
    const pool_address = data["pool_address"] as string;

    return {
      owner,
      amount_in,
      amount_out,
      pool_address,
      ledger_sequence: event.ledger,
      tx_hash: event.txHash,
    };
  } catch (err) {
    console.error("[poller] failed to parse event:", err);
    return null;
  }
}

// Extracts the vault owner from a ScheduleCreated event. topic[0] is the static
// "schedule_created" symbol; topic[1] is the owner Address (#[topic] field).
// Returns null for any event that is not a ScheduleCreated event.
function parseScheduleCreatedOwner(
  event: rpc.Api.EventResponse
): string | null {
  try {
    if (event.topic.length < 2) return null;

    const topic0 = event.topic[0].toXDR("base64");
    if (topic0 !== SCHEDULE_CREATED_TOPIC_XDR) return null;

    return scValToNative(event.topic[1]) as string;
  } catch (err) {
    console.error("[poller] failed to parse ScheduleCreated event:", err);
    return null;
  }
}

export async function startPoller(config: Config, db: Db): Promise<void> {
  const server = new rpc.Server(config.rpcUrl, { allowHttp: false });

  console.log(`[poller] starting — contract: ${config.contractId}`);

  async function poll(): Promise<void> {
    try {
      const fromLedger = db.getLastLedger();
      const latestInfo = await server.getLatestLedger();
      const latestLedger = latestInfo.sequence;

      if (fromLedger >= latestLedger) return;

      const startLedger = fromLedger === 0 ? latestLedger - 100 : fromLedger + 1;
      if (startLedger > latestLedger) return;

      const response = await server.getEvents({
        startLedger,
        filters: [
          {
            type: "contract",
            contractIds: [config.contractId],
            // topic[0] must be Symbol("swap")
            topics: [[SWAP_TOPIC_XDR]],
          },
          {
            type: "contract",
            contractIds: [config.contractId],
            // topic[0] must be Symbol("schedule_created")
            topics: [[SCHEDULE_CREATED_TOPIC_XDR]],
          },
        ],
        limit: 200,
      });

      let inserted = 0;
      let ownersDiscovered = 0;
      for (const event of response.events) {
        const swap = parseSwapEvent(event);
        if (swap) {
          db.insertSwapEvent(swap);
          inserted++;
          continue;
        }

        const newOwner = parseScheduleCreatedOwner(event);
        if (newOwner) {
          db.insertVaultOwner(newOwner);
          ownersDiscovered++;
          console.log(`[poller] discovered new vault owner: ${newOwner}`);
        }
      }

      if (inserted > 0 || ownersDiscovered > 0) {
        console.log(
          `[poller] ledgers ${startLedger}–${latestLedger}: inserted ${inserted} swap event(s), ${ownersDiscovered} new vault owner(s)`
        );
      }

      db.setLastLedger(latestLedger);
    } catch (err) {
      console.error("[poller] poll error:", err);
    }
  }

  await poll();
  setInterval(() => void poll(), config.pollIntervalMs);
}

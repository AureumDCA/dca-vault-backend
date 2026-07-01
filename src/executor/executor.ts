import {
  rpc,
  Keypair,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  Address,
  scValToNative,
} from "@stellar/stellar-sdk";
import { Config } from "../config";
import { Db } from "../indexer/db";

// Parsed shape of what the vault contract's get_vault returns via scValToNative.
// schedule fields follow the Schedule #[contracttype] struct layout (ScvMap).
interface ScheduleState {
  amount_per_execution: bigint;
  next_execution_ledger: number;
}
interface VaultState {
  balance: bigint;
  paused: boolean;
  schedule: ScheduleState | null | undefined;
}

async function getVaultState(
  server: rpc.Server,
  contract: Contract,
  executorKeypair: Keypair,
  networkPassphrase: string,
  owner: string
): Promise<VaultState | null> {
  try {
    const account = await server.getAccount(executorKeypair.publicKey());
    const ownerScVal = new Address(owner).toScVal();
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(contract.call("get_vault", ownerScVal))
      .setTimeout(30)
      .build();

    const simResult = await server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(simResult)) {
      console.warn(`[executor] get_vault simulation failed for ${owner}`);
      return null;
    }

    const returnVal = simResult.result?.retval;
    if (!returnVal) return null;

    return scValToNative(returnVal) as unknown as VaultState;
  } catch {
    return null;
  }
}

async function executeSwap(
  server: rpc.Server,
  contract: Contract,
  executorKeypair: Keypair,
  networkPassphrase: string,
  owner: string
): Promise<boolean> {
  try {
    const account = await server.getAccount(executorKeypair.publicKey());
    const ownerScVal = new Address(owner).toScVal();
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(contract.call("execute_swap", ownerScVal))
      .setTimeout(30)
      .build();

    const simResult = await server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(simResult)) {
      console.warn(
        `[executor] execute_swap simulation failed for ${owner}:`,
        simResult
      );
      return false;
    }

    const assembled = rpc.assembleTransaction(tx, simResult).build();
    assembled.sign(executorKeypair);

    const sendResult = await server.sendTransaction(assembled);
    if (
      sendResult.status !== "PENDING" &&
      sendResult.status !== "DUPLICATE"
    ) {
      console.warn(
        `[executor] execute_swap send failed for ${owner}: status=${sendResult.status}`
      );
      return false;
    }

    // Poll for confirmation
    const hash = sendResult.hash;
    for (let i = 0; i < 20; i++) {
      await delay(3000);
      const getResult = await server.getTransaction(hash);
      if (getResult.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        console.log(`[executor] execute_swap confirmed for ${owner} (${hash})`);
        return true;
      }
      if (getResult.status === rpc.Api.GetTransactionStatus.FAILED) {
        console.warn(
          `[executor] execute_swap failed on-chain for ${owner} (${hash})`
        );
        return false;
      }
    }

    console.warn(`[executor] execute_swap timed out for ${owner} (${hash})`);
    return false;
  } catch (err) {
    console.error(`[executor] unexpected error for ${owner}:`, err);
    return false;
  }
}

async function getCurrentLedger(server: rpc.Server): Promise<number> {
  const info = await server.getLatestLedger();
  return info.sequence;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function startExecutor(config: Config, db: Db): void {
  const server = new rpc.Server(config.rpcUrl, { allowHttp: false });
  const executorKeypair = Keypair.fromSecret(config.executorSecret);
  const contract = new Contract(config.contractId);

  console.log(`[executor] starting — executor: ${executorKeypair.publicKey()}`);

  // TODO: seed known owners from a vault creation event index, not just swap_events.
  // Currently we only know about owners who have had at least one swap executed.
  // This means new vaults are not triggered until they've had their first manual swap.
  // Fix: index create_schedule events (or a dedicated VaultCreated event) to track
  // all active vault owners from the moment they first configure a schedule.
  function getKnownOwners(): string[] {
    return db.getAllOwners();
  }

  async function tick(): Promise<void> {
    const owners = getKnownOwners();
    if (owners.length === 0) return;

    let currentLedger: number;
    try {
      currentLedger = await getCurrentLedger(server);
    } catch (err) {
      console.error("[executor] failed to fetch latest ledger:", err);
      return;
    }

    for (const owner of owners) {
      const vault = await getVaultState(
        server,
        contract,
        executorKeypair,
        config.networkPassphrase,
        owner
      );

      if (!vault) continue;
      if (vault.paused) continue;
      if (!vault.schedule) continue;

      const { amount_per_execution, next_execution_ledger } = vault.schedule;

      const isDue = currentLedger >= next_execution_ledger;
      const hasFunds = vault.balance >= amount_per_execution;

      if (!isDue || !hasFunds) continue;

      console.log(
        `[executor] triggering execute_swap for ${owner} ` +
          `(due at ${next_execution_ledger}, current ${currentLedger})`
      );
      await executeSwap(
        server,
        contract,
        executorKeypair,
        config.networkPassphrase,
        owner
      );
    }
  }

  // Run an initial tick, then schedule recurring.
  void tick().catch((err) => console.error("[executor] initial tick error:", err));
  setInterval(() => void tick().catch((err) => console.error("[executor] tick error:", err)), config.pollIntervalMs);
}

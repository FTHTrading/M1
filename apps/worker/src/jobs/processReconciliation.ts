import type { Job } from "bullmq";
import { getPrismaClient } from "@treasury/database";
import { runReconciliation } from "@treasury/reconciliation";
import { CircleUsdcProvider, TetherUsdtProvider } from "@treasury/providers";

export interface ReconciliationJobData {
  entityId?: string;
  periodDate?: string;
  triggeredBy?: string;
  triggerTime?: string;
  runByUserId?: string;
}

export async function processReconciliationJob(
  job: Job<ReconciliationJobData>,
): Promise<{ entitiesProcessed: number; runsCreated: number }> {
  const db = getPrismaClient();
  const log = async (msg: string): Promise<void> => {
    await job.log(msg);
  };

  const periodDate = new Date(job.data.periodDate ?? job.data.triggerTime ?? Date.now());

  const entities = job.data.entityId
    ? [{ id: job.data.entityId }]
    : await db.entity.findMany({
        where: { status: "ACTIVE" },
        select: { id: true },
      });

  if (entities.length === 0) {
    await log("[recon] no active entities found");
    return { entitiesProcessed: 0, runsCreated: 0 };
  }

  const providerBalances = await fetchProviderBalances(log);

  let runsCreated = 0;
  for (const entity of entities) {
    const bankFiatBalanceCents = await computeEntityBankBalance(db, entity.id, periodDate);

    await runReconciliation({
      entityId: entity.id,
      periodDate,
      bankFiatBalanceCents,
      providerUsdcBalanceCents: providerBalances.usdc,
      providerUsdtBalanceCents: providerBalances.usdt,
      ...(job.data.runByUserId ? { runByUserId: job.data.runByUserId } : {}),
    });

    runsCreated += 1;
    await log(
      `[recon] entity ${entity.id} complete: bank=${bankFiatBalanceCents.toString()} usdc=${providerBalances.usdc.toString()} usdt=${providerBalances.usdt.toString()}`,
    );
  }

  return { entitiesProcessed: entities.length, runsCreated };
}

async function fetchProviderBalances(
  log: (msg: string) => Promise<void>,
): Promise<{ usdc: bigint; usdt: bigint }> {
  let usdc = 0n;
  let usdt = 0n;

  try {
    const circle = new CircleUsdcProvider({
      CIRCLE_API_KEY: process.env["CIRCLE_API_KEY"] ?? "",
      ...(process.env["CIRCLE_ENTITY_ID"] ? { CIRCLE_ENTITY_ID: process.env["CIRCLE_ENTITY_ID"] } : {}),
      ...(process.env["CIRCLE_WALLET_ID"] ? { CIRCLE_WALLET_ID: process.env["CIRCLE_WALLET_ID"] } : {}),
      CIRCLE_SANDBOX: process.env["CIRCLE_SANDBOX"] !== "false",
      CIRCLE_BASE_URL: process.env["CIRCLE_BASE_URL"] ?? "https://api-sandbox.circle.com",
      FEATURE_SANDBOX_ONLY: process.env["FEATURE_SANDBOX_ONLY"] !== "false",
    });
    const balances = await circle.getBalances();
    usdc = balances
      .filter((b) => b.asset === "USDC")
      .reduce((acc, b) => acc + b.balance, 0n);
  } catch (err) {
    await log(`[recon] circle balance fetch degraded: ${String(err)}`);
  }

  try {
    const tether = new TetherUsdtProvider({
      TETHER_ACCOUNT_MODE: (process.env["TETHER_ACCOUNT_MODE"] as "sandbox" | "otc_desk" | "tether_direct") ?? "sandbox",
      TETHER_REFERENCE_DETAILS: process.env["TETHER_REFERENCE_DETAILS"],
      FEATURE_SANDBOX_ONLY: process.env["FEATURE_SANDBOX_ONLY"] !== "false",
      ENABLE_TRON: process.env["ENABLE_TRON"] === "true",
    });
    const balances = await tether.getBalances();
    usdt = balances
      .filter((b) => b.asset === "USDT")
      .reduce((acc, b) => acc + b.balance, 0n);
  } catch (err) {
    await log(`[recon] tether balance fetch degraded: ${String(err)}`);
  }

  return { usdc, usdt };
}

async function computeEntityBankBalance(
  db: ReturnType<typeof getPrismaClient>,
  entityId: string,
  asOf: Date,
): Promise<bigint> {
  const [inbound, outbound] = await Promise.all([
    db.wireEvent.aggregate({
      where: {
        bankAccount: { entityId },
        direction: "INBOUND",
        importedAt: { lte: asOf },
      },
      _sum: { amountCents: true },
    }),
    db.wireEvent.aggregate({
      where: {
        bankAccount: { entityId },
        direction: "OUTBOUND",
        importedAt: { lte: asOf },
      },
      _sum: { amountCents: true },
    }),
  ]);

  return (inbound._sum.amountCents ?? 0n) - (outbound._sum.amountCents ?? 0n);
}

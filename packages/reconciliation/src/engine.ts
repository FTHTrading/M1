/**
 * Reconciliation Engine
 *
 * Three-way reconciliation:
 *   1. Ledger (internal double-entry books)
 *   2. Provider (Circle / Tether reported balances)
 *   3. Bank statements (imported CSV / MT940)
 *
 * Produces ReconciliationBreak records for any discrepancy above tolerance.
 * Tolerance: configurable via RECON_TOLERANCE_CENTS env var (default 100 = $1).
 */

import { getPrismaClient } from "@treasury/database";
import type { ReconciliationSummary } from "@treasury/types";
import { getAccountBalance, ACCOUNTS } from "@treasury/ledger";
import { getEnv } from "@treasury/config";

const TOLERANCE_CENTS = BigInt(process.env["RECON_TOLERANCE_CENTS"] ?? "100");

export async function runReconciliation(params: {
  entityId: string;
  periodDate: Date;
  bankFiatBalanceCents: bigint;
  providerUsdcBalanceCents: bigint;
  providerUsdtBalanceCents: bigint;
  runByUserId?: string;
}): Promise<ReconciliationSummary> {
  const db = getPrismaClient();
  const env = getEnv();

  const runId = crypto.randomUUID();
  const now = new Date();

  // Ledger balances
  const [
    ledgerFiatCash,
    ledgerUsdcInventory,
    ledgerUsdtInventory,
    ledgerPendingFiat,
  ] = await Promise.all([
    getAccountBalance(ACCOUNTS.FIAT_CASH),
    getAccountBalance(ACCOUNTS.USDC_INVENTORY),
    getAccountBalance(ACCOUNTS.USDT_INVENTORY),
    getAccountBalance(ACCOUNTS.PENDING_FIAT),
  ]);

  const ledgerTotalFiat = ledgerFiatCash + ledgerPendingFiat;

  const breaks: {
    breakType: string;
    expectedAmountCents: bigint;
    actualAmountCents: bigint;
    differenceCents: bigint;
    description: string;
    status: string;
  }[] = [];

  // ── Break detection ────────────────────────────────────────────────────────

  // Fiat: internal ledger vs bank statement
  const fiatDiff = absDiff(ledgerTotalFiat, params.bankFiatBalanceCents);
  if (fiatDiff > TOLERANCE_CENTS) {
    breaks.push({
      breakType: "FIAT_BANK_LEDGER_MISMATCH",
      expectedAmountCents: ledgerTotalFiat,
      actualAmountCents: params.bankFiatBalanceCents,
      differenceCents: fiatDiff,
      description: `Ledger fiat ${formatUsd(ledgerTotalFiat)} vs bank ${formatUsd(params.bankFiatBalanceCents)}`,
      status: "OPEN",
    });
  }

  // USDC: internal ledger vs Circle reported
  const usdcDiff = absDiff(ledgerUsdcInventory, params.providerUsdcBalanceCents);
  if (usdcDiff > TOLERANCE_CENTS) {
    breaks.push({
      breakType: "STABLECOIN_PROVIDER_MISMATCH",
      expectedAmountCents: ledgerUsdcInventory,
      actualAmountCents: params.providerUsdcBalanceCents,
      differenceCents: usdcDiff,
      description: `Ledger USDC ${formatUsd(ledgerUsdcInventory)} vs Circle ${formatUsd(params.providerUsdcBalanceCents)}`,
      status: "OPEN",
    });
  }

  // USDT: internal ledger vs Tether/OTC reported
  const usdtDiff = absDiff(ledgerUsdtInventory, params.providerUsdtBalanceCents);
  if (env.ENABLE_USDT === "true" && usdtDiff > TOLERANCE_CENTS) {
    breaks.push({
      breakType: "STABLECOIN_PROVIDER_MISMATCH",
      expectedAmountCents: ledgerUsdtInventory,
      actualAmountCents: params.providerUsdtBalanceCents,
      differenceCents: usdtDiff,
      description: `Ledger USDT ${formatUsd(ledgerUsdtInventory)} vs OTC ${formatUsd(params.providerUsdtBalanceCents)}`,
      status: "OPEN",
    });
  }

  // Persist reconciliation run
  const run = await db.reconciliationRun.create({
    data: {
      id: runId,
      entityId: params.entityId,
      periodDate: params.periodDate,
      status: breaks.length === 0 ? "MATCHED" : "BREAKS_FOUND",
      ledgerFiatCents: ledgerTotalFiat,
      bankFiatCents: params.bankFiatBalanceCents,
      providerUsdcCents: params.providerUsdcBalanceCents,
      providerUsdtCents: params.providerUsdtBalanceCents,
      breakCount: breaks.length,
      runAt: now,
      runByUserId: params.runByUserId,
    },
  });

  if (breaks.length > 0) {
    await db.reconciliationBreak.createMany({
      data: breaks.map((b) => ({
        reconRunId: run.id,
        breakType: b.breakType,
        expectedAmountCents: b.expectedAmountCents,
        actualAmountCents: b.actualAmountCents,
        differenceCents: b.differenceCents,
        description: b.description,
        status: b.status,
      })),
    });
  }

  return {
    runId: run.id,
    status: run.status,
    breakCount: breaks.length,
    breaks,
    ledgerFiatCents: ledgerTotalFiat,
    bankFiatCents: params.bankFiatBalanceCents,
    providerUsdcCents: params.providerUsdcBalanceCents,
    providerUsdtCents: params.providerUsdtBalanceCents,
    runAt: now,
  };
}

/** List open reconciliation breaks for an entity */
export async function listOpenBreaks(entityId: string) {
  const db = getPrismaClient();
  return db.reconciliationBreak.findMany({
    where: {
      reconRun: { entityId },
      status: "OPEN",
    },
    include: { reconRun: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Mark a break as resolved */
export async function resolveBreak(params: {
  breakId: string;
  resolvedByUserId: string;
  resolution: string;
}): Promise<void> {
  const db = getPrismaClient();
  await db.reconciliationBreak.update({
    where: { id: params.breakId },
    data: {
      status: "RESOLVED",
      resolvedByUserId: params.resolvedByUserId,
      resolution: params.resolution,
      resolvedAt: new Date(),
    },
  });
}

function absDiff(a: bigint, b: bigint): bigint {
  return a > b ? a - b : b - a;
}

function formatUsd(cents: bigint): string {
  return `$${(Number(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

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
import { randomUUID } from "crypto";

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

  const runId = randomUUID();
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
    id: string;
    breakType: string;
    amountCents: bigint;
    expectedValue: string;
    actualValue: string;
    description: string;
    status: string;
  }[] = [];

  // ── Break detection ────────────────────────────────────────────────────────

  // Fiat: internal ledger vs bank statement
  const fiatDiff = absDiff(ledgerTotalFiat, params.bankFiatBalanceCents);
  if (fiatDiff > TOLERANCE_CENTS) {
    breaks.push({
      id: randomUUID(),
      breakType: "FIAT_BANK_LEDGER_MISMATCH",
      amountCents: fiatDiff,
      expectedValue: ledgerTotalFiat.toString(),
      actualValue: params.bankFiatBalanceCents.toString(),
      description: `Ledger fiat ${formatUsd(ledgerTotalFiat)} vs bank ${formatUsd(params.bankFiatBalanceCents)}`,
      status: "OPEN",
    });
  }

  // USDC: internal ledger vs Circle reported
  const usdcDiff = absDiff(ledgerUsdcInventory, params.providerUsdcBalanceCents);
  if (usdcDiff > TOLERANCE_CENTS) {
    breaks.push({
      id: randomUUID(),
      breakType: "STABLECOIN_PROVIDER_MISMATCH",
      amountCents: usdcDiff,
      expectedValue: ledgerUsdcInventory.toString(),
      actualValue: params.providerUsdcBalanceCents.toString(),
      description: `Ledger USDC ${formatUsd(ledgerUsdcInventory)} vs Circle ${formatUsd(params.providerUsdcBalanceCents)}`,
      status: "OPEN",
    });
  }

  // USDT: internal ledger vs Tether/OTC reported
  const usdtDiff = absDiff(ledgerUsdtInventory, params.providerUsdtBalanceCents);
  if (env.ENABLE_USDT && usdtDiff > TOLERANCE_CENTS) {
    breaks.push({
      id: randomUUID(),
      breakType: "STABLECOIN_PROVIDER_MISMATCH",
      amountCents: usdtDiff,
      expectedValue: ledgerUsdtInventory.toString(),
      actualValue: params.providerUsdtBalanceCents.toString(),
      description: `Ledger USDT ${formatUsd(ledgerUsdtInventory)} vs OTC ${formatUsd(params.providerUsdtBalanceCents)}`,
      status: "OPEN",
    });
  }

  // Persist reconciliation run
  const run = await db.reconciliationRun.create({
    data: {
      id: runId,
      entityId: params.entityId,
      runDate: params.periodDate,
      status: breaks.length === 0 ? "COMPLETED" : "PARTIAL",
      bankBalanceCents: params.bankFiatBalanceCents,
      providerUsdcBalance: params.providerUsdcBalanceCents,
      providerUsdtBalance: params.providerUsdtBalanceCents,
      ledgerUsdcBalance: ledgerUsdcInventory,
      ledgerUsdtBalance: ledgerUsdtInventory,
      breakCount: breaks.length,
      startedAt: now,
      completedAt: now,
      ...(params.runByUserId ? { notes: `Triggered by ${params.runByUserId}` } : {}),
    },
  });

  if (breaks.length > 0) {
    await db.reconciliationBreak.createMany({
      data: breaks.map((b) => ({
        id: b.id,
        reconciliationRunId: run.id,
        breakType: b.breakType as
          | "UNDERFUNDED_MINT"
          | "UNMATCHED_WIRE"
          | "FAILED_WALLET_TRANSFER"
          | "STALE_PROVIDER_STATUS"
          | "LEDGER_IMBALANCE"
          | "WALLET_BALANCE_MISMATCH"
          | "PROVIDER_BALANCE_MISMATCH"
          | "MISSING_JOURNAL_ENTRY"
          | "DUPLICATE_TRANSACTION"
          | "OTHER",
        amountCents: b.amountCents,
        expectedValue: b.expectedValue,
        actualValue: b.actualValue,
        description: b.description,
        status: b.status as "OPEN",
      })),
    });
  }

  return {
    runId: run.id,
    runDate: params.periodDate,
    status: run.status,
    bankBalanceCents: params.bankFiatBalanceCents,
    providerUsdcBalance: params.providerUsdcBalanceCents,
    providerUsdtBalance: params.providerUsdtBalanceCents,
    ledgerUsdcBalance: ledgerUsdcInventory,
    ledgerUsdtBalance: ledgerUsdtInventory,
    breakCount: breaks.length,
    breaks: breaks.map((b) => ({
      id: b.id,
      breakType: b.breakType,
      description: b.description,
      amountCents: b.amountCents,
      status: b.status,
    })),
  };
}

/** List open reconciliation breaks for an entity */
export async function listOpenBreaks(entityId: string) {
  const db = getPrismaClient();
  return db.reconciliationBreak.findMany({
    where: {
      reconciliationRun: { entityId },
      status: "OPEN",
    },
    include: { reconciliationRun: true },
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
      resolvedById: params.resolvedByUserId,
      investigationNotes: params.resolution,
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

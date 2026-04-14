/**
 * Policy Engine
 *
 * Evaluates a PolicyContext against the configured rule set before any
 * MintRequest or RedemptionRequest transitions to an approved state.
 *
 * Rules evaluated (in order):
 *  1. Feature flags — FEATURE_SANDBOX_ONLY blocks live transfers
 *  2. Per-transaction USD limit (MAX_SINGLE_TX_USD)
 *  3. Dual-approval threshold (REQUIRED_APPROVAL_THRESHOLD_USD)
 *  4. KYC/KYB status check
 *  5. Wallet whitelist check
 *  6. Hourly velocity limit
 *  7. Daily velocity limit
 */

import { getEnv } from "@treasury/config";
import { getPrismaClient } from "@treasury/database";
import type { PolicyContext, PolicyEvaluationResult } from "@treasury/types";

export async function evaluatePolicy(
  ctx: PolicyContext,
): Promise<PolicyEvaluationResult> {
  const env = getEnv();
  const reasons: string[] = [];

  // ── Rule 1: sandbox-only mode blocks live transfers ──────────────────────
  if (env.FEATURE_SANDBOX_ONLY && ctx.liveMode) {
    reasons.push("FEATURE_SANDBOX_ONLY is enabled — live transfers are blocked");
  }

  // ── Rule 2: per-transaction limit ────────────────────────────────────────
  const maxSingleTxUsd = Number(env.MAX_SINGLE_TX_USD ?? "500000");
  if (ctx.amountUsd > maxSingleTxUsd) {
    reasons.push(
      `Amount $${ctx.amountUsd.toLocaleString()} exceeds per-transaction limit $${maxSingleTxUsd.toLocaleString()}`,
    );
  }

  // ── Rule 3: dual-approval gate ───────────────────────────────────────────
  const approvalThresholdUsd = Number(env.REQUIRED_APPROVAL_THRESHOLD_USD ?? "25000");
  const requiresApproval = ctx.amountUsd >= approvalThresholdUsd;

  // ── Rule 4: KYC/KYB status ───────────────────────────────────────────────
  const db = getPrismaClient();
  const compliance = await db.complianceProfile.findUnique({
    where: { entityId: ctx.entityId },
  });
  if (!compliance) {
    reasons.push("No compliance profile found for entity");
  } else {
    const kycOk = ["APPROVED"].includes(compliance.kycStatus);
    const kybOk = ["APPROVED"].includes(compliance.kybStatus);
    if (!kycOk) reasons.push(`KYC status is ${compliance.kycStatus} — must be APPROVED`);
    if (!kybOk) reasons.push(`KYB status is ${compliance.kybStatus} — must be APPROVED`);

    // ── Jurisdiction check ───────────────────────────────────────────────
    if (compliance.jurisdictionCode) {
      const blocked = env.BLOCKED_JURISDICTIONS?.split(",").map((j) => j.trim()) ?? [];
      if (blocked.includes(compliance.jurisdictionCode)) {
        reasons.push(`Jurisdiction ${compliance.jurisdictionCode} is blocked`);
      }
    }
  }

  // ── Rule 5: wallet whitelist ─────────────────────────────────────────────
  if (ctx.destinationAddress) {
    const entry = await db.walletWhitelistEntry.findFirst({
      where: {
        wallet: { entityId: ctx.entityId },
        address: ctx.destinationAddress,
        network: ctx.network,
        isActive: true,
      },
    });
    if (!entry) {
      reasons.push(
        `Destination address ${ctx.destinationAddress} is not whitelisted for network ${ctx.network}`,
      );
    }
  }

  // ── Rules 6 & 7: velocity limits ─────────────────────────────────────────
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 3_600_000);
  const oneDayAgo = new Date(now.getTime() - 86_400_000);

  const [hourlyRows, dailyRows] = await Promise.all([
    db.mintRequest.aggregate({
      where: {
        entityId: ctx.entityId,
        status: { in: ["COMPLETED", "SETTLING", "SETTLED"] },
        createdAt: { gte: oneHourAgo },
      },
      _sum: { amountCents: true },
    }),
    db.mintRequest.aggregate({
      where: {
        entityId: ctx.entityId,
        status: { in: ["COMPLETED", "SETTLING", "SETTLED"] },
        createdAt: { gte: oneDayAgo },
      },
      _sum: { amountCents: true },
    }),
  ]);

  const hourlyTotalUsd = Number(hourlyRows._sum.amountCents ?? 0n) / 100;
  const dailyTotalUsd = Number(dailyRows._sum.amountCents ?? 0n) / 100;
  const remainingHourlyUsd = Number(env.HOURLY_VELOCITY_LIMIT_USD ?? "100000") - hourlyTotalUsd;
  const remainingDailyUsd = Number(env.DAILY_VELOCITY_LIMIT_USD ?? "1000000") - dailyTotalUsd;

  if (ctx.amountUsd > remainingHourlyUsd) {
    reasons.push(
      `Hourly velocity limit exceeded — $${remainingHourlyUsd.toLocaleString()} remaining of ${env.HOURLY_VELOCITY_LIMIT_USD ?? "100000"}`,
    );
  }
  if (ctx.amountUsd > remainingDailyUsd) {
    reasons.push(
      `Daily velocity limit exceeded — $${remainingDailyUsd.toLocaleString()} remaining of ${env.DAILY_VELOCITY_LIMIT_USD ?? "1000000"}`,
    );
  }

  const allowed = reasons.length === 0;

  return {
    allowed,
    requiresApproval,
    reasons,
    checkedAt: now,
  };
}

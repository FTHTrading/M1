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
  const blockedReasons: string[] = [];
  const warnings: string[] = [];
  const amountUsd = Number(ctx.amountCents) / 100;

  // ── Rule 1: sandbox-only mode blocks live transfers ──────────────────────
  if (env.FEATURE_SANDBOX_ONLY && env.FEATURE_LIVE_TRANSFERS) {
    blockedReasons.push("FEATURE_SANDBOX_ONLY is enabled — live transfers are blocked");
  }

  // ── Rule 2: per-transaction limit ────────────────────────────────────────
  const maxSingleTxUsd = Number(env.MAX_SINGLE_TX_USD);
  if (amountUsd > maxSingleTxUsd) {
    blockedReasons.push(
      `Amount $${amountUsd.toLocaleString()} exceeds per-transaction limit $${maxSingleTxUsd.toLocaleString()}`,
    );
  }

  // ── Rule 3: dual-approval gate ───────────────────────────────────────────
  const approvalThresholdUsd = Number(env.REQUIRED_APPROVAL_THRESHOLD_USD);
  const requiresDualApproval = amountUsd >= approvalThresholdUsd;

  // ── Rule 4: KYC/KYB status ───────────────────────────────────────────────
  const db = getPrismaClient();
  const compliance = await db.complianceProfile.findUnique({
    where: { entityId: ctx.entityId },
  });
  if (!compliance) {
    blockedReasons.push("No compliance profile found for entity");
  } else {
    const kycOk = ["APPROVED"].includes(compliance.kycStatus);
    const kybOk = ["APPROVED"].includes(compliance.kybStatus);
    if (!kycOk) blockedReasons.push(`KYC status is ${compliance.kycStatus} — must be APPROVED`);
    if (!kybOk) blockedReasons.push(`KYB status is ${compliance.kybStatus} — must be APPROVED`);

    // ── Jurisdiction check ───────────────────────────────────────────────
    const blockedJurisdictions = compliance.restrictedJurisdictions ?? [];
    if (blockedJurisdictions.length > 0) {
      const entity = await db.entity.findUnique({
        where: { id: ctx.entityId },
        select: { countryOfIncorporation: true },
      });
      if (entity && blockedJurisdictions.includes(entity.countryOfIncorporation)) {
        blockedReasons.push(`Jurisdiction ${entity.countryOfIncorporation} is blocked`);
      }
    }
  }

  // ── Rule 5: wallet whitelist ─────────────────────────────────────────────
  if (ctx.destinationWallet) {
    const wallet = await db.wallet.findFirst({
      where: {
        entityId: ctx.entityId,
        address: ctx.destinationWallet.address,
        network: ctx.destinationWallet.network,
        isWhitelisted: true,
        status: "ACTIVE",
        whitelistEntries: { some: {} },
      },
    });
    if (!wallet) {
      blockedReasons.push(
        `Destination address ${ctx.destinationWallet.address} is not whitelisted for network ${ctx.destinationWallet.network}`,
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
        status: { in: ["MINT_COMPLETED", "SETTLEMENT_INITIATED", "SETTLED"] },
        createdAt: { gte: oneHourAgo },
      },
      _sum: { requestedAmountCents: true },
    }),
    db.mintRequest.aggregate({
      where: {
        entityId: ctx.entityId,
        status: { in: ["MINT_COMPLETED", "SETTLEMENT_INITIATED", "SETTLED"] },
        createdAt: { gte: oneDayAgo },
      },
      _sum: { requestedAmountCents: true },
    }),
  ]);

  const hourlyTotalUsd = Number(hourlyRows._sum?.requestedAmountCents ?? 0n) / 100;
  const dailyTotalUsd = Number(dailyRows._sum?.requestedAmountCents ?? 0n) / 100;
  const hourlyVelocityLimitUsd = maxSingleTxUsd;
  const dailyVelocityLimitUsd = maxSingleTxUsd * 10;
  const remainingHourlyUsd = hourlyVelocityLimitUsd - hourlyTotalUsd;
  const remainingDailyUsd = dailyVelocityLimitUsd - dailyTotalUsd;

  if (amountUsd > remainingHourlyUsd) {
    blockedReasons.push(
      `Hourly velocity limit exceeded — $${remainingHourlyUsd.toLocaleString()} remaining of ${hourlyVelocityLimitUsd.toLocaleString()}`,
    );
  }
  if (amountUsd > remainingDailyUsd) {
    blockedReasons.push(
      `Daily velocity limit exceeded — $${remainingDailyUsd.toLocaleString()} remaining of ${dailyVelocityLimitUsd.toLocaleString()}`,
    );
  }

  const allowed = blockedReasons.length === 0;

  if (requiresDualApproval) {
    warnings.push(
      `Amount exceeds dual-approval threshold of $${approvalThresholdUsd.toLocaleString()}`,
    );
  }

  return {
    allowed,
    requiresDualApproval,
    requiredApprovers: requiresDualApproval ? 2 : 1,
    blockedReasons,
    warnings,
  };
}

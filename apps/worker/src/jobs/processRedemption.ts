/**
 * Redemption workflow job
 *
 * Drives a RedemptionRequest through the provider state machine:
 *   SUBMITTED_TO_PROVIDER → submits transfer to Circle
 *   PROVIDER_PROCESSING   → polls until completed
 *   FIAT_RECEIVED         → posts fiat-received journal entry
 *   SETTLED
 */

import type { Job } from "bullmq";
import { getPrismaClient } from "@treasury/database";
import { CircleUsdcProvider } from "@treasury/providers";
import {
  postRedemptionSubmitted,
  postRedemptionFiatReceived,
} from "@treasury/ledger";
import { eventStore } from "@treasury/events";

export async function processRedemptionJob(
  job: Job<{ redemptionRequestId: string }>,
): Promise<void> {
  const db = getPrismaClient();
  const { redemptionRequestId } = job.data;
  const log = job.log.bind(job);

  await log(`[redemption] starting job for ${redemptionRequestId}`);

  const redReq = await db.redemptionRequest.findUnique({
    where: { id: redemptionRequestId },
    include: {
      entity:      true,
      bankAccount: true,
      sourceWallet: true,
    },
  });

  if (!redReq) throw new Error(`RedemptionRequest ${redemptionRequestId} not found`);

  const sandboxMode = process.env["FEATURE_SANDBOX_ONLY"] !== "false";
  const provider = new CircleUsdcProvider({
    apiKey:   process.env["CIRCLE_API_KEY"] ?? "",
    entityId: process.env["CIRCLE_ENTITY_ID"] ?? "",
    walletId: process.env["CIRCLE_WALLET_ID"] ?? "",
    sandbox:  sandboxMode,
  });

  // ── SUBMITTED_TO_PROVIDER → submit redemption ─────────────────────────────
  if (redReq.status === "SUBMITTED_TO_PROVIDER") {
    const result = await provider.initiateRedemption({
      redemptionRequestId,
      requestedUnits:      redReq.requestedUnits,
      asset:               redReq.asset as "USDC",
      network:             redReq.network as never,
      destinationBankAccountId: redReq.bankAccountId,
      sourceWalletAddress: redReq.sourceWallet?.address ?? "",
      idempotencyKey:      redemptionRequestId,
    });

    await db.redemptionRequest.update({
      where: { id: redemptionRequestId },
      data: {
        status:             "PROVIDER_PROCESSING",
        providerRequestId:  result.providerTransferId,
      },
    });

    await postRedemptionSubmitted({
      entityId:            redReq.entityId,
      redemptionRequestId,
      asset:               redReq.asset as "USDC" | "USDT",
      amountCents:         redReq.expectedFiatCents ?? 0n,
    });

    await eventStore.emit({
      eventType:     "redemption.provider_processing",
      aggregateType: "RedemptionRequest",
      aggregateId:   redemptionRequestId,
      payload:       { providerTransferId: result.providerTransferId },
    });

    throw new Error("Redemption submitted — re-queue for polling"); // causes BullMQ to retry
  }

  // ── PROVIDER_PROCESSING → poll ────────────────────────────────────────
  if (redReq.status === "PROVIDER_PROCESSING" && redReq.providerRequestId) {
    const status = await provider.checkRedemptionStatus({
      providerTransferId: redReq.providerRequestId,
    });

    if (status.status === "SETTLED") {
      await db.redemptionRequest.update({
        where: { id: redemptionRequestId },
        data: { status: "FIAT_RECEIVED" },
      });
    } else if (status.status === "FAILED" || status.status === "CANCELLED") {
      await db.redemptionRequest.update({
        where: { id: redemptionRequestId },
        data: { status: "FAILED", failureReason: status.failureReason },
      });
      await eventStore.emit({
        eventType:     "redemption.failed",
        aggregateType: "RedemptionRequest",
        aggregateId:   redemptionRequestId,
        payload:       { reason: status.failureReason },
      });
      return;
    } else {
      throw new Error(`Redemption still in progress: ${status.status}`);
    }
  }

  // ── FIAT_RECEIVED → receive fiat ───────────────────────────────────
  const latestReq = await db.redemptionRequest.findUniqueOrThrow({
    where: { id: redemptionRequestId },
  });

  if (latestReq.status === "FIAT_RECEIVED") {
    await postRedemptionFiatReceived({
      entityId:            redReq.entityId,
      redemptionRequestId,
      amountCents:         latestReq.expectedFiatCents ?? 0n,
      networkFeeCents:     latestReq.networkFeeCents ?? 0n,
      custodyFeeCents:     0n,
    });

    await db.redemptionRequest.update({
      where: { id: redemptionRequestId },
      data: { status: "SETTLED", settledAt: new Date() },
    });

    await eventStore.emit({
      eventType:     "redemption.completed",
      aggregateType: "RedemptionRequest",
      aggregateId:   redemptionRequestId,
      payload:       { amountCents: (latestReq.expectedFiatCents ?? 0n).toString() },
    });

    await log(`[redemption] completed ${redemptionRequestId}`);
  }
}

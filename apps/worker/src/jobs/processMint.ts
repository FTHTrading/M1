/**
 * Mint workflow job
 *
 * Picks up a MintRequest in BANK_FUNDED state, drives it through
 * the Circle / OTC provider state machine, posts journal entries at
 * each significant transition, and finalises when COMPLETED or FAILED.
 *
 * Retry policy: 5 attempts with exponential back-off (5 s base).
 */

import type { Job } from "bullmq";
import { getPrismaClient } from "@treasury/database";
import { getEnv } from "@treasury/config";
import { CircleUsdcProvider, createApostleClientFromEnv } from "@treasury/providers";
import {
  postFiatReservedForMint,
  postMintSubmittedToProvider,
  postMintCompleted,
  postStablecoinDistributed,
} from "@treasury/ledger";
import { eventStore } from "@treasury/events";

// Apostle Chain client (null if APOSTLE_ENDPOINT not configured)
const apostleClient = createApostleClientFromEnv();

export async function processMintJob(job: Job<{ mintRequestId: string }>): Promise<void> {
  const db = getPrismaClient();
  const { mintRequestId } = job.data;
  const log = job.log.bind(job);

  await log(`[mint] starting job for ${mintRequestId}`);

  const mintReq = await db.mintRequest.findUnique({
    where: { id: mintRequestId },
    include: {
      entity: true,
      settlementWallet: true,
      counterparty: true,
    },
  });

  if (!mintReq) throw new Error(`MintRequest ${mintRequestId} not found`);

  const env = getEnv();
  const provider = new CircleUsdcProvider({
    CIRCLE_API_KEY: env.CIRCLE_API_KEY,
    ...(env.CIRCLE_ENTITY_ID ? { CIRCLE_ENTITY_ID: env.CIRCLE_ENTITY_ID } : {}),
    ...(env.CIRCLE_WALLET_ID ? { CIRCLE_WALLET_ID: env.CIRCLE_WALLET_ID } : {}),
    CIRCLE_SANDBOX: env.CIRCLE_SANDBOX,
    CIRCLE_BASE_URL: env.CIRCLE_BASE_URL,
    FEATURE_SANDBOX_ONLY: env.FEATURE_SANDBOX_ONLY,
  });

  // ── Step 1: BANK_FUNDED → reserve fiat in ledger ────────────────────────
  if (mintReq.status === "BANK_FUNDED") {
    await postFiatReservedForMint({
      entityId:     mintReq.entityId,
      mintRequestId,
      amountCents:  mintReq.requestedAmountCents,
    });
    await db.mintRequest.update({
      where: { id: mintRequestId },
      data: { status: "SUBMITTED_TO_PROVIDER" },
    });
    await eventStore.emit({
      eventType:     "mint.funding_confirmed",
      aggregateType: "MintRequest",
      aggregateId:   mintRequestId,
      payload:       { amountCents: mintReq.requestedAmountCents.toString() },
    });
  }

  // ── Step 2: BANK_FUNDED → submit to provider ───────────────────────
  const freshReq = await db.mintRequest.findUniqueOrThrow({ where: { id: mintRequestId } });

  if (freshReq.status === "SUBMITTED_TO_PROVIDER") {
    const destinationNetwork = freshReq.network ?? "ETHEREUM";
    const destinationWalletAddress = mintReq.settlementWallet?.address ?? "";

    const quoteResult = await provider.quoteMint({
      fiatAmountCents: freshReq.requestedAmountCents,
      asset: freshReq.asset as "USDC",
      destinationNetwork,
    });

    const initiationResult = await provider.initiateMint({
      requestId: mintRequestId,
      fiatAmountCents: freshReq.requestedAmountCents,
      asset: freshReq.asset as "USDC",
      destinationWalletAddress,
      destinationNetwork,
      entityId: freshReq.entityId,
      ...(freshReq.bankFundingReference ? { externalReference: freshReq.bankFundingReference } : {}),
    });

    await db.mintRequest.update({
      where: { id: mintRequestId },
      data: {
        status: "PROVIDER_PROCESSING",
        providerRequestId: initiationResult.externalId,
        providerResponse: initiationResult.wireInstructions as never,
        networkFeeCents: quoteResult.networkFeeEstimateCents,
        providerSubmittedAt: new Date(),
      },
    });

    await postMintSubmittedToProvider({
      entityId:    mintReq.entityId,
      mintRequestId,
      amountCents: freshReq.requestedAmountCents,
    });

    await eventStore.emit({
      eventType:     "mint.provider_processing",
      aggregateType: "MintRequest",
      aggregateId:   mintRequestId,
      payload: { providerRequestId: initiationResult.externalId },
    });

    // Re-queue a status-check job to come back in 30 s
    return;
  }

  // ── Step 3: PROVIDER_PROCESSING → poll until MINTED ─────────────────────
  if (freshReq.status === "PROVIDER_PROCESSING" && freshReq.providerRequestId) {
    const statusResult = await provider.checkMintStatus(freshReq.providerRequestId);

    if (statusResult.status === "SETTLED" || statusResult.status === "MINTED") {
      const feeCents = freshReq.networkFeeCents ?? 0n;
      const mintedUnits = statusResult.assetAmount ?? freshReq.requestedAmountCents * 10_000n;

      await postMintCompleted({
        entityId:        mintReq.entityId,
        mintRequestId,
        fiatAmountCents: freshReq.requestedAmountCents,
        stablecoinUnits: mintedUnits,
        asset:           freshReq.asset as "USDC" | "USDT",
        networkFeeCents: feeCents,
        custodyFeeCents: 0n,
      });

      await db.mintRequest.update({
        where: { id: mintRequestId },
        data: {
          status:          "MINT_COMPLETED",
          mintCompletedAt: new Date(),
          mintedUnits,
          networkFeeCents: feeCents,
        },
      });
    } else if (statusResult.status === "FAILED" || statusResult.status === "CANCELLED") {
      await db.mintRequest.update({
        where: { id: mintRequestId },
        data: { status: "FAILED", failureReason: statusResult.message ?? null },
      });
      await eventStore.emit({
        eventType: "mint.failed",
        aggregateType: "MintRequest",
        aggregateId: mintRequestId,
        payload: { reason: statusResult.message ?? null },
      });
      return;
    } else {
      // Still in flight — job will be retried by BullMQ
      throw new Error(`Mint still in progress: ${statusResult.status}`);
    }
  }

  // ── Step 4: MINT_COMPLETED → distribute to wallet ────────────────────────
  const settlingReq = await db.mintRequest.findUniqueOrThrow({ where: { id: mintRequestId } });

  if (settlingReq.status === "MINT_COMPLETED") {
    await postStablecoinDistributed({
      entityId:    mintReq.entityId,
      mintRequestId,
      asset:       settlingReq.asset as "USDC" | "USDT",
      amountCents: settlingReq.requestedAmountCents - (settlingReq.networkFeeCents ?? 0n),
    });

    await db.mintRequest.update({
      where: { id: mintRequestId },
      data: { status: "SETTLED", settledAt: new Date() },
    });

    // ── Apostle Chain post-settlement finality record ─────────────────────
    if (apostleClient) {
      const apostleReceipt = await apostleClient.recordSettlement({
        requestId:          mintRequestId,
        destinationAgentId: process.env["APOSTLE_TREASURY_AGENT_ID"] ?? settlingReq.entityId,
        asset:              "USDF",
        // 1:1 USDF = fiat cents expressed as micro-units (cents * 10^16 for 18-dec)
        // We store as cent value for simplicity — operators calibrate via ATP config
        amount:             (settlingReq.requestedAmountCents - (settlingReq.networkFeeCents ?? 0n)).toString(),
        memo:               `mint:${mintRequestId}:${settlingReq.asset}:${settlingReq.network}`,
      });

      await db.mintRequest.update({
        where: { id: mintRequestId },
        data: {
          apostleTxHash:    apostleReceipt.txHash,
          apostleStatus:    apostleReceipt.status,
          apostleSettledAt: apostleReceipt.status !== "FAILED" ? apostleReceipt.settledAt : null,
        } as never, // Apostle fields added via schema migration
      });

      await log(
        `[mint] Apostle Chain settlement: ${apostleReceipt.status} — txHash: ${apostleReceipt.txHash}`,
      );
    }

    await eventStore.emit({
      eventType:     "mint.completed",
      aggregateType: "MintRequest",
      aggregateId:   mintRequestId,
      payload: {
        amountCents: settlingReq.requestedAmountCents.toString(),
        asset:       settlingReq.asset,
        network:     settlingReq.network,
        apostleTxHash: apostleClient ? "wired" : "not_configured",
      },
    });

    await log(`[mint] completed ${mintRequestId}`);
  }
}

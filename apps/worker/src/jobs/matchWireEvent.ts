/**
 * Wire event matching job
 *
 * Attempts to match an inbound WireEvent against a MintRequest that
 * is in AWAITING_BANK_FUNDING state by comparing reference numbers.
 */

import type { Job } from "bullmq";
import { getPrismaClient } from "@treasury/database";
import { Queue } from "bullmq";

export async function matchWireEventJob(job: Job<{ wireEventId: string }>): Promise<void> {
  const db = getPrismaClient();
  const mintQueue = new Queue("mint-workflow", {
    connection: { host: process.env["REDIS_HOST"] ?? "localhost", port: 6379 },
  });

  const wireEvent = await db.wireEvent.findUnique({
    where: { id: job.data.wireEventId },
  });
  if (!wireEvent) return;

  // Try to match by wire reference number against mint references
  const mintReq = await db.mintRequest.findFirst({
    where: {
      status: "AWAITING_BANK_FUNDING",
      OR: [
        { reference: wireEvent.referenceNumber },
        { bankFundingReference: wireEvent.referenceNumber },
      ],
    },
  });

  if (!mintReq) {
    await db.wireEvent.update({
      where: { id: wireEvent.id },
      data: { matchStatus: "UNMATCHED" },
    });
    return;
  }

  // Matched — advance mint request to BANK_FUNDED
  await Promise.all([
    db.wireEvent.update({
      where: { id: wireEvent.id },
      data: {
        matchStatus:    "MATCHED",
        mintRequestId:  mintReq.id,
      },
    }),
    db.mintRequest.update({
      where: { id: mintReq.id },
      data: {
        status:               "BANK_FUNDED",
        bankFundingReference: wireEvent.referenceNumber,
      },
    }),
  ]);

  // Trigger mint workflow
  await mintQueue.add("process-mint", { mintRequestId: mintReq.id }, {
    jobId: `mint-${mintReq.id}`,
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
  });
}

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
  const matchReference = wireEvent.reference ?? wireEvent.bankReference;

  const mintReq = matchReference
    ? await db.mintRequest.findFirst({
        where: {
          status: "AWAITING_BANK_FUNDING",
          OR: [
            { reference: matchReference },
            { bankFundingReference: matchReference },
          ],
        },
      })
    : null;

  if (!mintReq) {
    await db.wireEvent.update({
      where: { id: wireEvent.id },
      data: { status: "UNMATCHED" },
    });
    return;
  }

  // Matched — advance mint request to BANK_FUNDED
  await Promise.all([
    db.wireEvent.update({
      where: { id: wireEvent.id },
      data: {
        status: "MATCHED",
        matchedToType: "mint_request",
        matchedToId: mintReq.id,
        matchedAt: new Date(),
      },
    }),
    db.mintRequest.update({
      where: { id: mintReq.id },
      data: {
        status: "BANK_FUNDED",
        ...(matchReference ? { bankFundingReference: matchReference } : {}),
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

import type { FastifyInstance } from "fastify";
import { getPrismaClient } from "@treasury/database";
import { Queue } from "bullmq";
import { z } from "zod";

const decisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note:     z.string().max(1000).optional(),
});

export async function approvalRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getPrismaClient();
  const mintQueue = new Queue("mint-workflow", {
    connection: { host: process.env["REDIS_HOST"] ?? "localhost", port: 6379 },
  });
  const redemptionQueue = new Queue("redemption-workflow", {
    connection: { host: process.env["REDIS_HOST"] ?? "localhost", port: 6379 },
  });

  fastify.addHook("onRequest", fastify.authenticate);

  // GET /approvals — list pending approvals
  fastify.get("/", async (_req, reply) => {
    const pending = await db.approval.findMany({
      where: { status: "PENDING" },
      include: {
        mintRequest:       { select: { reference: true, amountCents: true, asset: true, status: true } },
        redemptionRequest: { select: { reference: true, amountCents: true, asset: true, status: true } },
        approver:          { select: { fullName: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return reply.send({ data: pending });
  });

  // POST /approvals/:id/decide — approve or reject
  fastify.post<{ Params: { id: string } }>("/:id/decide", async (req, reply) => {
    const body = decisionSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation", message: body.error.flatten() });
    }

    const approval = await db.approval.findUnique({
      where: { id: req.params.id },
      include: { mintRequest: true, redemptionRequest: true },
    });
    if (!approval) return reply.code(404).send({ error: "Approval not found" });
    if (approval.status !== "PENDING") {
      return reply.code(409).send({ error: "Approval already decided" });
    }

    const payload = req.user as { sub: string };
    const approverUserId = payload.sub;

    await db.approval.update({
      where: { id: req.params.id },
      data: {
        status:        body.data.decision === "APPROVE" ? "APPROVED" : "REJECTED",
        note:          body.data.note,
        approverUserId,
        decidedAt:     new Date(),
      },
    });

    if (body.data.decision === "APPROVE") {
      // Advance the parent request
      if (approval.mintRequestId) {
        const mint = approval.mintRequest!;
        if (mint.status === "PENDING_APPROVAL") {
          await db.mintRequest.update({
            where: { id: approval.mintRequestId },
            data: { status: "AWAITING_BANK_FUNDING" },
          });
        }
      } else if (approval.redemptionRequestId) {
        const redeem = approval.redemptionRequest!;
        if (redeem.status === "PENDING_APPROVAL") {
          await db.redemptionRequest.update({
            where: { id: approval.redemptionRequestId },
            data: { status: "SUBMITTED_TO_PROVIDER" },
          });
          await redemptionQueue.add("process-redemption", {
            redemptionRequestId: approval.redemptionRequestId,
          }, {
            jobId: `redemption-${approval.redemptionRequestId}`,
            attempts: 5,
            backoff: { type: "exponential", delay: 5000 },
          });
        }
      }
    } else {
      // Reject — move parent to REJECTED
      if (approval.mintRequestId) {
        await db.mintRequest.update({
          where: { id: approval.mintRequestId },
          data: { status: "CANCELLED" },
        });
      } else if (approval.redemptionRequestId) {
        await db.redemptionRequest.update({
          where: { id: approval.redemptionRequestId },
          data: { status: "CANCELLED" },
        });
      }
    }

    return reply.send({ success: true });
  });
}

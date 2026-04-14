import type { FastifyInstance } from "fastify";
import { getPrismaClient } from "@treasury/database";

export async function reportRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getPrismaClient();

  fastify.addHook("onRequest", fastify.authenticate);

  // GET /reports — list report jobs
  fastify.get("/", async (_req, reply) => {
    const jobs = await db.reportJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return reply.send(jobs);
  });

  // GET /reports/summary — dashboard KPI snapshot
  fastify.get<{ Querystring: { entityId?: string } }>("/summary", async (req, reply) => {
    const where = req.query.entityId ? { entityId: req.query.entityId } : {};

    const [
      pendingMints,
      completedMints,
      pendingRedemptions,
      completedRedemptions,
      openBreaks,
    ] = await Promise.all([
      db.mintRequest.count({ where: { ...where, status: { in: ["PENDING_APPROVAL", "AWAITING_BANK_FUNDING", "BANK_FUNDED", "SUBMITTED_TO_PROVIDER", "PROVIDER_PROCESSING"] } } }),
      db.mintRequest.count({ where: { ...where, status: "SETTLED" } }),
      db.redemptionRequest.count({ where: { ...where, status: { in: ["PENDING_APPROVAL", "SUBMITTED_TO_PROVIDER", "PROVIDER_PROCESSING"] } } }),
      db.redemptionRequest.count({ where: { ...where, status: "SETTLED" } }),
      db.reconciliationBreak.count({ where: { status: "OPEN", reconRun: { ...where } } }),
    ]);

    return reply.send({
      pendingMints,
      completedMints,
      pendingRedemptions,
      completedRedemptions,
      openBreaks,
      generatedAt: new Date(),
    });
  });
}

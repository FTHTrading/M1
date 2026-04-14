import type { FastifyInstance } from "fastify";
import { runReconciliation, listOpenBreaks, resolveBreak } from "@treasury/reconciliation";
import { getPrismaClient } from "@treasury/database";
import { z } from "zod";

const runSchema = z.object({
  entityId:                  z.string().uuid(),
  periodDate:                z.string().datetime(),
  bankFiatBalanceCents:      z.number().int(),
  providerUsdcBalanceCents:  z.number().int(),
  providerUsdtBalanceCents:  z.number().int(),
});

export async function reconciliationRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getPrismaClient();

  fastify.addHook("onRequest", fastify.authenticate);

  // GET /reconciliation/runs
  fastify.get("/runs", async (req, reply) => {
    const runs = await db.reconciliationRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return reply.send({ data: runs });
  });

  // POST /reconciliation/runs
  fastify.post("/runs", async (req, reply) => {
    const body = runSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation", message: body.error.flatten() });
    }
    const payload = req.user as { sub: string };
    const result = await runReconciliation({
      entityId:                  body.data.entityId,
      periodDate:                new Date(body.data.periodDate),
      bankFiatBalanceCents:      BigInt(body.data.bankFiatBalanceCents),
      providerUsdcBalanceCents:  BigInt(body.data.providerUsdcBalanceCents),
      providerUsdtBalanceCents:  BigInt(body.data.providerUsdtBalanceCents),
      runByUserId:               payload.sub,
    });
    return reply.code(201).send(result);
  });

  // GET /reconciliation/breaks
  fastify.get<{ Querystring: { entityId?: string } }>("/breaks", async (req, reply) => {
    const breaks = await listOpenBreaks(req.query.entityId ?? "");
    return reply.send({ data: breaks });
  });

  // POST /reconciliation/breaks/:id/resolve
  fastify.post<{ Params: { id: string }; Body: { resolution: string } }>(
    "/breaks/:id/resolve",
    async (req, reply) => {
      const payload = req.user as { sub: string };
      await resolveBreak({
        breakId:         req.params.id,
        resolvedByUserId: payload.sub,
        resolution:      (req.body as { resolution: string }).resolution ?? "",
      });
      return reply.code(204).send();
    },
  );
}

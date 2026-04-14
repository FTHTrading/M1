import type { FastifyInstance } from "fastify";
import { getPrismaClient } from "@treasury/database";

export async function eventsRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getPrismaClient();

  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get<{
    Querystring: {
      aggregateType?: string;
      aggregateId?: string;
      eventType?: string;
      page?: string;
    };
  }>("/", async (req, reply) => {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = 50;

    const [items, total] = await Promise.all([
      db.eventLog.findMany({
        where: {
          ...(req.query.aggregateType ? { aggregateType: req.query.aggregateType } : {}),
          ...(req.query.aggregateId ? { aggregateId: req.query.aggregateId } : {}),
          ...(req.query.eventType ? { eventType: req.query.eventType } : {}),
        },
        orderBy: { occurredAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.eventLog.count({
        where: {
          ...(req.query.aggregateType ? { aggregateType: req.query.aggregateType } : {}),
          ...(req.query.aggregateId ? { aggregateId: req.query.aggregateId } : {}),
          ...(req.query.eventType ? { eventType: req.query.eventType } : {}),
        },
      }),
    ]);

    return reply.send({ items, total, page, pageSize });
  });
}

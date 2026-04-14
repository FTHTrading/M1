import type { FastifyInstance } from "fastify";
import { getPrismaClient } from "@treasury/database";

export async function transferRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getPrismaClient();

  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get<{ Querystring: { entityId?: string; asset?: string; page?: string } }>(
    "/",
    async (req, reply) => {
      const page = Math.max(1, Number(req.query.page ?? 1));
      const pageSize = 50;

      const [items, total] = await Promise.all([
        db.stablecoinTransfer.findMany({
          where: {
            ...(req.query.entityId ? { entityId: req.query.entityId } : {}),
            ...(req.query.asset ? { asset: req.query.asset as never } : {}),
          },
          include: {
            mintRequest:       { select: { reference: true } },
            redemptionRequest: { select: { reference: true } },
          },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.stablecoinTransfer.count({
          where: {
            ...(req.query.entityId ? { entityId: req.query.entityId } : {}),
            ...(req.query.asset ? { asset: req.query.asset as never } : {}),
          },
        }),
      ]);

      return reply.send({ items, total, page, pageSize });
    },
  );

  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const transfer = await db.stablecoinTransfer.findUnique({
      where: { id: req.params.id },
      include: {
        mintRequest: true,
        redemptionRequest: true,
      },
    });
    if (!transfer) return reply.code(404).send({ error: "Transfer not found" });
    return reply.send(transfer);
  });
}

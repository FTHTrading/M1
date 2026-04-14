import type { FastifyInstance } from "fastify";
import { getPrismaClient } from "@treasury/database";

export async function treasuryAccountRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getPrismaClient();

  fastify.addHook("onRequest", fastify.authenticate);

  // GET /treasury-accounts?entityId=<uuid>
  fastify.get<{ Querystring: { entityId?: string } }>("/", async (req, reply) => {
    const accounts = await db.treasuryAccount.findMany({
      where: {
        ...(req.query.entityId ? { entityId: req.query.entityId } : {}),
        status: "ACTIVE",
      },
      select: { id: true, name: true, entityId: true, description: true },
      orderBy: { name: "asc" },
    });
    return reply.send({ data: accounts });
  });
}

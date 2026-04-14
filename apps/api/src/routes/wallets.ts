import type { FastifyInstance } from "fastify";
import { getPrismaClient } from "@treasury/database";
import { z } from "zod";

const createSchema = z.object({
  entityId:    z.string().uuid(),
  label:       z.string(),
  address:     z.string(),
  network:     z.enum(["ETHEREUM","POLYGON","BASE","SOLANA","TRON","STELLAR","XRPL"]),
  asset:       z.enum(["USDC","USDT"]),
  custodian:   z.string().optional(),
});

const whitelistSchema = z.object({
  address:     z.string(),
  network:     z.enum(["ETHEREUM","POLYGON","BASE","SOLANA","TRON","STELLAR","XRPL"]),
  label:       z.string().optional(),
});

export async function walletRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getPrismaClient();

  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get<{ Querystring: { entityId?: string } }>("/", async (req, reply) => {
    const wallets = await db.wallet.findMany({
      where: req.query.entityId ? { entityId: req.query.entityId } : {},
      include: { whitelistEntries: { where: { isActive: true } } },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({ data: wallets });
  });

  fastify.post("/", async (req, reply) => {
    const body = createSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation", message: body.error.flatten() });
    }
    const wallet = await db.wallet.create({ data: body.data });
    return reply.code(201).send(wallet);
  });

  // Add whitelist entry
  fastify.post<{ Params: { id: string } }>("/:id/whitelist", async (req, reply) => {
    const body = whitelistSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation", message: body.error.flatten() });
    }
    const entry = await db.walletWhitelistEntry.create({
      data: { walletId: req.params.id, ...body.data },
    });
    return reply.code(201).send(entry);
  });

  // Remove whitelist entry
  fastify.delete<{ Params: { id: string; entryId: string } }>(
    "/:id/whitelist/:entryId",
    async (req, reply) => {
      await db.walletWhitelistEntry.update({
        where: { id: req.params.entryId },
        data: { isActive: false },
      });
      return reply.code(204).send();
    },
  );
}

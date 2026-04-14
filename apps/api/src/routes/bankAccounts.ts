import type { FastifyInstance } from "fastify";
import { getPrismaClient } from "@treasury/database";
import { z } from "zod";

const createSchema = z.object({
  entityId:       z.string().uuid(),
  bankName:       z.string(),
  accountName:    z.string(),
  accountNumber:  z.string(),
  routingNumber:  z.string(),
  swiftBic:       z.string().optional(),
  ibanNumber:     z.string().optional(),
  currencyCode:   z.string().length(3).default("USD"),
  accountType:    z.enum(["CHECKING", "SAVINGS", "MONEY_MARKET"]).default("CHECKING"),
  bankCountry:    z.string().length(2).default("US"),
  bankAddressLine1: z.string().optional(),
  bankCity:       z.string().optional(),
});

export async function bankAccountRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getPrismaClient();

  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get<{ Querystring: { entityId?: string } }>("/", async (req, reply) => {
    const accounts = await db.bankAccount.findMany({
      where: req.query.entityId ? { entityId: req.query.entityId } : {},
      include: { entity: { select: { legalName: true } } },
      orderBy: { createdAt: "desc" },
    });
    return reply.send(accounts);
  });

  fastify.post("/", async (req, reply) => {
    const body = createSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation", message: body.error.flatten() });
    }

    const account = await db.bankAccount.create({ data: body.data });
    return reply.code(201).send(account);
  });

  fastify.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    await db.bankAccount.update({
      where: { id: req.params.id },
      data: { status: "INACTIVE" },
    });
    return reply.code(204).send();
  });
}

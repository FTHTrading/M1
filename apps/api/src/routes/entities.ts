import type { FastifyInstance } from "fastify";
import { getPrismaClient } from "@treasury/database";
import { z } from "zod";

const createSchema = z.object({
  legalName:     z.string().min(2),
  dbaName:       z.string().optional(),
  entityType:    z.enum(["LLC", "CORP", "PARTNERSHIP", "SOLE_PROP", "TRUST"]),
  taxId:         z.string().optional(),
  countryCode:   z.string().length(2),
  stateProvince: z.string().optional(),
  addressLine1:  z.string(),
  addressLine2:  z.string().optional(),
  city:          z.string(),
  postalCode:    z.string(),
});

export async function entityRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getPrismaClient();

  fastify.addHook("onRequest", fastify.authenticate);

  // GET /entities
  fastify.get("/", async (_req, reply) => {
    const entities = await db.entity.findMany({
      include: { bankAccounts: true, wallets: true },
      orderBy: { createdAt: "desc" },
    });
    return reply.send(entities);
  });

  // GET /entities/:id
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const entity = await db.entity.findUnique({
      where: { id: req.params.id },
      include: {
        bankAccounts: true,
        wallets: true,
        complianceProfile: true,
        treasuryAccounts: true,
      },
    });
    if (!entity) return reply.code(404).send({ error: "Entity not found" });
    return reply.send(entity);
  });

  // POST /entities
  fastify.post("/", async (req, reply) => {
    const body = createSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation", message: body.error.flatten() });
    }

    const entity = await db.entity.create({
      data: {
        legalName:     body.data.legalName,
        dbaName:       body.data.dbaName,
        entityType:    body.data.entityType,
        taxId:         body.data.taxId,
        countryCode:   body.data.countryCode,
        stateProvince: body.data.stateProvince,
        addressLine1:  body.data.addressLine1,
        addressLine2:  body.data.addressLine2,
        city:          body.data.city,
        postalCode:    body.data.postalCode,
      },
    });

    return reply.code(201).send(entity);
  });
}

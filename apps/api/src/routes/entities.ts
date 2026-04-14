import type { FastifyInstance } from "fastify";
import { getPrismaClient } from "@treasury/database";
import { z } from "zod";

const createSchema = z.object({
  legalName:     z.string().min(2),
  tradingName:   z.string().optional(),
  entityType:    z.enum(["CORPORATION", "LLC", "PARTNERSHIP", "TRUST", "GOVERNMENT", "FINANCIAL_INSTITUTION", "OTHER"]),
  taxId:         z.string().optional(),
  countryOfIncorporation: z.string().min(2),
  stateProvince: z.string().optional(),
  addressLine1:  z.string(),
  addressLine2:  z.string().optional(),
  city:          z.string(),
  postalCode:    z.string(),
  contactEmail:  z.string().email().default("ops@example.com"),
  contactPhone:  z.string().optional(),
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
        ...(body.data.tradingName ? { tradingName: body.data.tradingName } : {}),
        entityType:    body.data.entityType,
        ...(body.data.taxId ? { taxId: body.data.taxId } : {}),
        countryOfIncorporation: body.data.countryOfIncorporation,
        address: {
          line1: body.data.addressLine1,
          ...(body.data.addressLine2 ? { line2: body.data.addressLine2 } : {}),
          city: body.data.city,
          ...(body.data.stateProvince ? { stateProvince: body.data.stateProvince } : {}),
          postalCode: body.data.postalCode,
          country: body.data.countryOfIncorporation,
        },
        contactEmail: body.data.contactEmail,
        ...(body.data.contactPhone ? { contactPhone: body.data.contactPhone } : {}),
      },
    });

    return reply.code(201).send(entity);
  });
}

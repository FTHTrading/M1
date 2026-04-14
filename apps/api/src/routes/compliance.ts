import type { FastifyInstance } from "fastify";
import { getPrismaClient } from "@treasury/database";
import { evaluatePolicy } from "@treasury/compliance";
import { z } from "zod";
import type { PolicyContext } from "@treasury/types";

export async function complianceRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getPrismaClient();

  fastify.addHook("onRequest", fastify.authenticate);

  // GET /compliance/profiles
  fastify.get<{ Querystring: { entityId?: string } }>("/profiles", async (req, reply) => {
    const profiles = await db.complianceProfile.findMany({
      where: req.query.entityId ? { entityId: req.query.entityId } : {},
      include: { entity: { select: { legalName: true } } },
    });
    return reply.send({ data: profiles });
  });

  // GET /compliance/profiles/:entityId
  fastify.get<{ Params: { entityId: string } }>("/profiles/:entityId", async (req, reply) => {
    const profile = await db.complianceProfile.findUnique({
      where: { entityId: req.params.entityId },
      include: { entity: true },
    });
    if (!profile) return reply.code(404).send({ error: "Compliance profile not found" });
    return reply.send(profile);
  });

  // POST /compliance/evaluate — dry-run policy check
  const evalSchema = z.object({
    entityId:  z.string().uuid(),
    amountUsd: z.number().positive(),
    asset:     z.enum(["USDC","USDT"]),
    network:   z.enum(["ETHEREUM","POLYGON","BASE","SOLANA","TRON","STELLAR","XRPL"]),
    liveMode:  z.boolean().default(false),
  });

  fastify.post("/evaluate", async (req, reply) => {
    const body = evalSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation", message: body.error.flatten() });
    }
    const ctx: PolicyContext = body.data;
    const result = await evaluatePolicy(ctx);
    return reply.send(result);
  });

  // GET /compliance/cases
  fastify.get<{ Querystring: { entityId?: string; status?: string } }>("/cases", async (req, reply) => {
    const cases = await db.complianceCase.findMany({
      where: {
        ...(req.query.entityId ? { entityId: req.query.entityId } : {}),
        ...(req.query.status ? { status: req.query.status as never } : {}),
      },
      include: { entity: { select: { legalName: true } } },
      orderBy: { createdAt: "desc" },
    });
    return reply.send(cases);
  });
}

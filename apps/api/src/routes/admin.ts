import type { FastifyInstance } from "fastify";
import { getPrismaClient } from "@treasury/database";

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getPrismaClient();

  fastify.addHook("onRequest", fastify.authenticate);

  // GET /admin/users
  fastify.get("/users", async (_req, reply) => {
    const users = await db.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        createdAt: true,
        roles: { include: { role: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });
    return reply.send(users);
  });

  // GET /admin/audit-log
  fastify.get<{ Querystring: { resourceType?: string; page?: string } }>(
    "/audit-log",
    async (req, reply) => {
      const page = Math.max(1, Number(req.query.page ?? 1));
      const pageSize = 50;

      const [items, total] = await Promise.all([
        db.auditLog.findMany({
          where: req.query.resourceType ? { resource: req.query.resourceType } : {},
          include: { user: { select: { name: true, email: true } } },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.auditLog.count({
          where: req.query.resourceType ? { resource: req.query.resourceType } : {},
        }),
      ]);

      return reply.send({ items, total, page, pageSize });
    },
  );

  // GET /admin/settings — placeholder for runtime config
  fastify.get("/settings", async (_req, reply) => {
    return reply.send({
      FEATURE_SANDBOX_ONLY: process.env["FEATURE_SANDBOX_ONLY"] ?? "true",
      FEATURE_LIVE_TRANSFERS: process.env["FEATURE_LIVE_TRANSFERS"] ?? "false",
      ENABLE_USDT: process.env["ENABLE_USDT"] ?? "false",
      REQUIRED_APPROVAL_THRESHOLD_USD: process.env["REQUIRED_APPROVAL_THRESHOLD_USD"] ?? "25000",
      MAX_SINGLE_TX_USD: process.env["MAX_SINGLE_TX_USD"] ?? "500000",
    });
  });
}

import type { FastifyInstance } from "fastify";
import { getPrismaClient } from "@treasury/database";
import * as bcrypt from "bcryptjs";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getPrismaClient();

  // POST /auth/login
  fastify.post("/login", async (request, reply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation", message: body.error.flatten() });
    }

    const user = await db.user.findUnique({
      where: { email: body.data.email },
      include: { roles: { include: { role: true } } },
    });

    if (!user || user.status !== "ACTIVE") {
      return reply.code(401).send({ error: "Unauthorized", message: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(body.data.password, user.passwordHash);
    if (!valid) {
      return reply.code(401).send({ error: "Unauthorized", message: "Invalid credentials" });
    }

    const roles = user.roles.map((ur) => ur.role.name);
    const token = fastify.jwt.sign({
      sub: user.id,
      email: user.email,
      name: user.name,
      roles,
    });

    await db.userSession.create({
      data: {
        userId: user.id,
        token,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
        expiresAt: new Date(Date.now() + 8 * 3_600_000),
      },
    });

    return reply.send({
      token,
      user: { id: user.id, email: user.email, name: user.name, roles },
    });
  });

  // POST /auth/logout
  fastify.post(
    "/logout",
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const authHeader = request.headers.authorization ?? "";
      const token = authHeader.replace("Bearer ", "");
      await db.userSession.deleteMany({
        where: { token },
      });
      return reply.code(204).send();
    },
  );

  // GET /auth/me
  fastify.get(
    "/me",
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const payload = request.user as { sub: string };
      const user = await db.user.findUnique({
        where: { id: payload.sub },
        include: { roles: { include: { role: true } } },
      });
      if (!user) return reply.code(404).send({ error: "User not found" });
      return reply.send({
        id: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles.map((ur) => ur.role.name),
      });
    },
  );
}

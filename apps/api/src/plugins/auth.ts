/**
 * Auth middleware — decodes the Bearer JWT and attaches user to request.
 * Registers a preHandler that any route can opt into via { onRequest: [server.authenticate] }.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export async function authPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate(
    "authenticate",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch (err) {
        reply.code(401).send({ error: "Unauthorized", message: "Invalid or missing token" });
      }
    },
  );
}

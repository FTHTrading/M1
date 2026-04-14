/**
 * Webhook routes — inbound provider callbacks.
 *
 * Circle sends signed webhooks to /webhooks/circle.
 * Bank feed sends wire event notifications to /webhooks/bank.
 *
 * All webhook payloads are validated with HMAC-SHA256 before processing.
 */

import type { FastifyInstance } from "fastify";
import { createHmac, timingSafeEqual } from "crypto";
import { getPrismaClient } from "@treasury/database";
import { Queue } from "bullmq";

function verifyCircleSignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature) return false;
  const cleaned = signature.startsWith("sha256=")
    ? signature.slice("sha256=".length)
    : signature;
  if (!/^[a-fA-F0-9]{64}$/.test(cleaned)) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(cleaned, "hex");

  if (expectedBuffer.length !== receivedBuffer.length) return false;

  try {
    return timingSafeEqual(expectedBuffer, receivedBuffer);
  } catch {
    return false;
  }
}

function getRawPayload(request: { rawBody?: string; body: unknown }): string {
  if (typeof request.rawBody === "string" && request.rawBody.length > 0) {
    return request.rawBody;
  }
  return JSON.stringify(request.body ?? {});
}

export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getPrismaClient();
  const mintQueue = new Queue("mint-workflow", {
    connection: { host: process.env["REDIS_HOST"] ?? "localhost", port: 6379 },
  });
  const redemptionQueue = new Queue("redemption-workflow", {
    connection: { host: process.env["REDIS_HOST"] ?? "localhost", port: 6379 },
  });

  // POST /webhooks/circle — Circle Mint API callbacks
  fastify.post<{ Body: Record<string, unknown> }>(
    "/circle",
    {
      config: { rawBody: true }, // requires rawBody plugin or body parser config
    },
    async (request, reply) => {
      const signature = String(request.headers["x-circle-signature"] ?? "");
      const timestampHeader = request.headers["x-circle-timestamp"];
      const webhookSecret = process.env["CIRCLE_WEBHOOK_SECRET"] ?? "";
      const maxSkewSec = Number(process.env["CIRCLE_WEBHOOK_MAX_SKEW_SEC"] ?? 300);

      if (webhookSecret) {
        const timestamp = Number(Array.isArray(timestampHeader) ? timestampHeader[0] : timestampHeader);
        if (Number.isFinite(timestamp)) {
          const nowSec = Math.floor(Date.now() / 1000);
          if (Math.abs(nowSec - timestamp) > maxSkewSec) {
            fastify.log.warn({ timestamp, maxSkewSec }, "Circle webhook timestamp outside allowed skew");
            return reply.code(401).send({ error: "Stale signature" });
          }
        }

        const rawBody = getRawPayload(request as unknown as { rawBody?: string; body: unknown });
        const valid = verifyCircleSignature(rawBody, signature, webhookSecret);
        if (!valid) {
          fastify.log.warn({ signature }, "Circle webhook signature mismatch");
          return reply.code(401).send({ error: "Invalid signature" });
        }
      }

      const event = request.body;
      const eventType = String(event["type"] ?? "");
      const clientRef = String((event["id"] as string | undefined) ?? "");

      // Persist delivery record with idempotency on (source, externalEventId)
      try {
        await db.webhookDelivery.create({
          data: {
            source: "circle",
            eventType,
            externalEventId: clientRef || null,
            rawPayload: event as Record<string, unknown>,
            headers: request.headers as Record<string, unknown>,
            status: "PENDING",
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Duplicate delivery should be treated as success for webhook retries.
        if (clientRef && message.includes("Unique constraint failed")) {
          return reply.code(200).send({ received: true, duplicate: true });
        }
        throw err;
      }

      fastify.log.info({ eventType, clientRef }, "Circle webhook received");

      // Trigger relevant queue job to re-check state
      if (eventType.startsWith("payment_intent")) {
        const mintReq = await db.mintRequest.findFirst({
          where: { providerRequestId: clientRef },
        });
        if (mintReq) {
          await mintQueue.add("check-mint-status", { mintRequestId: mintReq.id }, {
            priority: 1,
          });
        }
      }

      if (eventType.startsWith("transfer")) {
        const redReq = await db.redemptionRequest.findFirst({
          where: { providerRequestId: clientRef },
        });
        if (redReq) {
          await redemptionQueue.add("check-redemption-status", {
            redemptionRequestId: redReq.id,
          }, { priority: 1 });
        }
      }

      if (clientRef) {
        await db.webhookDelivery.updateMany({
          where: { source: "circle", externalEventId: clientRef },
          data: { status: "DELIVERED", processedAt: new Date() },
        });
      }

      return reply.code(200).send({ received: true });
    },
  );

  // POST /webhooks/bank — inbound wire event (bank feed / MT940 parser)
  fastify.post<{ Body: Record<string, unknown> }>("/bank", async (request, reply) => {
    const event = request.body;

    const bankAccountId = String(event["bankAccountId"] ?? "");
    if (!bankAccountId) {
      return reply.code(400).send({ error: "bankAccountId is required" });
    }

    const wireEvent = await db.wireEvent.create({
      data: {
        bankAccountId,
        reference:        String(event["referenceNumber"] ?? event["reference"] ?? ""),
        amountCents:       BigInt(String(event["amountCents"] ?? "0")),
        currency:          String(event["currency"] ?? "USD"),
        direction:         String(event["direction"] ?? "INBOUND") as "INBOUND" | "OUTBOUND",
        counterpartyName:  String(event["counterpartyName"] ?? ""),
        counterpartyAccount: String(event["counterpartyAccount"] ?? ""),
        bankReference:     String(event["bankReference"] ?? ""),
        valueDate:         event["valueDate"] ? new Date(String(event["valueDate"])) : new Date(),
        notes:             String(event["description"] ?? ""),
        status:            "UNMATCHED",
      },
    });

    // Enqueue matching job
    await mintQueue.add("match-wire-event", { wireEventId: wireEvent.id }, {
      priority: 2,
    });

    return reply.code(200).send({ received: true, wireEventId: wireEvent.id });
  });
}

/**
 * Mint Request routes
 *
 * Flow:
 *  1. POST /mint-requests         — create request (DRAFT)
 *  2. POST /mint-requests/:id/submit     — submit for approval
 *  3. (Approval happens via /approvals)
 *  4. POST /mint-requests/:id/fund       — operator confirms wire sent
 *  5. Worker polls provider and advances states automatically
 */

import type { FastifyInstance } from "fastify";
import { getPrismaClient } from "@treasury/database";
import { evaluatePolicy, screenOnChainAddress } from "@treasury/compliance";
import { FthL1Client, createFthL1ClientFromEnv } from "@treasury/providers";
import { Queue } from "bullmq";
import { z } from "zod";
import type { PolicyContext } from "@treasury/types";

// Singleton FTH L1 client — built once on module load, null if not configured
const fthL1Client: FthL1Client | null = createFthL1ClientFromEnv();

const createSchema = z.object({
  entityId:            z.string().uuid(),
  treasuryAccountId:   z.string().uuid(),
  settlementWalletId:  z.string().uuid(),
  asset:               z.enum(["USDC","USDT"]),
  network:             z.enum(["ETHEREUM","POLYGON","BASE","SOLANA","TRON","STELLAR","XRPL"]),
  requestedAmountCents: z.number().int().positive().max(50_000_000_00), // max $50M
  memo:                z.string().max(500).optional(),
});

export async function mintRequestRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getPrismaClient();
  const mintQueue = new Queue("mint-workflow", {
    connection: { host: process.env["REDIS_HOST"] ?? "localhost", port: 6379 },
  });

  fastify.addHook("onRequest", fastify.authenticate);

  // GET /mint-requests
  fastify.get<{ Querystring: { entityId?: string; status?: string; page?: string } }>(
    "/",
    async (req, reply) => {
      const page = Math.max(1, Number(req.query.page ?? 1));
      const pageSize = 25;

      const [items, total] = await Promise.all([
        db.mintRequest.findMany({
          where: {
            ...(req.query.entityId ? { entityId: req.query.entityId } : {}),
            ...(req.query.status ? { status: req.query.status as never } : {}),
          },
          include: {
            entity: { select: { legalName: true } },
            settlementWallet: { select: { label: true, address: true, network: true } },
          },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.mintRequest.count({
          where: {
            ...(req.query.entityId ? { entityId: req.query.entityId } : {}),
            ...(req.query.status ? { status: req.query.status as never } : {}),
          },
        }),
      ]);

      return reply.send({ items, total, page, pageSize });
    },
  );

  // GET /mint-requests/:id
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const mintReq = await db.mintRequest.findUnique({
      where: { id: req.params.id },
      include: {
        entity: true,
        treasuryAccount: true,
        settlementWallet: true,
        approvals: { include: { approver: { select: { name: true, email: true } } } },
        journalEntries: { include: { lines: { include: { ledgerAccount: true } } } },
        providerInstructions: true,
        transfers: true,
      },
    });
    if (!mintReq) return reply.code(404).send({ error: "Mint request not found" });
    return reply.send(mintReq);
  });

  // POST /mint-requests
  fastify.post("/", async (req, reply) => {
    const body = createSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation", message: body.error.flatten() });
    }

    const wallet = await db.wallet.findUnique({
      where: { id: body.data.settlementWalletId },
    });
    if (!wallet) return reply.code(400).send({ error: "Settlement wallet not found" });

    const amountUsd = body.data.requestedAmountCents / 100;
    const policyCtx: PolicyContext = {
      entityId:           body.data.entityId,
      amountUsd,
      asset:              body.data.asset,
      network:            body.data.network,
      destinationAddress: wallet.address,
      liveMode:           process.env["FEATURE_SANDBOX_ONLY"] !== "true",
    };

    const policy = await evaluatePolicy(policyCtx);
    if (!policy.allowed) {
      return reply.code(422).send({
        error: "PolicyViolation",
        reasons: policy.reasons,
      });
    }

    const reference = `MINT-${Date.now()}`;
    const mintReq = await db.mintRequest.create({
      data: {
        entityId:             body.data.entityId,
        treasuryAccountId:    body.data.treasuryAccountId,
        initiatedById:        (req as any).user.id,
        settlementWalletId:   body.data.settlementWalletId,
        asset:                body.data.asset,
        network:              body.data.network,
        requestedAmountCents: BigInt(body.data.requestedAmountCents),
        memo:                 body.data.memo,
        reference,
        status:               "DRAFT",
        requiresApproval:     policy.requiresApproval,
      },
    });

    return reply.code(201).send(mintReq);
  });

  // POST /mint-requests/:id/submit — move DRAFT → PENDING_APPROVAL or AWAITING_BANK_FUNDING
  fastify.post<{ Params: { id: string } }>("/:id/submit", async (req, reply) => {
    const mintReq = await db.mintRequest.findUnique({ where: { id: req.params.id } });
    if (!mintReq) return reply.code(404).send({ error: "Not found" });
    if (mintReq.status !== "DRAFT") {
      return reply.code(409).send({ error: "Can only submit a DRAFT request" });
    }

    const newStatus = mintReq.requiresApproval ? "PENDING_APPROVAL" : "AWAITING_BANK_FUNDING";
    const updated = await db.mintRequest.update({
      where: { id: req.params.id },
      data: { status: newStatus },
    });
    return reply.send(updated);
  });

  // POST /mint-requests/:id/cancel
  fastify.post<{ Params: { id: string } }>("/:id/cancel", async (req, reply) => {
    const mintReq = await db.mintRequest.findUnique({ where: { id: req.params.id } });
    if (!mintReq) return reply.code(404).send({ error: "Not found" });
    if (!(["DRAFT", "PENDING_APPROVAL", "AWAITING_BANK_FUNDING"] as string[]).includes(mintReq.status)) {
      return reply.code(409).send({ error: "Cannot cancel at this stage" });
    }

    const updated = await db.mintRequest.update({
      where: { id: req.params.id },
      data: { status: "CANCELLED" },
    });
    return reply.send(updated);
  });

  // POST /mint-requests/:id/fund — operator indicates wire was sent
  fastify.post<{ Params: { id: string }; Body: { wireReferenceNumber?: string } }>(
    "/:id/fund",
    async (req, reply) => {
      const mintReq = await db.mintRequest.findUnique({
        where:   { id: req.params.id },
        include: { settlementWallet: true },
      });
      if (!mintReq) return reply.code(404).send({ error: "Not found" });
      if (mintReq.status !== "AWAITING_BANK_FUNDING") {
        return reply.code(409).send({ error: "Request is not in AWAITING_BANK_FUNDING state" });
      }

      const sandboxMode = process.env["FEATURE_SANDBOX_ONLY"] !== "false";

      // ── On-chain address screening ──────────────────────────────────────
      const walletAddress = mintReq.settlementWallet?.address;
      if (walletAddress) {
        const screening = await screenOnChainAddress({
          address:     walletAddress,
          network:     mintReq.network,
          sandboxMode,
        });
        if (!screening.cleared) {
          return reply.code(422).send({
            error:   "AddressScreeningBlocked",
            message: "Settlement wallet address flagged by sanctions screening",
            hits:    screening.hits,
          });
        }
      }

      // ── FTH L1 TEV pre-flight ───────────────────────────────────────────
      if (fthL1Client) {
        const tevResult = await fthL1Client.verify({
          requestId:         req.params.id,
          entityId:          mintReq.entityId,
          operationType:     "MINT",
          walletAddress:     walletAddress ?? "",
          network:           mintReq.network,
          asset:             mintReq.asset as "USDC" | "USDT",
          amountCents:       mintReq.requestedAmountCents.toString(),
          externalReference: (req.body as { wireReferenceNumber?: string }).wireReferenceNumber,
        });

        await db.mintRequest.update({
          where: { id: req.params.id },
          data: {
            fthTevVerdict:   tevResult.verdict,
            fthTevScore:     tevResult.score ?? null,
            fthTevRiskTags:  tevResult.riskTags ?? [],
            fthTevReference: tevResult.receiptId ?? null,
            fthTevCheckedAt: new Date(),
          } as never,
        });

        if (tevResult.verdict === "REJECTED") {
          return reply.code(422).send({
            error:     "TevRejected",
            message:   tevResult.reason ?? "FTH L1 TEV check rejected this transaction",
            receiptId: tevResult.receiptId,
          });
        }

        if (tevResult.verdict === "DEGRADE" && fthL1Client.shouldBlockOnDegrade()) {
          return reply.code(503).send({
            error:   "TevUnavailable",
            message: "FTH L1 Runtime is unreachable and hard-block mode is enabled",
          });
        }

        // Log DEGRADE as a warning but allow the transaction to continue
        if (tevResult.degraded) {
          fastify.log.warn(
            { mintRequestId: req.params.id, tevLatencyMs: tevResult.latencyMs },
            "FTH L1 TEV degraded — proceeding without pre-flight clearance",
          );
        }
      }

      const updated = await db.mintRequest.update({
        where: { id: req.params.id },
        data: {
          status: "BANK_FUNDED",
          bankFundingReference: (req.body as { wireReferenceNumber?: string }).wireReferenceNumber,
        },
      });

      // Enqueue the mint workflow job
      await mintQueue.add("process-mint", { mintRequestId: req.params.id }, {
        jobId:    `mint-${req.params.id}`,
        attempts: 5,
        backoff:  { type: "exponential", delay: 5000 },
      });

      return reply.send(updated);
    },
  );
}

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
  entityId:          z.string().uuid(),
  treasuryAccountId: z.string().uuid(),
  sourceWalletId:    z.string().uuid(),
  bankAccountId:     z.string().uuid(),
  asset:             z.enum(["USDC","USDT"]),
  network:           z.enum(["ETHEREUM","POLYGON","BASE","SOLANA","TRON","STELLAR","XRPL"]),
  requestedUnits:    z.string().regex(/^\d+$/, "Must be a string integer"),
  memo:              z.string().max(500).optional(),
});

export async function redemptionRequestRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getPrismaClient();
  const redemptionQueue = new Queue("redemption-workflow", {
    connection: { host: process.env["REDIS_HOST"] ?? "localhost", port: 6379 },
  });

  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get<{ Querystring: { entityId?: string; status?: string; page?: string } }>(
    "/",
    async (req, reply) => {
      const page = Math.max(1, Number(req.query.page ?? 1));
      const pageSize = 25;

      const [items, total] = await Promise.all([
        db.redemptionRequest.findMany({
          where: {
            ...(req.query.entityId ? { entityId: req.query.entityId } : {}),
            ...(req.query.status ? { status: req.query.status as never } : {}),
          },
          include: {
            entity: { select: { legalName: true } },
            bankAccount: { select: { bankName: true, accountName: true } },
            sourceWallet: { select: { label: true, address: true, network: true } },
          },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.redemptionRequest.count({
          where: {
            ...(req.query.entityId ? { entityId: req.query.entityId } : {}),
            ...(req.query.status ? { status: req.query.status as never } : {}),
          },
        }),
      ]);

      return reply.send({ items, total, page, pageSize });
    },
  );

  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const redReq = await db.redemptionRequest.findUnique({
      where: { id: req.params.id },
      include: {
        entity: true,
        bankAccount: true,
        sourceWallet: true,
        approvals: { include: { approver: { select: { name: true, email: true } } } },
        journalEntries: { include: { lines: { include: { ledgerAccount: true } } } },
        providerInstructions: true,
      },
    });
    if (!redReq) return reply.code(404).send({ error: "Redemption request not found" });
    return reply.send(redReq);
  });

  fastify.post("/", async (req, reply) => {
    const body = createSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation", message: body.error.flatten() });
    }

    const wallet = await db.wallet.findUnique({ where: { id: body.data.sourceWalletId } });
    if (!wallet) return reply.code(400).send({ error: "Source wallet not found" });

    // 1 USDC = 1_000_000 units (6 decimals), ≈ $1.00 → 100 cents
    const requestedUnits = BigInt(body.data.requestedUnits);
    const policyCtx: PolicyContext = {
      entityId: body.data.entityId,
      amountCents: BigInt(Math.round((Number(requestedUnits) / 1_000_000) * 100)),
      asset: body.data.asset,
    };

    const policy = await evaluatePolicy(policyCtx);
    if (!policy.allowed) {
      return reply.code(422).send({ error: "PolicyViolation", reasons: policy.blockedReasons });
    }

    const reference = `REDEEM-${Date.now()}`;
    const amountUsd = Number(requestedUnits) / 1_000_000;
    const redReq = await db.redemptionRequest.create({
      data: {
        entityId:          body.data.entityId,
        treasuryAccountId: body.data.treasuryAccountId,
        initiatedById:     (req.user as { sub: string }).sub,
        sourceWalletId:    body.data.sourceWalletId,
        bankAccountId:     body.data.bankAccountId,
        asset:             body.data.asset,
        network:           body.data.network,
        requestedUnits,
        expectedFiatCents: BigInt(Math.round(amountUsd * 100)),
        reference,
        status:            "DRAFT",
        requiresApproval:  policy.requiresDualApproval,
        ...(body.data.memo ? { memo: body.data.memo } : {}),
      },
    });

    return reply.code(201).send(redReq);
  });

  fastify.post<{ Params: { id: string } }>("/:id/submit", async (req, reply) => {
    const redReq = await db.redemptionRequest.findUnique({
      where:   { id: req.params.id },
      include: { sourceWallet: true },
    });
    if (!redReq) return reply.code(404).send({ error: "Not found" });
    if (redReq.status !== "DRAFT") {
      return reply.code(409).send({ error: "Can only submit a DRAFT request" });
    }

    const sandboxMode = process.env["FEATURE_SANDBOX_ONLY"] !== "false";

    // ── On-chain address screening ────────────────────────────────────────
    const walletAddress = redReq.sourceWallet?.address;
    if (walletAddress) {
      const screening = await screenOnChainAddress({
        address: walletAddress,
        network: redReq.network ?? "ETHEREUM",
        sandboxMode,
      });
      if (!screening.cleared) {
        return reply.code(422).send({
          error:   "AddressScreeningBlocked",
          message: "Source wallet address flagged by sanctions screening",
          hits:    screening.hits,
        });
      }
    }

    // ── FTH L1 TEV pre-flight ────────────────────────────────────────────
    if (fthL1Client) {
      const amountUsd = Number(redReq.requestedUnits) / 1_000_000;
      const tevResult = await fthL1Client.verify({
        requestId:     req.params.id,
        entityId:      redReq.entityId,
        operationType: "REDEMPTION",
        walletAddress: walletAddress ?? "",
        network:       redReq.network ?? "ETHEREUM",
        asset:         redReq.asset as "USDC" | "USDT",
        amountCents:   String(Math.round(amountUsd * 100)),
      });

      await db.redemptionRequest.update({
        where: { id: req.params.id },
        data: {
          fthTevVerdict:   tevResult.verdict,
          fthTevScore:     tevResult.score ?? null,
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

      if (tevResult.degraded) {
        fastify.log.warn(
          { redemptionRequestId: req.params.id, tevLatencyMs: tevResult.latencyMs },
          "FTH L1 TEV degraded — proceeding without pre-flight clearance",
        );
      }
    }

    const newStatus = redReq.requiresApproval ? "PENDING_APPROVAL" : "SUBMITTED_TO_PROVIDER";
    const updated = await db.redemptionRequest.update({
      where: { id: req.params.id },
      data: { status: newStatus },
    });

    if (newStatus === "SUBMITTED_TO_PROVIDER") {
      await redemptionQueue.add("process-redemption", { redemptionRequestId: req.params.id }, {
        jobId:    `redemption-${req.params.id}`,
        attempts: 5,
        backoff:  { type: "exponential", delay: 5000 },
      });
    }

    return reply.send(updated);
  });

  fastify.post<{ Params: { id: string } }>("/:id/cancel", async (req, reply) => {
    const redReq = await db.redemptionRequest.findUnique({ where: { id: req.params.id } });
    if (!redReq) return reply.code(404).send({ error: "Not found" });
    if (!(["DRAFT", "PENDING_APPROVAL"] as string[]).includes(redReq.status)) {
      return reply.code(409).send({ error: "Cannot cancel at this stage" });
    }
    const updated = await db.redemptionRequest.update({
      where: { id: req.params.id },
      data: { status: "CANCELLED" },
    });
    return reply.send(updated);
  });
}

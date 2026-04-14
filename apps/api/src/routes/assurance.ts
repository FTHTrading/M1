/**
 * Assurance OS API routes
 *
 * All endpoints are read-heavy — the audit job persists data and these
 * routes serve it to the dashboard.
 *
 * Endpoints:
 *   GET  /overview                      — latest run summary for dashboard
 *   POST /runs                          — trigger a new audit run
 *   GET  /runs                          — list all runs (paginated)
 *   GET  /runs/:id                      — run header + scores
 *   GET  /runs/:id/capabilities         — capability assessments
 *   GET  /runs/:id/claims               — claim assessments
 *   GET  /runs/:id/gaps                 — gap items
 *   GET  /runs/:id/snapshot             — full JSON snapshot for export
 */

import type { FastifyInstance } from "fastify";
import { getPrismaClient } from "@treasury/database";
import { Queue } from "bullmq";

const PAGE_SIZE = 50;

export async function assuranceRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getPrismaClient();

  const auditQueue = new Queue("audit-workflow", {
    connection: {
      host: process.env["REDIS_HOST"] ?? "localhost",
      port: Number(process.env["REDIS_PORT"] ?? 6379),
      password: process.env["REDIS_PASSWORD"],
    },
  });

  fastify.addHook("onRequest", fastify.authenticate);

  // ── GET /overview ─────────────────────────────────────────────────────────

  fastify.get("/overview", async (_req, reply) => {
    // Get the most recently completed run
    const run = await db.auditRun.findFirst({
      where: { status: "COMPLETED" },
      orderBy: { completedAt: "desc" },
      include: {
        ratingScores: { orderBy: { score: "desc" } },
        gapItems: {
          where: { resolved: false },
          orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
          take: 5,
        },
      },
    });

    if (!run) {
      return reply.send({
        hasRun: false,
        message: "No completed audit runs. Trigger a run via POST /assurance/runs.",
      });
    }

    // Claim support distribution
    const claimAgg = await db.claimAssessment.groupBy({
      by: ["support"],
      where: { auditRunId: run.id },
      _count: { support: true },
    });

    const claimDist = Object.fromEntries(
      claimAgg.map((row) => [row.support, row._count.support]),
    );

    // Capability status distribution
    const capAgg = await db.capabilityAssessment.groupBy({
      by: ["status"],
      where: { auditRunId: run.id },
      _count: { status: true },
    });

    const capDist = Object.fromEntries(
      capAgg.map((row) => [row.status, row._count.status]),
    );

    // Gap severity counts
    const gapAgg = await db.assuranceGapItem.groupBy({
      by: ["severity"],
      where: { auditRunId: run.id, resolved: false },
      _count: { severity: true },
    });

    const gapDist = Object.fromEntries(
      gapAgg.map((row) => [row.severity, row._count.severity]),
    );

    return reply.send({
      hasRun: true,
      runId: run.id,
      overallScore: run.overallScore,
      ratingTier: run.ratingTier,
      completedAt: run.completedAt,
      categoryScores: run.ratingScores,
      topGaps: run.gapItems,
      claimDistribution: claimDist,
      capabilityDistribution: capDist,
      gapDistribution: gapDist,
    });
  });

  // ── POST /runs ────────────────────────────────────────────────────────────

  fastify.post("/runs", async (req, reply) => {
    const user = (req as { user?: { id?: string } }).user;

    // Create a QUEUED run record
    const run = await db.auditRun.create({
      data: {
        status: "QUEUED",
        triggeredBy: user?.id ?? "api",
      },
    });

    // Enqueue the audit job
    await auditQueue.add(
      "run-audit",
      { auditRunId: run.id },
      { attempts: 2, backoff: { type: "exponential", delay: 5000 } },
    );

    return reply.status(202).send({
      auditRunId: run.id,
      status: "QUEUED",
      message: "Audit run queued. Poll GET /assurance/runs/:id for status.",
    });
  });

  // ── GET /runs ─────────────────────────────────────────────────────────────

  fastify.get<{ Querystring: { page?: string } }>("/runs", async (req, reply) => {
    const page = Math.max(1, Number(req.query.page ?? 1));

    const [items, total] = await Promise.all([
      db.auditRun.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          status: true,
          overallScore: true,
          ratingTier: true,
          triggeredBy: true,
          startedAt: true,
          completedAt: true,
          createdAt: true,
          schemaVersion: true,
          _count: {
            select: {
              capabilities: true,
              claims: true,
              gapItems: true,
            },
          },
        },
      }),
      db.auditRun.count(),
    ]);

    return reply.send({ items, total, page, pageSize: PAGE_SIZE });
  });

  // ── GET /runs/:id ─────────────────────────────────────────────────────────

  fastify.get<{ Params: { id: string } }>("/runs/:id", async (req, reply) => {
    const run = await db.auditRun.findUnique({
      where: { id: req.params.id },
      include: {
        ratingScores: { orderBy: { weight: "desc" } },
        _count: {
          select: { capabilities: true, claims: true, gapItems: true },
        },
      },
    });

    if (!run) return reply.status(404).send({ error: "Audit run not found" });
    return reply.send(run);
  });

  // ── GET /runs/:id/capabilities ────────────────────────────────────────────

  fastify.get<{
    Params: { id: string };
    Querystring: { category?: string; status?: string };
  }>("/runs/:id/capabilities", async (req, reply) => {
    const caps = await db.capabilityAssessment.findMany({
      where: {
        auditRunId: req.params.id,
        ...(req.query.category ? { category: req.query.category } : {}),
        ...(req.query.status ? { status: req.query.status as never } : {}),
      },
      include: { evidence: true },
      orderBy: [{ category: "asc" }, { maturityScore: "desc" }],
    });

    return reply.send({ items: caps, total: caps.length });
  });

  // ── GET /runs/:id/claims ──────────────────────────────────────────────────

  fastify.get<{
    Params: { id: string };
    Querystring: { support?: string; category?: string };
  }>("/runs/:id/claims", async (req, reply) => {
    const claims = await db.claimAssessment.findMany({
      where: {
        auditRunId: req.params.id,
        ...(req.query.support ? { support: req.query.support as never } : {}),
        ...(req.query.category ? { category: req.query.category } : {}),
      },
      orderBy: [{ support: "asc" }, { category: "asc" }],
    });

    return reply.send({ items: claims, total: claims.length });
  });

  // ── GET /runs/:id/gaps ────────────────────────────────────────────────────

  fastify.get<{
    Params: { id: string };
    Querystring: { severity?: string; resolved?: string };
  }>("/runs/:id/gaps", async (req, reply) => {
    const resolved =
      req.query.resolved === "true"
        ? true
        : req.query.resolved === "false"
        ? false
        : undefined;

    const gaps = await db.assuranceGapItem.findMany({
      where: {
        auditRunId: req.params.id,
        ...(req.query.severity ? { severity: req.query.severity as never } : {}),
        ...(resolved !== undefined ? { resolved } : {}),
      },
      orderBy: [{ severity: "asc" }, { createdAt: "asc" }],
    });

    return reply.send({ items: gaps, total: gaps.length });
  });

  // ── PATCH /runs/:runId/gaps/:gapId/resolve ────────────────────────────────

  fastify.patch<{
    Params: { runId: string; gapId: string };
    Body: { note?: string };
  }>("/runs/:runId/gaps/:gapId/resolve", async (req, reply) => {
    const gap = await db.assuranceGapItem.updateMany({
      where: { id: req.params.gapId, auditRunId: req.params.runId },
      data: {
        resolved: true,
        resolvedAt: new Date(),
        ...(req.body.note ? { resolvedNote: req.body.note } : {}),
      },
    });

    if (gap.count === 0) return reply.status(404).send({ error: "Gap not found" });
    return reply.send({ resolved: true });
  });

  // ── GET /runs/:id/snapshot ────────────────────────────────────────────────

  fastify.get<{ Params: { id: string } }>("/runs/:id/snapshot", async (req, reply) => {
    const snapshot = await db.auditSnapshot.findUnique({
      where: { auditRunId: req.params.id },
    });

    if (!snapshot) {
      return reply.status(404).send({ error: "Snapshot not yet available for this run" });
    }

    return reply
      .header("Content-Type", "application/json")
      .header(
        "Content-Disposition",
        `attachment; filename="audit-snapshot-${req.params.id}.json"`,
      )
      .send(snapshot.payload);
  });
}

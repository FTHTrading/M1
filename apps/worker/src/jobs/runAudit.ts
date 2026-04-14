/**
 * Audit pipeline job
 *
 * Runs the full M1 Assurance OS audit pipeline for a single AuditRun:
 *  1. Marks the run RUNNING
 *  2. Collects filesystem evidence (schema models, API routes, packages, docs)
 *  3. Scores all 41 capabilities against the evidence
 *  4. Derives claim support from capability statuses
 *  5. Computes category scores and overall score
 *  6. Persists all results to the database
 *  7. Creates a full JSON snapshot with SHA-256 checksum
 *  8. Marks the run COMPLETED (or FAILED on error)
 */

import crypto from "crypto";
import type { Job } from "bullmq";
import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "@treasury/database";
import {
  collectAllEvidence,
  runAuditPipeline,
  CAPABILITY_REGISTRY,
  CLAIMS_REGISTRY,
  GAP_REGISTRY,
} from "@treasury/audit";

const SCHEMA_VERSION = "1.0.0";

export async function runAuditJob(
  job: Job<{ auditRunId: string; repoRoot?: string }>,
): Promise<void> {
  const db = getPrismaClient();
  const { auditRunId, repoRoot } = job.data;
  const log = (msg: string) => job.log(msg);

  await log(`[audit] starting run ${auditRunId}`);

  // ── Step 1: Mark RUNNING ──────────────────────────────────────────────────

  await db.auditRun.update({
    where: { id: auditRunId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  try {
    // ── Step 2: Collect evidence ────────────────────────────────────────────

    await log("[audit] collecting filesystem evidence...");
    const evidence = await collectAllEvidence(repoRoot ?? process.cwd());

    await log(
      `[audit] evidence collected: ${evidence.prismaModels.length} models, ` +
        `${evidence.apiRouteFiles.length} routes, ${evidence.packageDirs.length} packages, ` +
        `${evidence.docFiles.length} docs, ${evidence.workerJobFiles.length} worker jobs`,
    );

    // ── Step 3–5: Run the audit pipeline ────────────────────────────────────

    await log("[audit] running scoring pipeline...");
    const result = runAuditPipeline(
      evidence,
      CAPABILITY_REGISTRY,
      CLAIMS_REGISTRY,
      GAP_REGISTRY,
    );

    await log(
      `[audit] pipeline complete: score=${result.overallScore.toFixed(1)}, ` +
        `tier=${result.ratingTier}, caps=${result.capabilities.length}, ` +
        `claims=${result.claims.length}, gaps=${result.gaps.length}`,
    );

    // ── Step 6: Persist results ──────────────────────────────────────────────

    await log("[audit] persisting capability assessments...");

    await db.$transaction(async (tx) => {
      // Capability assessments + evidence items
      for (const cap of result.capabilities) {
        const assessment = await tx.capabilityAssessment.create({
          data: {
            auditRunId,
            capabilityKey: cap.key,
            category: cap.category,
            title: cap.title,
            description: cap.description,
            status: cap.status,
            maturityScore: Math.round(cap.maturityScore),
            confidence: cap.confidence,
            evidenceSummary: cap.evidenceSummary,
            gaps: cap.gaps,
            ...(cap.notes ? { notes: cap.notes } : {}),
          },
        });

        if (cap.evidenceItems.length > 0) {
          await tx.capabilityEvidenceItem.createMany({
            data: cap.evidenceItems.map((ei) => ({
              assessmentId: assessment.id,
              evidenceType: ei.type,
              reference: ei.reference,
              description: ei.description,
              found: ei.found,
              weight: ei.weight,
            })),
          });
        }
      }

      // Claim assessments
      if (result.claims.length > 0) {
        await tx.claimAssessment.createMany({
          data: result.claims.map((cl) => ({
            auditRunId,
            claimKey: cl.key,
            category: cl.category,
            claim: cl.claim,
            source: cl.source,
            support: cl.support,
            confidence: cl.confidence,
            evidenceRefs: cl.evidenceRefs,
            analystNote: cl.analystNote,
          })),
        });
      }

      // Gap items
      if (result.gaps.length > 0) {
        await tx.assuranceGapItem.createMany({
          data: result.gaps.map((g) => ({
            auditRunId,
            gapKey: g.gapKey,
            severity: g.severity === "RESOLVED" ? "INFORMATIONAL" : g.severity,
            category: g.category,
            title: g.title,
            description: g.description,
            affectedClaims: g.affectedClaims,
            remediation: g.remediation,
            effortEstimate: g.effortEstimate,
            externalDep: g.externalDep,
            resolved: g.severity === "RESOLVED",
          })),
        });
      }

      // Category rating scores
      if (result.categoryScores.length > 0) {
        await tx.assuranceRatingScore.createMany({
          data: result.categoryScores.map((cs) => ({
            auditRunId,
            category: cs.category,
            label: cs.label,
            score: Math.round(cs.score),
            weight: cs.weight,
            tier: cs.tier,
            notes: cs.notes,
          })),
        });
      }

      // Update the run header
      await tx.auditRun.update({
        where: { id: auditRunId },
        data: {
          status: "COMPLETED",
          overallScore: Math.round(result.overallScore),
          ratingTier: result.ratingTier,
          completedAt: new Date(),
          schemaVersion: SCHEMA_VERSION,
        },
      });
    });

    // ── Step 7: Snapshot ─────────────────────────────────────────────────────

    await log("[audit] creating audit snapshot...");

    const snapshotPayload = {
      ...result,
      auditRunId,
      schemaVersion: SCHEMA_VERSION,
    };

    const payloadJson = JSON.stringify(snapshotPayload, null, 2);
    const payloadValue = JSON.parse(payloadJson) as Prisma.InputJsonValue;
    const checksum = crypto.createHash("sha256").update(payloadJson).digest("hex");

    await db.auditSnapshot.upsert({
      where: { auditRunId },
      create: {
        auditRunId,
        payload: payloadValue,
        checksum,
      },
      update: {
        payload: payloadValue,
        checksum,
      },
    });

    await log(
      `[audit] run ${auditRunId} completed successfully. ` +
        `Score: ${Math.round(result.overallScore)} / 100, Tier: ${result.ratingTier}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[audit] run ${auditRunId} FAILED:`, message);

    await db.auditRun.update({
      where: { id: auditRunId },
      data: { status: "FAILED", errorMessage: message },
    }).catch(() => {
      // Best-effort — don't mask the original error
    });

    throw err; // Re-throw so BullMQ records the failure
  }
}

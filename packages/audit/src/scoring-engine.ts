/**
 * M1 Assurance OS — Scoring Engine
 *
 * Runs the full assessment pipeline:
 *  1. Maps collected evidence onto capability definitions
 *  2. Adjusts maturity scores and confidence based on found/missing evidence
 *  3. Derives claim support status from capability statuses
 *  4. Computes weighted category scores
 *  5. Derives overall score and RatingTier
 *  6. Selects relevant gap items
 */

import type {
  CollectedEvidence,
  CapabilityDefinition,
  CapabilityStatus,
  ConfidenceLevel,
  ClaimDefinition,
  ClaimSupportStatus,
  GapDefinition,
  AssessedCapability,
  AssessedClaim,
  AssessedEvidenceItem,
  CategoryScore,
  AssuranceGapItem,
  AuditResult,
  RatingTier,
  CapabilityCategory,
} from "./types.js";

// ─── Category metadata ────────────────────────────────────────────────────────

interface CategoryMeta {
  label: string;
  weight: number;
}

const CATEGORY_META: Record<CapabilityCategory, CategoryMeta> = {
  CORE_INFRASTRUCTURE:    { label: "Core Infrastructure",     weight: 2.0 },
  FINANCIAL_CONTROLS:     { label: "Financial Controls",      weight: 2.0 },
  COMPLIANCE_AND_AML:     { label: "Compliance & AML",        weight: 1.8 },
  OPERATIONAL_WORKFLOW:   { label: "Operational Workflow",    weight: 1.5 },
  PROVIDER_INTEGRATION:   { label: "Provider Integration",    weight: 1.5 },
  MONITORING_AND_REPORTING: { label: "Monitoring & Reporting", weight: 1.0 },
  CHAIN_AND_SETTLEMENT:   { label: "Chain & Settlement",      weight: 1.2 },
  AI_AND_EXTERNAL:        { label: "AI & External Systems",   weight: 0.8 },
};

// ─── Evidence resolution ──────────────────────────────────────────────────────

function evidencePresent(
  type: string,
  key: string,
  evidence: CollectedEvidence,
): boolean {
  switch (type) {
    case "schema_model":  return evidence.prismaModels.includes(key);
    case "schema_enum":   return evidence.prismaEnums.includes(key);
    case "api_route":     return evidence.apiRouteFiles.some((f) =>
      f.toLowerCase() === key.toLowerCase() ||
      f.toLowerCase().startsWith(key.toLowerCase())
    );
    case "package_file":  return evidence.packageDirs.includes(key);
    case "doc_file":      return evidence.docFiles.some((f) =>
      f.toLowerCase().includes(key.toLowerCase())
    );
    case "worker_job":    return evidence.workerJobFiles.some((f) =>
      f.toLowerCase().includes(key.toLowerCase())
    );
    default:              return false;
  }
}

// ─── Capability assessment ────────────────────────────────────────────────────

const MISSING_REQUIRED_PENALTY = 10;
const CONFIDENCE_PENALTY_FROM_MISSING = 1; // levels to drop per missing required

function confidenceDrop(
  base: ConfidenceLevel,
  drops: number,
): ConfidenceLevel {
  const order: ConfidenceLevel[] = ["HIGH", "MEDIUM", "LOW", "NONE"];
  const idx = order.indexOf(base);
  return order[Math.min(order.length - 1, idx + drops)] ?? "NONE";
}

export function assessCapability(
  def: CapabilityDefinition,
  evidence: CollectedEvidence,
): AssessedCapability {
  const evidenceItems: AssessedEvidenceItem[] = def.evidenceDependencies.map(
    (dep) => {
      const found = evidencePresent(dep.type, dep.key, evidence);
      return {
        type: dep.type,
        reference: `${dep.type}:${dep.key}`,
        description: `${dep.type.replace(/_/g, " ")} — ${dep.key}`,
        found,
        weight: dep.scoreBoost,
      };
    },
  );

  let score = def.baseMaturityScore;
  let missingRequiredCount = 0;

  for (const item of evidenceItems) {
    const dep = def.evidenceDependencies.find(
      (d) => `${d.type}:${d.key}` === item.reference,
    );
    if (!dep) continue;

    if (item.found) {
      score += dep.scoreBoost;
    } else if (dep.required) {
      score -= MISSING_REQUIRED_PENALTY;
      missingRequiredCount++;
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // Adjust confidence downward for each missing required dependency
  const confidence = confidenceDrop(
    def.baseConfidence,
    missingRequiredCount * CONFIDENCE_PENALTY_FROM_MISSING,
  );

  // If score drops significantly, downgrade status
  let status: CapabilityStatus = def.baseStatus;
  if (def.baseStatus === "LIVE" && score < 60) status = "PARTIAL";
  if (def.baseStatus === "LIVE" && score < 40) status = "SIMULATED";
  if (def.baseStatus === "IMPLEMENTED" && score < 40) status = "PARTIAL";

  // Summarise found evidence
  const foundRefs = evidenceItems.filter((e) => e.found).map((e) => e.reference);
  const missingRefs = evidenceItems
    .filter((e) => !e.found && def.evidenceDependencies.find((d) => `${d.type}:${d.key}` === e.reference)?.required)
    .map((e) => e.reference);

  const evidenceSummary = [
    foundRefs.length > 0 ? `Confirmed: ${foundRefs.join(", ")}` : null,
    missingRefs.length > 0 ? `Missing required: ${missingRefs.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(". ") || "No direct evidence dependencies defined — using analyst baseline.";

  return {
    key: def.key,
    category: def.category,
    title: def.title,
    description: def.description,
    status,
    confidence,
    maturityScore: score,
    evidenceSummary,
    evidenceItems,
    gaps: def.gaps,
    notes: def.notes,
  };
}

// ─── Claim assessment ─────────────────────────────────────────────────────────

const LIVE_STATUSES: CapabilityStatus[] = ["LIVE", "IMPLEMENTED"];
const PARTIAL_STATUSES: CapabilityStatus[] = ["PARTIAL"];
const WEAK_STATUSES: CapabilityStatus[] = ["SIMULATED"];
const DOC_ONLY_STATUSES: CapabilityStatus[] = ["DOCUMENTED_ONLY"];

export function assessClaim(
  def: ClaimDefinition,
  assessedCapabilities: AssessedCapability[],
): AssessedClaim {
  const deps = assessedCapabilities.filter((c) =>
    def.supportedByCapabilities.includes(c.key),
  );

  if (deps.length === 0) {
    return {
      key: def.key,
      category: def.category,
      claim: def.claim,
      source: def.source,
      support: "CANNOT_VERIFY",
      confidence: "NONE",
      evidenceRefs: [],
      analystNote: def.analystNote ?? "No supporting capabilities defined.",
    };
  }

  const total = deps.length;
  const liveCount   = deps.filter((c) => LIVE_STATUSES.includes(c.status)).length;
  const partialCount = deps.filter((c) => PARTIAL_STATUSES.includes(c.status)).length;
  const weakCount   = deps.filter((c) => WEAK_STATUSES.includes(c.status)).length;
  const docOnlyCount = deps.filter((c) => DOC_ONLY_STATUSES.includes(c.status)).length;

  let support: ClaimSupportStatus;
  if (liveCount / total >= 0.8) {
    support = "SUPPORTED";
  } else if (liveCount / total >= 0.5) {
    support = "PARTIALLY_SUPPORTED";
  } else if ((liveCount + partialCount) / total >= 0.3) {
    support = "PARTIALLY_SUPPORTED";
  } else if (docOnlyCount / total >= 0.5) {
    support = "MARKETING_ONLY";
  } else if (weakCount / total >= 0.5) {
    support = "WEAKLY_SUPPORTED";
  } else if (liveCount + partialCount > 0) {
    support = "WEAKLY_SUPPORTED";
  } else {
    support = "UNSUPPORTED";
  }

  // Derive confidence from supporting capabilities
  const highConfCount = deps.filter((c) => c.confidence === "HIGH").length;
  const medConfCount  = deps.filter((c) => c.confidence === "MEDIUM").length;
  let confidence: ConfidenceLevel;
  if (highConfCount / total >= 0.7) {
    confidence = "HIGH";
  } else if ((highConfCount + medConfCount) / total >= 0.5) {
    confidence = "MEDIUM";
  } else {
    confidence = "LOW";
  }

  const evidenceRefs = deps.map((d) => d.key);

  return {
    key: def.key,
    category: def.category,
    claim: def.claim,
    source: def.source,
    support,
    confidence,
    evidenceRefs,
    analystNote: def.analystNote ?? "",
  };
}

// ─── Rating tier mapping ──────────────────────────────────────────────────────

export function scoreToTier(score: number): RatingTier {
  if (score >= 90) return "AAA";
  if (score >= 80) return "AA";
  if (score >= 70) return "A";
  if (score >= 60) return "BBB";
  if (score >= 50) return "BB";
  if (score >= 40) return "B";
  return "C";
}

// ─── Category scoring ─────────────────────────────────────────────────────────

const CONFIDENCE_WEIGHT: Record<ConfidenceLevel, number> = {
  HIGH:   1.0,
  MEDIUM: 0.8,
  LOW:    0.5,
  NONE:   0.2,
};

export function computeCategoryScores(
  capabilities: AssessedCapability[],
): CategoryScore[] {
  const categories = Object.keys(CATEGORY_META) as CapabilityCategory[];

  return categories.map((cat) => {
    const meta = CATEGORY_META[cat];
    const caps = capabilities.filter((c) => c.category === cat);

    if (caps.length === 0) {
      return {
        category: cat,
        label: meta.label,
        score: 0,
        weight: meta.weight,
        tier: "C" as RatingTier,
        notes: "No capabilities defined for this category.",
      };
    }

    // Weighted average by confidence
    let weightedSum = 0;
    let totalWeight = 0;
    for (const cap of caps) {
      const w = CONFIDENCE_WEIGHT[cap.confidence];
      weightedSum += cap.maturityScore * w;
      totalWeight += w;
    }
    const score = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
    const tier = scoreToTier(score);

    const notes = caps
      .filter((c) => c.maturityScore < 60)
      .map((c) => `${c.title} (${c.maturityScore})`)
      .join("; ");

    return {
      category: cat,
      label: meta.label,
      score,
      weight: meta.weight,
      tier,
      notes: notes || "All capabilities meet or exceed threshold.",
    };
  });
}

// ─── Overall score ────────────────────────────────────────────────────────────

export function computeOverallScore(categoryScores: CategoryScore[]): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const cat of categoryScores) {
    weightedSum += cat.score * cat.weight;
    totalWeight += cat.weight;
  }
  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
}

// ─── Full audit pipeline ──────────────────────────────────────────────────────

export function runAuditPipeline(
  evidence: CollectedEvidence,
  capabilityDefs: CapabilityDefinition[],
  claimDefs: ClaimDefinition[],
  gapDefs: GapDefinition[],
): AuditResult {
  const capabilities = capabilityDefs.map((def) => assessCapability(def, evidence));
  const claims = claimDefs.map((def) => assessClaim(def, capabilities));
  const categoryScores = computeCategoryScores(capabilities);
  const overallScore = computeOverallScore(categoryScores);
  const ratingTier = scoreToTier(overallScore);

  // Build gap items — include all seeded gaps
  const gaps: AssuranceGapItem[] = gapDefs.map((g) => ({
    gapKey: g.gapKey,
    severity: g.severity,
    category: g.category,
    title: g.title,
    description: g.description,
    affectedClaims: g.affectedClaims,
    remediation: g.remediation,
    effortEstimate: g.effortEstimate,
    externalDep: g.externalDep,
  }));

  // Also generate dynamic gaps for capabilities with no evidence at all
  for (const cap of capabilities) {
    const hasNoEvidence = cap.evidenceItems.every((e) => !e.found) &&
      cap.evidenceItems.length > 0;
    const alreadyHasGap = gapDefs.some((g) =>
      g.affectedClaims.length === 0 && g.gapKey.includes(cap.key),
    );

    if (hasNoEvidence && !alreadyHasGap && cap.maturityScore < 50) {
      gaps.push({
        gapKey: `gap_no_evidence_${cap.key}`,
        severity: "HIGH",
        category: cap.category,
        title: `No Evidence Found: ${cap.title}`,
        description: `All expected evidence dependencies returned no matches for capability "${cap.title}". Expected items: ${cap.evidenceItems.map((e) => e.reference).join(", ")}.`,
        affectedClaims: [],
        remediation: `Verify that the evidence items exist in the repository root and that the audit is being run from the correct directory.`,
        effortEstimate: "days",
        externalDep: false,
      });
    }
  }

  return {
    overallScore,
    ratingTier,
    capabilities,
    claims,
    categoryScores,
    gaps,
    evidence,
    collectedAt: new Date().toISOString(),
    schemaVersion: "1.0.0",
  };
}

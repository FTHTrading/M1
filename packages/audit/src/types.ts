/**
 * M1 Assurance OS — Core Type Definitions
 *
 * All types are self-contained (no Prisma dependency) so the audit engine
 * can run as a pure compute layer. Persistence is handled by the worker.
 */

// ─── Status enums ─────────────────────────────────────────────────────────────

export type CapabilityStatus =
  | "LIVE"
  | "IMPLEMENTED"
  | "PARTIAL"
  | "SIMULATED"
  | "DOCUMENTED_ONLY"
  | "MISSING";

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export type ClaimSupportStatus =
  | "SUPPORTED"
  | "PARTIALLY_SUPPORTED"
  | "WEAKLY_SUPPORTED"
  | "UNSUPPORTED"
  | "MARKETING_ONLY"
  | "CANNOT_VERIFY";

export type GapSeverity =
  | "CRITICAL"
  | "HIGH"
  | "MEDIUM"
  | "LOW"
  | "INFORMATIONAL"
  | "RESOLVED";

export type RatingTier = "AAA" | "AA" | "A" | "BBB" | "BB" | "B" | "C";

export type EvidenceType =
  | "schema_model"
  | "schema_enum"
  | "api_route"
  | "package_file"
  | "doc_file"
  | "worker_job";

// ─── Registry definitions (static, seeded) ────────────────────────────────────

export interface EvidenceDependency {
  /** Type of evidence to look for */
  type: EvidenceType;
  /**
   * Key to search for.
   * - schema_model / schema_enum → exact model/enum name (e.g. "MintRequest")
   * - api_route → route filename stem (e.g. "mintRequests")
   * - package_file → package dir name (e.g. "compliance", "ledger")
   * - doc_file      → filename stem (e.g. "reconciliation-methodology")
   * - worker_job    → job filename stem (e.g. "processMint")
   */
  key: string;
  /** If true, missing evidence penalises the capability score */
  required: boolean;
  /** Score boost (0–15) added when this evidence is confirmed present */
  scoreBoost: number;
}

export interface CapabilityDefinition {
  key: string;
  category: CapabilityCategory;
  title: string;
  description: string;
  /** Baseline status from analyst knowledge — adjusted by evidence collection */
  baseStatus: CapabilityStatus;
  /** Baseline maturity score 0–100 */
  baseMaturityScore: number;
  /** Baseline confidence — adjusted by evidence collection */
  baseConfidence: ConfidenceLevel;
  /** Evidence items that raise/lower the score at runtime */
  evidenceDependencies: EvidenceDependency[];
  /** Known architectural gaps associated with this capability */
  gaps: string[];
  notes?: string;
}

export type CapabilityCategory =
  | "CORE_INFRASTRUCTURE"
  | "FINANCIAL_CONTROLS"
  | "COMPLIANCE_AND_AML"
  | "OPERATIONAL_WORKFLOW"
  | "PROVIDER_INTEGRATION"
  | "MONITORING_AND_REPORTING"
  | "CHAIN_AND_SETTLEMENT"
  | "AI_AND_EXTERNAL";

export interface ClaimDefinition {
  key: string;
  category: string;
  /** Verbatim public-facing claim */
  claim: string;
  /** Source document */
  source: string;
  /** Capability keys whose statuses drive the support derivation */
  supportedByCapabilities: string[];
  analystNote?: string;
}

export interface GapDefinition {
  gapKey: string;
  severity: GapSeverity;
  category: CapabilityCategory;
  title: string;
  description: string;
  affectedClaims: string[];
  remediation: string;
  effortEstimate: "days" | "weeks" | "months";
  externalDep: boolean;
  /** ISO date string (YYYY-MM-DD) when gap was resolved */
  resolvedAt?: string;
}

// ─── Collected evidence (runtime) ─────────────────────────────────────────────

export interface CollectedEvidence {
  prismaModels: string[];   // model names found in schema
  prismaEnums: string[];    // enum names found
  apiRouteFiles: string[];  // route file stems
  packageDirs: string[];    // packages/ directory names
  docFiles: string[];       // doc file stems
  workerJobFiles: string[]; // worker job file stems
}

// ─── Assessed results (runtime) ───────────────────────────────────────────────

export interface AssessedEvidenceItem {
  type: EvidenceType;
  reference: string;
  description: string;
  found: boolean;
  weight: number;
}

export interface AssessedCapability {
  key: string;
  category: CapabilityCategory;
  title: string;
  description: string;
  status: CapabilityStatus;
  confidence: ConfidenceLevel;
  maturityScore: number;
  evidenceSummary: string;
  evidenceItems: AssessedEvidenceItem[];
  gaps: string[];
  notes?: string;
}

export interface AssessedClaim {
  key: string;
  category: string;
  claim: string;
  source: string;
  support: ClaimSupportStatus;
  confidence: ConfidenceLevel;
  evidenceRefs: string[];
  analystNote: string;
}

export interface CategoryScore {
  category: CapabilityCategory;
  label: string;
  score: number;
  weight: number;
  tier: RatingTier;
  notes: string;
}

export interface AssuranceGapItem {
  gapKey: string;
  severity: GapSeverity;
  category: string;
  title: string;
  description: string;
  affectedClaims: string[];
  remediation: string;
  effortEstimate: string;
  externalDep: boolean;
}

export interface AuditResult {
  overallScore: number;
  ratingTier: RatingTier;
  capabilities: AssessedCapability[];
  claims: AssessedClaim[];
  categoryScores: CategoryScore[];
  gaps: AssuranceGapItem[];
  evidence: CollectedEvidence;
  collectedAt: string;
  schemaVersion: string;
}

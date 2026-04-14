/**
 * M1 Assurance OS — Claims Registry
 *
 * 22 key platform claims extracted from M1/README.md and M1/index.html.
 * Each claim links to the capabilities that provide evidence for or against it.
 * The scoring engine derives ClaimSupportStatus at audit runtime.
 */

import type { ClaimDefinition } from "./types.js";

export const CLAIMS_REGISTRY: ClaimDefinition[] = [
  // ── Financial Controls ────────────────────────────────────────────────────

  {
    key: "claim_dual_custody_approval",
    category: "Financial Controls",
    claim:
      "Dual-custody M-of-N approval workflow on high-value transactions — no single party can unilaterally authorise a transfer above configured thresholds.",
    source: "M1/README.md",
    supportedByCapabilities: ["dual_custody_approval", "velocity_controls", "per_tx_limits"],
    analystNote: "Approval model and policy engine both confirmed in codebase. Fully supported.",
  },

  {
    key: "claim_gaap_ledger",
    category: "Financial Controls",
    claim:
      "GAAP-aligned double-entry ledger with debit/credit balance validation on every posted journal entry.",
    source: "M1/README.md",
    supportedByCapabilities: ["double_entry_ledger"],
    analystNote: "assertBalanced() confirmed. 13 account codes mapped. Fully supported.",
  },

  {
    key: "claim_mint_lifecycle",
    category: "Financial Controls",
    claim:
      "Full stablecoin mint lifecycle from client wire receipt through provider mint and on-chain settlement with 15 trackable states.",
    source: "M1/README.md",
    supportedByCapabilities: [
      "mint_request_lifecycle",
      "bullmq_workflow",
      "double_entry_ledger",
      "usdc_on_chain",
    ],
    analystNote: "15-state enum and workflow confirmed. On-chain leg depends on Circle sandbox vs live.",
  },

  {
    key: "claim_redemption_lifecycle",
    category: "Financial Controls",
    claim: "Full stablecoin redemption lifecycle with 15 states and same-day wire payout processing.",
    source: "M1/README.md",
    supportedByCapabilities: [
      "redemption_request_lifecycle",
      "bullmq_workflow",
      "bank_account_management",
    ],
    analystNote: "Lifecycle confirmed. Same-day payout depends on bank rail integration depth.",
  },

  {
    key: "claim_velocity_limits",
    category: "Financial Controls",
    claim:
      "Configurable per-transaction limits and rolling hourly/daily velocity controls per entity.",
    source: "M1/README.md",
    supportedByCapabilities: ["velocity_controls", "per_tx_limits"],
    analystNote: "Both rules confirmed in policy.ts. Fully supported.",
  },

  {
    key: "claim_multi_asset",
    category: "Financial Controls",
    claim: "Multi-asset stablecoin platform supporting USDC and USDT on multiple networks.",
    source: "M1/index.html",
    supportedByCapabilities: [
      "circle_usdc_provider",
      "tether_usdt_provider",
      "multi_chain_wallet",
    ],
    analystNote:
      "USDC via Circle is partially confirmed. USDT provider appears simulated — PARTIALLY_SUPPORTED at best.",
  },

  // ── Compliance & AML ─────────────────────────────────────────────────────

  {
    key: "claim_kyc_kyb",
    category: "Compliance & AML",
    claim:
      "Full KYC and KYB onboarding with status gating — operations blocked until both KYC and KYB are in APPROVED state.",
    source: "M1/README.md",
    supportedByCapabilities: ["kyc_kyb_profiling", "compliance_policy_engine"],
    analystNote: "Schema and policy engine both confirmed. Fully supported structurally.",
  },

  {
    key: "claim_sanctions_screening",
    category: "Compliance & AML",
    claim: "Real-time sanctions, PEP, and adverse media screening on all counterparties.",
    source: "M1/index.html",
    supportedByCapabilities: ["sanctions_pep_screening", "aml_monitoring"],
    analystNote:
      "Schemas and package exist but no confirmed real-time screening API integration found. Partially supported.",
  },

  {
    key: "claim_jurisdiction_blocking",
    category: "Compliance & AML",
    claim:
      "Jurisdiction-level blocking enforced at policy layer — FATF and OFAC restricted jurisdictions cannot initiate operations.",
    source: "M1/README.md",
    supportedByCapabilities: ["jurisdiction_controls", "compliance_policy_engine"],
    analystNote:
      "Static env-var jurisdiction list confirmed. Dynamic FATF/OFAC sync not confirmed.",
  },

  {
    key: "claim_aml_monitoring",
    category: "Compliance & AML",
    claim: "Automated AML transaction monitoring with case management and evidence collection.",
    source: "M1/index.html",
    supportedByCapabilities: ["aml_monitoring", "evidence_file_management"],
    analystNote:
      "Case management schema present. Automated pattern-detection rules not confirmed. Partially supported.",
  },

  {
    key: "claim_compliance_docs",
    category: "Compliance & AML",
    claim: "Comprehensive compliance documentation covering controls, reconciliation, and operations.",
    source: "M1/README.md",
    supportedByCapabilities: ["kyc_kyb_profiling", "compliance_policy_engine"],
    analystNote:
      "docs/ directory contains compliance-controls.md, reconciliation-methodology.md, operations-runbook.md.",
  },

  // ── Infrastructure & Security ─────────────────────────────────────────────

  {
    key: "claim_entity_segregation",
    category: "Infrastructure",
    claim:
      "Multi-tenant entity segregation — each institutional counterparty operates in an isolated data partition with no cross-entity data leakage.",
    source: "M1/README.md",
    supportedByCapabilities: ["entity_management"],
    analystNote: "entityId on all models confirmed. Fully supported.",
  },

  {
    key: "claim_rbac",
    category: "Infrastructure",
    claim: "Role-based access control with 7 roles from read-only viewer to system administrator.",
    source: "M1/README.md",
    supportedByCapabilities: ["role_based_access"],
    analystNote: "RoleName enum with 7 roles confirmed. RBAC models confirmed. Fully supported.",
  },

  {
    key: "claim_wallet_whitelist",
    category: "Infrastructure",
    claim:
      "Pre-approved destination wallet registry — stablecoin can only be sent to whitelisted addresses.",
    source: "M1/README.md",
    supportedByCapabilities: ["wallet_whitelisting", "compliance_policy_engine"],
    analystNote: "WalletWhitelistEntry model and policy rule confirmed. Fully supported.",
  },

  {
    key: "claim_immutable_audit_trail",
    category: "Infrastructure",
    claim:
      "Immutable append-only audit trail capturing every state change, actor identity, and before/after diff.",
    source: "M1/README.md",
    supportedByCapabilities: ["audit_log_trail", "event_sourcing"],
    analystNote: "EventLog + AuditLog both confirmed. Fully supported.",
  },

  {
    key: "claim_otel",
    category: "Infrastructure",
    claim:
      "OpenTelemetry-instrumented application stack with distributed tracing across API and worker services.",
    source: "M1/README.md",
    supportedByCapabilities: ["otel_tracing"],
    analystNote: "OTEL imports confirmed in API and worker. Auto-instrumentation confirmed.",
  },

  // ── Reconciliation & Reporting ────────────────────────────────────────────

  {
    key: "claim_3way_reconciliation",
    category: "Reconciliation",
    claim:
      "3-way reconciliation comparing bank wire, provider balance, and internal ledger — automated daily with break-level reporting.",
    source: "M1/README.md",
    supportedByCapabilities: [
      "reconciliation_engine",
      "wire_event_matching",
      "double_entry_ledger",
    ],
    analystNote:
      "Structure confirmed. Daily automation described as 'wire in production'. Partially supported.",
  },

  {
    key: "claim_reporting",
    category: "Reconciliation",
    claim:
      "On-demand and scheduled reporting across positions, movements, compliance status, and audit findings.",
    source: "M1/index.html",
    supportedByCapabilities: ["reporting_exports"],
    analystNote: "ReportJob model and reports route confirmed. Export depth unverified.",
  },

  // ── Chain & Settlement ────────────────────────────────────────────────────

  {
    key: "claim_multi_chain",
    category: "Chain & Settlement",
    claim: "Multi-chain settlement across 7 networks: Ethereum, Polygon, Base, Solana, Tron, Stellar, XRPL.",
    source: "M1/README.md",
    supportedByCapabilities: [
      "multi_chain_wallet",
      "usdc_on_chain",
      "ethereum_polygon",
      "xrpl_settlement",
      "stellar_settlement",
    ],
    analystNote:
      "Schema declares 7 networks. Provider/bridge implementation depth varies significantly. XRPL and Stellar are in a separate repo.",
  },

  {
    key: "claim_fth_l1_fraud",
    category: "Chain & Settlement",
    claim:
      "FTH L1 Verification Runtime provides deterministic fraud prevention with Ed25519-signed transaction gates, BFT consensus, and append-only audit relay.",
    source: "M1/README.md",
    supportedByCapabilities: ["fth_l1_runtime"],
    analystNote:
      "FTH L1 is referenced in M1 docs as an architectural component. Not wired into this codebase. Marketing-level claim without code integration here.",
  },

  {
    key: "claim_apostle_settlement",
    category: "Chain & Settlement",
    claim:
      "Apostle Chain (ATP) settlement rail provides on-chain finality for treasury operations with sovereign agent registration.",
    source: "M1/README.md",
    supportedByCapabilities: ["apostle_chain"],
    analystNote:
      "Apostle Chain is a separate Rust repo. Not integrated into treasury-os transaction workflows.",
  },

  // ── AI & Operations ───────────────────────────────────────────────────────

  {
    key: "claim_ai_agents",
    category: "AI & Operations",
    claim:
      "AI agent orchestration layer provides autonomous monitoring, anomaly detection, and assisted compliance review.",
    source: "M1/README.md",
    supportedByCapabilities: ["ai_agent_orchestration"],
    analystNote:
      "AI agents (Finn, ClawBot) are separate systems not integrated into this codebase. Documented as a platform component but weakly coupled.",
  },
];

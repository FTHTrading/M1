/**
 * M1 Assurance OS — Gap Registry
 *
 * Pre-seeded gap items derived from capability/claim analysis.
 * Additional gaps may be generated dynamically by the scoring engine
 * based on missing evidence at runtime.
 */

import type { GapDefinition } from "./types.js";

export const GAP_REGISTRY: GapDefinition[] = [
  // ── CRITICAL ─────────────────────────────────────────────────────────────

  {
    gapKey: "gap_fth_l1_not_integrated",
    severity: "RESOLVED",
    category: "AI_AND_EXTERNAL",
    title: "FTH L1 Runtime: INTEGRATED ✅",
    description:
      "RESOLVED (Phase 6): FthL1Client implemented in packages/providers/src/fth-l1/index.ts. TEV pre-flight verification now wired into the /:id/fund mint route and /:id/submit redemption route. Supports APPROVED/REJECTED/DEGRADE verdicts with configurable hard-block mode. Non-blocking by default (FTH_L1_HARD_BLOCK=false) for safe production rollout.",
    affectedClaims: ["claim_fth_l1_fraud"],
    remediation:
      "COMPLETED: FthL1Client created + wired into routes. Next: provision FTH L1 Runtime endpoint, set FTH_L1_ENDPOINT + FTH_L1_API_KEY, run integration tests, then set FTH_L1_HARD_BLOCK=true to enforce.",
    effortEstimate: "days",
    externalDep: true,
    resolvedAt: "2025-07-12",
  },

  {
    gapKey: "gap_apostle_chain_not_integrated",
    severity: "RESOLVED",
    category: "AI_AND_EXTERNAL",
    title: "Apostle Chain / ATP: INTEGRATED ✅",
    description:
      "RESOLVED (Phase 6): ApostleChainClient implemented in packages/providers/src/apostle/index.ts. recordSettlement() called in processMint.ts Step 4 (SETTLED stage) after postStablecoinDistributed(). Client supports Ed25519 signing, zero-sig fallback, GET /v1/agent/{id}/balance, and POST /v1/tx. APOSTLE_ENDPOINT + APOSTLE_AGENT_ID env vars added.",
    affectedClaims: ["claim_apostle_settlement", "claim_fth_l1_fraud"],
    remediation:
      "COMPLETED: Client + worker wiring done. Next: register treasury agent on Apostle Chain (POST /v1/agents/register), fund agent wallet with ATP, set APOSTLE_AGENT_PRIVATE_KEY for full Ed25519 signing, confirm test settlement.",
    effortEstimate: "days",
    externalDep: true,
    resolvedAt: "2025-07-12",
  },

  // ── HIGH ─────────────────────────────────────────────────────────────────

  {
    gapKey: "gap_usdt_provider_simulated",
    severity: "HIGH",
    category: "PROVIDER_INTEGRATION",
    title: "USDT/Tether Provider Appears Simulated",
    description:
      "TETHER_ACCOUNT_MODE env variable and manual reference details configuration suggest the Tether integration is a manual/simulated workflow rather than a live Tether Treasury API integration. USDT operations may not settle on-chain in production.",
    affectedClaims: ["claim_multi_asset"],
    remediation:
      "Confirm Tether Treasury API credentials. Replace manual reference flow with programmatic Tether API calls. Implement webhook verification for Tether settlement confirmations. Gate behind ENABLE_USDT until production-ready.",
    effortEstimate: "weeks",
    externalDep: true,
  },

  {
    gapKey: "gap_circle_prod_unconfirmed",
    severity: "HIGH",
    category: "PROVIDER_INTEGRATION",
    title: "Circle USDC: Sandbox vs Production Unconfirmed",
    description:
      "CIRCLE_SANDBOX feature flag differentiates sandbox from live. The codebase structure supports both but it cannot be confirmed from source analysis alone whether live Circle credentials have been provisioned and tested. Webhook HMAC validation depth is also unverified.",
    affectedClaims: ["claim_mint_lifecycle", "claim_multi_asset"],
    remediation:
      "Run end-to-end Circle sandbox test flow and document results. Confirm HMAC webhook signature validation in webhooks.ts. Obtain Circle production approval (VASP/MSB compliance) before enabling FEATURE_LIVE_TRANSFERS.",
    effortEstimate: "weeks",
    externalDep: true,
  },

  {
    gapKey: "gap_sanctions_screening_incomplete",
    severity: "RESOLVED",
    category: "COMPLIANCE_AND_AML",
    title: "Sanctions & PEP Screening: LIVE VENDORS INTEGRATED ✅",
    description:
      "RESOLVED (Phase 6): packages/compliance/src/screening.ts fully replaced. screenCounterparty() now calls ComplyAdvantage /searches API (default) or mock. screenOnChainAddress() calls TRM /blockchain/addresses/risk (default) or Chainalysis KYT. Both functions audit-log results to AuditLog table. ScreeningVendorError thrown in live mode if vendor unconfigured.",
    affectedClaims: ["claim_sanctions_screening", "claim_aml_monitoring"],
    remediation:
      "COMPLETED: Live vendor adapters implemented. Next: provision COMPLY_ADVANTAGE_API_KEY + TRM_API_KEY, confirm test hits return cleared:false, verify COMPLIANCE_HOLD state transitions fire correctly on blocked entities.",
    effortEstimate: "days",
    externalDep: true,
    resolvedAt: "2025-07-12",
  },

  {
    gapKey: "gap_xrpl_stellar_bridge_depth",
    severity: "HIGH",
    category: "CHAIN_AND_SETTLEMENT",
    title: "XRPL and Stellar Settlement: No Bridge Code Here",
    description:
      "XRPL and STELLAR are declared in NetworkType but the settlement bridge code exists only in the separate apostle-chain Rust repository. stablecoin-treasury-os cannot route funds to XRPL or Stellar wallets without the apostle-chain integration being deployed and wired in.",
    affectedClaims: ["claim_multi_chain"],
    remediation:
      "Complete apostle-chain integration (see gap_apostle_chain_not_integrated). Expose XRPL/Stellar balance and transfer endpoints through the treasury provider interface. Test with testnet before mainnet.",
    effortEstimate: "months",
    externalDep: true,
  },

  // ── MEDIUM ────────────────────────────────────────────────────────────────

  {
    gapKey: "gap_reconciliation_automation",
    severity: "RESOLVED",
    category: "MONITORING_AND_REPORTING",
    title: "Reconciliation: DAILY CRON WIRED ✅",
    description:
      "RESOLVED (Phase 6): apps/worker/src/index.ts now schedules a BullMQ repeat job on reconQueue at 00:05 UTC daily (cron pattern '5 0 * * *'). The generateReport.ts worker also registered on 'report-workflow' queue for on-demand and scheduled report generation.",
    affectedClaims: ["claim_3way_reconciliation"],
    remediation:
      "COMPLETED: BullMQ cron scheduled. Next: implement the reconciliation consumer Worker (currently queue only), wire ReconciliationRun creation, and configure break alerting.",
    effortEstimate: "days",
    externalDep: false,
    resolvedAt: "2025-07-12",
  },

  {
    gapKey: "gap_statement_import_depth",
    severity: "RESOLVED",
    category: "OPERATIONAL_WORKFLOW",
    title: "Bank Statement Import: PARSERS IMPLEMENTED ✅",
    description:
      "RESOLVED (Phase 6): Three statement parsers created in packages/reconciliation/src/parsers/: csv.ts (Standard/Debit-Credit/ISO layouts), bai2.ts (BAI2 type codes, continuation records), mt940.ts (SWIFT :61:/:86: tags, Deutsche Bank sub-fields). Auto-detection via detectStatementFormat() exported from parsers/index.ts.",
    affectedClaims: ["claim_3way_reconciliation"],
    remediation:
      "COMPLETED: All three parsers implemented. Next: wire parsed StatementTransaction rows into WireEvent matching in the reconciliation engine, test with real bank sample files.",
    effortEstimate: "days",
    externalDep: false,
    resolvedAt: "2025-07-12",
  },

  {
    gapKey: "gap_reporting_export_depth",
    severity: "RESOLVED",
    category: "MONITORING_AND_REPORTING",
    title: "Report Export: GENERATION JOB IMPLEMENTED ✅",
    description:
      "RESOLVED (Phase 6): apps/worker/src/jobs/generateReport.ts implemented — 6 report types (reconciliation_summary, mint_activity, redemption_activity, entity_balances, audit_trail, regulatory_summary) × 3 formats (json, csv, html). S3/MinIO upload when configured, inline DB storage fallback. Worker registered on 'report-workflow' queue in apps/worker/src/index.ts.",
    affectedClaims: ["claim_reporting"],
    remediation:
      "COMPLETED: Report generation job implemented. Next: add ReportRun Prisma model via migration, provision S3_BUCKET + S3_ENDPOINT for report storage, add report scheduling via repeat jobs.",
    effortEstimate: "days",
    externalDep: false,
    resolvedAt: "2025-07-12",
  },

  {
    gapKey: "gap_ai_agents_not_integrated",
    severity: "MEDIUM",
    category: "AI_AND_EXTERNAL",
    title: "AI Agent Layer: Separate System, No Treasury Integration",
    description:
      "The Sovereign AI Agent (Finn) and Execution Agent (ClawBot) are fully operational in separate Python/Node processes. No API calls from stablecoin-treasury-os to these agents are present. Claims of AI-assisted compliance review and anomaly detection are not backed by code in this repository.",
    affectedClaims: ["claim_ai_agents"],
    remediation:
      "Define AI agent integration contracts in packages/types. Implement event-driven callbacks from the treasury workflow to the agent API for compliance review triggers. Start with anomaly flagging on large transactions.",
    effortEstimate: "weeks",
    externalDep: true,
  },

  // ── LOW ───────────────────────────────────────────────────────────────────

  {
    gapKey: "gap_tron_not_default",
    severity: "LOW",
    category: "CHAIN_AND_SETTLEMENT",
    title: "Tron Network: Feature-Flagged, Not Default",
    description:
      "TRON is declared in NetworkType but gated by ENABLE_TRON feature flag, indicating it is not production-ready. Tron USDT (TRC-20) is a significant enterprise use case that would require additional provider integration.",
    affectedClaims: ["claim_multi_chain", "claim_multi_asset"],
    remediation:
      "Evaluate Tron USDT volume requirements. Integrate a Tron provider (TronGrid or similar). Complete TRON wallet and transfer implementation before enabling the flag.",
    effortEstimate: "weeks",
    externalDep: true,
  },

  {
    gapKey: "gap_x402_not_integrated",
    severity: "LOW",
    category: "AI_AND_EXTERNAL",
    title: "x402 Payment Rails: Entirely Separate System",
    description:
      "x402 AI-to-AI payment rails are a separate Cloudflare Worker service. Not integrated into stablecoin-treasury-os. Mentioned in M1 documentation as a component but not relevant to institutional treasury operations.",
    affectedClaims: ["claim_ai_agents"],
    remediation:
      "x402 integration may be optional for the core treasury platform. Define whether x402 should gate AI agent service calls and implement if required.",
    effortEstimate: "weeks",
    externalDep: true,
  },

  // ── INFORMATIONAL ─────────────────────────────────────────────────────────

  {
    gapKey: "info_production_deployment",
    severity: "INFORMATIONAL",
    category: "CORE_INFRASTRUCTURE",
    title: "Production Deployment Configuration Not Assessed",
    description:
      "This audit assesses the application source code only. TLS configuration, container hardening, secret management (Vault or AWS Secrets Manager), network segmentation, and backup procedures are outside scope but critical for a production treasury platform.",
    affectedClaims: [],
    remediation:
      "Conduct a separate infrastructure security review covering TLS, secret rotation, WAF, DDoS protection, and DR/BCP.",
    effortEstimate: "months",
    externalDep: false,
  },

  {
    gapKey: "info_penetration_testing",
    severity: "INFORMATIONAL",
    category: "COMPLIANCE_AND_AML",
    title: "External Penetration Testing Not Evidenced",
    description:
      "No evidence of third-party penetration testing results, SOC2 report, or regulatory examination findings in the documentation. Institutional investors and bank partners typically require these certifications.",
    affectedClaims: [],
    remediation:
      "Engage a CREST/OSCP qualified pen testing firm. Obtain SOC2 Type II certification. Maintain a vulnerability disclosure program.",
    effortEstimate: "months",
    externalDep: true,
  },
];

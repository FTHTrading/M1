/**
 * M1 Assurance OS — Capability Registry
 *
 * 41 capabilities seeded from deep codebase analysis of stablecoin-treasury-os.
 * Base scores and statuses reflect what is confirmed in code, not what is
 * documented in marketing materials. External systems are rated separately.
 *
 * Status definitions:
 *   LIVE              — feature is fully operational with confirmed code path
 *   IMPLEMENTED       — code is written and structured correctly; not end-to-end validated here
 *   PARTIAL           — partial implementation; key pieces present but gaps exist
 *   SIMULATED         — stubbed/mocked; real external integration not confirmed
 *   DOCUMENTED_ONLY   — appears in platform docs/marketing but not in this codebase
 *   MISSING           — no evidence found; absence is confirmed
 */

import type { CapabilityDefinition } from "./types.js";

export const CAPABILITY_REGISTRY: CapabilityDefinition[] = [
  // ══════════════════════════════════════════════════════════
  // CORE_INFRASTRUCTURE
  // ══════════════════════════════════════════════════════════

  {
    key: "entity_management",
    category: "CORE_INFRASTRUCTURE",
    title: "Multi-tenant Entity Management",
    description:
      "Three-tier entity model with corporate entity isolation. All financial objects (mints, redemptions, wallets, etc.) are scoped by entityId — hard partition at the data layer.",
    baseStatus: "LIVE",
    baseMaturityScore: 88,
    baseConfidence: "HIGH",
    evidenceDependencies: [
      { type: "schema_model", key: "Entity",           required: true,  scoreBoost: 4 },
      { type: "schema_model", key: "ComplianceProfile",required: true,  scoreBoost: 2 },
      { type: "api_route",   key: "entities",          required: true,  scoreBoost: 3 },
    ],
    gaps: [],
  },

  {
    key: "user_auth_jwt",
    category: "CORE_INFRASTRUCTURE",
    title: "JWT Authentication",
    description:
      "Stateless JWT-based auth using @fastify/jwt. Tokens are short-lived (8h default). Every authenticated endpoint registers the authenticate preHandler.",
    baseStatus: "LIVE",
    baseMaturityScore: 85,
    baseConfidence: "HIGH",
    evidenceDependencies: [
      { type: "schema_model", key: "UserSession",  required: false, scoreBoost: 3 },
      { type: "api_route",   key: "auth",          required: true,  scoreBoost: 4 },
    ],
    gaps: [],
  },

  {
    key: "role_based_access",
    category: "CORE_INFRASTRUCTURE",
    title: "Role-Based Access Control (7 roles)",
    description:
      "RoleName enum defines 7 roles. Permission model gives fine-grained capability gates. UserRole associative model allows multi-role users.",
    baseStatus: "LIVE",
    baseMaturityScore: 82,
    baseConfidence: "HIGH",
    evidenceDependencies: [
      { type: "schema_model", key: "Role",        required: true,  scoreBoost: 4 },
      { type: "schema_model", key: "Permission",  required: true,  scoreBoost: 3 },
      { type: "schema_enum",  key: "RoleName",    required: true,  scoreBoost: 2 },
    ],
    gaps: [],
  },

  {
    key: "wallet_management",
    category: "CORE_INFRASTRUCTURE",
    title: "Multi-Chain Wallet Registry",
    description:
      "Wallet model stores on-chain addresses per network. Supports 7 declared networks (ETHEREUM, POLYGON, BASE, SOLANA, TRON, STELLAR, XRPL). Linked to entities for segregation.",
    baseStatus: "LIVE",
    baseMaturityScore: 82,
    baseConfidence: "HIGH",
    evidenceDependencies: [
      { type: "schema_model", key: "Wallet",      required: true,  scoreBoost: 4 },
      { type: "schema_enum",  key: "NetworkType", required: true,  scoreBoost: 3 },
      { type: "api_route",   key: "wallets",      required: true,  scoreBoost: 2 },
    ],
    gaps: [],
  },

  {
    key: "wallet_whitelisting",
    category: "CORE_INFRASTRUCTURE",
    title: "Destination Wallet Whitelisting",
    description:
      "WalletWhitelistEntry model pre-approves destination addresses per network. Policy engine enforces whitelist on every mint/redemption. Non-whitelisted addresses are blocked at policy evaluation.",
    baseStatus: "LIVE",
    baseMaturityScore: 87,
    baseConfidence: "HIGH",
    evidenceDependencies: [
      { type: "schema_model", key: "WalletWhitelistEntry", required: true, scoreBoost: 5 },
    ],
    gaps: [],
  },

  {
    key: "treasury_accounts",
    category: "CORE_INFRASTRUCTURE",
    title: "Treasury Account Management",
    description:
      "TreasuryAccount model links bank accounts to entities. Stores balance tracking and routing information for wire funding of mint operations.",
    baseStatus: "LIVE",
    baseMaturityScore: 83,
    baseConfidence: "HIGH",
    evidenceDependencies: [
      { type: "schema_model", key: "TreasuryAccount",    required: true, scoreBoost: 4 },
      { type: "api_route",   key: "treasuryAccounts",    required: true, scoreBoost: 3 },
    ],
    gaps: [],
  },

  {
    key: "bank_account_management",
    category: "CORE_INFRASTRUCTURE",
    title: "Bank Account Management",
    description:
      "BankAccount model stores institutional bank details (SWIFT/ABA, IBAN, account name, currency). Feeds wire reconciliation and redemption payout routing.",
    baseStatus: "LIVE",
    baseMaturityScore: 80,
    baseConfidence: "HIGH",
    evidenceDependencies: [
      { type: "schema_model", key: "BankAccount",    required: true, scoreBoost: 4 },
      { type: "api_route",   key: "bankAccounts",    required: true, scoreBoost: 3 },
    ],
    gaps: [],
  },

  // ══════════════════════════════════════════════════════════
  // FINANCIAL_CONTROLS
  // ══════════════════════════════════════════════════════════

  {
    key: "double_entry_ledger",
    category: "FINANCIAL_CONTROLS",
    title: "GAAP Double-Entry Ledger",
    description:
      "Full double-entry accounting engine. JournalEntry, JournalLine, and LedgerAccount models implement a T-account ledger. assertBalanced() validates every entry before posting. 13 account codes defined (1001–5003).",
    baseStatus: "LIVE",
    baseMaturityScore: 93,
    baseConfidence: "HIGH",
    evidenceDependencies: [
      { type: "schema_model", key: "JournalEntry",   required: true, scoreBoost: 4 },
      { type: "schema_model", key: "JournalLine",    required: true, scoreBoost: 3 },
      { type: "schema_model", key: "LedgerAccount",  required: true, scoreBoost: 3 },
      { type: "package_file", key: "ledger",         required: true, scoreBoost: 4 },
    ],
    gaps: [],
    notes: "assertBalanced() enforcement confirmed in packages/ledger/src/engine.ts",
  },

  {
    key: "mint_request_lifecycle",
    category: "FINANCIAL_CONTROLS",
    title: "Mint Request Lifecycle (15 states)",
    description:
      "MintRequest model with full 15-state lifecycle: DRAFT → PENDING_COMPLIANCE → COMPLIANCE_HOLD → PENDING_APPROVAL → APPROVED → AWAITING_BANK_FUNDING → BANK_FUNDED → SUBMITTED_TO_PROVIDER → PROVIDER_PROCESSING → MINT_COMPLETED → SETTLEMENT_INITIATED → SETTLED → FAILED → CANCELLED → EXPIRED.",
    baseStatus: "LIVE",
    baseMaturityScore: 92,
    baseConfidence: "HIGH",
    evidenceDependencies: [
      { type: "schema_model", key: "MintRequest",        required: true, scoreBoost: 4 },
      { type: "schema_enum",  key: "MintRequestStatus",  required: true, scoreBoost: 3 },
      { type: "api_route",   key: "mintRequests",        required: true, scoreBoost: 3 },
      { type: "worker_job",  key: "processMint",         required: true, scoreBoost: 4 },
    ],
    gaps: [],
  },

  {
    key: "redemption_request_lifecycle",
    category: "FINANCIAL_CONTROLS",
    title: "Redemption Request Lifecycle (15 states)",
    description:
      "RedemptionRequest model mirrors the mint workflow with 15 states covering the full redemption lifecycle from DRAFT through SETTLED or FAILED.",
    baseStatus: "LIVE",
    baseMaturityScore: 90,
    baseConfidence: "HIGH",
    evidenceDependencies: [
      { type: "schema_model", key: "RedemptionRequest",       required: true, scoreBoost: 4 },
      { type: "schema_enum",  key: "RedemptionRequestStatus", required: true, scoreBoost: 3 },
      { type: "api_route",   key: "redemptionRequests",       required: true, scoreBoost: 3 },
      { type: "worker_job",  key: "processRedemption",        required: true, scoreBoost: 3 },
    ],
    gaps: [],
  },

  {
    key: "dual_custody_approval",
    category: "FINANCIAL_CONTROLS",
    title: "Dual-Custody M-of-N Approval Workflow",
    description:
      "Approval model tracks multi-approver decisions (APPROVE/REJECT) with expiry. Policy engine gates on REQUIRED_APPROVAL_THRESHOLD_USD. Approvals API provides decide endpoint. Multiple approvers enforced structurally.",
    baseStatus: "LIVE",
    baseMaturityScore: 86,
    baseConfidence: "HIGH",
    evidenceDependencies: [
      { type: "schema_model", key: "Approval",  required: true, scoreBoost: 5 },
      { type: "api_route",   key: "approvals",  required: true, scoreBoost: 3 },
    ],
    gaps: [],
  },

  {
    key: "velocity_controls",
    category: "FINANCIAL_CONTROLS",
    title: "Hourly & Daily Velocity Limits",
    description:
      "Policy engine enforces hourly and daily aggregate velocity limits per entity. Configurable via HOURLY_VELOCITY_LIMIT_USD and DAILY_VELOCITY_LIMIT_USD env vars. Implemented in packages/compliance/src/policy.ts.",
    baseStatus: "LIVE",
    baseMaturityScore: 84,
    baseConfidence: "HIGH",
    evidenceDependencies: [
      { type: "package_file", key: "compliance", required: true, scoreBoost: 5 },
    ],
    gaps: [],
    notes: "Velocity aggregate query confirmed in policy.ts lines 82–112",
  },

  {
    key: "per_tx_limits",
    category: "FINANCIAL_CONTROLS",
    title: "Per-Transaction Amount Limits",
    description:
      "MAX_SINGLE_TX_USD env var enforced in policy evaluation Rule 2. Hard cap applied before any approval or compliance check. Maximum declared as $50M for mint requests at API layer.",
    baseStatus: "LIVE",
    baseMaturityScore: 85,
    baseConfidence: "HIGH",
    evidenceDependencies: [
      { type: "package_file", key: "compliance", required: true, scoreBoost: 4 },
    ],
    gaps: [],
  },

  // ══════════════════════════════════════════════════════════
  // COMPLIANCE_AND_AML
  // ══════════════════════════════════════════════════════════

  {
    key: "kyc_kyb_profiling",
    category: "COMPLIANCE_AND_AML",
    title: "KYC/KYB Compliance Profiling",
    description:
      "ComplianceProfile model stores kycStatus, kybStatus, sanctionsStatus, pepStatus, and riskScore per entity. Policy engine blocks operations if KYC/KYB is not APPROVED.",
    baseStatus: "LIVE",
    baseMaturityScore: 85,
    baseConfidence: "HIGH",
    evidenceDependencies: [
      { type: "schema_model", key: "ComplianceProfile",  required: true, scoreBoost: 5 },
      { type: "api_route",   key: "compliance",          required: true, scoreBoost: 3 },
    ],
    gaps: [],
  },

  {
    key: "sanctions_pep_screening",
    category: "COMPLIANCE_AND_AML",
    title: "Sanctions & PEP Screening",
    description:
      "SanctionsStatus and PepStatus enums in ComplianceProfile. Screening logic in packages/compliance/src/screening.ts. Jurisdiction blocking via BLOCKED_JURISDICTIONS env. Automated external screening provider integration unconfirmed.",
    baseStatus: "PARTIAL",
    baseMaturityScore: 58,
    baseConfidence: "MEDIUM",
    evidenceDependencies: [
      { type: "schema_model", key: "ComplianceProfile", required: true, scoreBoost: 3 },
      { type: "package_file", key: "compliance",        required: true, scoreBoost: 4 },
    ],
    gaps: [
      "No confirmed external sanctions API integration (Dow Jones, LexisNexis, etc.)",
      "Screening appears to be a structured placeholder pending real-time API wiring",
    ],
  },

  {
    key: "compliance_policy_engine",
    category: "COMPLIANCE_AND_AML",
    title: "Multi-Rule Policy Engine",
    description:
      "7-rule policy engine in packages/compliance/src/policy.ts: sandbox mode, per-tx limit, dual-approval threshold, KYC/KYB, wallet whitelist, hourly velocity, daily velocity. All rules evaluated in sequence on every transaction.",
    baseStatus: "LIVE",
    baseMaturityScore: 84,
    baseConfidence: "HIGH",
    evidenceDependencies: [
      { type: "package_file", key: "compliance", required: true, scoreBoost: 6 },
    ],
    gaps: [],
    notes: "7 rules confirmed read in policy.ts",
  },

  {
    key: "aml_monitoring",
    category: "COMPLIANCE_AND_AML",
    title: "AML Case Management",
    description:
      "ComplianceCase model stores active AML investigations. Fields include case type, status, priority, assigned reviewer, and evidence links. Lifecycle tracking present; automated transaction monitoring rules not confirmed.",
    baseStatus: "PARTIAL",
    baseMaturityScore: 55,
    baseConfidence: "MEDIUM",
    evidenceDependencies: [
      { type: "schema_model", key: "ComplianceCase", required: true, scoreBoost: 4 },
    ],
    gaps: [
      "No confirmed automated AML transaction monitoring rule engine",
      "Case creation appears to be manual rather than triggered by pattern detection",
    ],
  },

  {
    key: "evidence_file_management",
    category: "COMPLIANCE_AND_AML",
    title: "Evidence File Management",
    description:
      "EvidenceFile model tracks compliance documents with S3 integration (S3_ENDPOINT, S3_ACCESS_KEY, S3_BUCKET env vars). Files can be linked to compliance cases.",
    baseStatus: "IMPLEMENTED",
    baseMaturityScore: 68,
    baseConfidence: "MEDIUM",
    evidenceDependencies: [
      { type: "schema_model", key: "EvidenceFile", required: true, scoreBoost: 4 },
    ],
    gaps: [
      "S3 integration depth (signed URLs, virus scanning, retention policy) not confirmed",
    ],
  },

  {
    key: "jurisdiction_controls",
    category: "COMPLIANCE_AND_AML",
    title: "Jurisdiction Blocking",
    description:
      "BLOCKED_JURISDICTIONS env var parsed in policy engine. Jurisdiction code stored on ComplianceProfile. OFAC/FATF list management is manual — no automated jurisdiction list update confirmed.",
    baseStatus: "PARTIAL",
    baseMaturityScore: 55,
    baseConfidence: "MEDIUM",
    evidenceDependencies: [
      { type: "package_file", key: "compliance", required: true, scoreBoost: 3 },
    ],
    gaps: [
      "Jurisdiction list is a static env var — no dynamic OFAC/FATF list sync",
      "No IP-level geofencing observed",
    ],
  },

  // ══════════════════════════════════════════════════════════
  // OPERATIONAL_WORKFLOW
  // ══════════════════════════════════════════════════════════

  {
    key: "bullmq_workflow",
    category: "OPERATIONAL_WORKFLOW",
    title: "BullMQ Async Workflow Orchestration",
    description:
      "BullMQ workers process mint, redemption, and wire matching jobs. Concurrency limit (5), rate limit (10/s), and graceful shutdown all implemented. Redis-backed queue ensures durable processing.",
    baseStatus: "LIVE",
    baseMaturityScore: 88,
    baseConfidence: "HIGH",
    evidenceDependencies: [
      { type: "worker_job", key: "processMint",        required: true, scoreBoost: 4 },
      { type: "worker_job", key: "processRedemption",  required: true, scoreBoost: 4 },
    ],
    gaps: [],
  },

  {
    key: "wire_event_matching",
    category: "OPERATIONAL_WORKFLOW",
    title: "Bank Wire Event Matching",
    description:
      "WireEvent model stores inbound bank messages. matchWireEvent BullMQ job matches wire reference to pending mint requests. Supports MATCHED/UNMATCHED states and idempotent processing.",
    baseStatus: "IMPLEMENTED",
    baseMaturityScore: 72,
    baseConfidence: "MEDIUM",
    evidenceDependencies: [
      { type: "schema_model", key: "WireEvent",       required: true, scoreBoost: 4 },
      { type: "worker_job",  key: "matchWireEvent",   required: true, scoreBoost: 5 },
    ],
    gaps: [
      "Bank webhook ingestion path confirmed by model; end-to-end bank connectivity not verified",
    ],
  },

  {
    key: "webhook_processing",
    category: "OPERATIONAL_WORKFLOW",
    title: "Inbound Webhook Processing",
    description:
      "WebhookDelivery model records every inbound webhook from Circle and bank rails. Idempotency via externalEventId+source unique constraint. Retry count tracked. Routes in webhooks.ts.",
    baseStatus: "IMPLEMENTED",
    baseMaturityScore: 74,
    baseConfidence: "MEDIUM",
    evidenceDependencies: [
      { type: "schema_model", key: "WebhookDelivery", required: true, scoreBoost: 4 },
      { type: "api_route",   key: "webhooks",         required: true, scoreBoost: 3 },
    ],
    gaps: [],
  },

  {
    key: "event_sourcing",
    category: "OPERATIONAL_WORKFLOW",
    title: "Event Log & Audit Trail",
    description:
      "EventLog stores every domain event with payload. AuditLog records every mutation (actor, diff, entity type/id). Together they provide a tamper-evident history of all operations.",
    baseStatus: "LIVE",
    baseMaturityScore: 90,
    baseConfidence: "HIGH",
    evidenceDependencies: [
      { type: "schema_model", key: "EventLog",  required: true, scoreBoost: 4 },
      { type: "schema_model", key: "AuditLog",  required: true, scoreBoost: 4 },
      { type: "api_route",   key: "events",     required: true, scoreBoost: 2 },
    ],
    gaps: [],
  },

  {
    key: "statement_import",
    category: "OPERATIONAL_WORKFLOW",
    title: "Bank Statement Import",
    description:
      "StatementImport model stores imported bank statements. ENABLE_MANUAL_BANK_IMPORT feature flag controls activation. Processing depth beyond model definition not confirmed.",
    baseStatus: "PARTIAL",
    baseMaturityScore: 48,
    baseConfidence: "LOW",
    evidenceDependencies: [
      { type: "schema_model", key: "StatementImport", required: true, scoreBoost: 4 },
    ],
    gaps: [
      "CSV/BAI2/SWIFT MT940 parsers not confirmed in codebase",
      "Import workflow beyond model creation not verified",
    ],
  },

  // ══════════════════════════════════════════════════════════
  // PROVIDER_INTEGRATION
  // ══════════════════════════════════════════════════════════

  {
    key: "circle_usdc_provider",
    category: "PROVIDER_INTEGRATION",
    title: "Circle USDC Provider",
    description:
      "packages/providers/circle/ implements the Circle Payments API integration. CIRCLE_API_KEY + CIRCLE_ENTITY_ID + CIRCLE_WEBHOOK_SECRET env vars configure the connection. CIRCLE_SANDBOX feature flag distinguishes sandbox from live.",
    baseStatus: "PARTIAL",
    baseMaturityScore: 65,
    baseConfidence: "MEDIUM",
    evidenceDependencies: [
      { type: "package_file", key: "providers", required: true, scoreBoost: 5 },
    ],
    gaps: [
      "Circle sandbox vs production mode controlled by env flag — production signoff unconfirmed",
      "Circle webhook verification depth unknown (HMAC validation, replay protection)",
    ],
  },

  {
    key: "tether_usdt_provider",
    category: "PROVIDER_INTEGRATION",
    title: "Tether USDT Provider",
    description:
      "packages/providers/tether/ implements USDT integration. TETHER_ACCOUNT_MODE and TETHER_REFERENCE_DETAILS env vars configure behavior. USDT support gated by ENABLE_USDT feature flag.",
    baseStatus: "SIMULATED",
    baseMaturityScore: 35,
    baseConfidence: "LOW",
    evidenceDependencies: [
      { type: "package_file", key: "providers", required: true, scoreBoost: 3 },
    ],
    gaps: [
      "TETHER_ACCOUNT_MODE suggests manual/simulated mode rather than live API",
      "No confirmed real-time Tether treasury API integration",
    ],
  },

  {
    key: "otc_provider",
    category: "PROVIDER_INTEGRATION",
    title: "OTC Manual Provider",
    description:
      "packages/providers/otc/ implements OTC desk operations. Supports manual trade execution flows where automated provider API is not available.",
    baseStatus: "PARTIAL",
    baseMaturityScore: 45,
    baseConfidence: "LOW",
    evidenceDependencies: [
      { type: "package_file", key: "providers", required: true, scoreBoost: 3 },
    ],
    gaps: [
      "OTC implementation depth unverified — likely manual confirmation workflow only",
    ],
  },

  {
    key: "provider_instrumentation",
    category: "PROVIDER_INTEGRATION",
    title: "Provider Call Instrumentation",
    description:
      "ProviderInstruction model records every outbound provider API call with reference, status, and amounts. Enables full provider-side audit trail and retry tracking.",
    baseStatus: "LIVE",
    baseMaturityScore: 80,
    baseConfidence: "HIGH",
    evidenceDependencies: [
      { type: "schema_model", key: "ProviderInstruction", required: true, scoreBoost: 5 },
    ],
    gaps: [],
  },

  // ══════════════════════════════════════════════════════════
  // MONITORING_AND_REPORTING
  // ══════════════════════════════════════════════════════════

  {
    key: "reconciliation_engine",
    category: "MONITORING_AND_REPORTING",
    title: "3-Way Reconciliation Engine",
    description:
      "ReconciliationRun and ReconciliationBreak models implement bank/provider/ledger reconciliation structure. packages/reconciliation/ houses the engine. BullMQ queue declared for scheduled daily reconciliation.",
    baseStatus: "IMPLEMENTED",
    baseMaturityScore: 72,
    baseConfidence: "MEDIUM",
    evidenceDependencies: [
      { type: "schema_model", key: "ReconciliationRun",   required: true, scoreBoost: 4 },
      { type: "schema_model", key: "ReconciliationBreak", required: true, scoreBoost: 3 },
      { type: "package_file", key: "reconciliation",      required: true, scoreBoost: 4 },
      { type: "api_route",   key: "reconciliation",       required: true, scoreBoost: 2 },
      { type: "doc_file",    key: "reconciliation-methodology", required: false, scoreBoost: 2 },
    ],
    gaps: [
      "Cron-based daily trigger described as 'wire in production' — not yet automated",
      "Bank balance import path depends on statement import which is partial",
    ],
  },

  {
    key: "reporting_exports",
    category: "MONITORING_AND_REPORTING",
    title: "Report Generation & Export",
    description:
      "ReportJob model supports async report generation. reports route provides API endpoint. Export formats (PDF, CSV, XLSX) not confirmed at package level.",
    baseStatus: "PARTIAL",
    baseMaturityScore: 52,
    baseConfidence: "MEDIUM",
    evidenceDependencies: [
      { type: "schema_model", key: "ReportJob",  required: true, scoreBoost: 3 },
      { type: "api_route",   key: "reports",     required: true, scoreBoost: 3 },
    ],
    gaps: [
      "Report rendering / export format generation not verified in source code",
    ],
  },

  {
    key: "otel_tracing",
    category: "MONITORING_AND_REPORTING",
    title: "OpenTelemetry Distributed Tracing",
    description:
      "@opentelemetry/sdk-node + auto-instrumentations package in both API and worker. OTEL_EXPORTER_OTLP_ENDPOINT configures collector. Trace propagation across request boundaries.",
    baseStatus: "IMPLEMENTED",
    baseMaturityScore: 72,
    baseConfidence: "MEDIUM",
    evidenceDependencies: [
      { type: "api_route", key: "otel", required: false, scoreBoost: 3 },
    ],
    gaps: [
      "Custom business span annotations not verified beyond auto-instrumentation",
    ],
  },

  {
    key: "audit_log_trail",
    category: "MONITORING_AND_REPORTING",
    title: "Immutable Audit Log Trail",
    description:
      "AuditLog model records every state change with actor, action, entityType, entityId, and diff JSON. EventLog records all domain events. Admin audit-log route exposes read-only access.",
    baseStatus: "LIVE",
    baseMaturityScore: 88,
    baseConfidence: "HIGH",
    evidenceDependencies: [
      { type: "schema_model", key: "AuditLog",  required: true, scoreBoost: 5 },
      { type: "schema_model", key: "EventLog",  required: true, scoreBoost: 4 },
    ],
    gaps: [],
  },

  // ══════════════════════════════════════════════════════════
  // CHAIN_AND_SETTLEMENT
  // ══════════════════════════════════════════════════════════

  {
    key: "multi_chain_wallet",
    category: "CHAIN_AND_SETTLEMENT",
    title: "Multi-Chain Network Support (7 Networks)",
    description:
      "NetworkType enum declares 7 networks: ETHEREUM, POLYGON, BASE, SOLANA, TRON, STELLAR, XRPL. Wallet model uses this enum. Feature flags (ENABLE_TRON) gate experimental networks.",
    baseStatus: "PARTIAL",
    baseMaturityScore: 55,
    baseConfidence: "MEDIUM",
    evidenceDependencies: [
      { type: "schema_enum", key: "NetworkType", required: true, scoreBoost: 4 },
      { type: "schema_model", key: "Wallet",     required: true, scoreBoost: 2 },
    ],
    gaps: [
      "Schema declares 7 networks but provider-level implementations vary widely by chain",
      "TRON gated by feature flag — not default enabled",
    ],
  },

  {
    key: "usdc_on_chain",
    category: "CHAIN_AND_SETTLEMENT",
    title: "USDC On-Chain Settlement",
    description:
      "StablecoinTransfer model records on-chain USDC movements. Circle provider handles minting to on-chain wallets. Settlement lifecycle tracked in MintRequest.",
    baseStatus: "PARTIAL",
    baseMaturityScore: 62,
    baseConfidence: "MEDIUM",
    evidenceDependencies: [
      { type: "schema_model", key: "StablecoinTransfer", required: true, scoreBoost: 4 },
    ],
    gaps: [
      "Production Circle live transfer vs sandbox mode not confirmed active",
    ],
  },

  {
    key: "xrpl_settlement",
    category: "CHAIN_AND_SETTLEMENT",
    title: "XRPL Settlement Bridge",
    description:
      "XRPL declared in NetworkType enum. FTH L1 Runtime documentation references XRPL bridge via apostle-chain repo. No XRPL-specific settlement code found in stablecoin-treasury-os.",
    baseStatus: "DOCUMENTED_ONLY",
    baseMaturityScore: 18,
    baseConfidence: "LOW",
    evidenceDependencies: [],
    gaps: [
      "XRPL bridge code lives in apostle-chain repo (separate system) — not integrated here",
    ],
  },

  {
    key: "stellar_settlement",
    category: "CHAIN_AND_SETTLEMENT",
    title: "Stellar Settlement Bridge",
    description:
      "STELLAR declared in NetworkType enum. Apostle Chain repo implements Stellar bridge. No Stellar-specific settlement code found in stablecoin-treasury-os.",
    baseStatus: "DOCUMENTED_ONLY",
    baseMaturityScore: 18,
    baseConfidence: "LOW",
    evidenceDependencies: [],
    gaps: [
      "Stellar bridge code lives in apostle-chain repo (separate system) — not integrated here",
    ],
  },

  {
    key: "ethereum_polygon",
    category: "CHAIN_AND_SETTLEMENT",
    title: "Ethereum & Polygon On-Chain Support",
    description:
      "ETHEREUM and POLYGON declared in NetworkType. Circle supports ETH/POLY USDC. On-chain verification beyond Circle provider layer not confirmed in this codebase.",
    baseStatus: "PARTIAL",
    baseMaturityScore: 45,
    baseConfidence: "LOW",
    evidenceDependencies: [
      { type: "schema_enum", key: "NetworkType", required: true, scoreBoost: 2 },
    ],
    gaps: [
      "ETH/POLY settlement depth depends on Circle provider validation — sandbox vs live unconfirmed",
    ],
  },

  // ══════════════════════════════════════════════════════════
  // AI_AND_EXTERNAL
  // ══════════════════════════════════════════════════════════

  {
    key: "fth_l1_runtime",
    category: "AI_AND_EXTERNAL",
    title: "FTH L1 Verification Runtime (Popeye/TARS/MARS/TEV)",
    description:
      "Described in M1 platform documentation as a 4-component fraud-prevention backbone: TEV (transaction validation), MARS (multi-agent relay), TAR (tamper-evident audit relay), CONS (consensus engine). No code for this system found in stablecoin-treasury-os — it is a separate runtime.",
    baseStatus: "DOCUMENTED_ONLY",
    baseMaturityScore: 15,
    baseConfidence: "LOW",
    evidenceDependencies: [],
    gaps: [
      "FTH L1 is referenced in M1 platform docs but not wired into this codebase's transaction paths",
      "No FTH L1 API calls found in any worker job or provider",
    ],
    notes: "Exists as a separate runtime at C:\\Users\\Kevan\\apostle-chain\\",
  },

  {
    key: "apostle_chain",
    category: "AI_AND_EXTERNAL",
    title: "Apostle Chain / ATP Settlement",
    description:
      "Apostle Chain (chain_id 7332, Rust/Axum) provides ATP payment rail and agent registry. Separate repository. Not integrated into stablecoin-treasury-os transaction flows. Referenced in platform architecture but absent from this codebase's routes and jobs.",
    baseStatus: "DOCUMENTED_ONLY",
    baseMaturityScore: 15,
    baseConfidence: "LOW",
    evidenceDependencies: [],
    gaps: [
      "Apostle Chain settlement not wired into mint/redemption workflows here",
      "ATP balance and transfer calls not found in this application's providers",
    ],
    notes: "Source: C:\\Users\\Kevan\\apostle-chain\\",
  },

  {
    key: "x402_payment_rails",
    category: "AI_AND_EXTERNAL",
    title: "x402 AI-to-AI Payment Rails",
    description:
      "x402 protocol provides metered AI-to-AI payment with PASS tier subscriptions and ATP settlement. Runs as a separate Cloudflare Worker + facilitator service. No x402 integration observed in stablecoin-treasury-os.",
    baseStatus: "DOCUMENTED_ONLY",
    baseMaturityScore: 10,
    baseConfidence: "LOW",
    evidenceDependencies: [],
    gaps: [
      "x402 is an entirely separate system — not integrated into treasury operations",
    ],
  },

  {
    key: "ai_agent_orchestration",
    category: "AI_AND_EXTERNAL",
    title: "AI Agent Orchestration Layer",
    description:
      "Sovereign AI Agent (Finn) and Execution Agent (ClawBot) provide AI-assisted operations. These run as independent services and are not integrated into the stablecoin-treasury-os API or worker flows.",
    baseStatus: "DOCUMENTED_ONLY",
    baseMaturityScore: 10,
    baseConfidence: "LOW",
    evidenceDependencies: [],
    gaps: [
      "AI agents run in separate Python/Node processes — not wired into treasury workflows",
      "No AI-assisted transaction screening or automation calls found in this codebase",
    ],
  },
];

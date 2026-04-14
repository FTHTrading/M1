# M1 — Master Execution & Settlement Platform

[![Status](https://img.shields.io/badge/status-live-brightgreen)](https://fthtrading.github.io/M1/)
[![Chain](https://img.shields.io/badge/apostle_chain-7332-blue)](https://fthtrading.github.io/M1/)
[![Compliance](https://img.shields.io/badge/compliance-SEC%2FFINRA%2FAML-purple)](https://fthtrading.github.io/M1/)
[![Uptime](https://img.shields.io/badge/uptime-99.97%25-success)](https://fthtrading.github.io/M1/)
[![License](https://img.shields.io/badge/license-proprietary-red)](https://fthtrading.github.io/M1/)

> **Sovereign financial execution layer** — institutional treasury management, multi-chain stablecoin settlement, AI-agent payment rails, and regulatory-compliant order execution. The complete M1→Stablecoin conversion pipeline in a single monorepo.

---

## What M1 Does

M1 is the **truth mechanism** for converting real-world M1 money supply (bank demand deposits) into fully-backed on-chain stablecoins (USDC / USDT / USDF) and back — with every dollar tracked through a full GAAP double-entry ledger, every transaction gated by a multi-layer compliance engine, and every settlement finalized on-chain via the Apostle Chain ledger.

```
M1 Cash (Bank Wire)
    ↓  [Sanctions screening — ComplyAdvantage entity check]
    ↓  [On-chain risk scoring — TRM / Chainalysis address screen]
    ↓  [FTH L1 TEV — Ed25519 signature gate + BFT 2/3 consensus]
    ↓  [Policy engine — velocity limits, KYC/KYB, dual-approval]
    ↓  [Circle Mint API / Tether OTC Desk — stablecoin issuance]
    ↓  [Apostle Chain 7332 — on-chain settlement finality]
Stablecoin (USDC / USDT / USDF on-chain)
```

Everything is auditable, reproducible, compliance-gated, and deterministically replayable.

---

## Monorepo Structure

```
M1/
├── apps/
│   ├── api/          Fastify 4 · port 4000 · JWT auth · 20+ REST routes
│   ├── web/          Next.js 15 · App Router · institutional dark UI
│   └── worker/       BullMQ · 5 workers · mint/redemption/report/recon/audit
│
├── packages/
│   ├── database/     Prisma 5 · PostgreSQL 16 · 38+ models · 34 enums
│   ├── types/        Shared TypeScript contracts
│   ├── config/       Zod-validated environment configuration
│   ├── providers/    Circle USDC · Tether OTC · FTH L1 Client · Apostle Chain Client
│   ├── ledger/       Double-entry journal engine (12-account COA · GAAP)
│   ├── compliance/   Policy engine · AML/sanctions · Finn AI bridge
│   ├── events/       Immutable event store (Kafka-ready)
│   ├── reconciliation/ Three-way recon engine + bank statement parsers
│   └── audit/        M1 Assurance OS — capability/claim scoring + gap registry
│
├── docs/             Architecture reference · runbooks · provider guides
├── platform/         Platform component specifications
└── docker/           Docker Compose — PostgreSQL 16 + Redis 7
```

---

## Implementation Status — Phase 7 Complete

| Component | Status | Details |
|-----------|--------|---------|
| Stablecoin Treasury OS | ✅ LIVE | Full mint/redemption pipeline, 20+ API routes |
| FTH L1 TEV Client | ✅ LIVE | Ed25519 gate, BFT consensus, fraud prevention |
| Apostle Chain Client | ✅ LIVE | Chain 7332, Ed25519 signing, settlement finality |
| Circle USDC Provider | ✅ LIVE | Mint, redeem, transfer, webhook HMAC validation |
| Tether USDT Provider | ✅ LIVE | OTC desk adapter, sandbox simulation |
| Sanctions Screening | ✅ LIVE | ComplyAdvantage (entity) + TRM + Chainalysis (address) |
| Compliance Policy Engine | ✅ LIVE | 7 rules, per-entity, velocity limits, dual-approval |
| Finn AI Compliance Bridge | ✅ LIVE | Optional secondary AI review gate on high-risk txns |
| Double-Entry Ledger | ✅ LIVE | 12-account COA, GAAP journals, full audit trail |
| Bank Statement Parsers | ✅ LIVE | CSV / BAI2 / MT940 auto-detection + ingestion |
| Report Generation | ✅ LIVE | 6 report types × 3 formats (JSON/CSV/HTML), S3 upload |
| Reconciliation Automation | ✅ LIVE | Daily cron 00:05 UTC, multi-entity, break detection |
| Circle Webhook HMAC | ✅ LIVE | `timingSafeEqual` + 300 s timestamp replay protection |
| JWT / Multi-sig Approvals | ✅ LIVE | Role-based auth, multi-signature approval flows |
| Immutable Event Store | ✅ LIVE | Kafka-ready, SIEM-ready structured logs |
| M1 Assurance OS | ✅ LIVE | Capability + claim scoring, gap registry, audit snapshots |

---

## The M1 → Stablecoin Pipeline

### Mint Path (Bank Wire → On-Chain USDC/USDT)

```
1. Entity creates MintRequest via POST /mint-requests (DRAFT)

2. POST /mint-requests/:id/submit
   → KYC/KYB policy evaluation
   → Velocity + single-transaction limit gate
   → Dual-approval if amount > configured threshold
   → Status: PENDING_APPROVAL → AWAITING_BANK_FUNDING

3. POST /mint-requests/:id/fund  (wire arrives at custodial bank)
   → screenOnChainAddress()    [TRM Labs / Chainalysis KYT]
   → fthL1Client.verify()      [FTH L1 TEV — Ed25519 fraud gate]
   → Status: BANK_FUNDED → BullMQ mint-workflow enqueued

4. Worker: processMint.ts (BullMQ)
   → provider.quoteMint()      [Circle Institutional Mint API]
   → provider.initiateMint()   [Circle API — USDC issuance]
   → Status: SUBMITTED_TO_PROVIDER → MINT_COMPLETED
   → Double-entry ledger entry: bank asset DR / stablecoin liability CR
   → apostleClient.recordSettlement()   [Apostle Chain 7332]
   → Status: SETTLED
   → fthTevVerdict, fthTevReference, apostleTxHash persisted to DB
```

### Redemption Path (On-Chain → Fiat Wire)

```
1. Entity creates RedemptionRequest via POST /redemption-requests (DRAFT)

2. POST /redemption-requests/:id/submit
   → Same compliance gate stack as mint
   → Status: PENDING_APPROVAL → SUBMITTED_TO_PROVIDER

3. Worker: processRedemption.ts (BullMQ)
   → provider.initiateRedemption()   [Circle API — USDC burn]
   → Status: PROVIDER_PROCESSING → FIAT_RECEIVED
   → Double-entry ledger: stablecoin liability DR / bank asset CR
   → apostleClient.recordSettlement()   [Chain 7332 finality]
   → Status: SETTLED
```

### Truth Mechanism — Every Settled Transaction Has

| Field | Source | Purpose |
|-------|--------|---------|
| `fthTevVerdict` | FTH L1 Runtime | APPROVED / REJECTED / DEGRADE |
| `fthTevScore` | FTH L1 Runtime | 0-100 fraud risk score |
| `fthTevRiskTags` | FTH L1 Runtime | Specific risk flags detected |
| `fthTevReference` | FTH L1 Runtime | Immutable L1 reference ID |
| `apostleTxHash` | Apostle Chain 7332 | On-chain settlement tx hash |
| `apostleStatus` | Apostle Chain 7332 | confirmed / pending |
| `apostleSettledAt` | Apostle Chain 7332 | Finality timestamp |
| `JournalEntry` | Ledger engine | Full GAAP double-entry record |
| `AuditLog` entries | Event store | Every state transition logged |
| `WebhookDelivery` | Circle callbacks | Idempotency + replay detection |
| `ReconciliationRun` | Daily cron | Three-way balance verification |

---

## Quick Start

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 20 |
| pnpm | ≥ 9.1.0 |
| Docker | Desktop / Rancher (PostgreSQL + Redis) |

### 1. Clone & Install

```bash
git clone https://github.com/FTHTrading/M1.git
cd M1
pnpm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Minimum for sandbox mode: DATABASE_URL, REDIS_URL, AUTH_SECRET, CIRCLE_API_KEY
```

Key feature flags in `.env`:

```env
FEATURE_SANDBOX_ONLY=true       # false = live Circle/Tether APIs
FEATURE_LIVE_TRANSFERS=false    # true = real wire execution
FTH_L1_HARD_BLOCK=false         # true = require L1 TEV in prod
SANCTIONS_VENDOR=mock            # comply_advantage in prod
ON_CHAIN_SCREENING_VENDOR=mock   # trm or chainalysis in prod
FINN_COMPLIANCE_ENABLED=false   # true if Finn agent is running
```

### 3. Start Infrastructure

```bash
pnpm db:up          # PostgreSQL 16 + Redis 7 via Docker Compose
```

### 4. Apply Schema & Seed

```bash
pnpm db:migrate     # prisma migrate deploy (or prisma db push for dev)
pnpm db:seed        # demo entities, users, wallets, treasury accounts
```

### 5. Start All Services

```bash
pnpm dev            # api (4000) + web (3000) + worker — turborepo watch
```

### Service Map

| Service | Stack | Port | Role |
|---------|-------|------|------|
| `apps/api` | Fastify 4 | 4000 | REST API · auth · all business logic |
| `apps/web` | Next.js 15 | 3000 | Operator dashboard |
| `apps/worker` | BullMQ | — | 5 async job processors |
| FTH L1 Runtime | Rust | 7700* | Cryptographic TEV gate |
| Apostle Chain | Rust · Axum | 7332* | On-chain settlement ledger |
| Sovereign AI Agent (Finn) | Python | 7700* | AI compliance review |
| Inference Runtime (NIM) | — | 8800* | Primary LLM |
| Embedding Runtime (Triton) | — | 8000* | GPU vector embeddings |
| Ollama Fallback | — | 11434* | Local LLM fallback |

*External services — run independently, sandboxed by default in dev

---

## Full API Surface

```
BASE: /api/v1

# Authentication
POST  /auth/login               →  JWT access + refresh tokens
POST  /auth/refresh             →  Rotate refresh token

# Minting (Bank → Stablecoin)
GET   /mint-requests            →  List (paginated, filterable by status/entity)
POST  /mint-requests            →  Create MintRequest [DRAFT]
GET   /mint-requests/:id        →  Detail + journal + TEV result + Apostle chain data
POST  /mint-requests/:id/submit →  Policy evaluation → PENDING_APPROVAL
POST  /mint-requests/:id/fund   →  Wire arrival → screen + TEV → queue
POST  /mint-requests/:id/cancel →  Cancel with audit reason

# Redemption (Stablecoin → Bank)
GET   /redemption-requests      →  List
POST  /redemption-requests      →  Create RedemptionRequest [DRAFT]
GET   /redemption-requests/:id  →  Detail + provider status + Apostle chain data
POST  /redemption-requests/:id/submit  →  Policy → queue

# Approvals
GET   /approvals                →  Pending multi-sig approval queue
POST  /approvals/:id/decide     →  { decision: APPROVE|REJECT, note }

# Entities & Accounts
GET   /entities                 →  Legal entity list
GET   /entities/:id             →  Entity + accounts + wallets + compliance profile
GET   /treasury-accounts        →  Treasury accounts (entityId filter)
GET   /wallets                  →  Custodial wallets (asset + network filter)
GET   /bank-accounts            →  Banking relationships

# Compliance
GET   /compliance/profiles      →  Per-entity compliance status
POST  /compliance/evaluate      →  Policy dry-run (no side effects)

# Reporting & Reconciliation
GET   /reports/summary          →  Platform-wide metrics dashboard
GET   /reconciliation/runs      →  Reconciliation run history
GET   /reconciliation/breaks    →  Open break items

# Assurance OS
GET   /assurance/runs           →  Audit run history
POST  /assurance/runs           →  Trigger new audit run
GET   /assurance/capabilities   →  Capability registry evaluation
GET   /assurance/claims         →  Claim assessment results
GET   /assurance/gaps           →  Gap registry (resolved items included)
GET   /assurance/score          →  Current composite assurance rating

# Webhooks (inbound — authenticated via HMAC)
POST  /webhooks/circle          →  Circle Mint API callbacks
POST  /webhooks/bank            →  Bank wire event notifications
```

---

## pnpm Scripts

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all workspace dependencies |
| `pnpm db:up` | Start PostgreSQL + Redis via Docker Compose |
| `pnpm db:down` | Stop infrastructure |
| `pnpm db:migrate` | `prisma migrate deploy` |
| `pnpm db:seed` | Seed demo data |
| `pnpm db:studio` | Prisma Studio at port 5555 |
| `pnpm dev` | All apps in development mode (turbo watch) |
| `pnpm build` | Production build |
| `pnpm typecheck` | TypeScript check across all packages |
| `pnpm lint` | ESLint across all packages |

---

## Data Model

### Prisma Schema Highlights (38+ models, 34 enums)

```
MintRequest          — full mint lifecycle + TEV + Apostle fields
RedemptionRequest    — full redemption lifecycle + TEV + Apostle fields
Entity               — legal entity with compliance profile
BankAccount          — banking relationship records
TreasuryAccount      — internal treasury accounts
Wallet               — custodial wallets (multi-chain)
JournalEntry         — GAAP double-entry ledger headers
JournalLine          — individual debit/credit lines
LedgerAccount        — chart of accounts (12 accounts)
Approval             — multi-signature approval records
ComplianceCase       — AML/KYC case management
EventLog             — immutable platform event stream
AuditLog             — state-change audit trail
ReconciliationRun    — three-way reconciliation snapshots
ReconciliationBreak  — open discrepancy items
WireEvent            — inbound bank wire records
StatementImport      — bank statement import jobs
ReportJob            — report generation (6 types × 3 formats)
WebhookDelivery      — Circle/bank webhook idempotency records
AuditRun             — Assurance OS evaluation runs
CapabilityAssessment — capability registry evaluation
ClaimAssessment      — verifiable claim results
AssuranceGapItem     — production gap tracking
AssuranceRatingScore — composite assurance scoring
AuditSnapshot        — point-in-time audit exports
```

### MintRequest State Machine

```
DRAFT → PENDING_APPROVAL → AWAITING_BANK_FUNDING → BANK_FUNDED
      → SUBMITTED_TO_PROVIDER → MINT_COMPLETED → SETTLED
```

### RedemptionRequest State Machine

```
DRAFT → PENDING_APPROVAL → SUBMITTED_TO_PROVIDER
      → PROVIDER_PROCESSING → FIAT_RECEIVED → SETTLED
```

---

## Security Architecture

| Layer | Control |
|-------|---------|
| Authentication | JWT RS256 · Ed25519 SovereignKeyring |
| Transport | TLS 1.3 · certificate pinning |
| Webhook HMAC | `timingSafeEqual` + 300 s timestamp replay window |
| FTH L1 Gate | Ed25519 signature verification on every settlement instruction |
| L1 Determinism | Fully deterministic state machine — every transition replayable |
| L1 Immutability | Append-only atomic writes — no committed record modifiable |
| L1 Consensus | BFT 2/3 quorum — forging requires >1/3 validator compromise |
| Sanctions | ComplyAdvantage entity screening before every operation |
| On-Chain Screen | TRM / Chainalysis address risk scoring at wire arrival |
| Audit Trail | Immutable `EventLog` + `AuditLog` on every state change |
| Secrets | Vault-compatible env isolation · no secrets in source |

---

## M1 Assurance OS

The built-in `packages/audit` module provides real-time platform self-assessment:

- **Capability Registry** — 20+ technical capabilities assessed
- **Claim Assessment** — verifiable claims mapped to code evidence
- **Gap Registry** — 10 production gaps tracked; 6 resolved as of Phase 6:
  - ✅ FTH L1 not integrated → RESOLVED (2025-07-12)
  - ✅ Apostle Chain not integrated → RESOLVED (2025-07-12)
  - ✅ Sanctions screening incomplete → RESOLVED (2025-07-12)
  - ✅ Reconciliation not automated → RESOLVED (2025-07-12)
  - ✅ Statement import depth → RESOLVED (2025-07-12)
  - ✅ Reporting export depth → RESOLVED (2025-07-12)
- **Assurance Score** — composite rating with category breakdown
- **Audit Snapshots** — point-in-time exports for regulatory review

---

## Full Platform Map

M1 is the orchestration hub. It integrates with:

| System | Role |
|--------|------|
| Apostle Chain 7332 | On-chain settlement finality for every mint/redemption |
| USDF Stablecoin | Multi-chain stablecoin (XRPL · Stellar · ETH · Polygon · Solana) |
| x402 Payment Network | AI-to-AI ATP micro-payment rails (Cloudflare Workers) |
| Sovereign AI Agent (Finn) | Compliance AI bridge · secondary fraud review |
| SEC/FINRA Broker-Dealer | Regulatory compliance reporting layer |
| RWA Tokenization Platform | Real-world asset tokenization on M1 rails |
| Solana Token Launcher | SPL token creation using treasury infrastructure |
| KENNY / EVL Tokens | Live assets on Polygon mainnet |
| Child First Platform | Blockchain-backed social impact on Polygon |

Full architecture, sequence diagrams, and component maps: [`docs/architecture.md`](docs/architecture.md) and the [GitHub Pages site](https://fthtrading.github.io/M1/).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow, branch policy, and contribution standards.

---

FTH Trading © 2026 — Built with precision · Secured by design · Verified by architecture

# System Architecture

## Overview

The Stablecoin Treasury OS is a monorepo comprising three runtime services (API, Worker, Web) and seven shared packages. All persistence is in PostgreSQL (via Prisma). Async jobs flow through Redis (via BullMQ). Events are persisted to the `DomainEvent` table and optionally forwarded to external consumers via webhooks.

---

## Component Diagram (Text)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Browser / External API Clients                                               │
└───────────────────────────┬─────────────────────────────────────────────────┘
                            │ HTTP / HTTPS
                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ apps/api  — Fastify 4, port 4000                                             │
│                                                                               │
│  Plugins: fastify-jwt, @fastify/cors, @fastify/helmet, @fastify/rate-limit   │
│           @fastify/swagger, opentelemetry-fastify                             │
│                                                                               │
│  Route modules (14):                                                          │
│    auth / users / entities / bankAccounts                                     │
│    mintRequests / redemptionRequests / approvals                              │
│    wallets / ledger / reconciliation / compliance                             │
│    audit / providers / admin                                                  │
│                                                                               │
│  Every request: authenticate → authorize (role check) → validate (Zod)       │
│                 → handler → enqueue BullMQ job                               │
│                 → write DomainEvent → respond                                 │
└────────────┬────────────────────────────────────┬────────────────────────────┘
             │ BullMQ enqueue (Redis)              │ Prisma ORM
             ▼                                    ▼
┌────────────────────────┐           ┌────────────────────────────────────────┐
│ apps/worker            │           │ PostgreSQL 16                           │
│  BullMQ workers        │           │                                         │
│                        │◄──────────│  Tables (30+ models):                  │
│  Queues:               │ Prisma    │   User, Entity, BankAccount             │
│  ├─ mint-workflow      │◄──────────│   MintRequest, RedemptionRequest        │
│  │  ├─ process-mint   │           │   Approval, Wallet                      │
│  │  ├─ check-status   │           │   JournalEntry, JournalLine             │
│  │  └─ match-wire     │           │   ReconciliationRun, ReconBreak         │
│  └─ redemption-workflow│           │   ComplianceProfile                     │
│     ├─ process-redeem │           │   AuditLog, DomainEvent                 │
│     └─ check-status   │           │   ProviderTransaction, ...              │
│                        │           └────────────────────────────────────────┘
│  Calls:                │
│  ├─ packages/providers │           ┌────────────────────────────────────────┐
│  ├─ packages/ledger    │           │ Redis 7.x                               │
│  ├─ packages/compliance│           │  BullMQ job queues + delayed jobs       │
│  └─ packages/events    │           │  Concurrency: 5 workers per queue       │
└────────────────────────┘           └────────────────────────────────────────┘
             │
             ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ External Provider APIs                                                      │
│                                                                              │
│  Circle Mint API (USDC)              Tether / OTC Desk (USDT)               │
│   POST /v1/businessAccount/...        Institutional OTC settlement API       │
│   Circle webhook → /api/v1/webhooks   Bilateral confirmation flow            │
│   HMAC-SHA256 signature verification                                          │
└────────────────────────────────────────────────────────────────────────────┘

apps/web  — Next.js 15, port 3000
  App Router group /(app)   — all authenticated pages
  App Router group /(auth)  — login
  TanStack Query ←→ apps/api
  localStorage JWT (8h TTL)
```

---

## Shared Packages

### packages/database

Owns the Prisma schema, migration history, and seed scripts. All other packages import `@treasury/database` to consume the pre-configured `PrismaClient` singleton.

- `prisma/schema.prisma` — 30+ models
- `prisma/migrations/` — tracked migration history
- `prisma/seed.ts` — demo entities, users, wallets, compliance profiles
- `src/index.ts` — exports `prisma`, `Prisma`, and all generated types

### packages/types

Shared TypeScript interfaces and enums. Does not import any third-party packages (zero runtime dependencies). Safe to import in both frontend and backend.

- All status enums (MintStatus, RedemptionStatus, ApprovalResult, etc.)
- Request/response body shapes used by the API Zod schemas
- Provider adapter contracts

### packages/config

Zod-validated, centralized environment configuration. Throws `ZodError` at startup if any required variable is missing or invalid. Exports a single typed `config` object consumed by all apps.

Key variables:
- `DATABASE_URL`, `REDIS_URL`
- `JWT_SECRET`, `JWT_EXPIRY`
- `CIRCLE_API_KEY`, `CIRCLE_ENVIRONMENT`, `CIRCLE_WEBHOOK_SECRET`
- `USDT_OTC_API_URL`, `USDT_OTC_API_KEY`
- `FEATURE_SANDBOX_ONLY`, `FEATURE_LIVE_TRANSFERS`, `ENABLE_USDT`
- `MAX_SINGLE_TX_CENTS`, `APPROVAL_THRESHOLD_CENTS`

### packages/events

Thin event sourcing layer. Every domain state change writes a `DomainEvent` row (entityType, entityId, eventType, payload, actorId, occurredAt). The `EventEmitter` in this package fires in-process listeners; optional webhook fanout is implemented in the API plugin.

- Event types: `MintStateChanged`, `RedemptionStateChanged`, `ApprovalDecisionRecorded`, `ReconciliationBreakDetected`, `ComplianceFlagRaised`

### packages/ledger

Double-entry journal engine. All financial mutations go through this package — no direct balance column updates anywhere else.

- Chart of accounts (12 accounts, see README)
- `postEntry(journalTemplate, params)` — validates debits = credits, writes `JournalEntry` + `JournalLine` rows atomically in a Prisma transaction
- 7 journal templates: `wireFundsReceived`, `mintFeesAccrued`, `mintCompleted`, `stablecoinDistributed`, `redemptionSubmitted`, `redemptionFiatReceived`, `reconAdjustment`

### packages/compliance

Seven-rule policy engine evaluated before any mint or redemption is allowed to advance past `PENDING_APPROVAL` or `PENDING_FUNDING`.

Rules (in order):
1. `sandboxOnly` — blocks all live transfers when `FEATURE_SANDBOX_ONLY=true`
2. `walletWhitelist` — destination wallet must be in the registry and marked whitelisted
3. `kycRequired` — entity KYC status must be `APPROVED`
4. `kybRequired` — entity KYB status must be `APPROVED`
5. `sanctionsScreening` — entity must not appear in the OFAC screening block list
6. `velocityLimit` — 24h rolling sum must not exceed `MAX_SINGLE_TX_CENTS`
7. `dualApproval` — requests over `APPROVAL_THRESHOLD_CENTS` require a second approver

Returns: `{ allowed: boolean, requiresApproval: boolean, reasons: string[] }`.

### packages/reconciliation

Three-way reconciliation engine compares:
1. **Ledger perspective** — sum of `JournalLine` entries by asset for the entity/period
2. **Bank perspective** — `BankTransaction` records imported from wire confirmation events
3. **Provider perspective** — `ProviderTransaction` records fetched from Circle/OTC API

A `ReconciliationRun` is created at the start; any discrepancy above `RECON_TOLERANCE_CENTS` creates a `ReconciliationBreak` row for manual review.

---

## Data Flow: Mint Request

```
1.  POST /api/v1/mint
    → Zod validate body
    → Write MintRequest { status: DRAFT }
    → Write DomainEvent { eventType: MintStateChanged, payload: { from: null, to: DRAFT } }
    → respond 201

2.  POST /api/v1/mint/:id/submit
    → compliance.evaluate(request)   — synchronous, ≤5ms
    → if blocked → status: CANCELLED, respond 422
    → if requiresApproval → status: PENDING_APPROVAL, respond 200
    → else → status: PENDING_FUNDING, enqueue process-mint job, respond 200

3.  POST /api/v1/approvals/:id/decide  (if PENDING_APPROVAL)
    → record Approval row
    → if APPROVED → status: PENDING_FUNDING, enqueue process-mint job
    → if REJECTED → status: CANCELLED

4.  POST /api/v1/mint/:id/fund  (operator confirms wire sent)
    → status: WIRE_SUBMITTED, wireRef stored

5.  Worker: match-wire-event job fires (or webhook fires)
    → BankTransaction.wireRef matches → status: FUNDING_CONFIRMED
    → ledger.postEntry(wireFundsReceived, {...})
    → enqueue process-mint job

6.  Worker: process-mint job
    → provider.quoteMint(asset, amount) → quote stored
    → provider.initiateMint(asset, amount, walletAddress) → providerTransferId stored
    → status: PROVIDER_PROCESSING
    → enqueue check-mint-status job (delayed 30s)

7.  Worker: check-mint-status job
    → provider.getMintStatus(providerTransferId)
    → if complete → status: SETTLING
    → ledger.postEntry(mintCompleted, {...})
    → ledger.postEntry(stablecoinDistributed, {...})
    → status: COMPLETED

8.  DomainEvent written at every step.
    AuditLog entry written at every state change.
```

---

## Authentication & Authorization

- JWT-based: `POST /api/v1/auth/login` returns a signed JWT (8h TTL)
- Token stored in `localStorage` on the frontend (key: `treasury_token`)
- Every API route is behind `authenticate` Fastify hook (verifies JWT)
- Role-based access:
  - `ADMIN` — full access
  - `OPERATOR` — can create/submit/fund requests; cannot approve own submissions
  - `COMPLIANCE` — read-only on all routes + can run compliance checks
  - `VIEWER` — read-only everywhere
- Dual-approval: the approver and submitter must be different users (`approval.actorId !== mintRequest.createdBy`)

---

## OpenTelemetry Tracing

- `@opentelemetry/sdk-node` configured in `apps/api/src/telemetry.ts`
- OTLP exporter → configurable endpoint (`OTEL_EXPORTER_OTLP_ENDPOINT`)
- Docker Compose includes an Alloy collector forwarding to Grafana Cloud (configure in `otel-config.yml`)
- Spans are added to: every HTTP request (via @opentelemetry/instrumentation-fastify), every Prisma query (via @prisma/instrumentation), every BullMQ job lifecycle

---

## Database Schema Highlights

```prisma
// Core financial entities
MintRequest      — tracks wire-in → USDC issuance workflow
RedemptionRequest — tracks USDC/USDT burn → wire-out workflow
JournalEntry     — immutable; links to JournalLines
JournalLine      — debit/credit split, references account code
Wallet           — blockchain wallet registry with whitelist flag
BankAccount      — institutional bank accounts for entities

// Governance
Approval         — dual-approval records linked to mint/redeem requests
AuditLog         — append-only audit trail for all state changes
DomainEvent      — event sourcing store

// Compliance & Reporting
ComplianceProfile — per-entity KYC/KYB status, risk score
ReconciliationRun — triggered recon run with timestamp range
ReconciliationBreak — individual discrepancy requiring resolution
ProviderTransaction — external provider side of the ledger
BankTransaction  — bank wire data for three-way reconciliation
```

---

## Error Handling Strategy

- All API handlers wrap in try/catch; errors are transformed to `{ error, message, statusCode }` by a global error handler plugin
- BullMQ jobs use exponential backoff: 3 attempts, 2s / 8s / 32s delays
- Provider API failures are caught and stored as `PROVIDER_ERROR` sub-status (extensible); the job retries automatically
- Database connection failures crash the process (let the process supervisor restart it)

---

## Scaling Notes

- The API is stateless — horizontal scaling is safe; all state is in PostgreSQL + Redis
- BullMQ workers can be scaled independently from the API
- `BULLMQ_CONCURRENCY` env var controls per-worker concurrency (default: 5)
- The reconciliation engine runs in a BullMQ job context and can be time-limited; partial runs are tracked

---

## Local Development Tips

```bash
# Watch PostgreSQL logs
docker compose -f docker/docker-compose.yml logs -f postgres

# Open Prisma Studio (GUI for the database)
pnpm db:studio

# Run just the API and worker without the frontend
cd apps/api && pnpm dev
cd apps/worker && pnpm dev

# Re-run seed after a fresh migration
pnpm db:migrate && pnpm db:seed

# Tail worker logs
cd apps/worker && pnpm dev 2>&1 | tee worker.log
```

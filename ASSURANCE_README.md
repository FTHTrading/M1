# M1 Assurance OS — Developer Reference

The Assurance OS is the audit engine for the M1 Stablecoin Treasury Platform. It performs an
automated capability maturity assessment, scores public claims against provable evidence, and
produces a rating tier used for institutional due diligence.

---

## Architecture

```
packages/audit/          ← pure compute layer (no Prisma dependency)
  ├── capability-registry.ts   41 capabilities across 8 categories
  ├── claims-registry.ts       22 public claims mapped to evidence requirements
  ├── gap-registry.ts          15 known gaps with severity + remediation
  ├── collectors/              filesystem evidence collectors
  │   ├── schema-collector.ts      Prisma model names
  │   ├── api-collector.ts         API route files
  │   ├── package-collector.ts     workspace packages + dependencies
  │   └── docs-collector.ts        markdown + config files
  ├── scoring-engine.ts        capability scoring + claim derivation + category rollup
  └── index.ts                 public re-exports

apps/worker/src/jobs/runAudit.ts   BullMQ job: runs pipeline, persists to DB
apps/api/src/routes/assurance.ts   Fastify routes: 9 REST endpoints
apps/web/src/app/(app)/assurance/  5 Next.js pages: dashboard UI
```

The pipeline runs entirely in-process inside the worker. No external network calls are made.
Evidence is collected by scanning the local filesystem (monorepo root).

---

## Triggering an Audit Run

### Via the web UI

Navigate to **Assurance** in the sidebar, then click **Run Audit** on the overview page or
the Runs history page.

### Via the API

```http
POST /api/v1/assurance/runs
Authorization: Bearer <token>
Content-Type: application/json

{
  "notes": "optional description",
  "repoRoot": "/absolute/path/to/repo"   // omit to use process.cwd()
}
```

Response `202 Accepted`:

```json
{
  "runId": "clx...",
  "status": "QUEUED",
  "message": "Audit run queued"
}
```

The run progresses through `QUEUED → RUNNING → COMPLETED` (or `FAILED`). Poll
`GET /api/v1/assurance/runs/:id` for status. The runs page auto-polls every 5 seconds
while any run is in progress.

---

## Evidence Collection

Four collectors run in parallel and return an `AuditEvidence` object:

| Collector | What it scans | Key outputs |
|-----------|--------------|-------------|
| `schema-collector` | `packages/database/prisma/schema.prisma` | `prismaModels[]` — list of model names |
| `api-collector` | `apps/api/src/routes/*.ts` | `apiRouteFiles[]`, `routePatterns[]` |
| `package-collector` | `*/package.json` files across monorepo | `packageDirs[]`, `packageFileContents` Map, `npmDependencies` Set |
| `docs-collector` | `**/*.md`, `**/*.env.example`, `**/*.yml` | `docFiles[]`, `envVarNames[]` |

Evidence is fully deterministic: the same repo state produces the same evidence object and
therefore the same score.

---

## Scoring Methodology

### Capability scoring

Each capability starts at a `baseScore` defined in `capability-registry.ts`, then the scoring
engine applies modifiers:

```
maturityScore = baseScore
             + evidenceBoost   (found relevant evidence items)
             - evidencePenalty (expected evidence items not found)
             × confidenceMultiplier
```

| Confidence | Multiplier |
|------------|-----------|
| `HIGH`     | 1.00      |
| `MEDIUM`   | 0.90      |
| `LOW`      | 0.75      |

Scores are clamped to `[0, 100]`.

### Capability status thresholds

| Status | Condition |
|--------|-----------|
| `LIVE` | Score ≥ 85, HIGH confidence |
| `IMPLEMENTED` | Score ≥ 70 |
| `PARTIAL` | Score ≥ 50 |
| `SIMULATED` | Score ≥ 30 |
| `DOCUMENTED_ONLY` | Score ≥ 15 |
| `MISSING` | Score < 15 |

### Category rollup

Each category has a configurable weight. The overall score is a weighted average:

| Category | Weight |
|----------|--------|
| Core Infrastructure | 2.0 |
| Financial Operations | 2.0 |
| Compliance & Regulatory | 1.8 |
| Operations & Recovery | 1.5 |
| Provider Integrations | 1.5 |
| Chain Settlement | 1.2 |
| Monitoring & Analytics | 1.0 |
| AI & Automation | 0.8 |

### Rating tier mapping

| Score | Tier | Meaning |
|-------|------|---------|
| ≥ 90 | AAA | Institutional-grade, audit-ready |
| ≥ 80 | AA  | Near-production, minor gaps only |
| ≥ 70 | A   | Production-capable, documented gaps |
| ≥ 60 | BBB | Functional with material gaps |
| ≥ 50 | BB  | Prototype/beta, not production-ready |
| ≥ 40 | B   | Early-stage, significant work remaining |
| < 40  | C   | Pre-alpha / foundational only |

### Expected score

Based on the current codebase state the pipeline is expected to return approximately **68–73**,
placing the platform in the **A** tier. The core operational stack (database, API, auth, worker,
orchestration, compliance engine) scores strongly at 80+. External system integrations (Apostle
Chain, x402 settlement, live RPC connections) pull the average down because they cannot be fully
verified by filesystem evidence alone.

---

## Capability Registry

### 8 categories, 41 capabilities

**Core Infrastructure** (8 caps)
`database-connectivity`, `api-server`, `authentication`, `worker-queue`, `environment-config`,
`monorepo-structure`, `typescript-strict`, `orm-integration`

**Financial Operations** (6 caps)
`usdf-mint-burn`, `reserve-management`, `stablecoin-price-oracle`, `multi-asset-ledger`,
`transaction-history`, `fee-engine`

**Compliance & Regulatory** (7 caps)
`aml-kyc-framework`, `jurisdiction-rules`, `transaction-monitoring`, `compliance-reports`,
`audit-trail`, `regulatory-filing`, `sanctions-screening`

**Operations & Recovery** (5 caps)
`health-endpoints`, `graceful-shutdown`, `error-boundaries`, `backup-restore`,
`incident-runbooks`

**Provider Integrations** (4 caps)
`banking-api-integration`, `payment-processor`, `email-notifications`, `document-storage`

**Chain Settlement** (4 caps)
`apostle-chain-settlement`, `xrpl-bridge`, `stellar-bridge`, `on-chain-attestation`

**Monitoring & Analytics** (4 caps)
`structured-logging`, `metrics-collection`, `alerting`, `dashboard-analytics`

**AI & Automation** (3 caps)
`ai-compliance-review`, `automated-reporting`, `anomaly-detection`

---

## Gap Registry

### Summary (15 gaps)

| Severity | Count | Examples |
|----------|-------|---------|
| CRITICAL | 2 | `live-banking-connection`: no live banking API keys in env; `apostle-chain-live`: settlement calls unverified outside EC2 |
| HIGH | 4 | `xrpl-mainnet-live`, `kyc-provider-live`, `real-time-price-oracle`, `pagerduty-alerting` |
| MEDIUM | 4 | `stellar-mainnet-untested`, `sanctions-list-live`, `email-provider-configured`, `backup-automated` |
| LOW | 3 | `metrics-exporter-running`, `document-storage-configured`, `ai-review-endpoint-live` |
| INFORMATIONAL | 2 | `audit-log-retention-policy`, `incident-runbooks-tested` |

The two CRITICAL gaps represent external infrastructure that must be in place before production launch. These are tracked and displayed prominently in the web dashboard.

---

## Claim Assessment

The scoring engine derives `ClaimSupportStatus` for each of the 22 public claims by mapping
required capability statuses to a support level:

| Support | Meaning |
|---------|---------|
| `SUPPORTED` | All required capabilities are LIVE or IMPLEMENTED |
| `PARTIALLY_SUPPORTED` | Some required caps are PARTIAL or SIMULATED |
| `WEAKLY_SUPPORTED` | At least one required cap is DOCUMENTED_ONLY |
| `UNSUPPORTED` | At least one required cap is MISSING |
| `MARKETING_ONLY` | Claim has no evidentiable capability mapping |
| `CANNOT_VERIFY` | Insufficient evidence to assess |

---

## Database Schema

All Assurance OS data lives in 7 new tables added to `packages/database/prisma/schema.prisma`:

```
AuditRun              — top-level run record with score + tier
CapabilityAssessment  — one row per capability per run
CapabilityEvidenceItem — one row per evidence item per capability
ClaimAssessment       — one row per claim per run
AssuranceGapItem      — one row per gap per run (with resolve support)
AssuranceRatingScore  — one row per category score per run
AuditSnapshot         — full JSON export of each completed run
```

---

## REST API Reference

All routes are prefixed `/api/v1/assurance` and require Bearer auth.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/overview` | Latest completed run summary for the dashboard |
| POST | `/runs` | Enqueue a new audit run (202 Accepted) |
| GET | `/runs` | Paginated run history (50 per page, `?page=N`) |
| GET | `/runs/:id` | Run header + all category scores |
| GET | `/runs/:id/capabilities` | Capabilities (`?category=`, `?status=`) |
| GET | `/runs/:id/claims` | Claims (`?support=`, `?category=`) |
| GET | `/runs/:id/gaps` | Gaps (`?severity=`, `?resolved=true|false`) |
| PATCH | `/runs/:runId/gaps/:gapId/resolve` | Resolve a gap with optional note |
| GET | `/runs/:id/snapshot` | Download full JSON snapshot as attachment |

---

## Extending the Registry

### Adding a new capability

Edit `packages/audit/src/capability-registry.ts`:

```typescript
{
  key: "my-new-capability",
  category: "Core Infrastructure",
  title: "My New Capability",
  description: "One sentence describing what this proves.",
  weight: 1.0,              // relative importance within category
  baseScore: 60,            // score before evidence evaluation
  evidenceHints: [          // strings to search for in evidence
    "my-model-name",
    "my-route-file",
  ],
}
```

Then add scoring logic in `packages/audit/src/scoring-engine.ts` to boost/penalise based
on whether the evidence hints are found. Re-run an audit to see the updated score.

### Adding a new gap

Edit `packages/audit/src/gap-registry.ts`:

```typescript
{
  gapKey: "my-gap",
  severity: "HIGH",
  category: "Core Infrastructure",
  title: "Short title",
  description: "What is missing and why it matters.",
  affectedClaims: ["claim-key-1"],
  remediation: "Steps to close the gap.",
  effortEstimate: "2 weeks",
  externalDep: false,
}
```

The gap will appear automatically in all future audit runs.

---

## Running Locally

```bash
# Install dependencies
pnpm install

# Generate Prisma client (after schema changes)
pnpm --filter @treasury/database db:generate

# Run a migration in development
pnpm --filter @treasury/database db:migrate:dev

# Trigger an audit run via curl (requires API running)
curl -X POST http://localhost:3001/api/v1/assurance/runs \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"notes": "local dev run"}'

# Watch worker logs to see audit pipeline output
pnpm --filter @treasury/worker dev
```

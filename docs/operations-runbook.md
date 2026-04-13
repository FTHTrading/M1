# Operations Runbook

Day-to-day operational procedures for running the Stablecoin Treasury OS in production.

---

## Daily Operating Checklist

- [ ] Review pending mint requests older than 2 hours — escalate if WIRE_SUBMITTED but no FUNDING_CONFIRMED
- [ ] Review BullMQ dead-letter queue — clear or re-queue failed jobs
- [ ] Confirm reconciliation for the prior business day ran and has zero open breaks
- [ ] Check Circle webhook delivery logs in Circle console for any undelivered events
- [ ] Verify provider health endpoints return `healthy: true`

---

## Starting Services

### Local development

```bash
# Start infrastructure (PostgreSQL + Redis)
pnpm db:up

# Start all services in watch mode
pnpm dev

# Or individually
cd apps/api && pnpm dev        # Fastify on :4000
cd apps/worker && pnpm dev     # BullMQ workers
cd apps/web && pnpm dev        # Next.js on :3000
```

### Production (Docker Compose)

```bash
# Build all images
docker compose -f docker/docker-compose.yml --profile production build

# Start all
docker compose -f docker/docker-compose.yml --profile production up -d

# Check status
docker compose -f docker/docker-compose.yml ps

# View logs
docker compose -f docker/docker-compose.yml logs -f api worker
```

### Environment variable validation

On startup, `packages/config` runs Zod validation. If any required variable is missing, the process throws immediately with a clear message:

```
ZodError: [
  { code: 'invalid_type', path: ['CIRCLE_API_KEY'], message: 'Required' }
]
```

Fix: set the missing variable in `.env` and restart.

---

## Mint Request Lifecycle Management

### Request stuck in WIRE_SUBMITTED

**Symptom**: Mint request has been in `WIRE_SUBMITTED` for more than 2 business hours.

**Steps**:
1. Check Circle console for the wire matching: navigate to **Payments** → **Wire Transfers** → find by wire reference
2. If Circle received the wire but the webhook wasn't delivered:
   - Circle console → **Notifications** → **Subscriptions** → check delivery logs
   - Re-deliver the webhook manually from Circle's console
3. If Circle hasn't received the wire:
   - Contact the sending bank with the wire reference number
   - Once confirmed received, manually advance via API:
     ```bash
     curl -X POST http://localhost:4000/api/v1/mint/{id}/confirm-funding \
       -H "Authorization: Bearer $ADMIN_JWT" \
       -H "Content-Type: application/json" \
       -d '{"bankTransactionId": "btxn_xxx"}'
     ```
4. If wire is not coming (cancelled), use:
   ```bash
   curl -X POST http://localhost:4000/api/v1/mint/{id}/cancel \
     -H "Authorization: Bearer $ADMIN_JWT"
   ```

### Request stuck in PROVIDER_PROCESSING

**Symptom**: Mint request has been in `PROVIDER_PROCESSING` for more than 4 hours (Circle usually settles in under 1 hour).

**Steps**:
1. Locate the `providerTransferId` in the mint request detail
2. Check Circle directly:
   ```bash
   curl https://api.circle.com/v1/businessAccount/payouts/{providerTransferId} \
     -H "Authorization: Bearer $CIRCLE_API_KEY"
   ```
3. If Circle shows `complete`, the `check-mint-status` job may be stuck:
   - Check BullMQ (use Bull Board at http://localhost:4000/admin/queues)
   - Find the job and check its status; if `failed`, re-queue it:
     ```bash
     curl -X POST http://localhost:4000/api/v1/admin/jobs/requeue \
       -H "Authorization: Bearer $ADMIN_JWT" \
       -d '{"queue": "mint-workflow", "jobId": "..."}'
     ```

---

## Redemption Request Lifecycle Management

### Request stuck in WIRE_PENDING

**Symptom**: Redemption is complete on the provider side (USDC burned) but no wire confirmation received.

**Steps**:
1. Check your bank's wire notifications — the wire may have arrived but the wire-matching logic didn't fire
2. Import the bank transaction manually:
   ```bash
   curl -X POST http://localhost:4000/api/v1/bank-transactions \
     -H "Authorization: Bearer $ADMIN_JWT" \
     -d '{"redemptionId": "...", "amount": 100000, "wireRef": "...", "settledAt": "..."}'
   ```
3. This will trigger the `processRedemption` job which marks the request `COMPLETED` and writes the final ledger entries

---

## BullMQ Queue Management

### Access Bull Board

Bull Board is mounted at `http://localhost:4000/admin/queues` (admin only). It shows:
- Queue depths (waiting, active, delayed, completed, failed)
- Job details (input, output, error, retry count)
- Ability to retry or remove individual jobs

### Retry a failed job via API

```bash
curl -X POST http://localhost:4000/api/v1/admin/jobs/retry \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"queue": "mint-workflow", "jobId": "job_xxx"}'
```

### Retry all failed jobs in a queue

```bash
curl -X POST http://localhost:4000/api/v1/admin/jobs/retry-all-failed \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{"queue": "mint-workflow"}'
```

### Clear the dead letter queue

If failed jobs are accumulating and you want to discard them (use with caution):
```bash
curl -X DELETE http://localhost:4000/api/v1/admin/queues/mint-workflow/failed \
  -H "Authorization: Bearer $ADMIN_JWT"
```

---

## Reconciliation Cadence

The standard reconciliation cadence is:

| Frequency | Coverage |
|-----------|----------|
| Daily (end of business) | Prior 24h window per entity |
| Weekly | Rolling 7-day per entity |
| Monthly | Full calendar month |

### Running reconciliation manually

```bash
curl -X POST http://localhost:4000/api/v1/reconciliation/run \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "entityId": "entity_uuid",
    "windowStart": "2025-01-01T00:00:00Z",
    "windowEnd": "2025-01-31T23:59:59Z"
  }'
```

Or use the Reconciliation page in the UI.

### Resolving breaks

When a `ReconciliationBreak` is opened:
1. Review the break details — compare ledger amount vs bank amount vs provider amount
2. Identify the source of discrepancy (missing bank transaction import, duplicate journal entry, provider fee not captured)
3. Fix the root cause:
   - Missing journal entry → post a reconciliation adjustment via `ledger.postEntry(reconAdjustment, {...})`
   - Missing bank record → import the bank transaction manually
   - Provider fee discrepancy → check if fee accounting template was applied correctly
4. Mark the break resolved via API:
   ```bash
   curl -X POST http://localhost:4000/api/v1/reconciliation/breaks/{id}/resolve \
     -H "Authorization: Bearer $ADMIN_JWT" \
     -d '{"note": "Adjusted for Circle wire fee not captured in original entry"}'
   ```

---

## Database Operations

### Connect to PostgreSQL directly

```bash
docker exec -it treasury-postgres psql -U treasury -d treasury_os
```

### Run ad-hoc Prisma queries

```bash
cd packages/database
npx prisma studio      # GUI at localhost:5555
```

### Backup the database

```bash
docker exec treasury-postgres pg_dump -U treasury treasury_os > backup_$(date +%Y%m%d).sql
```

### Restore from backup

```bash
cat backup_20250101.sql | docker exec -i treasury-postgres psql -U treasury -d treasury_os
```

### Running a migration in production

```bash
# Always dry-run first
DATABASE_URL=$PROD_DB_URL npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource prisma/schema.prisma

# Apply
DATABASE_URL=$PROD_DB_URL npx prisma migrate deploy
```

---

## Monitoring & Alerting

### Key metrics to watch

| Metric | Alert threshold |
|--------|----------------|
| Mint requests in `PROVIDER_PROCESSING` > 4h | Page on-call |
| BullMQ failed jobs in mint-workflow | Alert after 3 consecutive failures |
| Reconciliation breaks unresolved > 24h | Alert compliance team |
| Provider health `healthy: false` > 5 min | Alert on-call |
| API error rate > 1% | Alert on-call |
| API p99 latency > 2s | Alert on-call |

### OpenTelemetry traces

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to your Grafana / Jaeger endpoint. All API requests, BullMQ jobs, and key Prisma queries are instrumented.

### Structured logs

All services log JSON to stdout. In production, pipe to your logging stack:

```bash
docker compose logs -f api | jq '.'
```

Key log fields:
- `level` — info / warn / error
- `requestId` — unique per HTTP request
- `jobId` — BullMQ job ID
- `mintRequestId` / `redemptionRequestId` — for correlation
- `actorId` — authenticated user ID who triggered the action

---

## User Management

### Create a new admin user

```bash
curl -X POST http://localhost:4000/api/v1/users \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"email": "new@example.com", "name": "New Admin", "role": "ADMIN", "password": "..."}'
```

Roles: `ADMIN`, `OPERATOR`, `COMPLIANCE`, `VIEWER`

### Reset a user's password

```bash
curl -X PATCH http://localhost:4000/api/v1/users/{userId} \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{"password": "new_secure_password"}'
```

Passwords are hashed with bcrypt (factor 12). Never store plaintext.

---

## Emergency Shutdown Procedure

If a security incident requires immediately stopping all live transfers:

1. **Feature flag kill-switch** (preferred — no restart needed):
   ```bash
   curl -X PATCH http://localhost:4000/api/v1/admin/config \
     -H "Authorization: Bearer $ADMIN_JWT" \
     -d '{"FEATURE_LIVE_TRANSFERS": false}'
   ```
   This causes the policy engine to block all new mint/redeem requests immediately.

2. **Stop the workers** to halt in-flight jobs:
   ```bash
   docker compose -f docker/docker-compose.yml stop worker
   ```

3. **Notify Circle** if live Circle API access needs to be revoked:
   - Circle console → Settings → API Keys → Revoke

4. Review the audit log for the incident window:
   ```bash
   curl "http://localhost:4000/api/v1/audit?startDate=2025-01-01T00:00:00Z" \
     -H "Authorization: Bearer $ADMIN_JWT"
   ```

# Compliance Controls

This document describes the compliance policy engine implemented in `packages/compliance` and how to configure, extend, and audit it.

---

## Architecture

The compliance engine is a pure synchronous function:

```typescript
evaluate(request: PolicyEvaluationInput): PolicyEvaluationResult

interface PolicyEvaluationInput {
  type: 'mint' | 'redemption';
  entityId: string;
  walletId: string;
  asset: 'USDC' | 'USDT';
  fiatAmountCents: bigint;
  stablecoinUnits?: bigint;
  actorId: string;
}

interface PolicyEvaluationResult {
  allowed: boolean;
  requiresApproval: boolean;
  reasons: string[];
}
```

Rules are evaluated in order, short-circuiting at the first blocking rule. The result is stored in the `MintRequest` or `RedemptionRequest` record for audit purposes.

---

## Rules

### Rule 1 — Sandbox Only (`sandboxOnly`)

**Source**: `FEATURE_SANDBOX_ONLY` environment variable  
**Default**: `true` (blocks all live transfers by default, safe for development)

When `FEATURE_SANDBOX_ONLY=true`, all requests receive:
```json
{ "allowed": false, "reasons": ["Live transfers blocked: FEATURE_SANDBOX_ONLY is enabled"] }
```

To allow live transfers, set **both**:
```
FEATURE_SANDBOX_ONLY=false
FEATURE_LIVE_TRANSFERS=true
```

Both flags must be set; either alone is insufficient. This two-key design prevents accidental activation.

---

### Rule 2 — Wallet Whitelist (`walletWhitelist`)

**Source**: `Wallet.isWhitelisted` flag in the database

Only wallets explicitly added to the `Wallet` registry and marked `isWhitelisted=true` may receive minted stablecoins or send redemptions.

**Block condition**: `Wallet.id = request.walletId AND isWhitelisted = false`

To whitelist a wallet:
```bash
curl -X PATCH http://localhost:4000/api/v1/wallets/{walletId} \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{"isWhitelisted": true}'
```

Or use the toggle in the Wallets page of the UI.

---

### Rule 3 — KYC Required (`kycRequired`)

**Source**: `ComplianceProfile.kycStatus` field

All entities (individuals and institutions) must complete KYC before any transaction is permitted.

**Allowed values**: `APPROVED`  
**Blocking values**: `PENDING`, `FAILED`, `EXPIRED`, `NOT_STARTED`

To update KYC status (ADMIN/COMPLIANCE role required):
```bash
curl -X PATCH http://localhost:4000/api/v1/compliance/{entityId}/kyc \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{"kycStatus": "APPROVED"}'
```

---

### Rule 4 — KYB Required (`kybRequired`)

**Source**: `ComplianceProfile.kybStatus` field

In addition to KYC (individual identity), institutional entities must complete KYB (business verification). For individual accounts, KYB is not required and this rule is skipped.

**Applies to**: entities with `Entity.type = 'INSTITUTION'`

---

### Rule 5 — Sanctions Screening (`sanctionsScreening`)

**Source**: `ComplianceProfile.screeningStatus` field

Every entity is screened against OFAC's Specially Designated Nationals list and other applicable sanctions lists before any transaction proceeds.

**Blocking value**: `FLAGGED`

A `FLAGGED` entity:
- Cannot initiate any mint or redemption request
- All existing in-progress requests are put into manual review
- The `ComplianceFlagRaised` domain event is emitted

To clear a screening flag (requires COMPLIANCE or ADMIN role + documented review):
```bash
curl -X POST http://localhost:4000/api/v1/compliance/{entityId}/screening/clear \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{"note": "Reviewed on 2025-01-15 — confirmed false positive, entity cleared"}'
```

This action is permanently recorded in the AuditLog with the `note`.

**Live screening integration**: The current implementation uses the `ComplianceProfile.screeningStatus` field which you update manually or via a third-party screening service webhook. To integrate a live screening service (e.g., Elliptic, Chainalysis, Acuris):
1. Implement a webhook receiver at `/api/v1/webhooks/screening`
2. Update `ComplianceProfile.screeningStatus` based on the alert
3. Emit the `ComplianceFlagRaised` event

---

### Rule 6 — Velocity Limit (`velocityLimit`)

**Source**: `MAX_SINGLE_TX_CENTS` environment variable (default: 10,000,000 = $100,000)

**Checks**:
1. **Single transaction limit**: The request amount must not exceed `MAX_SINGLE_TX_CENTS`
2. **24-hour rolling limit**: The sum of all `COMPLETED` mint requests for the entity in the past 24 hours plus the current request must not exceed `MAX_SINGLE_TX_CENTS × 10`

**Block condition**: Either limit is exceeded

To increase limits for a specific entity (use sparingly — requires ADMIN role):
```bash
curl -X PATCH http://localhost:4000/api/v1/compliance/{entityId}/limits \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{"singleTxLimitCents": 50000000, "dailyLimitCents": 200000000}'
```

Entity-level overrides take precedence over the global config limit.

---

### Rule 7 — Dual Approval (`dualApproval`)

**Source**: `APPROVAL_THRESHOLD_CENTS` environment variable (default: 5,000,000 = $50,000)

Any request with `fiatAmountCents >= APPROVAL_THRESHOLD_CENTS` requires approval from a second authorized user before it can proceed.

**Requirements**:
- Approver must have role `OPERATOR` or `ADMIN`
- Approver must be a **different user** from the submitter (`approval.actorId !== request.createdBy`)
- Rejection by any approver cancels the request immediately

The approval flow:
1. Request is created and submitted → status: `PENDING_APPROVAL`
2. Visible in the Approvals queue for all eligible approvers
3. First eligible approver records their decision
4. If `APPROVED` → status: `PENDING_FUNDING`, workflow continues
5. If `REJECTED` → status: `CANCELLED`, `DomainEvent` emitted

---

## AML / KYT (Know Your Transaction)

The current release implements basic rule-based AML at the policy layer. For full AML compliance (Travel Rule, on-chain analytics), integrate a KYT provider:

| Provider | Use case |
|----------|----------|
| Chainalysis KYT | Real-time on-chain transaction risk scoring |
| Elliptic Lens | Cross-asset wallet screening |
| TRM Labs | Multi-chain transaction monitoring |

The `ComplianceProfile.riskScore` field accepts a 0–100 value from your KYT provider. Set `COMPLIANCE_RISK_SCORE_THRESHOLD` to auto-flag entities above a score threshold.

---

## Blocked Jurisdictions

To apply jurisdiction-based blocking (OFAC embargo, FATF blacklist), add entries to the `BlockedJurisdiction` table:

```sql
INSERT INTO "BlockedJurisdiction" (country_code, reason, added_by, added_at)
VALUES ('KP', 'OFAC - North Korea', 'admin@treasury.com', NOW());
```

The compliance engine checks `Entity.country` against this table on every evaluation. Entities from blocked jurisdictions receive:
```json
{ "allowed": false, "reasons": ["Jurisdiction KP is blocked (OFAC - North Korea)"] }
```

---

## Compliance Audit Trail

Every compliance evaluation is logged to the `AuditLog`:

```json
{
  "action": "COMPLIANCE_EVALUATED",
  "entityType": "MintRequest",
  "entityId": "uuid",
  "actorId": "system",
  "metadata": {
    "result": { "allowed": true, "requiresApproval": true, "reasons": ["Dual approval required: $75,000 >= threshold"] },
    "rules": [
      { "rule": "sandboxOnly", "passed": true },
      { "rule": "walletWhitelist", "passed": true },
      { "rule": "kycRequired", "passed": true },
      { "rule": "kybRequired", "passed": true },
      { "rule": "sanctionsScreening", "passed": true },
      { "rule": "velocityLimit", "passed": true },
      { "rule": "dualApproval", "passed": true, "note": "requires approval" }
    ]
  }
}
```

Every approval decision is also logged:
```json
{
  "action": "APPROVAL_RECORDED",
  "entityType": "MintRequest",
  "entityId": "uuid",
  "actorId": "approver-user-id",
  "metadata": {
    "decision": "APPROVE",
    "note": "Reviewed client documents, approved.",
    "requestAmount": 7500000
  }
}
```

---

## Configuring Policy Thresholds

| Variable | Default | Description |
|----------|---------|-------------|
| `FEATURE_SANDBOX_ONLY` | `true` | Block all live transfers |
| `FEATURE_LIVE_TRANSFERS` | `false` | Allow live provider API calls |
| `ENABLE_USDT` | `false` | Enable USDT mint/redeem flow |
| `MAX_SINGLE_TX_CENTS` | `10000000` | $100,000 single transaction cap |
| `APPROVAL_THRESHOLD_CENTS` | `5000000` | $50,000 dual-approval threshold |
| `COMPLIANCE_RISK_SCORE_THRESHOLD` | `75` | Auto-flag KYT risk score above this |
| `VELOCITY_WINDOW_HOURS` | `24` | Rolling window for velocity check |

---

## Compliance Page in the UI

The **Compliance** page (`/compliance`) provides:
- A table of all `ComplianceProfile` records with KYC/KYB/screening status and risk score
- An **Evaluate** dialog — run the policy engine against a hypothetical request for any entity, showing which rules pass/fail and whether approval would be required
- This dialog is read-only (it does not create any records) — safe for pre-flight checks

---

## Extending the Policy Engine

To add a new compliance rule:

1. Add the rule function to `packages/compliance/src/policy.ts`:
   ```typescript
   function myNewRule(input: PolicyEvaluationInput, profile: ComplianceProfile): RuleResult {
     const blocked = /* your condition */;
     return {
       rule: 'myNewRule',
       passed: !blocked,
       blocking: blocked,
       reason: blocked ? 'Reason why blocked' : undefined,
     };
   }
   ```

2. Register it in the `RULES` array in the same file (order matters — earlier rules short-circuit later ones)

3. Add the rule name to the `PolicyRule` union type in `packages/types`

4. Add tests in `packages/compliance/src/__tests__/policy.test.ts`

5. Document the rule in this file

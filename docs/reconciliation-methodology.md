# Reconciliation Methodology

This document describes the three-way reconciliation engine in `packages/reconciliation`, the types of breaks it detects, and the process for resolving them.

---

## Overview

The reconciliation engine compares three independent views of the same financial activity over a given time window:

1. **Ledger view** — What the double-entry journal says happened (`JournalLine` rows)
2. **Bank view** — What the bank's wire confirmation records say happened (`BankTransaction` rows)
3. **Provider view** — What the stablecoin provider's API says happened (`ProviderTransaction` rows)

All three views should agree. When they disagree beyond the configured tolerance, a `ReconciliationBreak` is created for manual review.

---

## When to Run Reconciliation

| Trigger | Description |
|---------|-------------|
| **End of Business Day (automated)** | A scheduled BullMQ job runs at 18:00 local time for the prior 24h window for each active entity |
| **Manual trigger** | Operators or Compliance can trigger a run via the UI or API at any time |
| **After incident recovery** | Always run reconciliation after manually correcting a stuck workflow |
| **Before monthly close** | Run a full-month reconciliation before reporting |

---

## Algorithm

### Step 1 — Collect the Ledger View

```typescript
const ledgerLines = await prisma.journalLine.findMany({
  where: {
    journalEntry: {
      entityId: run.entityId,
      createdAt: { gte: run.windowStart, lte: run.windowEnd },
    },
    accountCode: { in: CASH_AND_STABLECOIN_ACCOUNTS },
  },
});

const ledgerByAsset = groupBy(ledgerLines, line => assetFromAccountCode(line.accountCode));
// Sum: debitCents - creditCents per asset = net movement
```

Relevant accounts for mint activity:
- `1001 FIAT_CASH` — inbound wire receipts
- `1101 USDC_INVENTORY` — USDC minted
- `1102 USDT_INVENTORY` — USDT minted

For redemption activity:
- `2101 CLIENT_OBLIGATIONS_USDC` — USDC burned
- `1001 FIAT_CASH` — outbound wire sent

### Step 2 — Collect the Bank View

```typescript
const bankTxns = await prisma.bankTransaction.findMany({
  where: {
    entityId: run.entityId,
    settledAt: { gte: run.windowStart, lte: run.windowEnd },
  },
});

const bankTotal = bankTxns.reduce((sum, t) => sum + t.amountCents, 0n);
```

`BankTransaction` rows are created by:
- The `match-wire-event` BullMQ job (matches inbound wire to a mint request)
- Manual import by an operator (for wires that weren't auto-matched)

### Step 3 — Collect the Provider View

```typescript
const providerTxns = await prisma.providerTransaction.findMany({
  where: {
    entityId: run.entityId,
    settledAt: { gte: run.windowStart, lte: run.windowEnd },
    status: 'COMPLETED',
  },
});
```

`ProviderTransaction` rows are created by:
- The `process-mint` / `process-redemption` workers when they call `provider.initiateMint()`
- Provider webhook events updating status to `COMPLETED`

### Step 4 — Compare and Detect Breaks

Three comparisons are made:

**Ledger vs Bank**
```
break if abs(ledgerFiatNet - bankFiatTotal) > RECON_TOLERANCE_CENTS
```
This catches: missing bank imports, duplicate journal entries, incorrect wire amounts.

**Ledger vs Provider**
```
break if abs(ledgerStablecoinNet - providerStablecoinTotal) > RECON_TOLERANCE_UNITS
```
This catches: provider transactions not reflected in the ledger, incorrect ledger amounts.

**Bank vs Provider** (cross-check)
```
break if abs(bankFiatTotal - providerFiatEquivalent) > RECON_TOLERANCE_CENTS
```
This catches: fee discrepancies between bank and provider, FX rounding issues.

### Step 5 — Write Results

```typescript
await prisma.reconciliationRun.update({
  where: { id: run.id },
  data: {
    status: breaks.length === 0 ? 'CLEAN' : 'BREAKS_DETECTED',
    completedAt: new Date(),
    ledgerFiatCents: ledgerFiatNet,
    bankFiatCents: bankFiatTotal,
    providerFiatCents: providerFiatEquivalent,
  },
});

for (const b of breaks) {
  await prisma.reconciliationBreak.create({ data: b });
  await events.emit('ReconciliationBreakDetected', b);
}
```

---

## Break Types

### `LEDGER_BANK_MISMATCH`

**Meaning**: The ledger records a different fiat amount than what the bank recorded.

**Common causes**:
- A wire arrived at the bank but the `BankTransaction` row was never created (auto-matching failed)
- A journal entry was posted with the wrong amount (data-entry error)
- A duplicate journal entry was accidentally posted

**Resolution**:
1. Compare the specific `JournalEntry` records with the bank's wire statement
2. If a bank transaction is missing: create it via `POST /api/v1/bank-transactions`
3. If a journal entry has wrong amount: post a `reconAdjustment` journal entry to correct the variance
4. Resolve the break with a note

### `LEDGER_PROVIDER_MISMATCH`

**Meaning**: The ledger records a different stablecoin amount than what the provider settled.

**Common causes**:
- Provider network fee wasn't captured in the ledger (fee accounts not debited)
- A provider transaction completed but the webhook wasn't received, and the job didn't poll
- Circle Sandbox behavior differs from production (amounts rounded differently)

**Resolution**:
1. Pull the provider transaction directly: `GET /api/v1/providers/transactions/{providerRef}`
2. Compare the `stablecoinUnits` and `fee` fields
3. Post a `mintFeesAccrued` or `reconAdjustment` entry to capture the missing fee
4. Resolve the break

### `BANK_PROVIDER_MISMATCH`

**Meaning**: The bank wire amount doesn't match the provider's fiat input amount.

**Common causes**:
- Bank wire fee deducted by the sending bank (reduces the amount Circle receives)
- FX conversion when wires cross currency jurisdictions
- Correspondent bank charges on international wires

**Resolution**:
1. Identify whether the discrepancy is a bank fee or FX effect
2. If bank fee: post a `FEES_NETWORK` debit journal entry for the fee amount, then adjust the `FIAT_CASH` credit
3. If FX: post a `FEES_FX` entry capturing the FX spread
4. Update the `BankTransaction.amountCents` if the recorded amount was incorrect

---

## Tolerance Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `RECON_TOLERANCE_CENTS` | `100` | $1.00 fiat tolerance before creating a break |
| `RECON_TOLERANCE_UNITS` | `1000000` | 1 USDC (6-decimal units) provider tolerance |

These tolerances exist to absorb rounding differences in floating-point API responses. Set to `0` for strict mode (any discrepancy creates a break).

---

## ReconciliationRun States

| Status | Meaning |
|--------|---------|
| `RUNNING` | Engine is currently executing for this run |
| `CLEAN` | All three views agreed within tolerance |
| `BREAKS_DETECTED` | One or more `ReconciliationBreak` rows created |
| `FAILED` | Engine threw an unhandled exception; check logs |

---

## ReconciliationBreak States

| Status | Meaning |
|--------|---------|
| `OPEN` | Not yet reviewed |
| `UNDER_REVIEW` | Operator is investigating |
| `RESOLVED` | Root cause identified and corrected |
| `DISPUTED` | Break is disputed with the bank or provider |

---

## Reconciliation in the UI

The **Reconciliation** page (`/reconciliation`) shows:

**Runs panel** — lists all `ReconciliationRun` records with entity, window, status, and break count. Clicking a run filters the breaks panel to that entity.

**Breaks panel** — lists `ReconciliationBreak` records filtered by entity and status. Operators can:
- Filter by `OPEN` (default) to see only items needing attention
- Click **Resolve** on any break → opens a dialog to enter the resolution note → marks break `RESOLVED`

**Run button** — opens a dialog to trigger a new reconciliation run for a selected entity and date range.

---

## Three-Way Recon Diagram

```
            ┌─────────────┐
            │ LEDGER VIEW  │
            │ JournalLines │
            └──────┬───────┘
                   │
          ┌────────┴────────┐
          │                  │
    ┌─────▼──────┐    ┌──────▼──────┐
    │ BANK VIEW   │    │PROVIDER VIEW│
    │ BankTxns    │    │ ProviderTxns│
    └─────┬───────┘    └──────┬──────┘
          │                  │
          └────────┬──────────┘
                   │
            ┌──────▼──────────┐
            │ Three comparisons│
            │ L vs B           │
            │ L vs P           │
            │ B vs P           │
            └──────┬──────────┘
                   │
       ┌───────────┴───────────┐
       │                       │
  ┌────▼─────┐          ┌──────▼──────┐
  │  CLEAN   │          │BREAKS_DETECTED│
  │ run ends │          │ N breaks created│
  └──────────┘          └─────────────┘
```

---

## Audit Trail for Reconciliation

Every reconciliation action is recorded in `AuditLog`:
- `RECONCILIATION_RUN_STARTED` — run ID, entity, window
- `RECONCILIATION_BREAK_DETECTED` — break ID, type, amounts
- `RECONCILIATION_BREAK_RESOLVED` — break ID, operator, note
- `RECONCILIATION_RUN_COMPLETED` — run status, break count

These events are surfaced in the **Audit Log** page with `entityType=ReconciliationRun` filter.

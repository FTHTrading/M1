/**
 * Double-entry ledger engine for Stablecoin Treasury OS.
 *
 * Every financial workflow step MUST post balanced journal entries here.
 * All amounts are in integer cents (bigint) to avoid floating-point errors.
 *
 * Account codes:
 *   1001 — Fiat Cash — Operating (ASSET)
 *   1002 — Pending Fiat Settlement (ASSET)
 *   1101 — USDC Inventory (ASSET)
 *   1102 — USDT Inventory (ASSET)
 *   1201 — Receivables — Provider (ASSET)
 *   1501 — Custodial Reserve (ASSET)
 *   2001 — Payables — Provider (LIABILITY)
 *   2101 — Client Obligations — USDC (LIABILITY)
 *   2102 — Client Obligations — USDT (LIABILITY)
 *   5001 — Fees Expense — Network (EXPENSE)
 *   5002 — Fees Expense — Custody (EXPENSE)
 *   5003 — Fees Expense — FX (EXPENSE)
 */

import { getPrismaClient } from "@treasury/database";
import type { PostJournalEntryInput } from "@treasury/types";

export const ACCOUNTS = {
  FIAT_CASH:                "1001",
  PENDING_FIAT:             "1002",
  USDC_INVENTORY:           "1101",
  USDT_INVENTORY:           "1102",
  RECEIVABLES_PROVIDER:     "1201",
  CUSTODIAL_RESERVE:        "1501",
  PAYABLES_PROVIDER:        "2001",
  CLIENT_OBLIGATIONS_USDC:  "2101",
  CLIENT_OBLIGATIONS_USDT:  "2102",
  FEES_NETWORK:             "5001",
  FEES_CUSTODY:             "5002",
  FEES_FX:                  "5003",
} as const;

/**
 * Assert that the journal entry balances (sum of debits = sum of credits).
 * Throws if the entry is unbalanced.
 */
function assertBalanced(lines: PostJournalEntryInput["lines"]): void {
  let debits = 0n;
  let credits = 0n;
  for (const line of lines) {
    if (line.isDebit) debits += line.amountCents;
    else credits += line.amountCents;
  }
  if (debits !== credits) {
    throw new Error(
      `Unbalanced journal entry: debits=${debits} credits=${credits}`,
    );
  }
}

export async function postJournalEntry(
  input: PostJournalEntryInput,
): Promise<{ journalEntryId: string }> {
  assertBalanced(input.lines);

  const db = getPrismaClient();

  // Resolve account IDs
  const accountCodes = [...new Set(input.lines.map((l) => l.accountCode))];
  const accounts = await db.ledgerAccount.findMany({
    where: { code: { in: accountCodes } },
  });
  const accountMap = new Map(accounts.map((a) => [a.code, a.id]));

  for (const line of input.lines) {
    if (!accountMap.has(line.accountCode)) {
      throw new Error(
        `Ledger account not found for code: ${line.accountCode}`,
      );
    }
  }

  const entry = await db.journalEntry.create({
    data: {
      entityId: input.entityId,
      mintRequestId: input.mintRequestId,
      redemptionRequestId: input.redemptionRequestId,
      status: "POSTED",
      memo: input.memo,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      postedAt: new Date(),
      lines: {
        createMany: {
          data: input.lines.map((line) => ({
            ledgerAccountId: accountMap.get(line.accountCode)!,
            isDebit: line.isDebit,
            amountCents: line.amountCents,
            currency: line.currency ?? "USD",
            description: line.description,
          })),
        },
      },
    },
  });

  return { journalEntryId: entry.id };
}

/** Get the net balance (debits - credits) for an account code */
export async function getAccountBalance(accountCode: string): Promise<bigint> {
  const db = getPrismaClient();
  const account = await db.ledgerAccount.findUnique({
    where: { code: accountCode },
    include: {
      debitLines: { where: { isDebit: true } },
      creditLines: { where: { isDebit: false } },
    },
  });
  if (!account) throw new Error(`Account not found: ${accountCode}`);

  const debits = account.debitLines.reduce((sum, l) => sum + l.amountCents, 0n);
  const credits = account.creditLines.reduce((sum, l) => sum + l.amountCents, 0n);

  // For ASSET/EXPENSE accounts normal balance is debit; for LIABILITY/EQUITY/REVENUE it's credit
  const isDebitNormal = ["ASSET", "EXPENSE"].includes(account.type);
  return isDebitNormal ? debits - credits : credits - debits;
}

// ─── Pre-built journal entry templates ───────────────────────────────────────

/** When fiat is confirmed received from bank — move from pending to cash */
export async function postBankFundingReceived(params: {
  entityId: string;
  mintRequestId: string;
  amountCents: bigint;
}): Promise<{ journalEntryId: string }> {
  return postJournalEntry({
    entityId: params.entityId,
    mintRequestId: params.mintRequestId,
    memo: `Bank funding received for mint ${params.mintRequestId}`,
    referenceType: "mint",
    referenceId: params.mintRequestId,
    lines: [
      { accountCode: ACCOUNTS.FIAT_CASH,    isDebit: true,  amountCents: params.amountCents, description: "Fiat received from bank" },
      { accountCode: ACCOUNTS.PENDING_FIAT, isDebit: false, amountCents: params.amountCents, description: "Clear pending fiat" },
    ],
  });
}

/** When fiat is reserved for pending conversion */
export async function postFiatReservedForMint(params: {
  entityId: string;
  mintRequestId: string;
  amountCents: bigint;
}): Promise<{ journalEntryId: string }> {
  return postJournalEntry({
    entityId: params.entityId,
    mintRequestId: params.mintRequestId,
    memo: `Fiat reserved for mint request ${params.mintRequestId}`,
    referenceType: "mint",
    referenceId: params.mintRequestId,
    lines: [
      { accountCode: ACCOUNTS.PENDING_FIAT, isDebit: true,  amountCents: params.amountCents, description: "Reserve fiat for conversion" },
      { accountCode: ACCOUNTS.FIAT_CASH,    isDebit: false, amountCents: params.amountCents, description: "Remove from available cash" },
    ],
  });
}

/** When provider submits mint and fiat moves to provider receivable */
export async function postMintSubmittedToProvider(params: {
  entityId: string;
  mintRequestId: string;
  amountCents: bigint;
}): Promise<{ journalEntryId: string }> {
  return postJournalEntry({
    entityId: params.entityId,
    mintRequestId: params.mintRequestId,
    memo: `Mint submitted to provider — fiat in transit ${params.mintRequestId}`,
    referenceType: "mint",
    referenceId: params.mintRequestId,
    lines: [
      { accountCode: ACCOUNTS.RECEIVABLES_PROVIDER, isDebit: true,  amountCents: params.amountCents, description: "Fiat sent to provider" },
      { accountCode: ACCOUNTS.PENDING_FIAT,          isDebit: false, amountCents: params.amountCents, description: "Clear pending fiat" },
    ],
  });
}

/** When provider confirms mint completed */
export async function postMintCompleted(params: {
  entityId: string;
  mintRequestId: string;
  fiatAmountCents: bigint;
  stablecoinUnits: bigint;  // for USDC: 6 decimal places; no separate usd amount needed
  asset: "USDC" | "USDT";
  networkFeeCents: bigint;
  custodyFeeCents: bigint;
}): Promise<{ journalEntryId: string }> {
  const inventoryAccount = params.asset === "USDC"
    ? ACCOUNTS.USDC_INVENTORY
    : ACCOUNTS.USDT_INVENTORY;

  // Stablecoin value expressed in cents (1 USDC = 100 cents; units have 6 dec)
  const stablecoinValueCents = params.stablecoinUnits / 10_000n;
  const totalFeesCents = params.networkFeeCents + params.custodyFeeCents;

  return postJournalEntry({
    entityId: params.entityId,
    mintRequestId: params.mintRequestId,
    memo: `Mint completed — ${params.asset} inventory received ${params.mintRequestId}`,
    referenceType: "mint",
    referenceId: params.mintRequestId,
    lines: [
      { accountCode: inventoryAccount,               isDebit: true,  amountCents: stablecoinValueCents, description: `${params.asset} inventory received` },
      { accountCode: ACCOUNTS.FEES_NETWORK,          isDebit: true,  amountCents: params.networkFeeCents, description: "Network fee" },
      { accountCode: ACCOUNTS.FEES_CUSTODY,          isDebit: true,  amountCents: params.custodyFeeCents, description: "Custody fee" },
      { accountCode: ACCOUNTS.RECEIVABLES_PROVIDER,  isDebit: false, amountCents: stablecoinValueCents + totalFeesCents, description: "Clear provider receivable" },
    ],
  });
}

/** When USDC/USDT is settled to client wallet */
export async function postStablecoinDistributed(params: {
  entityId: string;
  mintRequestId: string;
  asset: "USDC" | "USDT";
  amountCents: bigint;
}): Promise<{ journalEntryId: string }> {
  const inventoryAccount = params.asset === "USDC"
    ? ACCOUNTS.USDC_INVENTORY
    : ACCOUNTS.USDT_INVENTORY;
  const obligationsAccount = params.asset === "USDC"
    ? ACCOUNTS.CLIENT_OBLIGATIONS_USDC
    : ACCOUNTS.CLIENT_OBLIGATIONS_USDT;

  return postJournalEntry({
    entityId: params.entityId,
    mintRequestId: params.mintRequestId,
    memo: `${params.asset} distributed to client wallet ${params.mintRequestId}`,
    referenceType: "mint",
    referenceId: params.mintRequestId,
    lines: [
      { accountCode: obligationsAccount, isDebit: true,  amountCents: params.amountCents, description: "Clear client obligation" },
      { accountCode: inventoryAccount,   isDebit: false, amountCents: params.amountCents, description: "Reduce inventory" },
    ],
  });
}

/** When redemption is submitted (stablecoin moves back to provider) */
export async function postRedemptionSubmitted(params: {
  entityId: string;
  redemptionRequestId: string;
  asset: "USDC" | "USDT";
  amountCents: bigint;
}): Promise<{ journalEntryId: string }> {
  const inventoryAccount = params.asset === "USDC"
    ? ACCOUNTS.USDC_INVENTORY
    : ACCOUNTS.USDT_INVENTORY;

  return postJournalEntry({
    entityId: params.entityId,
    redemptionRequestId: params.redemptionRequestId,
    memo: `Redemption submitted — ${params.asset} sent to provider ${params.redemptionRequestId}`,
    referenceType: "redemption",
    referenceId: params.redemptionRequestId,
    lines: [
      { accountCode: ACCOUNTS.RECEIVABLES_PROVIDER, isDebit: true,  amountCents: params.amountCents, description: "Fiat receivable from provider" },
      { accountCode: inventoryAccount,               isDebit: false, amountCents: params.amountCents, description: "Remove from inventory" },
    ],
  });
}

/** When fiat is received after redemption */
export async function postRedemptionFiatReceived(params: {
  entityId: string;
  redemptionRequestId: string;
  amountCents: bigint;
  networkFeeCents: bigint;
  custodyFeeCents: bigint;
}): Promise<{ journalEntryId: string }> {
  const totalFeesCents = params.networkFeeCents + params.custodyFeeCents;
  const netFiatCents = params.amountCents - totalFeesCents;

  return postJournalEntry({
    entityId: params.entityId,
    redemptionRequestId: params.redemptionRequestId,
    memo: `Fiat received from redemption ${params.redemptionRequestId}`,
    referenceType: "redemption",
    referenceId: params.redemptionRequestId,
    lines: [
      { accountCode: ACCOUNTS.FIAT_CASH,            isDebit: true,  amountCents: netFiatCents, description: "Net fiat received" },
      { accountCode: ACCOUNTS.FEES_NETWORK,          isDebit: true,  amountCents: params.networkFeeCents, description: "Network fee" },
      { accountCode: ACCOUNTS.FEES_CUSTODY,          isDebit: true,  amountCents: params.custodyFeeCents, description: "Custody fee" },
      { accountCode: ACCOUNTS.RECEIVABLES_PROVIDER,  isDebit: false, amountCents: params.amountCents, description: "Clear provider receivable" },
    ],
  });
}

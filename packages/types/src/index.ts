// ════════════════════════════════════════════════════════════════════════════
// Stablecoin Treasury OS — Shared Type Definitions
// ════════════════════════════════════════════════════════════════════════════

// ─── Primitives ───────────────────────────────────────────────────────────────

/** Amount in USD cents as a bigint (avoids float precision issues) */
export type Cents = bigint;

/** Stablecoin units with 6 decimal places as bigint */
export type StablecoinUnits = bigint;

/** Unix timestamp in milliseconds */
export type Timestamp = number;

// ─── API Response wrappers ────────────────────────────────────────────────────

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: ApiMeta;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ApiMeta {
  page?: number;
  pageSize?: number;
  totalCount?: number;
  totalPages?: number;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginationParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export interface PaginatedResult<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─── Stablecoin assets ────────────────────────────────────────────────────────

export type StablecoinAsset = "USDC" | "USDT";

export type NetworkType =
  | "ETHEREUM"
  | "SOLANA"
  | "POLYGON"
  | "BASE"
  | "TRON"
  | "STELLAR"
  | "XRPL";

export interface WalletAddress {
  network: NetworkType;
  address: string;
}

// ─── Provider Abstraction ─────────────────────────────────────────────────────

export type ProviderName = "circle" | "tether_otc" | "otc_desk";
export type ProviderMode = "live" | "sandbox";

export interface ProviderQuote {
  provider: ProviderName;
  mode: ProviderMode;
  quotedAt: Date;
  expiresAt: Date;
  fiatAmountCents: bigint;
  stablecoinUnits: bigint;
  asset: StablecoinAsset;
  networkFeeEstimateCents: bigint;
  custodyFeeEstimateCents: bigint;
  settlementNetwork: NetworkType;
  quoteId?: string;
}

export type MintStepStatus =
  | "PENDING"
  | "SUBMITTED"
  | "FUNDING_REQUIRED"
  | "FUNDED"
  | "MINTING"
  | "MINTED"
  | "SETTLING"
  | "SETTLED"
  | "FAILED"
  | "CANCELLED";

export interface ProviderMintStatus {
  externalId: string;
  status: MintStepStatus;
  assetAmount?: bigint;
  message?: string;
  providerRaw?: unknown;
  updatedAt: Date;
}

export type RedemptionStepStatus =
  | "PENDING"
  | "SUBMITTED"
  | "PROCESSING"
  | "COMPLETED"
  | "PENDING_FIAT"
  | "FIAT_SENT"
  | "FAILED"
  | "CANCELLED";

export interface ProviderRedemptionStatus {
  externalId: string;
  status: RedemptionStepStatus;
  fiatAmountCents?: bigint;
  message?: string;
  providerRaw?: unknown;
  updatedAt: Date;
}

// ─── Banking ──────────────────────────────────────────────────────────────────

export interface WireNotification {
  bankAccountId: string;
  direction: "INBOUND" | "OUTBOUND";
  amountCents: bigint;
  currency: string;
  reference?: string;
  counterpartyName?: string;
  counterpartyAccountNumber?: string;
  bankReference?: string;
  valueDate?: Date;
}

export interface BankBalanceSnapshot {
  bankAccountId: string;
  asOfDate: Date;
  availableBalanceCents: bigint;
  ledgerBalanceCents: bigint;
  currency: string;
}

// ─── Ledger ───────────────────────────────────────────────────────────────────

export interface LedgerAccountCode {
  FIAT_CASH: "1001";
  PENDING_FIAT: "1002";
  USDC_INVENTORY: "1101";
  USDT_INVENTORY: "1102";
  RECEIVABLES_PROVIDER: "1201";
  CUSTODIAL_RESERVE: "1501";
  PAYABLES_PROVIDER: "2001";
  CLIENT_OBLIGATIONS_USDC: "2101";
  CLIENT_OBLIGATIONS_USDT: "2102";
  FEES_NETWORK: "5001";
  FEES_CUSTODY: "5002";
  FEES_FX: "5003";
}

export interface PostJournalEntryInput {
  entityId?: string;
  mintRequestId?: string;
  redemptionRequestId?: string;
  memo: string;
  referenceType: string;
  referenceId?: string;
  lines: {
    accountCode: string;
    isDebit: boolean;
    amountCents: bigint;
    currency?: string;
    description?: string;
  }[];
}

// ─── Events ───────────────────────────────────────────────────────────────────

export interface DomainEvent<T = unknown> {
  id: string;
  eventType: string;
  aggregateId: string;
  aggregateType: string;
  actorId?: string;
  actorType?: "user" | "system" | "provider";
  payload: T;
  metadata?: Record<string, unknown>;
  occurredAt: Date;
}

// Known event types
export type KnownEventType =
  | "entity.created"
  | "entity.updated"
  | "entity.kyb_status_changed"
  | "bank_account.created"
  | "bank_account.verified"
  | "treasury_account.created"
  | "wallet.created"
  | "wallet.whitelisted"
  | "wallet.suspended"
  | "mint_request.created"
  | "mint_request.compliance_cleared"
  | "mint_request.compliance_held"
  | "mint_request.approved"
  | "mint_request.rejected"
  | "mint_request.bank_funded"
  | "mint_request.submitted_to_provider"
  | "mint_request.provider_processing"
  | "mint_request.mint_completed"
  | "mint_request.settled"
  | "mint_request.failed"
  | "mint_request.cancelled"
  | "redemption_request.created"
  | "redemption_request.approved"
  | "redemption_request.rejected"
  | "redemption_request.submitted_to_provider"
  | "redemption_request.completed"
  | "redemption_request.fiat_received"
  | "redemption_request.settled"
  | "redemption_request.failed"
  | "transfer.initiated"
  | "transfer.submitted"
  | "transfer.confirmed"
  | "transfer.failed"
  | "reconciliation.run.started"
  | "reconciliation.run.completed"
  | "reconciliation.variance.detected"
  | "provider.mint.submitted"
  | "provider.mint.completed"
  | "provider.redemption.submitted"
  | "provider.redemption.completed"
  | "bank_funds.detected"
  | "bank_funds.matched"
  | "compliance.case.opened"
  | "compliance.case.closed";

// ─── RBAC ─────────────────────────────────────────────────────────────────────

export type RoleName =
  | "super_admin"
  | "treasury_operator"
  | "treasury_approver"
  | "compliance_officer"
  | "finance_controller"
  | "auditor"
  | "read_only";

export interface JwtPayload {
  sub: string;       // userId
  email: string;
  name: string;
  roles: RoleName[];
  entityScopes: string[];  // entityIds the user has scoped access to
  iat: number;
  exp: number;
}

// ─── Reconciliation ───────────────────────────────────────────────────────────

export interface ReconciliationSummary {
  runId: string;
  runDate: Date;
  status: string;
  bankBalanceCents: bigint;
  providerUsdcBalance: bigint;
  providerUsdtBalance: bigint;
  ledgerUsdcBalance: bigint;
  ledgerUsdtBalance: bigint;
  breakCount: number;
  breaks: ReconciliationBreakSummary[];
}

export interface ReconciliationBreakSummary {
  id: string;
  breakType: string;
  description: string;
  amountCents?: bigint;
  status: string;
}

// ─── Compliance / Policy ──────────────────────────────────────────────────────

export interface PolicyEvaluationResult {
  allowed: boolean;
  requiresDualApproval: boolean;
  requiredApprovers: number;
  blockedReasons: string[];
  warnings: string[];
}

export interface PolicyContext {
  entityId: string;
  amountCents: bigint;
  asset: StablecoinAsset;
  destinationWallet?: { network: NetworkType; address: string };
  counterpartyId?: string;
}

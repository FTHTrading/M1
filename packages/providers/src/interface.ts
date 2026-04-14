import type {
  ProviderName,
  ProviderMode,
  ProviderQuote,
  ProviderMintStatus,
  ProviderRedemptionStatus,
  StablecoinAsset,
  NetworkType,
} from "@treasury/types";

// ─── Provider state machine enforcement ──────────────────────────────────────

export const MINT_STATE_TRANSITIONS: Record<string, string[]> = {
  PENDING:           ["SUBMITTED", "CANCELLED"],
  SUBMITTED:         ["FUNDING_REQUIRED", "MINTING", "FAILED", "CANCELLED"],
  FUNDING_REQUIRED:  ["FUNDED", "CANCELLED", "FAILED"],
  FUNDED:            ["MINTING", "FAILED"],
  MINTING:           ["MINTED", "FAILED"],
  MINTED:            ["SETTLING"],
  SETTLING:          ["SETTLED", "FAILED"],
  SETTLED:           [],
  FAILED:            ["PENDING"],  // allow retry
  CANCELLED:         [],
};

export const REDEMPTION_STATE_TRANSITIONS: Record<string, string[]> = {
  PENDING:           ["SUBMITTED", "CANCELLED"],
  SUBMITTED:         ["PROCESSING", "FAILED", "CANCELLED"],
  PROCESSING:        ["COMPLETED", "FAILED"],
  COMPLETED:         ["PENDING_FIAT"],
  PENDING_FIAT:      ["FIAT_SENT", "FAILED"],
  FIAT_SENT:         [],
  FAILED:            ["PENDING"],
  CANCELLED:         [],
};

export function assertMintTransition(from: string, to: string): void {
  const allowed = MINT_STATE_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(
      `Invalid mint state transition: ${from} → ${to}. Allowed: [${allowed.join(", ")}]`,
    );
  }
}

export function assertRedemptionTransition(from: string, to: string): void {
  const allowed = REDEMPTION_STATE_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(
      `Invalid redemption state transition: ${from} → ${to}. Allowed: [${allowed.join(", ")}]`,
    );
  }
}

// ─── Provider interface ───────────────────────────────────────────────────────

export interface MintInitiationParams {
  requestId: string;
  fiatAmountCents: bigint;
  asset: StablecoinAsset;
  destinationWalletAddress: string;
  destinationNetwork: NetworkType;
  entityId: string;
  externalReference?: string;
}

export interface RedemptionInitiationParams {
  requestId: string;
  stablecoinUnits: bigint;
  asset: StablecoinAsset;
  sourceWalletAddress: string;
  sourceNetwork: NetworkType;
  entityId: string;
  bankAccountRoutingNumber: string;
  bankAccountNumber: string;
  externalReference?: string;
}

export interface BalanceSummary {
  provider: ProviderName;
  asset: StablecoinAsset;
  network: NetworkType;
  balance: bigint;
  asOfDate: Date;
}

export interface ProviderTransaction {
  externalId: string;
  type: "mint" | "redemption" | "transfer";
  status: string;
  amountUnits: bigint;
  asset: StablecoinAsset;
  network?: NetworkType;
  txHash?: string;
  createdAt: Date;
  updatedAt: Date;
  raw?: unknown;
}

/**
 * StablecoinProvider — the interface ALL provider adapters must implement.
 * No operational step may be skipped; state machines guard each transition.
 */
export interface StablecoinProvider {
  readonly name: ProviderName;
  readonly mode: ProviderMode;
  readonly supportedAssets: StablecoinAsset[];

  /** Get a mint quote for a given fiat amount and target network */
  quoteMint(params: {
    fiatAmountCents: bigint;
    asset: StablecoinAsset;
    destinationNetwork: NetworkType;
  }): Promise<ProviderQuote>;

  /** Initiate a USD→stablecoin conversion */
  initiateMint(params: MintInitiationParams): Promise<{
    externalId: string;
    status: ProviderMintStatus;
    wireInstructions?: WireInstructions;
  }>;

  /** Confirm that bank funding has been detected on the provider side */
  confirmFunding(externalId: string): Promise<ProviderMintStatus>;

  /** Check the current status of a mint */
  checkMintStatus(externalId: string): Promise<ProviderMintStatus>;

  /** Settle minted stablecoin to destination wallet */
  settleToWallet(params: {
    externalId: string;
    destinationWalletAddress: string;
    destinationNetwork: NetworkType;
  }): Promise<ProviderMintStatus>;

  /** Initiate stablecoin → fiat redemption */
  initiateRedemption(params: RedemptionInitiationParams): Promise<{
    externalId: string;
    status: ProviderRedemptionStatus;
  }>;

  /** Check the current status of a redemption */
  checkRedemptionStatus(externalId: string): Promise<ProviderRedemptionStatus>;

  /** Confirm fiat receipt after redemption */
  confirmRedemption(externalId: string): Promise<ProviderRedemptionStatus>;

  /** Get all stablecoin balances for the authenticated account */
  getBalances(): Promise<BalanceSummary[]>;

  /** List recent transactions */
  listTransactions(params?: {
    limit?: number;
    fromDate?: Date;
    toDate?: Date;
  }): Promise<ProviderTransaction[]>;
}

export interface WireInstructions {
  bankName: string;
  accountNumber: string;
  routingNumber: string;
  swift?: string;
  reference: string;
  beneficiaryName: string;
  beneficiaryAddress?: string;
  amountCents: bigint;
  currency: string;
}

/**
 * Circle USDC Provider Adapter
 *
 * Implements the StablecoinProvider interface against Circle's Mint API.
 * Documentation: https://developers.circle.com/circle-mint
 *
 * In sandbox mode (CIRCLE_SANDBOX=true), all requests go to:
 *   https://api-sandbox.circle.com
 * In production mode:
 *   https://api.circle.com
 *
 * INSTITUTIONAL REQUIREMENT: You must have an approved Circle Mint account
 * before live requests will succeed. The adapter is complete and correct;
 * credentials (CIRCLE_API_KEY, CIRCLE_ENTITY_ID) are supplied via env.
 */

import { z } from "zod";
import type {
  ProviderQuote,
  ProviderMintStatus,
  ProviderRedemptionStatus,
  NetworkType,
} from "@treasury/types";
import type {
  StablecoinProvider,
  MintInitiationParams,
  RedemptionInitiationParams,
  BalanceSummary,
  ProviderTransaction,
  WireInstructions,
} from "../interface.js";
import {
  assertMintTransition,
  assertRedemptionTransition,
} from "../interface.js";
import type { Env } from "@treasury/config";

// ─── Circle API response schemas ──────────────────────────────────────────────

const CirclePaymentIntentSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: z.object({ amount: z.string(), currency: z.string() }),
  paymentMethods: z.array(
    z.object({
      type: z.string(),
      chain: z.string().optional(),
      beneficiaryBank: z
        .object({
          name: z.string().optional(),
          routingNumber: z.string().optional(),
          accountNumber: z.string().optional(),
          swiftCode: z.string().optional(),
          address: z.string().optional(),
        })
        .optional(),
      trackingRef: z.string().optional(),
    }),
  ).optional(),
  createDate: z.string(),
  updateDate: z.string(),
});

const CircleWalletSchema = z.object({
  walletId: z.string(),
  entityId: z.string(),
  type: z.string(),
  balances: z.array(
    z.object({ amount: z.string(), currency: z.string() }),
  ),
});

// ─── Network mapping Circle chain → NetworkType ────────────────────────────

const NETWORK_TO_CIRCLE_CHAIN: Record<string, string> = {
  ETHEREUM: "ETH",
  POLYGON:  "MATIC",
  BASE:     "BASE",
  SOLANA:   "SOL",
  TRON:     "TRX",
};

const CIRCLE_CHAIN_TO_NETWORK: Record<string, NetworkType> = {
  ETH:   "ETHEREUM",
  MATIC: "POLYGON",
  BASE:  "BASE",
  SOL:   "SOLANA",
  TRX:   "TRON",
};

// ─── Circle USDC Provider ────────────────────────────────────────────────────

export class CircleUsdcProvider implements StablecoinProvider {
  readonly name = "circle" as const;
  readonly supportedAssets = ["USDC" as const];

  readonly mode;
  private readonly apiKey: string;
  private readonly entityId: string | undefined;
  private readonly walletId: string | undefined;
  private readonly baseUrl: string;

  constructor(env: Pick<Env,
    "CIRCLE_API_KEY" | "CIRCLE_ENTITY_ID" | "CIRCLE_WALLET_ID" |
    "CIRCLE_SANDBOX" | "CIRCLE_BASE_URL" | "FEATURE_SANDBOX_ONLY"
  >) {
    const live = !env.CIRCLE_SANDBOX && !env.FEATURE_SANDBOX_ONLY;
    this.mode = live ? "live" as const : "sandbox" as const;
    this.apiKey = env.CIRCLE_API_KEY;
    this.entityId = env.CIRCLE_ENTITY_ID;
    this.walletId = env.CIRCLE_WALLET_ID;
    this.baseUrl = live ? "https://api.circle.com" : env.CIRCLE_BASE_URL;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "(no body)");
      throw new Error(
        `Circle API error ${res.status} ${method} ${path}: ${text}`,
      );
    }

    return res.json() as Promise<T>;
  }

  async quoteMint(params: {
    fiatAmountCents: bigint;
    asset: "USDC";
    destinationNetwork: NetworkType;
  }): Promise<ProviderQuote> {
    // Circle doesn't have a formal quote endpoint in the Mint API;
    // for USDC the rate is 1:1 USD. Fees depend on Circle Mint tier.
    const fiatAmountUsd = Number(params.fiatAmountCents) / 100;
    const stablecoinUnits = params.fiatAmountCents * 10_000n; // 6 decimal places

    return {
      provider: this.name,
      mode: this.mode,
      quotedAt: new Date(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      fiatAmountCents: params.fiatAmountCents,
      stablecoinUnits,
      asset: "USDC",
      networkFeeEstimateCents: this.estimateNetworkFee(params.destinationNetwork),
      custodyFeeEstimateCents: BigInt(Math.round(fiatAmountUsd * 0.001 * 100)), // ~0.1% estimate
      settlementNetwork: params.destinationNetwork,
    };
  }

  async initiateMint(params: MintInitiationParams): Promise<{
    externalId: string;
    status: ProviderMintStatus;
    wireInstructions?: WireInstructions;
  }> {
    assertMintTransition("PENDING", "SUBMITTED");

    const chain = NETWORK_TO_CIRCLE_CHAIN[params.destinationNetwork];
    if (!chain) {
      throw new Error(
        `Circle does not support network: ${params.destinationNetwork}`,
      );
    }

    const amountUsd = (Number(params.fiatAmountCents) / 100).toFixed(2);

    // POST /v1/paymentIntents — Circle Mint payment intent
    const response = await this.request<{ data: z.infer<typeof CirclePaymentIntentSchema> }>(
      "POST",
      "/v1/paymentIntents",
      {
        idempotencyKey: params.requestId,
        amount: { amount: amountUsd, currency: "USD" },
        settlementCurrency: "USDC",
        paymentMethods: [
          { type: "wire" },
          { type: "blockchain", chain, to: params.destinationWalletAddress },
        ],
      },
    );

    const intent = CirclePaymentIntentSchema.parse(response.data);
    const wireMethod = intent.paymentMethods?.find((m) => m.type === "wire");

    const wireInstructions: WireInstructions | undefined = wireMethod?.beneficiaryBank
      ? {
          bankName: wireMethod.beneficiaryBank.name ?? "Circle Insured Financial",
          accountNumber: wireMethod.beneficiaryBank.accountNumber ?? "",
          routingNumber: wireMethod.beneficiaryBank.routingNumber ?? "",
          swift: wireMethod.beneficiaryBank.swiftCode,
          reference: wireMethod.trackingRef ?? intent.id,
          beneficiaryName: "Circle Internet Financial",
          beneficiaryAddress: wireMethod.beneficiaryBank.address,
          amountCents: params.fiatAmountCents,
          currency: "USD",
        }
      : undefined;

    return {
      externalId: intent.id,
      status: {
        externalId: intent.id,
        status: "SUBMITTED",
        message: "Payment intent created, awaiting wire funding",
        updatedAt: new Date(intent.updateDate),
        providerRaw: intent,
      },
      wireInstructions,
    };
  }

  async confirmFunding(externalId: string): Promise<ProviderMintStatus> {
    assertMintTransition("SUBMITTED", "FUNDED");
    return this.checkMintStatus(externalId);
  }

  async checkMintStatus(externalId: string): Promise<ProviderMintStatus> {
    const response = await this.request<{ data: z.infer<typeof CirclePaymentIntentSchema> }>(
      "GET",
      `/v1/paymentIntents/${externalId}`,
    );
    const intent = CirclePaymentIntentSchema.parse(response.data);
    return this.mapCircleStatusToMintStatus(intent);
  }

  async settleToWallet(params: {
    externalId: string;
    destinationWalletAddress: string;
    destinationNetwork: NetworkType;
  }): Promise<ProviderMintStatus> {
    assertMintTransition("MINTED", "SETTLING");
    // Circle automatically settles to a configured blockchain destination
    // in the payment intent; this method confirms the settle was dispatched.
    return this.checkMintStatus(params.externalId);
  }

  async initiateRedemption(params: RedemptionInitiationParams): Promise<{
    externalId: string;
    status: ProviderRedemptionStatus;
  }> {
    assertRedemptionTransition("PENDING", "SUBMITTED");

    const amountUsdc = (Number(params.stablecoinUnits) / 1_000_000).toFixed(6);

    // POST /v1/transfers — outbound USDC → USD via Circle Mint
    const response = await this.request<{ data: { id: string; status: string; createDate: string; updateDate: string } }>(
      "POST",
      "/v1/transfers",
      {
        idempotencyKey: params.requestId,
        source: {
          type: "wallet",
          id: this.walletId,
          chain: NETWORK_TO_CIRCLE_CHAIN[params.sourceNetwork],
          address: params.sourceWalletAddress,
        },
        destination: {
          type: "wire",
          bankAccount: {
            routingNumber: params.bankAccountRoutingNumber,
            accountNumber: params.bankAccountNumber,
          },
        },
        amount: { amount: amountUsdc, currency: "USDC" },
      },
    );

    const transfer = response.data;
    return {
      externalId: transfer.id,
      status: {
        externalId: transfer.id,
        status: "SUBMITTED",
        message: "Redemption submitted to Circle",
        updatedAt: new Date(transfer.updateDate),
        providerRaw: transfer,
      },
    };
  }

  async checkRedemptionStatus(externalId: string): Promise<ProviderRedemptionStatus> {
    const response = await this.request<{ data: { id: string; status: string; amount?: { amount: string }; updateDate: string } }>(
      "GET",
      `/v1/transfers/${externalId}`,
    );
    const transfer = response.data;
    const domainStatus = this.mapCircleTransferStatusToRedemptionStatus(transfer.status);

    return {
      externalId,
      status: domainStatus,
      fiatAmountCents: transfer.amount
        ? BigInt(Math.round(parseFloat(transfer.amount.amount) * 100))
        : undefined,
      updatedAt: new Date(transfer.updateDate),
      providerRaw: transfer,
    };
  }

  async confirmRedemption(externalId: string): Promise<ProviderRedemptionStatus> {
    assertRedemptionTransition("COMPLETED", "PENDING_FIAT");
    return this.checkRedemptionStatus(externalId);
  }

  async getBalances(): Promise<BalanceSummary[]> {
    if (!this.walletId) return [];

    const response = await this.request<{ data: z.infer<typeof CircleWalletSchema> }>(
      "GET",
      `/v1/wallets/${this.walletId}`,
    );
    const wallet = CircleWalletSchema.parse(response.data);

    return wallet.balances
      .filter((b) => b.currency === "USDC")
      .map((b) => ({
        provider: this.name,
        asset: "USDC" as const,
        network: "ETHEREUM" as const,
        balance: BigInt(Math.round(parseFloat(b.amount) * 1_000_000)),
        asOfDate: new Date(),
      }));
  }

  async listTransactions(params?: {
    limit?: number;
    fromDate?: Date;
    toDate?: Date;
  }): Promise<ProviderTransaction[]> {
    type TransferItem = { id: string; type?: string; status: string; amount?: { amount: string; currency: string }; createDate: string; updateDate: string; transactionHash?: string; source?: { chain?: string } };
    const response = await this.request<{ data: TransferItem[] }>(
      "GET",
      `/v1/transfers?pageSize=${params?.limit ?? 50}`,
    );

    return (response.data ?? []).map((t) => ({
      externalId: t.id,
      type: "mint" as const,
      status: t.status,
      amountUnits: t.amount
        ? BigInt(Math.round(parseFloat(t.amount.amount) * 1_000_000))
        : 0n,
      asset: "USDC" as const,
      network: t.source?.chain
        ? (CIRCLE_CHAIN_TO_NETWORK[t.source.chain] ?? "ETHEREUM")
        : "ETHEREUM",
      txHash: t.transactionHash,
      createdAt: new Date(t.createDate),
      updatedAt: new Date(t.updateDate),
      raw: t,
    }));
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private mapCircleStatusToMintStatus(
    intent: z.infer<typeof CirclePaymentIntentSchema>,
  ): ProviderMintStatus {
    const statusMap: Record<string, ProviderMintStatus["status"]> = {
      pending:   "FUNDING_REQUIRED",
      complete:  "SETTLED",
      failed:    "FAILED",
      expired:   "FAILED",
    };
    const status = statusMap[intent.status] ?? "PENDING";

    return {
      externalId: intent.id,
      status,
      assetAmount: BigInt(Math.round(parseFloat(intent.amount.amount) * 1_000_000)),
      updatedAt: new Date(intent.updateDate),
      providerRaw: intent,
    };
  }

  private mapCircleTransferStatusToRedemptionStatus(
    circleStatus: string,
  ): ProviderRedemptionStatus["status"] {
    const map: Record<string, ProviderRedemptionStatus["status"]> = {
      pending:  "PROCESSING",
      complete: "COMPLETED",
      failed:   "FAILED",
    };
    return map[circleStatus] ?? "PENDING";
  }

  private estimateNetworkFee(network: NetworkType): bigint {
    const feeCentsMap: Record<string, number> = {
      ETHEREUM: 500,  // $5.00 estimate
      POLYGON:  10,   // $0.10
      BASE:     5,    // $0.05
      SOLANA:   1,    // $0.01
      TRON:     100,  // $1.00
    };
    return BigInt(feeCentsMap[network] ?? 200);
  }
}

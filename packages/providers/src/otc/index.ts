/**
 * OTC Desk Provider Stub
 *
 * A generic OTC desk adapter that can be connected to any OTC provider
 * (e.g., Cumberland, Galaxy Digital, B2C2, Wintermute) by implementing
 * the request() method with the counterparty's proprietary API.
 *
 * This stub returns deterministic sandbox responses for testing and
 * serves as the implementation template for connecting a real OTC desk.
 */

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
import { assertMintTransition, assertRedemptionTransition } from "../interface.js";

export class OtcDeskProvider implements StablecoinProvider {
  readonly name = "otc_desk" as const;
  readonly supportedAssets = ["USDC" as const, "USDT" as const];
  readonly mode = "sandbox" as const;

  async quoteMint(params: {
    fiatAmountCents: bigint;
    asset: "USDC" | "USDT";
    destinationNetwork: NetworkType;
  }): Promise<ProviderQuote> {
    const stablecoinUnits = params.fiatAmountCents * 10_000n;
    return {
      provider: this.name,
      mode: this.mode,
      quotedAt: new Date(),
      expiresAt: new Date(Date.now() + 2 * 60 * 1000),
      fiatAmountCents: params.fiatAmountCents,
      stablecoinUnits,
      asset: params.asset,
      networkFeeEstimateCents: 200n,
      custodyFeeEstimateCents: BigInt(Math.round(Number(params.fiatAmountCents) * 0.002)),
      settlementNetwork: params.destinationNetwork,
    };
  }

  async initiateMint(params: MintInitiationParams): Promise<{
    externalId: string;
    status: ProviderMintStatus;
    wireInstructions?: WireInstructions;
  }> {
    assertMintTransition("PENDING", "SUBMITTED");
    const externalId = `OTC-MINT-${params.requestId}`;
    return {
      externalId,
      status: { externalId, status: "SUBMITTED", updatedAt: new Date() },
      wireInstructions: {
        bankName: "[OTC STUB] Desk Partner Bank",
        accountNumber: "STUB-ACCT",
        routingNumber: "STUB-ROUTING",
        reference: externalId,
        beneficiaryName: "OTC Desk [STUB]",
        amountCents: params.fiatAmountCents,
        currency: "USD",
      },
    };
  }

  async confirmFunding(externalId: string): Promise<ProviderMintStatus> {
    assertMintTransition("SUBMITTED", "FUNDED");
    return { externalId, status: "FUNDED", updatedAt: new Date() };
  }

  async checkMintStatus(externalId: string): Promise<ProviderMintStatus> {
    return { externalId, status: "SETTLED", updatedAt: new Date() };
  }

  async settleToWallet(params: {
    externalId: string;
    destinationWalletAddress: string;
    destinationNetwork: NetworkType;
  }): Promise<ProviderMintStatus> {
    assertMintTransition("MINTED", "SETTLING");
    return { externalId: params.externalId, status: "SETTLED", updatedAt: new Date() };
  }

  async initiateRedemption(params: RedemptionInitiationParams): Promise<{
    externalId: string;
    status: ProviderRedemptionStatus;
  }> {
    assertRedemptionTransition("PENDING", "SUBMITTED");
    const externalId = `OTC-REDEEM-${params.requestId}`;
    return {
      externalId,
      status: { externalId, status: "SUBMITTED", updatedAt: new Date() },
    };
  }

  async checkRedemptionStatus(externalId: string): Promise<ProviderRedemptionStatus> {
    return { externalId, status: "FIAT_SENT", updatedAt: new Date() };
  }

  async confirmRedemption(externalId: string): Promise<ProviderRedemptionStatus> {
    assertRedemptionTransition("COMPLETED", "PENDING_FIAT");
    return { externalId, status: "PENDING_FIAT", updatedAt: new Date() };
  }

  async getBalances(): Promise<BalanceSummary[]> {
    return [
      { provider: this.name, asset: "USDC", network: "ETHEREUM", balance: 250_000_000_000n, asOfDate: new Date() },
      { provider: this.name, asset: "USDT", network: "ETHEREUM", balance: 250_000_000_000n, asOfDate: new Date() },
    ];
  }

  async listTransactions(): Promise<ProviderTransaction[]> {
    return [];
  }
}

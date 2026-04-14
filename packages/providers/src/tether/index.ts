/**
 * Tether USDT Provider Adapter
 *
 * Models Tether's VERIFIED institutional acquisition & redemption workflow.
 *
 * Reality: Tether does NOT provide a public self-service API for
 * institutional minting. Acquisition requires:
 *   1. Verified institutional account on tether.to/en/institutional
 *   2. KYC/KYB approval by Tether Operations Limited
 *   3. Wire funding to Tether's banking partners
 *   4. Manual or relationship-level USDT issuance
 *
 * This adapter models that workflow with a structured state machine.
 * The OTC desk sub-mode routes through an approved OTC intermediary
 * (e.g., Cumberland, Galaxy, B2C2) and is the most realistic path
 * for institutions that cannot obtain direct Tether access.
 *
 * Sandbox mode returns deterministic mock responses for development.
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
import {
  assertMintTransition,
  assertRedemptionTransition,
} from "../interface.js";
import type { Env } from "@treasury/config";

type TetherMode = "sandbox" | "otc_desk" | "tether_direct";

export class TetherUsdtProvider implements StablecoinProvider {
  readonly name = "tether_otc" as const;
  readonly supportedAssets = ["USDT" as const];
  readonly mode;

  private readonly tetherMode: TetherMode;
  private readonly referenceDetails: string | undefined;

  constructor(env: Pick<Env,
    "TETHER_ACCOUNT_MODE" | "TETHER_REFERENCE_DETAILS" |
    "FEATURE_SANDBOX_ONLY" | "ENABLE_TRON"
  >) {
    const forceSandbox = env.FEATURE_SANDBOX_ONLY || env.TETHER_ACCOUNT_MODE === "sandbox";
    this.mode = forceSandbox ? "sandbox" as const : "live" as const;
    this.tetherMode = env.TETHER_ACCOUNT_MODE as TetherMode;
    this.referenceDetails = env.TETHER_REFERENCE_DETAILS;
  }

  async quoteMint(params: {
    fiatAmountCents: bigint;
    asset: "USDT";
    destinationNetwork: NetworkType;
  }): Promise<ProviderQuote> {
    if (this.mode === "sandbox") {
      return this.sandboxQuote(params.fiatAmountCents, params.destinationNetwork);
    }

    // Live: OTC desk or Tether direct quotes are relationship-based.
    // This models the process: contact OTC desk → receive quote → record it.
    // Real integration would call the OTC desk's proprietary API/RFQ portal.
    throw new Error(
      "Live Tether USDT quotes require a verified OTC desk relationship. " +
      "Please contact your designated OTC counterparty for RFQ. " +
      "Update TETHER_ACCOUNT_MODE and TETHER_REFERENCE_DETAILS in your env.",
    );
  }

  async initiateMint(params: MintInitiationParams): Promise<{
    externalId: string;
    status: ProviderMintStatus;
    wireInstructions?: WireInstructions;
  }> {
    assertMintTransition("PENDING", "SUBMITTED");

    if (this.mode === "sandbox") {
      return this.sandboxInitiateMint(params);
    }

    // Live mode: generate a wire instruction package for the OTC desk or Tether
    const externalId = `TETHER-ACQ-${params.requestId}`;
    const wireInstructions = this.buildWireInstructions(params);

    return {
      externalId,
      status: {
        externalId,
        status: "SUBMITTED",
        message:
          this.tetherMode === "tether_direct"
            ? "Direct Tether acquisition submitted — await Tether Operations confirmation"
            : "OTC acquisition submitted — await OTC desk confirmation and USDT delivery",
        updatedAt: new Date(),
      },
      wireInstructions,
    };
  }

  async confirmFunding(externalId: string): Promise<ProviderMintStatus> {
    assertMintTransition("SUBMITTED", "FUNDED");
    if (this.mode === "sandbox") {
      return { externalId, status: "FUNDED", updatedAt: new Date() };
    }
    // Live: operator manually confirms wire receipt notification from OTC desk
    return { externalId, status: "FUNDED", updatedAt: new Date() };
  }

  async checkMintStatus(externalId: string): Promise<ProviderMintStatus> {
    if (this.mode === "sandbox") {
      return this.sandboxMintStatus(externalId);
    }
    // Live: poll OTC desk API or wait for webhook/manual update
    return { externalId, status: "MINTING", updatedAt: new Date() };
  }

  async settleToWallet(params: {
    externalId: string;
    destinationWalletAddress: string;
    destinationNetwork: NetworkType;
  }): Promise<ProviderMintStatus> {
    assertMintTransition("MINTED", "SETTLING");
    if (this.mode === "sandbox") {
      return {
        externalId: params.externalId,
        status: "SETTLED",
        updatedAt: new Date(),
        message: `[SANDBOX] USDT settled to ${params.destinationWalletAddress} on ${params.destinationNetwork}`,
      };
    }
    return {
      externalId: params.externalId,
      status: "SETTLING",
      updatedAt: new Date(),
      message: "USDT on-chain transfer initiated by OTC desk",
    };
  }

  async initiateRedemption(params: RedemptionInitiationParams): Promise<{
    externalId: string;
    status: ProviderRedemptionStatus;
  }> {
    assertRedemptionTransition("PENDING", "SUBMITTED");

    const externalId = `TETHER-REDEEM-${params.requestId}`;

    if (this.mode === "sandbox") {
      return {
        externalId,
        status: { externalId, status: "SUBMITTED", updatedAt: new Date() },
      };
    }

    return {
      externalId,
      status: {
        externalId,
        status: "SUBMITTED",
        message:
          "USDT redemption submitted to OTC desk — await fiat wire delivery confirmation",
        updatedAt: new Date(),
      },
    };
  }

  async checkRedemptionStatus(externalId: string): Promise<ProviderRedemptionStatus> {
    if (this.mode === "sandbox") {
      return {
        externalId,
        status: "COMPLETED",
        fiatAmountCents: 100_000_00n,
        updatedAt: new Date(),
      };
    }
    return { externalId, status: "PROCESSING", updatedAt: new Date() };
  }

  async confirmRedemption(externalId: string): Promise<ProviderRedemptionStatus> {
    assertRedemptionTransition("COMPLETED", "PENDING_FIAT");
    return { externalId, status: "PENDING_FIAT", updatedAt: new Date() };
  }

  async getBalances(): Promise<BalanceSummary[]> {
    if (this.mode === "sandbox") {
      return [
        {
          provider: this.name,
          asset: "USDT",
          network: "ETHEREUM",
          balance: 500_000_000_000n, // 500,000 USDT
          asOfDate: new Date(),
        },
        {
          provider: this.name,
          asset: "USDT",
          network: "TRON",
          balance: 500_000_000_000n,
          asOfDate: new Date(),
        },
      ];
    }
    // Live: query OTC desk custody portal or Tether account portal
    throw new Error(
      "Live USDT balance queries require OTC desk API integration. " +
      "Configure TETHER_REFERENCE_DETAILS with your counterparty credentials.",
    );
  }

  async listTransactions(params?: {
    limit?: number;
    fromDate?: Date;
    toDate?: Date;
  }): Promise<ProviderTransaction[]> {
    if (this.mode === "sandbox") {
      return [];
    }
    return [];
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private sandboxQuote(fiatAmountCents: bigint, destinationNetwork: NetworkType): ProviderQuote {
    const stablecoinUnits = fiatAmountCents * 10_000n;
    return {
      provider: this.name,
      mode: "sandbox",
      quotedAt: new Date(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      fiatAmountCents,
      stablecoinUnits,
      asset: "USDT",
      networkFeeEstimateCents: 100n,
      custodyFeeEstimateCents: BigInt(Math.round(Number(fiatAmountCents) * 0.0008)),
      settlementNetwork: destinationNetwork,
    };
  }

  private sandboxInitiateMint(params: MintInitiationParams): {
    externalId: string;
    status: ProviderMintStatus;
    wireInstructions: WireInstructions;
  } {
    const externalId = `SANDBOX-TETHER-${params.requestId}`;
    return {
      externalId,
      status: {
        externalId,
        status: "SUBMITTED",
        message: "[SANDBOX] Tether acquisition initiated",
        updatedAt: new Date(),
      },
      wireInstructions: {
        bankName: "[SANDBOX] Tether Partner Bank",
        accountNumber: "SANDBOX-ACCOUNT",
        routingNumber: "SANDBOX-ROUTING",
        reference: externalId,
        beneficiaryName: "Tether Operations Limited [SANDBOX]",
        amountCents: params.fiatAmountCents,
        currency: "USD",
      },
    };
  }

  private sandboxMintStatus(externalId: string): ProviderMintStatus {
    return {
      externalId,
      status: "MINTED",
      message: "[SANDBOX] USDT minted",
      updatedAt: new Date(),
    };
  }

  private buildWireInstructions(params: MintInitiationParams): WireInstructions {
    if (this.tetherMode === "tether_direct") {
      return {
        bankName: "Tether Operations Banking Partner",
        accountNumber: "Contact: tether.to/en/institutional for wire details",
        routingNumber: "Contact: tether.to/en/institutional",
        reference:
          this.referenceDetails
            ? `${this.referenceDetails}-${params.requestId}`
            : params.requestId,
        beneficiaryName: "Tether Operations Limited",
        beneficiaryAddress: "British Virgin Islands",
        amountCents: params.fiatAmountCents,
        currency: "USD",
      };
    }

    // OTC desk mode — operator must substitute with actual OTC desk wire details
    return {
      bankName: "OTC Desk Banking Partner",
      accountNumber: "Configure TETHER_REFERENCE_DETAILS with OTC wire instructions",
      routingNumber: "Configure TETHER_REFERENCE_DETAILS with OTC wire instructions",
      reference:
        this.referenceDetails
          ? `${this.referenceDetails}-${params.requestId}`
          : params.requestId,
      beneficiaryName: "OTC Desk — Tether Acquisition",
      amountCents: params.fiatAmountCents,
      currency: "USD",
    };
  }
}

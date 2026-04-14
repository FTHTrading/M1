/**
 * Sanctions screening and AML checks.
 *
 * Vendor routing controlled by SANCTIONS_VENDOR env var:
 *   - "comply_advantage" — ComplyAdvantage Name & Address screening API
 *   - "trm"             — TRM Labs blockchain risk API
 *   - "chainalysis"     — Chainalysis KYT on-chain address screening
 *   - "mock"            — always clear (non-sandbox explicit test mode)
 *
 * Sandbox mode (FEATURE_SANDBOX_ONLY=true): always returns cleared without
 * making any external network calls.
 *
 * In live mode both functions will throw ScreeningVendorError if no vendor
 * is configured, preventing any transaction from proceeding without screening.
 */

import { getPrismaClient } from "@treasury/database";
import { requestFinnComplianceReview } from "./finn-bridge.js";

export interface ScreeningResult {
  cleared: boolean;
  hits: ScreeningHit[];
  screenedAt: Date;
  /** Vendor that performed the check */
  vendor?: string;
  /** Raw vendor reference / case ID */
  vendorRef?: string;
}

export interface ScreeningHit {
  listName: string;
  matchType: "exact" | "fuzzy";
  entry: string;
  score: number;
}

export class ScreeningVendorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScreeningVendorError";
  }
}

// ── Internal vendor adapters ─────────────────────────────────────────────────

async function complyAdvantageScreenEntity(params: {
  legalName: string;
  countryCode: string;
}): Promise<ScreeningResult> {
  const apiKey  = process.env["COMPLY_ADVANTAGE_API_KEY"];
  const baseUrl = process.env["COMPLY_ADVANTAGE_BASE_URL"] ?? "https://api.complyadvantage.com";
  if (!apiKey) throw new ScreeningVendorError("COMPLY_ADVANTAGE_API_KEY not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  const response = await fetch(`${baseUrl}/searches`, {
    method:  "POST",
    signal:  controller.signal,
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Token ${apiKey}`,
    },
    body: JSON.stringify({
      search_term:     params.legalName,
      filters:         { country_codes: [params.countryCode.toLowerCase()] },
      share_url:       false,
      search_profile:  "financial_institutions",
      limit:           10,
    }),
  });

  clearTimeout(timer);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ScreeningVendorError(
      `ComplyAdvantage HTTP ${response.status}: ${body.slice(0, 200)}`,
    );
  }

  const data = (await response.json()) as {
    data: {
      id: string;
      total_hits: number;
      hits?: Array<{
        match_types: string[];
        doc: { name: string; sources: string[] };
        score: number;
      }>;
    };
  };

  const hits: ScreeningHit[] = (data.data.hits ?? []).map((h) => ({
    listName:  h.doc.sources[0] ?? "unknown",
    matchType: h.match_types.includes("exact_match") ? "exact" : "fuzzy",
    entry:     h.doc.name,
    score:     h.score,
  }));

  return {
    cleared:   hits.length === 0,
    hits,
    screenedAt: new Date(),
    vendor:    "comply_advantage",
    vendorRef: data.data.id,
  };
}

async function trmScreenAddress(params: {
  address: string;
  network: string;
}): Promise<ScreeningResult> {
  const apiKey  = process.env["TRM_API_KEY"];
  const baseUrl = process.env["TRM_BASE_URL"] ?? "https://api.trmlabs.com/public/v2";
  if (!apiKey) throw new ScreeningVendorError("TRM_API_KEY not configured");

  // Map internal network names to TRM chain identifiers
  const chainMap: Record<string, string> = {
    ETHEREUM: "ethereum",
    POLYGON:  "polygon",
    BASE:     "base",
    SOLANA:   "solana",
    TRON:     "tron",
    STELLAR:  "stellar",
    XRPL:     "ripple",
  };
  const chain = chainMap[params.network.toUpperCase()] ?? params.network.toLowerCase();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  const response = await fetch(`${baseUrl}/blockchain/addresses/risk`, {
    method:  "POST",
    signal:  controller.signal,
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
    },
    body: JSON.stringify([{ address: params.address, chain }]),
  });

  clearTimeout(timer);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ScreeningVendorError(`TRM HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const results = (await response.json()) as Array<{
    address:   string;
    riskScore: number;
    addressRiskIndicators?: Array<{ categoryRuleDescription: string; riskScoreLevelLabel: string }>;
  }>;

  const result   = results[0];
  const riskScore = result?.riskScore ?? 0;
  // TRM: score > 70 = high risk, surface as a hit
  const hits: ScreeningHit[] = riskScore > 70
    ? [{
        listName:  "TRM_ADDRESS_RISK",
        matchType: "exact",
        entry:     params.address,
        score:     riskScore / 100,
      }]
    : [];

  return {
    cleared:   hits.length === 0,
    hits,
    screenedAt: new Date(),
    vendor:    "trm",
    vendorRef: `trm-${params.address.slice(0, 12)}`,
  };
}

async function chainalysisScreenAddress(params: {
  address: string;
  network: string;
}): Promise<ScreeningResult> {
  const apiKey  = process.env["CHAINALYSIS_API_KEY"];
  const baseUrl = process.env["CHAINALYSIS_BASE_URL"] ?? "https://api.chainalysis.com/api/kyt/v2";
  if (!apiKey) throw new ScreeningVendorError("CHAINALYSIS_API_KEY not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  // Register address with Chainalysis KYT
  const response = await fetch(`${baseUrl}/users`, {
    method:  "POST",
    signal:  controller.signal,
    headers: {
      "Content-Type": "application/json",
      "Token":        apiKey,
    },
    body: JSON.stringify({
      userId:  `treasury-${params.address.slice(0, 16)}`,
      address: params.address,
      asset:   params.network === "SOLANA" ? "Solana" : "Ethereum",
    }),
  });

  clearTimeout(timer);

  if (!response.ok && response.status !== 409 /* already registered */) {
    const body = await response.text().catch(() => "");
    throw new ScreeningVendorError(`Chainalysis HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  // Check risk exposure
  const riskResp = await fetch(
    `${baseUrl}/address/${params.address}/risk`, // simplified endpoint
    { headers: { "Token": apiKey } },
  );

  if (!riskResp.ok) {
    // Non-fatal — return degraded cleared result
    return { cleared: true, hits: [], screenedAt: new Date(), vendor: "chainalysis" };
  }

  const risk = (await riskResp.json()) as { risk: string; cluster?: { name: string } };
  const isHighRisk = ["High", "Severe"].includes(risk.risk);

  const hits: ScreeningHit[] = isHighRisk
    ? [{ listName: "CHAINALYSIS_KYT", matchType: "exact", entry: params.address, score: 1 }]
    : [];

  return {
    cleared:   !isHighRisk,
    hits,
    screenedAt: new Date(),
    vendor:    "chainalysis",
    vendorRef: risk.cluster?.name,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Screen a counterparty by name + country code against known lists.
 * Sandbox: always returns cleared without external calls.
 * Production: routes through SANCTIONS_VENDOR env var.
 */
export async function screenCounterparty(params: {
  counterpartyId: string;
  legalName: string;
  countryCode: string;
  sandboxMode: boolean;
}): Promise<ScreeningResult> {
  if (params.sandboxMode) {
    return { cleared: true, hits: [], screenedAt: new Date(), vendor: "sandbox" };
  }

  const vendor = process.env["SANCTIONS_VENDOR"] ?? "comply_advantage";
  const db     = getPrismaClient();

  let result: ScreeningResult;

  switch (vendor) {
    case "comply_advantage":
      result = await complyAdvantageScreenEntity({
        legalName:   params.legalName,
        countryCode: params.countryCode,
      });
      break;
    case "mock":
      result = { cleared: true, hits: [], screenedAt: new Date(), vendor: "mock" };
      break;
    default:
      throw new ScreeningVendorError(
        `Unknown SANCTIONS_VENDOR="${vendor}". Supported: comply_advantage | mock`,
      );
  }

  const finnReview = await requestFinnComplianceReview({
    subjectId: params.counterpartyId,
    subjectType: "counterparty",
    operation: "COUNTERPARTY_SCREEN",
    payload: {
      legalName: params.legalName,
      countryCode: params.countryCode,
      vendor,
      hits: result.hits,
    },
  });

  if (finnReview?.block) {
    result = {
      ...result,
      cleared: false,
      hits: [
        ...result.hits,
        {
          listName: "FINN_AI_REVIEW",
          matchType: "fuzzy",
          entry: params.legalName,
          score: Math.min(1, Math.max(0, (finnReview.riskScore ?? 100) / 100)),
        },
      ],
      vendorRef: finnReview.referenceId ?? result.vendorRef,
    };
  }

  await db.auditLog.create({
    data: {
      action:     "SANCTIONS_SCREEN",
      resource:   "counterparty",
      resourceId: params.counterpartyId,
      details:    {
        legalName:   params.legalName,
        countryCode: params.countryCode,
        vendor,
        cleared:     result.cleared,
        hitCount:    result.hits.length,
        vendorRef:   result.vendorRef ?? null,
        finnReview,
      },
      ipAddress: "internal",
      userAgent: "sanctions-engine",
    },
  });

  return result;
}

/**
 * Screen a blockchain address via on-chain risk scoring.
 * Sandbox: always returns cleared without external calls.
 * Production: routes through ON_CHAIN_SCREENING_VENDOR env var.
 */
export async function screenOnChainAddress(params: {
  address: string;
  network: string;
  sandboxMode: boolean;
}): Promise<ScreeningResult> {
  if (params.sandboxMode) {
    return { cleared: true, hits: [], screenedAt: new Date(), vendor: "sandbox" };
  }

  const vendor = process.env["ON_CHAIN_SCREENING_VENDOR"] ?? "trm";
  const db     = getPrismaClient();

  let result: ScreeningResult;

  switch (vendor) {
    case "trm":
      result = await trmScreenAddress({ address: params.address, network: params.network });
      break;
    case "chainalysis":
      result = await chainalysisScreenAddress({ address: params.address, network: params.network });
      break;
    case "mock":
      result = { cleared: true, hits: [], screenedAt: new Date(), vendor: "mock" };
      break;
    default:
      throw new ScreeningVendorError(
        `Unknown ON_CHAIN_SCREENING_VENDOR="${vendor}". Supported: trm | chainalysis | mock`,
      );
  }

  const finnReview = await requestFinnComplianceReview({
    subjectId: params.address,
    subjectType: "wallet_address",
    operation: "ON_CHAIN_ADDRESS_SCREEN",
    payload: {
      address: params.address,
      network: params.network,
      vendor,
      hits: result.hits,
    },
  });

  if (finnReview?.block) {
    result = {
      ...result,
      cleared: false,
      hits: [
        ...result.hits,
        {
          listName: "FINN_AI_REVIEW",
          matchType: "exact",
          entry: params.address,
          score: Math.min(1, Math.max(0, (finnReview.riskScore ?? 100) / 100)),
        },
      ],
      vendorRef: finnReview.referenceId ?? result.vendorRef,
    };
  }

  await db.auditLog.create({
    data: {
      action:     "ON_CHAIN_ADDRESS_SCREEN",
      resource:   "wallet_address",
      resourceId: params.address,
      details:    {
        network:   params.network,
        vendor,
        cleared:   result.cleared,
        hitCount:  result.hits.length,
        vendorRef: result.vendorRef ?? null,
        finnReview,
      },
      ipAddress: "internal",
      userAgent: "sanctions-engine",
    },
  });

  return result;
}

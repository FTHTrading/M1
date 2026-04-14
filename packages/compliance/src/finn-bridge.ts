export interface FinnComplianceReviewRequest {
  subjectId: string;
  subjectType: "counterparty" | "wallet_address";
  operation: "COUNTERPARTY_SCREEN" | "ON_CHAIN_ADDRESS_SCREEN";
  payload: Record<string, unknown>;
}

export interface FinnComplianceReviewResult {
  reviewed: boolean;
  block: boolean;
  reason?: string;
  riskScore?: number;
  tags?: string[];
  referenceId?: string;
  degraded?: boolean;
}

export async function requestFinnComplianceReview(
  request: FinnComplianceReviewRequest,
): Promise<FinnComplianceReviewResult | null> {
  if (process.env["FINN_COMPLIANCE_ENABLED"] !== "true") {
    return null;
  }

  const endpoint =
    process.env["FINN_COMPLIANCE_ENDPOINT"] ??
    "http://localhost:7700/v1/compliance/review";
  const apiKey = process.env["FINN_COMPLIANCE_API_KEY"];
  const timeoutMs = Number(process.env["FINN_COMPLIANCE_TIMEOUT_MS"] ?? 3000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        reviewed: false,
        block: false,
        degraded: true,
        reason: `Finn compliance HTTP ${response.status}: ${body.slice(0, 200)}`,
      };
    }

    const data = (await response.json()) as {
      reviewed?: boolean;
      block?: boolean;
      reason?: string;
      riskScore?: number;
      tags?: string[];
      referenceId?: string;
    };

    return {
      reviewed: data.reviewed ?? true,
      block: data.block ?? false,
      degraded: false,
      ...(data.reason ? { reason: data.reason } : {}),
      ...(data.riskScore !== undefined ? { riskScore: data.riskScore } : {}),
      ...(data.tags ? { tags: data.tags } : {}),
      ...(data.referenceId ? { referenceId: data.referenceId } : {}),
    };
  } catch (err) {
    return {
      reviewed: false,
      block: false,
      degraded: true,
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

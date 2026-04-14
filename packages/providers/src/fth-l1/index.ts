/**
 * FTH L1 Runtime Client — Transaction Verification Engine (TEV)
 *
 * Integrates with the FTH L1 Runtime (Popeye/TARS/MARS architecture) running
 * at the configured endpoint. Performs pre-flight TEV checks on all mint and
 * redemption requests before they are enqueued for provider processing.
 *
 * Non-blocking design: if the FTH L1 Runtime is unreachable, the client logs
 * the degradation and returns a DEGRADE result rather than blocking the
 * treasury workflow. Hard-block mode can be enabled via FTH_L1_HARD_BLOCK=true.
 *
 * TEV principles:
 *  - Verify wallet address against FTH L1 approved counterparty registry
 *  - Verify transaction parameters against policy ledger
 *  - Emit a TEV receipt that is stored in the audit log
 */

export interface TevParams {
  /** Internal treasury request ID */
  requestId: string;
  /** Entity (institution) requesting the operation */
  entityId: string;
  /** Operation type */
  operationType: "MINT" | "REDEMPTION";
  /** Destination or source wallet address */
  walletAddress: string;
  /** On-chain network */
  network: string;
  /** Asset being minted or redeemed */
  asset: "USDC" | "USDT";
  /** Amount in USD cents (bigint serialised as string for HTTP transport) */
  amountCents: string;
  /** External reference number (bank wire ref etc.) */
  externalReference?: string;
}

export type TevVerdict = "APPROVED" | "REJECTED" | "DEGRADE";

export interface TevResult {
  verdict: TevVerdict;
  receiptId: string | null;
  /** TEV score 0–100 (null when degraded) */
  score: number | null;
  /** Human-readable reason — always populated on REJECTED */
  reason: string | null;
  /** Wall-clock latency of the TEV call in ms */
  latencyMs: number;
  /** Whether the result was from a degraded / offline path */
  degraded: boolean;
  checkedAt: Date;
}

export interface FthL1Config {
  /** FTH L1 Runtime base URL, e.g. http://localhost:7700 */
  endpoint: string;
  /** Bearer token for the TEV API */
  apiKey: string;
  /** Hard-block mints/redemptions if FTH L1 is unreachable (default: false) */
  hardBlock?: boolean;
  /** Request timeout in ms (default: 3000) */
  timeoutMs?: number;
  /** Bypass all checks — sandbox / test mode */
  sandboxMode?: boolean;
}

/**
 * FTH L1 Runtime thin client.
 * Instantiate once per process and reuse across requests.
 */
export class FthL1Client {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly hardBlock: boolean;
  private readonly timeoutMs: number;
  private readonly sandboxMode: boolean;

  constructor(config: FthL1Config) {
    this.endpoint   = config.endpoint.replace(/\/$/, "");
    this.apiKey     = config.apiKey;
    this.hardBlock  = config.hardBlock ?? false;
    this.timeoutMs  = config.timeoutMs ?? 3_000;
    this.sandboxMode = config.sandboxMode ?? false;
  }

  /**
   * Run a Transaction Verification Engine check.
   * Returns APPROVED / REJECTED / DEGRADE (when runtime is unreachable).
   * Never throws — degrade instead.
   */
  async verify(params: TevParams): Promise<TevResult> {
    if (this.sandboxMode) {
      return this.sandboxResult(params.requestId);
    }

    const startMs = Date.now();
    const url = `${this.endpoint}/v1/tev/verify`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(url, {
        method:  "POST",
        signal:  controller.signal,
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
          "X-Treasury-Request-Id": params.requestId,
        },
        body: JSON.stringify({
          requestId:         params.requestId,
          entityId:          params.entityId,
          operationType:     params.operationType,
          walletAddress:     params.walletAddress,
          network:           params.network,
          asset:             params.asset,
          amountCents:       params.amountCents,
          externalReference: params.externalReference,
        }),
      });

      clearTimeout(timer);
      const latencyMs = Date.now() - startMs;

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.error(`[fth-l1] TEV returned HTTP ${response.status}: ${body}`);

        if (response.status === 403 || response.status === 401) {
          // Authentication failures are not degradation — they're config errors
          return {
            verdict:    "REJECTED",
            receiptId:  null,
            score:      0,
            reason:     `FTH L1 authentication failure (HTTP ${response.status})`,
            latencyMs,
            degraded:   false,
            checkedAt:  new Date(),
          };
        }

        return this.degrade(latencyMs, `FTH L1 HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        verdict:   TevVerdict;
        receiptId: string;
        score:     number;
        reason:    string | null;
      };

      return {
        verdict:   data.verdict,
        receiptId: data.receiptId,
        score:     data.score,
        reason:    data.reason ?? null,
        latencyMs,
        degraded:  false,
        checkedAt: new Date(),
      };

    } catch (err: unknown) {
      const latencyMs = Date.now() - startMs;
      const message = err instanceof Error ? err.message : String(err);
      const tag = (err as { name?: string }).name === "AbortError" ? "timeout" : message;
      console.warn(`[fth-l1] TEV unreachable (${tag}) — degrading gracefully`);
      return this.degrade(latencyMs, tag);
    }
  }

  /**
   * Lightweight liveness probe — call on worker startup.
   */
  async ping(): Promise<boolean> {
    if (this.sandboxMode) return true;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2_000);
      const resp = await fetch(`${this.endpoint}/health`, {
        signal: controller.signal,
        headers: { "Authorization": `Bearer ${this.apiKey}` },
      });
      clearTimeout(timer);
      return resp.ok;
    } catch {
      return false;
    }
  }

  /** Returns true when a DEGRADE result should block the transaction */
  shouldBlockOnDegrade(): boolean {
    return this.hardBlock;
  }

  // ── private helpers ──────────────────────────────────────────────────────

  private sandboxResult(requestId: string): TevResult {
    return {
      verdict:   "APPROVED",
      receiptId: `tev-sandbox-${requestId}`,
      score:     100,
      reason:    null,
      latencyMs: 0,
      degraded:  false,
      checkedAt: new Date(),
    };
  }

  private degrade(latencyMs: number, cause: string): TevResult {
    return {
      verdict:   "DEGRADE",
      receiptId: null,
      score:     null,
      reason:    cause,
      latencyMs,
      degraded:  true,
      checkedAt: new Date(),
    };
  }
}

/**
 * Build an FthL1Client from process environment variables.
 * Returns null if FTH_L1_ENDPOINT is not configured.
 */
export function createFthL1ClientFromEnv(): FthL1Client | null {
  const endpoint = process.env["FTH_L1_ENDPOINT"];
  if (!endpoint) return null;

  return new FthL1Client({
    endpoint,
    apiKey:      process.env["FTH_L1_API_KEY"] ?? "",
    hardBlock:   process.env["FTH_L1_HARD_BLOCK"] === "true",
    timeoutMs:   Number(process.env["FTH_L1_TIMEOUT_MS"] ?? 3_000),
    sandboxMode: process.env["FEATURE_SANDBOX_ONLY"] !== "false",
  });
}

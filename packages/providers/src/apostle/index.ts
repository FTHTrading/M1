/**
 * Apostle Chain Client — Chain ID 7332
 *
 * Connects to the FTH Apostle Chain Rust/Axum node for ATP post-settlement
 * confirmation after a stablecoin mint or redemption completes.
 *
 * Architecture:
 *  - POST /v1/tx  — submit a signed TxEnvelope to the chain mempool
 *  - GET  /v1/receipts — poll for confirmation
 *  - GET  /v1/agent/{id}/balance — verify ATP balance for an agent wallet
 *
 * Signing:
 *  The Apostle Chain uses Ed25519 signatures. When a private key is not
 *  configured, the client operates in "submit-only" mode — transactions are
 *  submitted but signatures are empty (accepted by chain only if running in
 *  dev/zero-sig mode). In production set APOSTLE_AGENT_PRIVATE_KEY.
 *
 * Settlement flow:
 *  1. Mint or redemption completes on-chain (Circle/OTC provider)
 *  2. Worker calls ApostleChainClient.recordSettlement()
 *  3. Client constructs a Transfer TxEnvelope with mint metadata
 *  4. Submits to POST /v1/tx and stores the tx hash in the DB
 *  5. Worker polls confirmSettlement() until height advances
 */

import { createHash, createHmac } from "crypto";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ApostleChainConfig {
  /** Apostle Chain Axum API base URL, e.g. http://localhost:7332 */
  endpoint: string;
  /** Agent UUID (bare, without "agent:" prefix) — signer identity */
  agentId: string;
  /** Ed25519 private key hex (64 chars = 32 bytes). Optional — no signing if absent */
  privateKeyHex?: string;
  /** Request timeout in ms (default: 5000) */
  timeoutMs?: number;
  /** sandbox mode — returns mock receipts, no real HTTP calls */
  sandboxMode?: boolean;
  /** Chain ID to embed in envelopes (default: 7332) */
  chainId?: number;
}

export interface ApostleSettlementParams {
  /** Internal treasury request ID (used as nonce seed and memo) */
  requestId: string;
  /** Destination agent UUID for the settlement credit */
  destinationAgentId: string;
  /** Asset type: "ATP" | "USDF" | "UNY" */
  asset: "ATP" | "USDF" | "UNY";
  /** Amount as string integer (18-decimal for ATP/USDF, 7-decimal for USDF actual) */
  amount: string;
  /** Human-readable memo for audit trail */
  memo?: string;
}

export interface ApostleSettlementReceipt {
  /** Chain transaction hash (64-char hex, no 0x prefix) */
  txHash: string;
  /** Block height at which the tx was included (null if still in mempool) */
  blockHeight: number | null;
  /** Settlement status */
  status: "SUBMITTED" | "CONFIRMED" | "FAILED" | "SANDBOX";
  /** Wall-clock latency */
  latencyMs: number;
  /** Timestamp */
  settledAt: Date;
  /** Whether the result is from sandbox/mock path */
  degraded: boolean;
}

// ── Internal TxEnvelope shape (matches Rust serde) ──────────────────────────

interface TxEnvelope {
  hash: string;
  from: string;
  nonce: number;
  chain_id: number;
  payload: {
    type: "transfer";
    to: string;
    asset: string;
    amount: string;
  };
  signature: string;
  timestamp: string;
}

// ── Client ───────────────────────────────────────────────────────────────────

export class ApostleChainClient {
  private readonly endpoint: string;
  private readonly agentId: string;
  private readonly privateKeyHex: string | undefined;
  private readonly timeoutMs: number;
  private readonly sandboxMode: boolean;
  private readonly chainId: number;
  private nonce: number;

  constructor(config: ApostleChainConfig) {
    this.endpoint      = config.endpoint.replace(/\/$/, "");
    this.agentId       = config.agentId;
    this.privateKeyHex = config.privateKeyHex;
    this.timeoutMs     = config.timeoutMs ?? 5_000;
    this.sandboxMode   = config.sandboxMode ?? false;
    this.chainId       = config.chainId ?? 7332;
    this.nonce         = Math.floor(Date.now() / 1000);
  }

  /**
   * Record a treasury settlement event on the Apostle Chain.
   * Non-throwing — returns a FAILED receipt on connectivity errors.
   */
  async recordSettlement(params: ApostleSettlementParams): Promise<ApostleSettlementReceipt> {
    if (this.sandboxMode) {
      return this.sandboxReceipt(params.requestId);
    }

    const startMs = Date.now();

    try {
      const envelope = await this.buildEnvelope(params);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(`${this.endpoint}/v1/tx`, {
        method:  "POST",
        signal:  controller.signal,
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(envelope),
      });

      clearTimeout(timer);
      const latencyMs = Date.now() - startMs;

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.error(`[apostle] /v1/tx returned HTTP ${response.status}: ${body}`);
        return {
          txHash:      envelope.hash,
          blockHeight: null,
          status:      "FAILED",
          latencyMs,
          settledAt:   new Date(),
          degraded:    true,
        };
      }

      return {
        txHash:      envelope.hash,
        blockHeight: null, // will be confirmed in poll step
        status:      "SUBMITTED",
        latencyMs,
        settledAt:   new Date(),
        degraded:    false,
      };

    } catch (err: unknown) {
      const latencyMs = Date.now() - startMs;
      const message   = err instanceof Error ? err.message : String(err);
      console.warn(`[apostle] recordSettlement failed (${message}) — non-blocking`);
      return {
        txHash:      this.deterministicHash(params.requestId, "failed"),
        blockHeight: null,
        status:      "FAILED",
        latencyMs,
        settledAt:   new Date(),
        degraded:    true,
      };
    }
  }

  /**
   * Poll the chain for confirmation of a previously submitted tx hash.
   * Returns the current confirmation status.
   */
  async confirmSettlement(txHash: string): Promise<{ confirmed: boolean; blockHeight: number | null }> {
    if (this.sandboxMode) {
      return { confirmed: true, blockHeight: 1 };
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const resp = await fetch(`${this.endpoint}/v1/receipts`, { signal: controller.signal });
      clearTimeout(timer);

      if (!resp.ok) return { confirmed: false, blockHeight: null };

      const receipts = (await resp.json()) as Array<{ hash: string; block_height: number }>;
      const match    = receipts.find((r) => r.hash === txHash);

      return match
        ? { confirmed: true,  blockHeight: match.block_height }
        : { confirmed: false, blockHeight: null };

    } catch {
      return { confirmed: false, blockHeight: null };
    }
  }

  /**
   * Fetch the ATP/USDF balance for an agent.
   */
  async getAgentBalance(agentId: string): Promise<{ ATP: string; USDF: string } | null> {
    if (this.sandboxMode) {
      return { ATP: "0", USDF: "0" };
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const resp = await fetch(`${this.endpoint}/v1/agent/${agentId}/balance`, {
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!resp.ok) return null;
      return (await resp.json()) as { ATP: string; USDF: string };
    } catch {
      return null;
    }
  }

  /**
   * Liveness probe — returns true if the Apostle Chain node is reachable.
   */
  async ping(): Promise<boolean> {
    if (this.sandboxMode) return true;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2_000);
      const resp = await fetch(`${this.endpoint}/health`, { signal: controller.signal });
      clearTimeout(timer);
      return resp.ok;
    } catch {
      return false;
    }
  }

  // ── private helpers ──────────────────────────────────────────────────────

  private async buildEnvelope(params: ApostleSettlementParams): Promise<TxEnvelope> {
    const nonce    = this.nonce++;
    const ts       = new Date().toISOString();
    const payload  = {
      type:   "transfer" as const,
      to:     params.destinationAgentId,
      asset:  params.asset,
      amount: params.amount,
    };

    // Deterministic hash: sha256 of (from ++ nonce ++ payload serialized ++ chain_id)
    const hashInput = `${this.agentId}:${nonce}:${params.asset}:${params.amount}:${this.chainId}`;
    const hash      = this.deterministicHash(hashInput, ts);

    // Ed25519 signing — requires @noble/ed25519 or node:crypto webcrypto
    // If no key is configured, submit a zero signature (dev/mesh mode)
    let signature: string;
    if (this.privateKeyHex && this.privateKeyHex.length === 128) {
      signature = await this.signEnvelope(hash, this.privateKeyHex);
    } else {
      // Zero signature — accepted by Apostle Chain in dev mode
      signature = "0".repeat(128);
    }

    return {
      hash,
      from:      this.agentId,
      nonce,
      chain_id:  this.chainId,
      payload,
      signature,
      timestamp: ts,
    };
  }

  /**
   * Ed25519 sign using Node.js native crypto (requires Node 15+).
   * The private key hex is 64 chars (32 bytes seed).
   */
  private async signEnvelope(hash: string, privateKeyHex: string): Promise<string> {
    try {
      const { subtle } = globalThis.crypto;
      const keyBytes   = Buffer.from(privateKeyHex, "hex");

      const cryptoKey = await subtle.importKey(
        "raw",
        keyBytes,
        { name: "Ed25519" },
        false,
        ["sign"],
      );

      const msgBytes  = Buffer.from(hash, "hex");
      const sigBuffer = await subtle.sign("Ed25519", cryptoKey, msgBytes);
      return Buffer.from(sigBuffer).toString("hex");
    } catch (err) {
      console.warn("[apostle] Ed25519 sign failed — using zero sig:", err);
      return "0".repeat(128);
    }
  }

  private deterministicHash(seed: string, salt: string): string {
    return createHash("sha256")
      .update(`${seed}:${salt}`)
      .digest("hex");
  }

  private sandboxReceipt(requestId: string): ApostleSettlementReceipt {
    return {
      txHash:      this.deterministicHash(requestId, "sandbox"),
      blockHeight: 1,
      status:      "SANDBOX",
      latencyMs:   0,
      settledAt:   new Date(),
      degraded:    false,
    };
  }
}

/**
 * Build an ApostleChainClient from process environment variables.
 * Returns null if APOSTLE_ENDPOINT is not configured.
 */
export function createApostleClientFromEnv(): ApostleChainClient | null {
  const endpoint = process.env["APOSTLE_ENDPOINT"];
  if (!endpoint) return null;

  const pk = process.env["APOSTLE_AGENT_PRIVATE_KEY"];
  return new ApostleChainClient({
    endpoint,
    agentId:     process.env["APOSTLE_AGENT_ID"] ?? "",
    timeoutMs:   Number(process.env["APOSTLE_TIMEOUT_MS"] ?? 5_000),
    sandboxMode: process.env["FEATURE_SANDBOX_ONLY"] !== "false",
    chainId:     7332,
    ...(pk ? { privateKeyHex: pk } : {}),
  });
}

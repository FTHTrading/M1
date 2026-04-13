# Provider Integration Guide

This document covers how to set up and extend the stablecoin provider adapters in `packages/providers`.

---

## Provider Interface

All providers implement the `StablecoinProvider` interface defined in `packages/providers/src/interface.ts`:

```typescript
interface StablecoinProvider {
  asset: StablecoinAsset;           // 'USDC' | 'USDT'
  name: string;                     // human-readable name
  environment: 'sandbox' | 'production';

  // Quotes
  quoteMint(fiatAmountCents: bigint): Promise<MintQuote>;
  quoteRedemption(stablecoinUnits: bigint): Promise<RedemptionQuote>;

  // Operations
  initiateMint(params: InitiateMintParams): Promise<ProviderTransfer>;
  initiateRedemption(params: InitiateRedemptionParams): Promise<ProviderTransfer>;

  // Status polls
  getMintStatus(transferId: string): Promise<TransferStatus>;
  getRedemptionStatus(transferId: string): Promise<TransferStatus>;

  // Balance
  getWalletBalance(walletAddress: string): Promise<bigint>;

  // Health
  healthCheck(): Promise<{ healthy: boolean; latencyMs: number }>;
}
```

---

## Circle USDC Provider

### How it works

Circle uses a multi-step flow:
1. You transfer USD from your bank account to Circle's banking partner (via ACH or domestic wire)
2. Circle detects the inbound wire and credits your Circle account
3. You call the Mint API to move USD from your Circle account to a blockchain wallet as USDC

The `CircleUsdcProvider` in this platform maps to that flow:
- `initiateMint` calls `POST /v1/businessAccount/payouts` with destination set to your Circle wallet
- `getMintStatus` polls `GET /v1/businessAccount/payouts/:id`

### Step-by-step Setup

#### 1. Create a Circle account

Go to https://console.circle.com and register a business account. For development, use the Sandbox environment at https://console-sandbox.circle.com.

#### 2. Issue an API key

In the Circle console:
- Navigate to **Settings** → **API Keys**
- Click **Create API key**
- Set scope to **Full access** for development, restrict in production
- Copy the key — you will not see it again

Set in `.env`:
```
CIRCLE_API_KEY=TEST_API_KEY_...
CIRCLE_ENVIRONMENT=sandbox
```

#### 3. Register a bank account in Circle

In the Circle Sandbox console:
- Navigate to **Payments** → **Bank Accounts**
- Add a sandbox bank account (Plaid test credentials work)
- Note the `bankAccountId` — this is what seeds into `BankAccount.providerBankId`

#### 4. Verify your blockchain wallet

The USDC destination wallet must be registered in Circle:
- Navigate to **Wallets** → **Blockchain Wallets**
- Add a wallet on Ethereum mainnet or Solana (match your `Wallet.network` value)
- The wallet must hold a small amount of ETH/SOL for gas

#### 5. Register the Circle webhook

In the Circle console:
- Navigate to **Notifications** → **Subscriptions**
- Add a subscription URL: `https://your-domain.com/api/v1/webhooks/circle`
- Subscribe to all event types (or at minimum: `payouts`, `wire`, `transfer`)
- Copy the signing key

Set in `.env`:
```
CIRCLE_WEBHOOK_SECRET=your_signing_key
```

The webhook handler is at `apps/api/src/routes/webhooks.ts`. It:
1. Validates the `X-Circle-Signature` HMAC-SHA256 header (timing-safe comparison)
2. Parses the event type
3. Finds the matching `ProviderTransaction` by `providerRef`
4. Updates the status and enqueues the appropriate BullMQ job to advance the workflow

#### 6. Production Checklist

Before switching `CIRCLE_ENVIRONMENT=production`:
- [ ] Business verification complete in Circle console
- [ ] Bank account fully verified (not just sandbox-linked)
- [ ] Blockchain wallets whitelisted in `Wallet` table
- [ ] `FEATURE_SANDBOX_ONLY=false`
- [ ] `FEATURE_LIVE_TRANSFERS=true`
- [ ] Production webhook URL serving HTTPS with a valid TLS cert
- [ ] `CIRCLE_WEBHOOK_SECRET` rotated from sandbox value
- [ ] Notify compliance that live transfers are now active (policy engine allows them)

---

## Tether USDT Provider (OTC Desk)

### Overview

USDT does not have an equivalent consumer-facing Mint API. Institutional USDT issuance is done via:
1. **Bilateral OTC agreement** — negotiate terms and KYC with your counterpart (Cumberland, B2C2, Genesis Trading, etc.)
2. **Settlement instruction** — your OTC desk provides a Tether TRC20 or ERC20 wallet to send USDT to (or they send USDT to your wallet after receiving fiat)

The `TetherUsdtProvider` in this platform is structured to be extended with your OTC desk's specific API. In sandbox mode it simulates the full flow with in-memory state.

### Configuration

```bash
# Enable USDT feature
ENABLE_USDT=true

# Your OTC desk API
USDT_OTC_API_URL=https://api.yourdesk.com/v1
USDT_OTC_API_KEY=your_api_key
```

### Implementing a real OTC desk adapter

1. Extend `packages/providers/src/tether/otc-desk-client.ts`
2. Implement the three methods your OTC desk requires (auth, quote, initiate)
3. Map response fields to the `ProviderTransfer` shape:
   ```typescript
   {
     id: string;           // your internal transfer ID
     providerRef: string;  // OTC desk's reference ID
     status: TransferStatus;
     stablecoinUnits: bigint;
     fee: bigint;
     settledAt?: Date;
   }
   ```
4. Register your adapter in `packages/providers/src/index.ts`

---

## Sandbox Mode

When `FEATURE_SANDBOX_ONLY=true` (the default), the policy engine blocks all live transfers at rule #1. Both providers still run, but in "simulation" mode:
- All API calls to Circle/OTC go to sandbox endpoints
- Wire matching is simulated — `matchWireEvent` job advances state automatically at 5-second intervals
- Provider status transitions happen at predictable intervals (configurable via `SANDBOX_MINT_DELAY_MS`)

To test the full sandbox end-to-end without live wires:
1. Create a mint request
2. Submit it
3. The worker `matchWireEvent` job will auto-advance through `WIRE_SUBMITTED → FUNDING_CONFIRMED` after a short delay
4. The `process-mint` job picks up and calls the Circle Sandbox API
5. The `check-mint-status` job polls until Circle Sandbox returns `complete`
6. Mint reaches `COMPLETED` and ledger journals are written

---

## Provider Health Monitoring

The API exposes `GET /api/v1/providers/health` which calls `healthCheck()` on every configured provider and returns:

```json
{
  "providers": [
    { "name": "Circle USDC", "environment": "sandbox", "healthy": true, "latencyMs": 142 },
    { "name": "Tether USDT OTC", "environment": "sandbox", "healthy": true, "latencyMs": 37 }
  ]
}
```

Unhealthy providers are flagged in the Admin page UI and will cause the policy engine to reject new mint/redeem requests for that asset.

---

## Adding a New Provider

1. Create `packages/providers/src/<name>/index.ts`
2. Implement `StablecoinProvider` interface
3. Add a constructor that takes `ProviderConfig` (reads from `packages/config`)
4. Export from `packages/providers/src/index.ts`
5. Register in `apps/api/src/providers.ts` (provider registry singleton)
6. Add Zod env vars in `packages/config/src/index.ts`
7. Add feature flag to `admin/page.tsx` controls section
8. Write at minimum: unit tests for quote/status mapping, integration test with mock HTTP

---

## Webhook Security Reference

All inbound provider webhooks are validated before any state change occurs.

### Circle webhook verification

```typescript
import { createHmac, timingSafeEqual } from 'crypto';

function verifyCircleWebhook(
  payload: Buffer,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(signature, 'utf8');
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
```

Never compare signatures with `===` — that is vulnerable to timing attacks.

---

## Provider Transaction States

All provider activity is persisted in the `ProviderTransaction` table:

| Status | Meaning |
|--------|---------|
| `INITIATED` | Platform sent the request to the provider |
| `PROVIDER_PROCESSING` | Provider acknowledged, working on it |
| `SETTLING` | Funds in transit / blockchain confirmation pending |
| `COMPLETED` | Provider confirmed final settlement |
| `FAILED` | Provider returned an error; job will retry |
| `REVERSED` | Provider reversed the transaction (rare) |

The `ProviderTransaction.providerRef` field stores the provider's own transfer/payout ID, used for status polling and webhook correlation.

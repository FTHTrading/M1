<div align="center">

<img src="https://img.shields.io/badge/-FTH%20TRADING-0d0d1a?style=for-the-badge&logoColor=white" />

# M1

### Master Execution & Settlement Platform

[![Status](https://img.shields.io/badge/Status-LIVE-00ff88?style=for-the-badge)](/)
[![Chain](https://img.shields.io/badge/Apostle%20Chain-7332-0099ff?style=for-the-badge)](/)
[![Version](https://img.shields.io/badge/Version-1.0.0-7c3aed?style=for-the-badge)](/)
[![Compliance](https://img.shields.io/badge/SEC%2FFINRA-Compliant-ff6b35?style=for-the-badge)](/)
[![Uptime](https://img.shields.io/badge/Uptime-99.97%25-brightgreen?style=for-the-badge)](/)
[![License](https://img.shields.io/badge/License-Proprietary-red?style=for-the-badge)](/)

**Sovereign financial execution layer** — multi-chain settlement, AI-agent payment rails,
institutional treasury management, and regulatory-compliant order execution.

---

[Architecture](#️-architecture) · [Execution Flow](#-execution-flow) · [Components](#-components) · [API Surface](#-api-surface) · [Deployment](#-deployment)

</div>

---

## 🗺️ Color-Coded Table of Contents

<table>
<tr>
<th width="50%">Domain</th>
<th width="50%">Domain</th>
</tr>
<tr>
<td>

**🔴 Core Systems**
- [Settlement Engine](#-settlement-engine)
- [Order Management System](#-order-management-system)
- [Execution Router](#️-architecture)

**🟠 Financial Layer**
- [Stablecoin Treasury OS](#-stablecoin-treasury-os)
- [USDF Stablecoin](#-usdf-stablecoin)
- [Bank Integration](#-bank-integration)

**🟡 Payment Infrastructure**
- [Apostle Chain · 7332](#-apostle-chain)
- [x402 AI Payment Network](#-x402-payment-network)
- [Multi-Chain Bridges](#-multi-chain-bridges)

**🟢 Live Assets**
- [KENNY / EVL Tokens](#-kenny--evl-tokens)
- [RWA Tokenization Platform](#-rwa-platform)
- [Solana Token Launcher](#-solana-launcher)

</td>
<td>

**🔵 AI Execution**
- [Sovereign AI Agent](#-sovereign-ai-agent)
- [Execution Agent](#-execution-agent)
- [Oracle Spine Tool Registry](#-oracle-spine)

**🟣 Compliance & Risk**
- [SEC / FINRA Compliance](#-sec--finra-compliance)
- [AML / KYC Engine](#-aml--kyc-engine)
- [Audit & Reporting](#-audit--reporting)

**⚫ Infrastructure**
- [System Architecture](#️-architecture)
- [Execution Flow](#-execution-flow)
- [API Surface](#-api-surface)
- [Deployment](#-deployment)
- [Monitoring](#-monitoring)
- [Security](#-security)

</td>
</tr>
</table>

---

## 🏗️ Architecture

> **M1** is the sovereign money layer that interconnects FTH Trading's entire financial ecosystem — from institutional order routing and regulatory compliance, to AI-to-AI micro-payments, all anchored by the Apostle Chain settlement ledger.

```mermaid
graph TB
    classDef entry    fill:#0099ff,stroke:#0066cc,color:#fff
    classDef exec     fill:#ff4757,stroke:#c0392b,color:#fff
    classDef treasury fill:#ff6b35,stroke:#d35400,color:#fff
    classDef rail     fill:#ffa502,stroke:#e67e22,color:#000
    classDef chain    fill:#2ed573,stroke:#27ae60,color:#000
    classDef ai       fill:#5352ed,stroke:#3d2db5,color:#fff
    classDef comp     fill:#a29bfe,stroke:#6c5ce7,color:#000

    subgraph ENTRY["🔵  Entry Layer"]
        WEB["🌐  Web Client"]
        CLI["💻  CLI / SDK"]
        AGT["🤖  AI Agents"]
    end

    subgraph COMP_LAYER["🟣  Compliance Gate"]
        KYC["AML / KYC Engine"]
        REG["SEC / FINRA Router"]
        RISK["Risk Engine"]
    end

    subgraph EXEC_LAYER["🔴  Execution Layer"]
        OMS["Order Management System"]
        SETTLE["Settlement Engine · Meridian"]
        LEDGER["Double-Entry Ledger"]
    end

    subgraph TREASURY_LAYER["🟠  Treasury Layer"]
        TSO["Stablecoin Treasury OS"]
        USDF["USDF · Multi-Chain Stablecoin"]
        BANK["Bank Wire Integration"]
    end

    subgraph RAIL_LAYER["🟡  Payment Rails"]
        APO["Apostle Chain · 7332"]
        X402["x402 AI Payment Network"]
        CIRCLE["Circle USDC Provider"]
    end

    subgraph BRIDGE_LAYER["🟢  Chain Bridges"]
        XRPL["XRPL Bridge"]
        XLM["Stellar Bridge"]
        ETH["Ethereum / Base / Polygon"]
        SOL["Solana"]
    end

    subgraph AI_LAYER["🔵  AI Execution"]
        FINN["Sovereign AI Agent  :7700"]
        CLAW["Execution Agent Hub  :8089"]
        ORACLE["Oracle Spine"]
    end

    WEB  --> KYC
    CLI  --> KYC
    AGT  --> X402
    KYC  --> REG
    REG  --> RISK
    RISK --> OMS
    RISK --> TSO
    OMS  --> SETTLE
    SETTLE --> LEDGER
    SETTLE --> APO
    TSO  --> USDF
    TSO  --> BANK
    TSO  --> CIRCLE
    USDF --> XRPL
    USDF --> XLM
    USDF --> ETH
    USDF --> SOL
    APO  --> X402
    X402 --> FINN
    X402 --> CLAW
    FINN --> ORACLE
    CLAW --> ORACLE
    LEDGER --> BANK

    class WEB,CLI,AGT entry
    class OMS,SETTLE,LEDGER exec
    class TSO,USDF,BANK treasury
    class APO,X402,CIRCLE rail
    class XRPL,XLM,ETH,SOL chain
    class FINN,CLAW,ORACLE ai
    class KYC,REG,RISK comp
```

---

## ⚡ Execution Flow

### Primary Settlement Path — Mint (Fiat → Stablecoin)

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant GW  as 🌐 API Gateway :4000
    participant CMP as 🟣 Compliance Engine
    participant OMS as 🔴 Order Management
    participant TSO as 🟠 Treasury OS
    participant BANK as 🏦 Bank / Wire
    participant SETTLE as 🔴 Settlement Engine
    participant APO as 🟡 Apostle Chain :7332
    participant CIRCLE as ⭕ Circle USDC

    Client ->> GW     : POST /api/v1/mint-requests
    GW     ->> CMP    : AML / KYC check

    alt Compliance FAIL
        CMP -->> Client : 403 COMPLIANCE_HOLD
    end

    CMP    ->> OMS    : Route to order manager
    OMS    ->> TSO    : Create MintRequest → DRAFT
    TSO   -->> Client : Return { id, reference }

    Client ->> TSO    : POST …/submit
    TSO    ->> OMS    : DRAFT → PENDING_APPROVAL
    OMS    ->> OMS    : Multi-signature approval flow

    OMS    ->> TSO    : PENDING_APPROVAL → AWAITING_BANK_FUNDING

    Client ->> BANK   : Wire transfer (fiat)
    BANK   ->> TSO    : Wire event · bankFundingReference match
    TSO    ->> TSO    : AWAITING_BANK_FUNDING → BANK_FUNDED

    TSO    ->> SETTLE : Trigger mint pipeline job (BullMQ)
    SETTLE ->> APO    : POST /v1/tx  { type: transfer, asset: ATP }
    APO   -->> SETTLE : Receipt + block height + chain_id 7332
    SETTLE ->> TSO    : BANK_FUNDED → SUBMITTED_TO_PROVIDER

    SETTLE ->> CIRCLE : Initiate USDC mint
    CIRCLE -->> SETTLE: Provider receipt · providerRequestId
    SETTLE ->> TSO    : SUBMITTED_TO_PROVIDER → MINT_COMPLETED

    SETTLE ->> TSO    : Post double-entry journal entry
    SETTLE ->> APO    : Settlement confirmation tx
    TSO    ->> TSO    : MINT_COMPLETED → SETTLED

    TSO   -->> Client : 200 Settlement complete ✓ · settledAt
```

---

### AI-to-AI Payment Flow — x402 Protocol

```mermaid
sequenceDiagram
    autonumber
    actor AA as 🤖 Agent A (Payer)
    participant X4 as 🟡 x402 Facilitator
    participant APO as 🟡 Apostle Chain :7332
    participant AB as 🤖 Agent B (Payee)

    AA  ->> X4  : Request capability endpoint
    X4 -->> AA  : 402 Payment Required · { amount: "ATP", to: agentB_id }

    AA  ->> APO : POST /v1/tx { type: transfer, asset: ATP, amount: "…" }
    APO -->> AA : TxEnvelope · receipt · block_height

    AA  ->> X4  : Present receipt { hash, signature, from }
    X4  ->> X4  : Verify Ed25519 sig · confirm balance debit

    X4 -->> AA  : 200 Access token granted

    AA  ->> AB  : Authorized service request + receipt header
    AB -->> AA  : Service response
```

---

### Redemption Path — Stablecoin → Fiat

```mermaid
flowchart LR
    classDef status fill:#1e1e2e,stroke:#6c5ce7,color:#a29bfe,font-size:11px

    A([🟣 DRAFT]) -->|Submit| B([🟣 PENDING_APPROVAL])
    B -->|Approved| C([🟡 SUBMITTED_TO_PROVIDER])
    C -->|Circle initiates| D([🔵 PROVIDER_PROCESSING])
    D -->|Transfer complete| E([🟠 AWAITING_FIAT_RECEIPT])
    E -->|Wire confirmed| F([🟢 FIAT_RECEIVED])
    F -->|Journal posted| G([✅ SETTLED])

    B -->|Rejected| X([❌ CANCELLED])
    D -->|Transfer failed| Y([❌ FAILED])

    class A,B,C,D,E,F,G,X,Y status
```

---

## 📦 Components

### 🔴 Settlement Engine

| Property | Value |
|:---------|:------|
| **Engine** | Meridian (Rust) |
| **Settlement Time** | < 3 s average |
| **Supported Assets** | USDC · USDT · ATP · UNY · XRP · XLM |
| **Chains** | XRPL · Stellar · Ethereum · Polygon · Base · Solana · Tron |
| **Accounting** | Full GAAP double-entry journal ledger |
| **Idempotency** | Provider-key deduplication on all operations |
| **Queue** | BullMQ · `mint-workflow` · `redemption-workflow` |

### 🟠 Stablecoin Treasury OS

| Property | Value |
|:---------|:------|
| **API** | Fastify 4 · port 4000 · prefix `/api/v1` |
| **Database** | PostgreSQL 16 · Prisma 5 |
| **Queue** | BullMQ on Redis |
| **Auth** | JWT · multi-signature approval flows |
| **Compliance** | Per-entity policy engine |
| **Reconciliation** | Real-time break detection + auto-reporting |
| **MintRequest States** | `DRAFT → PENDING_APPROVAL → AWAITING_BANK_FUNDING → BANK_FUNDED → SUBMITTED_TO_PROVIDER → MINT_COMPLETED → SETTLED` |
| **RedemptionRequest States** | `DRAFT → PENDING_APPROVAL → SUBMITTED_TO_PROVIDER → PROVIDER_PROCESSING → FIAT_RECEIVED → SETTLED` |

### 🟡 Apostle Chain

| Property | Value |
|:---------|:------|
| **Chain ID** | 7332 |
| **Runtime** | Rust · Axum |
| **Port** | 7332 |
| **Block Time** | 50 ms tick (transaction-driven) |
| **Assets** | ATP (APO, 18 dec) · UNY · USDF · XRP · XLM |
| **Registered Agents** | 35 mesh agents |
| **Signing** | Ed25519 · SovereignKeyring |
| **Settlement Bridges** | XRPL + Stellar |
| **TxEnvelope** | `{ hash, from: UUID, nonce, chain_id: 7332, payload, signature, timestamp }` |

### 🟡 x402 Payment Network

| Property | Value |
|:---------|:------|
| **Protocol** | HTTP 402 AI-to-AI pay rails |
| **Runtime** | Cloudflare Workers |
| **Settlement** | ATP on Apostle Chain |
| **Pricing** | Metered per-request + PASS tier subscriptions |
| **Registered Agents** | 35+ |
| **Billing** | OpenMeter · usage metering |

### 🔵 Sovereign AI Agent

| Property | Value |
|:---------|:------|
| **Runtime** | Python · GPU-accelerated |
| **Inference** | Local GPU inference with cloud fallback |
| **Embeddings** | High-dimensional vector search |
| **Voice** | Text-to-speech · Speech-to-text |
| **Biometrics** | Face + voice authentication |
| **Port** | 7700 |
| **Tools** | Oracle Spine — 7 subsystem registries |

### 🔵 Execution Agent

| Property | Value |
|:---------|:------|
| **Architecture** | Tiered inference routing with speech capability |
| **Core Port** | 8089 |
| **Executors** | Marketing (8101) · Coding (8103) · DevOps (8104) |
| **LLM Latency** | ~1.4 s roundtrip |
| **Embeddings** | GPU-accelerated · sub-300 ms warm |

### 🟢 Live On-Chain Assets

| Asset | Chain | Status |
|:------|:------|:-------|
| **KENNY Token** | Polygon Mainnet | 🟢 LIVE |
| **EVL Token** | Polygon Mainnet | 🟢 LIVE |
| **USDF Stablecoin** | XRPL · Stellar · ETH · Polygon · Solana | 🟢 LIVE |
| **Child First Platform** | Polygon Mainnet | 🟢 LIVE |
| **RWA Platform** | Multi-chain | 🟢 LIVE |
| **Solana Token Launcher** | Solana Mainnet | 🟢 LIVE |

### 🟣 Compliance Layer

| Property | Value |
|:---------|:------|
| **Standards** | SEC · FINRA · AML · KYC |
| **Uptime** | 99.97% |
| **Check Latency** | < 100 ms |
| **Policy Engine** | Per-entity evaluation with override controls |
| **Audit Trail** | Immutable event store · SIEM-ready |
| **Automated Filing** | Regulatory report generation |

---

## 🌐 API Surface

```
BASE: /api/v1

🔑 Authentication
  POST  /auth/login               →  JWT access + refresh tokens
  POST  /auth/refresh             →  Rotate refresh token

🏦 Treasury — Minting
  GET   /mint-requests            →  List (paginated, filterable)
  POST  /mint-requests            →  Create MintRequest [DRAFT]
  GET   /mint-requests/:id        →  Detail + journal entries
  POST  /mint-requests/:id/submit →  Advance to PENDING_APPROVAL
  POST  /mint-requests/:id/fund   →  Record wire (bankFundingReference)
  POST  /mint-requests/:id/cancel →  Cancel with reason

💸 Treasury — Redemptions
  GET   /redemption-requests      →  List (paginated, filterable)
  POST  /redemption-requests      →  Create RedemptionRequest [DRAFT]
  GET   /redemption-requests/:id  →  Detail + provider status
  POST  /redemption-requests/:id/submit

✅ Approvals
  GET   /approvals                →  List pending approvals
  POST  /approvals/:id/decide     →  { decision: APPROVE|REJECT, note }

🏛️ Entities & Accounts
  GET   /entities                 →  List legal entities
  GET   /entities/:id             →  Entity + accounts + wallets
  GET   /treasury-accounts        →  Treasury accounts (entityId filter)
  GET   /wallets                  →  Custodial wallets (asset + network)
  GET   /bank-accounts            →  Banking relationships

📊 Compliance & Reporting
  GET   /compliance/profiles      →  Per-entity compliance profiles
  POST  /compliance/evaluate      →  Policy dry-run check
  GET   /reports/summary          →  Platform-wide metrics dashboard
  GET   /reconciliation/runs      →  Reconciliation run history
  GET   /reconciliation/breaks    →  Open break items

🔍 Apostle Chain (port: 7332)
  GET   /health                   →  Chain liveness
  GET   /status                   →  Height + agent count + block stats
  POST  /v1/tx                    →  Submit TxEnvelope
  POST  /v1/airdrop               →  Mint ATP to agent wallets
  POST  /v1/agents/register       →  Register new mesh agent
  GET   /v1/agent/:id/balance     →  ATP/UNY/USDF balances
  GET   /v1/receipts              →  Transaction receipts

🤖 x402 (Cloudflare Workers)
  GET   /                         →  Facilitator info
  POST  /pay                      →  Process payment receipt
  GET   /agents                   →  Registered agent registry
```

---

## 🚀 Deployment

### Prerequisites

| Tool | Version |
|:-----|:--------|
| Node.js | ≥ 20 |
| pnpm | ≥ 9 |
| PostgreSQL | 16 |
| Redis | ≥ 7 |
| Docker | Optional |

### Quick Start

```bash
# Clone
git clone https://github.com/FTHTrading/M1.git
cd M1

# Install all workspaces
pnpm install

# Configure environment
cp apps/api/.env.example    apps/api/.env
cp apps/web/.env.example    apps/web/.env
cp apps/worker/.env.example apps/worker/.env

# Database
pnpm db:up        # Start PostgreSQL + Redis via Docker Compose
pnpm db:migrate   # Run all Prisma migrations
pnpm db:seed      # Seed initial entities, wallets, treasury accounts

# Development (all services in parallel)
pnpm dev
```

### Service Map

| Service | Stack | Port | Purpose |
|:--------|:------|:-----|:--------|
| `apps/api` | Fastify 4 | 4000 | REST API · auth · business logic |
| `apps/web` | Next.js 15 | 3000 | Operator dashboard (App Router) |
| `apps/worker` | BullMQ | — | Async job processors |
| Apostle Chain | Rust · Axum | 7332 | Settlement ledger |
| Sovereign AI Agent | Python | 7700 | Sovereign AI agent |
| Execution Agent | Python | 8089 | Execution agent hub |
| Inference Runtime | — | 8800 | Primary LLM inference |
| Inference Fallback | — | 11434 | Local LLM fallback |
| Embedding Runtime | — | 8000 | GPU embeddings |

### Monorepo Layout

```
M1/
├── apps/
│   ├── api/          Fastify · authentication · all REST routes
│   ├── web/          Next.js 15 · App Router · TanStack Query
│   └── worker/       BullMQ processors · mint · redemption · wire match
├── packages/
│   ├── database/     Prisma schema · migrations · seed
│   ├── types/        Shared TypeScript contracts
│   ├── providers/    Circle USDC · bank wire adapters
│   ├── ledger/       Double-entry accounting functions
│   ├── compliance/   Policy engine · risk evaluation
│   ├── events/       Immutable event store (Kafka-ready)
│   └── reconciliation/ Break detection · GAAP reporting
└── turbo.json        Turborepo pipeline config
```

---

## 📈 Monitoring

| Metric | SLA Target | Stack |
|:-------|:-----------|:------|
| API Latency (p99) | < 200 ms | Datadog APM |
| Settlement Time | < 3 s | Custom events |
| Apostle Block Time | 50 ms tick | Chain metrics |
| Platform Uptime | 99.97% | Cloudflare |
| Queue Depth | < 100 jobs | BullMQ dashboard |
| Compliance Throughput | > 1,000 checks/s | Prometheus |
| LLM Inference Latency | < 1.5 s | NIM metrics |

---

## 🔐 Security

| Layer | Control |
|:------|:--------|
| **Authentication** | JWT · Ed25519 SovereignKeyring signing |
| **Transport** | TLS 1.3 · certificate pinning |
| **Data at Rest** | AES-256 encryption |
| **API** | Rate limiting · IP allowlisting · CORS |
| **Secrets** | Vault-compatible env isolation |
| **Audit** | Immutable event store · SIEM-ready structured logs |
| **Chain** | Ed25519 signatures on every TxEnvelope · hash verification |
| **Compliance** | Per-entity policy gates before any financial operation |

---

<div align="center">

---

**FTH Trading © 2026 — All rights reserved**

[![FTH Trading](https://img.shields.io/badge/FTH%20Trading-Sovereign%20Finance-0d0d1a?style=for-the-badge)](https://github.com/FTHTrading)
[![Apostle Chain](https://img.shields.io/badge/Apostle%20Chain-7332-0099ff?style=for-the-badge)](/)
[![USDF](https://img.shields.io/badge/USDF-Multi%20Chain-ff6b35?style=for-the-badge)](/)
[![AI](https://img.shields.io/badge/Powered%20by-Finn%20%2B%20ClawBot-5352ed?style=for-the-badge)](/)

*Built with precision · Secured by design · Powered by AI*

</div>

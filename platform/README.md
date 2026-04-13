# M1 Platform — Component Map

M1 is FTH Trading's sovereign financial execution platform. This document maps every active subsystem, its role, and where to find it.

---

## Platform Architecture

```
M1 — FTH Trading Sovereign Execution Platform
│
├── 💰 Treasury Layer
│   ├── stablecoin-treasury-os      USDC/USDT issuance, redemption, reconciliation
│   └── USDF Stablecoin (Meridian)  Multi-chain stablecoin + Rust settlement engine
│
├── ⛓️  Settlement Layer
│   ├── Apostle Chain               Sovereign Rust/Axum ledger — chain_id 7332
│   ├── XRPL Bridge                 Native XRPL connector
│   └── Stellar Bridge              Native Stellar connector
│
├── 🤖 AI Execution Layer
│   ├── Finn                        Sovereign household AI — Oracle Spine + biometrics
│   ├── ClawBot v2                  NVIDIA-first execution stack (NIM + Triton + Riva)
│   └── x402 Network                AI-to-AI payment rails, 35+ registered agents
│
├── 📊 Compliance & Reporting
│   ├── Broker-Dealer Platform      SEC/FINRA compliant OMS + ATS
│   ├── Compliance Engine           AML/KYC/KYB policy rules (packages/compliance)
│   └── Audit Event Store           Immutable DomainEvent log
│
├── 🪙 Asset Layer
│   ├── RWA Platform                Real World Asset tokenization (Polygon/ETH)
│   ├── KENNY / EVL Tokens          Live Polygon mainnet tokens
│   └── Solana Token Launcher       SaaS token deployment service
│
└── 🌐 Client Layer
    ├── Operator Dashboard          Next.js 15 dark UI (apps/web)
    ├── Kalishi Edge                Bet.drunks.app dashboard (Cloudflare)
    └── This site                  fthtrading.github.io/M1
```

---

## Repositories

| Repo | Description | Status |
|------|-------------|--------|
| [FTHTrading/M1](https://github.com/FTHTrading/M1) | Platform home — docs, site, architecture | ✅ Live |
| [FTHTrading/Legal-Chain](https://github.com/FTHTrading/Legal-Chain) | Legal & compliance chain | 🔵 Active |
| [FTHTrading/JR](https://github.com/FTHTrading/JR) | Junior agent runtime | 🔵 Active |

---

## Core Services & Ports

| Service | Port | Stack |
|---------|------|-------|
| Apostle Chain | 7332 | Rust / Axum |
| Treasury API | 4000 | Node / Fastify 4 |
| Treasury Web | 3000 | Next.js 15 |
| Finn | 7700 | Python / FastAPI |
| finn-brain | 7710 | Rust / Candle |
| ClawBot Runner | 8089 | Python / Uvicorn |
| NIM LLM | 8800 | NVIDIA NIM |
| Ollama | 11434 | Ollama |
| Triton | 8000 | NVIDIA Triton |

---

## Docs

- [Architecture](./architecture.md) — System component diagram and data flow
- [Compliance Controls](./compliance-controls.md) — 7-rule policy engine documentation
- [Operations Runbook](./operations-runbook.md) — Day-to-day operational procedures
- [Provider Integration](./provider-integration-guide.md) — Circle USDC + Tether setup
- [Reconciliation Methodology](./reconciliation-methodology.md) — Three-way ledger/bank/provider reconciliation

---

## Settlement Flow

```
Client Request
     │
     ▼
Compliance Gate ──► BLOCKED (if KYC/Sanctions fail)
     │ PASS
     ▼
Approval Workflow (multi-sig if > threshold)
     │
     ▼
Bank Wire Confirmation
     │
     ▼
Provider API (Circle / Tether OTC)
     │
     ▼
Apostle Chain Settlement
     │
     ▼
Wallet Credited + Journal Entry Posted
     │
     ▼
SETTLED ✅
```

---

## Token Economics (Apostle Chain)

| Token | Symbol | Decimals | Purpose |
|-------|--------|----------|---------|
| Apostle | ATP | 18 | Native gas + settlement |
| Unykorn | UNY | 18 | Mesh agent utility |
| USDF | USDF | 7 | Sovereign stablecoin |
| XRP | XRP | 6 | XRPL bridge |
| XLM | XLM | 7 | Stellar bridge |

---

## Key Wallets (Apostle Chain — Mainnet)

| Operator | ATP Balance |
|----------|-------------|
| kevan-burns-chairman | 500,000 |
| genesis-treasury | 1,000,000 |
| unykorn-operator | 250,000 |
| x402-credit-pool | 500,000 |
| mesh-pay-reserve | 200,000 |

---

*Last updated: April 2026 · FTH Trading · M1 Platform*

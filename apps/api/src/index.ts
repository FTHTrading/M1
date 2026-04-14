import "./otel.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

import { getEnv, loadEnv } from "@treasury/config";

import { authRoutes } from "./routes/auth.js";
import { entityRoutes } from "./routes/entities.js";
import { bankAccountRoutes } from "./routes/bankAccounts.js";
import { walletRoutes } from "./routes/wallets.js";
import { mintRequestRoutes } from "./routes/mintRequests.js";
import { redemptionRequestRoutes } from "./routes/redemptionRequests.js";
import { approvalRoutes } from "./routes/approvals.js";
import { transferRoutes } from "./routes/transfers.js";
import { reconciliationRoutes } from "./routes/reconciliation.js";
import { complianceRoutes } from "./routes/compliance.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { reportRoutes } from "./routes/reports.js";
import { adminRoutes } from "./routes/admin.js";
import { eventsRoutes } from "./routes/events.js";
import { treasuryAccountRoutes } from "./routes/treasuryAccounts.js";
import { assuranceRoutes } from "./routes/assurance.js";

loadEnv();
const env = getEnv();

const server = Fastify({
  logger: {
    level: env.LOG_LEVEL ?? "info",
    transport: process.env["NODE_ENV"] !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
  },
  ajv: {
    customOptions: {
      strict: "log",
      keywords: ["example"],
    },
  },
});

// ── Plugins ──────────────────────────────────────────────────────────────────

await server.register(helmet, {
  contentSecurityPolicy: false, // configured at CDN layer
});

await server.register(cors, {
  origin: env.CORS_ORIGIN?.split(",") ?? ["http://localhost:3000"],
  credentials: true,
});

await server.register(rateLimit, {
  max: 200,
  timeWindow: "1 minute",
  allowList: ["127.0.0.1"],
});

await server.register(sensible);

await server.register(jwt, {
  secret: env.AUTH_SECRET,
  sign: { expiresIn: env.JWT_EXPIRES_IN ?? "8h" },
});

await server.register(swagger, {
  openapi: {
    info: {
      title: "Stablecoin Treasury OS API",
      description: "Internal treasury orchestration API for USDC/USDT mint, redemption, ledger and compliance operations",
      version: "1.0.0",
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
    security: [{ bearerAuth: [] }],
  },
});

await server.register(swaggerUi, {
  routePrefix: "/docs",
  uiConfig: { docExpansion: "list" },
});

// ── Routes ────────────────────────────────────────────────────────────────────

const API_V1 = "/api/v1";

await server.register(authRoutes,           { prefix: `${API_V1}/auth` });
await server.register(entityRoutes,         { prefix: `${API_V1}/entities` });
await server.register(bankAccountRoutes,    { prefix: `${API_V1}/bank-accounts` });
await server.register(walletRoutes,         { prefix: `${API_V1}/wallets` });
await server.register(mintRequestRoutes,    { prefix: `${API_V1}/mint-requests` });
await server.register(redemptionRequestRoutes, { prefix: `${API_V1}/redemption-requests` });
await server.register(approvalRoutes,       { prefix: `${API_V1}/approvals` });
await server.register(transferRoutes,       { prefix: `${API_V1}/transfers` });
await server.register(reconciliationRoutes, { prefix: `${API_V1}/reconciliation` });
await server.register(complianceRoutes,     { prefix: `${API_V1}/compliance` });
await server.register(webhookRoutes,        { prefix: `${API_V1}/webhooks` });
await server.register(reportRoutes,         { prefix: `${API_V1}/reports` });
await server.register(adminRoutes,          { prefix: `${API_V1}/admin` });
await server.register(eventsRoutes,         { prefix: `${API_V1}/events` });
await server.register(treasuryAccountRoutes,{ prefix: `${API_V1}/treasury-accounts` });
await server.register(assuranceRoutes,       { prefix: `${API_V1}/assurance` });

// ── Health endpoints (public) ────────────────────────────────────────────────

server.get("/health", async () => ({ status: "ok", ts: new Date().toISOString() }));
server.get("/ready",  async () => ({ status: "ready" }));

// ── Start ────────────────────────────────────────────────────────────────────

const port = Number(env.API_PORT ?? 4000);
const host = env.API_HOST ?? "0.0.0.0";

try {
  await server.listen({ port, host });
  server.log.info(`Treasury API listening at ${host}:${port}`);
  server.log.info(`Swagger UI available at http://localhost:${port}/docs`);
} catch (err) {
  server.log.error(err);
  process.exit(1);
}

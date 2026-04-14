import "./otel.js";
import { Worker, Queue } from "bullmq";
import { loadEnv, getEnv } from "@treasury/config";

import { processMintJob } from "./jobs/processMint.js";
import { processRedemptionJob } from "./jobs/processRedemption.js";
import { matchWireEventJob } from "./jobs/matchWireEvent.js";
import { runAuditJob } from "./jobs/runAudit.js";
import { generateReportJob } from "./jobs/generateReport.js";
import { processReconciliationJob } from "./jobs/processReconciliation.js";

loadEnv();
const env = getEnv();

const redisUrl = new URL(env.REDIS_URL);
const connection = {
  host: redisUrl.hostname || "localhost",
  port: redisUrl.port ? Number(redisUrl.port) : 6379,
  ...(redisUrl.password ? { password: redisUrl.password } : {}),
};

console.log("Treasury Worker starting...");
console.log(`Redis: ${connection.host}:${connection.port}`);
console.log(`Sandbox mode: ${env.FEATURE_SANDBOX_ONLY}`);

// ── Mint workflow worker ──────────────────────────────────────────────────────

const mintWorker = new Worker(
  "mint-workflow",
  async (job) => {
    if (job.name === "process-mint" || job.name === "check-mint-status") {
      return processMintJob(job as Parameters<typeof processMintJob>[0]);
    }
    if (job.name === "match-wire-event") {
      return matchWireEventJob(job as Parameters<typeof matchWireEventJob>[0]);
    }
    throw new Error(`Unsupported mint job: ${job.name}`);
  },
  {
    connection,
    concurrency: 5,
    limiter: { max: 10, duration: 1000 },
  },
);

mintWorker.on("completed", (job) => {
  console.log(`[mint] job ${job.id} completed`);
});
mintWorker.on("failed", (job, err) => {
  console.error(`[mint] job ${job?.id} failed:`, err.message);
});
mintWorker.on("error", (err) => {
  console.error("[mint] worker error:", err);
});

// ── Redemption workflow worker ────────────────────────────────────────────────

const redemptionWorker = new Worker(
  "redemption-workflow",
  async (job) => {
    if (
      job.name === "process-redemption" ||
      job.name === "check-redemption-status"
    ) {
      return processRedemptionJob(
        job as Parameters<typeof processRedemptionJob>[0],
      );
    }
    throw new Error(`Unsupported redemption job: ${job.name}`);
  },
  {
    connection,
    concurrency: 5,
    limiter: { max: 10, duration: 1000 },
  },
);

redemptionWorker.on("completed", (job) => {
  console.log(`[redemption] job ${job.id} completed`);
});
redemptionWorker.on("failed", (job, err) => {
  console.error(`[redemption] job ${job?.id} failed:`, err.message);
});
redemptionWorker.on("error", (err) => {
  console.error("[redemption] worker error:", err);
});

// ── Report generation worker ─────────────────────────────────────────────────

const reportWorker = new Worker(
  "report-workflow",
  async (job) => {
    if (job.name === "generate-report") {
      return generateReportJob(job as Parameters<typeof generateReportJob>[0]);
    }
    throw new Error(`Unsupported report job: ${job.name}`);
  },
  {
    connection,
    concurrency: 2,
  },
);

reportWorker.on("completed", (job) => {
  console.log(`[report] job ${job.id} completed`);
});
reportWorker.on("failed", (job, err) => {
  console.error(`[report] job ${job?.id} failed:`, err.message);
});
reportWorker.on("error", (err) => {
  console.error("[report] worker error:", err);
});

// ── Reconciliation queue + daily cron ────────────────────────────────────────

const reconQueue = new Queue("reconciliation", { connection });

const reconciliationWorker = new Worker(
  "reconciliation",
  async (job) => {
    if (job.name === "run-reconciliation") {
      return processReconciliationJob(job as Parameters<typeof processReconciliationJob>[0]);
    }
    throw new Error(`Unsupported reconciliation job: ${job.name}`);
  },
  {
    connection,
    concurrency: 1,
  },
);

reconciliationWorker.on("completed", (job) => {
  console.log(`[recon] job ${job.id} completed`);
});
reconciliationWorker.on("failed", (job, err) => {
  console.error(`[recon] job ${job?.id} failed:`, err.message);
});
reconciliationWorker.on("error", (err) => {
  console.error("[recon] worker error:", err);
});

// Schedule daily reconciliation run at 00:05 UTC (give settlement time to clear)
reconQueue
  .add(
    "run-reconciliation",
    { triggeredBy: "cron", triggerTime: new Date().toISOString() },
    {
      repeat: { pattern: "5 0 * * *" },
      jobId:  "daily-reconciliation",
      removeOnComplete: { count: 30 },
      removeOnFail:    { count: 14 },
    },
  )
  .then(() => console.log("[recon] daily cron scheduled (00:05 UTC)"))
  .catch((err: unknown) => console.error("[recon] failed to schedule cron:", err));

// ── Audit pipeline worker ─────────────────────────────────────────────────────

const auditWorker = new Worker(
  "audit-workflow",
  async (job) => {
    if (job.name === "run-audit") {
      return runAuditJob(job as Parameters<typeof runAuditJob>[0]);
    }
    throw new Error(`Unsupported audit job: ${job.name}`);
  },
  {
    connection,
    concurrency: 2,
  },
);

auditWorker.on("completed", (job) => {
  console.log(`[audit] job ${job.id} completed`);
});
auditWorker.on("failed", (job, err) => {
  console.error(`[audit] job ${job?.id} failed:`, err.message);
});
auditWorker.on("error", (err) => {
  console.error("[audit] worker error:", err);
});

console.log("Treasury Worker ready. Listening for jobs...");

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(): Promise<void> {
  console.log("Shutting down workers...");
  await Promise.all([
    mintWorker.close(),
    redemptionWorker.close(),
    auditWorker.close(),
    reportWorker.close(),
    reconciliationWorker.close(),
  ]);
  await reconQueue.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

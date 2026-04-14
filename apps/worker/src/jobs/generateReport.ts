/**
 * Report Generation Job
 *
 * Generates treasury reports in multiple formats and persists execution
 * metadata into ReportJob (Prisma model already present in schema).
 */

import type { Job } from "bullmq";
import { getPrismaClient } from "@treasury/database";
import { eventStore } from "@treasury/events";

// ── Types ────────────────────────────────────────────────────────────────────

export type ReportType =
  | "reconciliation_summary"
  | "mint_activity"
  | "redemption_activity"
  | "entity_balances"
  | "audit_trail"
  | "regulatory_summary";

export type ReportFormat = "json" | "csv" | "html";

export interface GenerateReportJobData {
  reportType:  ReportType;
  format:      ReportFormat;
  /** ISO date string — start of reporting period */
  periodStart: string;
  /** ISO date string — end of reporting period */
  periodEnd:   string;
  /** Limit to a specific entity (optional — null = all entities) */
  entityId?:   string;
  /** User requesting the report */
  requestedBy: string;
  /** Optional pre-created ReportJob DB record id */
  reportJobId?: string;
}

// ── Job handler ──────────────────────────────────────────────────────────────

export async function generateReportJob(
  job: Job<GenerateReportJobData>,
): Promise<{ reportJobId: string; storageKey: string; rowCount: number }> {
  const db = getPrismaClient();
  const { reportType, format, periodStart, periodEnd, entityId, requestedBy, reportJobId } =
    job.data;
  const log = (msg: string) => job.log(msg);

  const startDate = new Date(periodStart);
  const endDate   = new Date(periodEnd);

  await log(`[report] generating ${reportType} (${format}) ${periodStart} → ${periodEnd}`);

  // Create or load the ReportJob record
  let currentReportJobId = reportJobId;
  if (!currentReportJobId) {
    const created = await db.reportJob.create({
      data: {
        entityId:      entityId ?? null,
        type:          mapToSchemaReportType(reportType),
        status:        "RUNNING",
        parameters:    {
          reportType,
          format,
          periodStart: startDate.toISOString(),
          periodEnd: endDate.toISOString(),
        },
        requestedById: requestedBy || null,
        startedAt:     new Date(),
      },
    });
    currentReportJobId = created.id;
  } else {
    await db.reportJob.update({
      where: { id: currentReportJobId },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        parameters: {
          reportType,
          format,
          periodStart: startDate.toISOString(),
          periodEnd: endDate.toISOString(),
        },
      },
    });
  }

  try {
    // ── Gather data ────────────────────────────────────────────────────────

    const rows = await fetchReportData(db, reportType, startDate, endDate, entityId);
    await log(`[report] fetched ${rows.length} rows for ${reportType}`);

    // ── Render ─────────────────────────────────────────────────────────────

    const rendered = renderReport({ reportType, format, rows, periodStart: startDate, periodEnd: endDate });

    // ── Persist / store ────────────────────────────────────────────────────

    const storageKey = buildStorageKey(currentReportJobId, reportType, format);
    const storage = await storeReport(storageKey, rendered);

    await db.reportJob.update({
      where: { id: currentReportJobId },
      data:  {
        status: "COMPLETED",
        completedAt: new Date(),
        storageKey,
        downloadUrl: storage.downloadUrl,
        parameters: {
          reportType,
          format,
          periodStart: startDate.toISOString(),
          periodEnd: endDate.toISOString(),
          rowCount: rows.length,
          fileSizeBytes: Buffer.byteLength(rendered, "utf-8"),
          inlinePreview: storage.inlinePreview,
        },
      },
    });

    await eventStore.emit({
      eventType:     "report.generated",
      aggregateType: "ReportJob",
      aggregateId:   currentReportJobId,
      actorId:       requestedBy,
      actorType:     "user",
      payload: { reportType, format, rowCount: rows.length, storageKey },
    });

    await log(`[report] completed ${currentReportJobId} - ${rows.length} rows, key: ${storageKey}`);

    return { reportJobId: currentReportJobId, storageKey, rowCount: rows.length };

  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    await db.reportJob.update({
      where: { id: currentReportJobId },
      data:  { status: "FAILED", errorMessage: reason, completedAt: new Date() },
    });
    throw err;
  }
}

function mapToSchemaReportType(reportType: ReportType):
  | "RECONCILIATION_EXCEPTION"
  | "FIAT_TO_STABLECOIN_CONVERSION"
  | "STABLECOIN_TO_FIAT_REDEMPTION"
  | "WALLET_DISTRIBUTION"
  | "AUDIT_LOG_EXPORT"
  | "PERIOD_ACTIVITY_STATEMENT" {
  switch (reportType) {
    case "reconciliation_summary":
      return "RECONCILIATION_EXCEPTION";
    case "mint_activity":
      return "FIAT_TO_STABLECOIN_CONVERSION";
    case "redemption_activity":
      return "STABLECOIN_TO_FIAT_REDEMPTION";
    case "entity_balances":
      return "WALLET_DISTRIBUTION";
    case "audit_trail":
      return "AUDIT_LOG_EXPORT";
    case "regulatory_summary":
      return "PERIOD_ACTIVITY_STATEMENT";
  }
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function fetchReportData(
  db: ReturnType<typeof getPrismaClient>,
  reportType: ReportType,
  start: Date,
  end: Date,
  entityId?: string,
): Promise<Record<string, unknown>[]> {
  const entityFilter = entityId ? { entityId } : {};

  switch (reportType) {
    case "mint_activity": {
      const items = await db.mintRequest.findMany({
        where: {
          ...entityFilter,
          createdAt: { gte: start, lte: end },
        },
        include: { entity: { select: { legalName: true } } },
        orderBy: { createdAt: "asc" },
      });
      return items.map((r) => ({
        id:                   r.id,
        reference:            r.reference,
        entity:               r.entity?.legalName ?? r.entityId,
        asset:                r.asset,
        network:              r.network,
        requestedAmountCents: r.requestedAmountCents.toString(),
        mintedUnits:          r.mintedUnits?.toString() ?? "",
        networkFeeCents:      r.networkFeeCents?.toString() ?? "",
        status:               r.status,
        createdAt:            r.createdAt.toISOString(),
        mintCompletedAt:      r.mintCompletedAt?.toISOString() ?? "",
        settledAt:            r.settledAt?.toISOString() ?? "",
      }));
    }

    case "redemption_activity": {
      const items = await db.redemptionRequest.findMany({
        where: {
          ...entityFilter,
          createdAt: { gte: start, lte: end },
        },
        include: { entity: { select: { legalName: true } } },
        orderBy: { createdAt: "asc" },
      });
      return items.map((r) => ({
        id: r.id,
        reference: r.reference,
        entity: r.entity?.legalName ?? r.entityId,
        asset: r.asset,
        network: r.network,
        requestedUnits: r.requestedUnits.toString(),
        expectedFiatCents: (r.expectedFiatCents ?? 0n).toString(),
        receivedFiatCents: r.receivedFiatCents?.toString() ?? "",
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        redemptionCompletedAt: r.redemptionCompletedAt?.toISOString() ?? "",
        settledAt: r.settledAt?.toISOString() ?? "",
      }));
    }

    case "entity_balances": {
      const accounts = await db.ledgerAccount.findMany({
        include: {
          journalLines: {
            where: {
              journalEntry: {
                postedAt: { gte: start, lte: end },
                ...(entityId ? { entityId } : {}),
              },
            },
            select: { amountCents: true, isDebit: true },
          },
        },
      });
      return accounts.map((a) => {
        const debits = a.journalLines.reduce(
          (sum, line) => (line.isDebit ? sum + line.amountCents : sum),
          0n,
        );
        const credits = a.journalLines.reduce(
          (sum, line) => (!line.isDebit ? sum + line.amountCents : sum),
          0n,
        );
        return {
          id: a.id,
          code: a.code,
          name: a.name,
          type: a.type,
          currency: a.currency,
          debitCents: debits.toString(),
          creditCents: credits.toString(),
          netCents: (credits - debits).toString(),
        };
      });
    }

    case "audit_trail": {
      const events = await db.eventLog.findMany({
        where: {
          occurredAt: { gte: start, lte: end },
          ...(entityId ? { aggregateId: entityId } : {}),
        },
        orderBy: { occurredAt: "asc" },
        take:    10_000,
      });
      return events.map((e) => ({
        id:            e.id,
        eventType:     e.eventType,
        aggregateType: e.aggregateType,
        aggregateId:   e.aggregateId,
        actorId:       e.actorId ?? "",
        actorType:     e.actorType ?? "",
        occurredAt:    e.occurredAt.toISOString(),
      }));
    }

    case "reconciliation_summary": {
      const runs = await db.reconciliationRun.findMany({
        where: {
          runDate: { gte: start, lte: end },
          ...entityFilter,
        },
        include: { breaks: true },
        orderBy: { runDate: "asc" },
      });
      return runs.map((r) => ({
        id:              r.id,
        runDate:         r.runDate.toISOString(),
        status:          r.status,
        bankBalanceCents:  r.bankBalanceCents?.toString() ?? "",
        providerUsdcBalance: r.providerUsdcBalance?.toString() ?? "",
        providerUsdtBalance: r.providerUsdtBalance?.toString() ?? "",
        ledgerUsdcBalance: r.ledgerUsdcBalance?.toString() ?? "",
        ledgerUsdtBalance: r.ledgerUsdtBalance?.toString() ?? "",
        breakCount:      r.breaks.length,
        unresolvedBreaks: r.breaks.filter((b) => b.status !== "RESOLVED").length,
      }));
    }

    case "regulatory_summary": {
      // Aggregate mint + redemption volume for regulatory filing
      const [mints, redemptions] = await Promise.all([
        db.mintRequest.findMany({
          where: { ...entityFilter, createdAt: { gte: start, lte: end }, status: "SETTLED" },
          select: { asset: true, requestedAmountCents: true, network: true },
        }),
        db.redemptionRequest.findMany({
          where: { ...entityFilter, createdAt: { gte: start, lte: end }, status: "SETTLED" },
          select: { asset: true, requestedUnits: true, network: true },
        }),
      ]);

      const mintVolume = mints.reduce((s, m) => s + m.requestedAmountCents, 0n);
      const redeemVolume = redemptions.reduce((s, r) => s + r.requestedUnits, 0n);

      return [{
        reportPeriod:         `${start.toISOString()} — ${end.toISOString()}`,
        totalMintTransactions: mints.length,
        totalMintVolumeCents:  mintVolume.toString(),
        totalRedemptions:     redemptions.length,
        totalRedemptionUnits: redeemVolume.toString(),
        networkBreakdown:     JSON.stringify(
          [...new Set([...mints.map((m) => m.network), ...redemptions.map((r) => r.network)])]
        ),
      }];
    }

    default:
      return [];
  }
}

// ── Renderers ─────────────────────────────────────────────────────────────────

function renderReport(params: {
  reportType: ReportType;
  format:     ReportFormat;
  rows:       Record<string, unknown>[];
  periodStart: Date;
  periodEnd:  Date;
}): string {
  const { format, rows, reportType, periodStart, periodEnd } = params;

  switch (format) {
    case "json":
      return JSON.stringify({
        meta: {
          reportType,
          generatedAt: new Date().toISOString(),
          periodStart: periodStart.toISOString(),
          periodEnd:   periodEnd.toISOString(),
          rowCount:    rows.length,
        },
        data: rows,
      }, null, 2);

    case "csv":
      return renderCsv(rows);

    case "html":
      return renderHtml(reportType, rows, periodStart, periodEnd);

    default:
      return JSON.stringify(rows);
  }
}

function renderCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const escape  = (v: unknown) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const headerLine = headers.map(escape).join(",");
  const dataLines  = rows.map((r) => headers.map((h) => escape(r[h])).join(","));
  return [headerLine, ...dataLines].join("\n");
}

function renderHtml(
  reportType: ReportType,
  rows: Record<string, unknown>[],
  start: Date,
  end: Date,
): string {
  const title   = reportType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const headers = rows[0] ? Object.keys(rows[0]) : [];

  const tableRows = rows
    .map(
      (r) =>
        `<tr>${headers.map((h) => `<td>${String(r[h] ?? "")}</td>`).join("")}</tr>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title} Report</title>
<style>
  body { font-family: system-ui, sans-serif; font-size: 13px; margin: 24px; color: #1a1a1a; }
  h1   { font-size: 18px; margin-bottom: 4px; }
  p.meta { color: #666; margin: 0 0 16px; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; }
  th    { background: #1a1a1a; color: #fff; padding: 6px 10px; text-align: left; font-size: 11px; text-transform: uppercase; }
  td    { padding: 5px 10px; border-bottom: 1px solid #e8e8e8; font-size: 12px; }
  tr:nth-child(even) { background: #f9f9f9; }
</style>
</head>
<body>
<h1>${title}</h1>
<p class="meta">Period: ${start.toISOString().slice(0, 10)} — ${end.toISOString().slice(0, 10)} &nbsp;|&nbsp; Generated: ${new Date().toISOString()} &nbsp;|&nbsp; Rows: ${rows.length}</p>
<table>
<thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
<tbody>
${tableRows}
</tbody>
</table>
</body>
</html>`;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function buildStorageKey(reportJobId: string, reportType: ReportType, format: ReportFormat): string {
  const date = new Date().toISOString().slice(0, 10);
  return `reports/${date}/${reportType}-${reportJobId}.${format}`;
}

/**
 * Store rendered report to S3/MinIO.
 * Returns metadata for persisted output and a short inline preview fallback.
 */
async function storeReport(
  key: string,
  content: string,
): Promise<{ downloadUrl: string | null; inlinePreview: string | null }> {
  const s3Endpoint = process.env["S3_ENDPOINT"];
  const s3Bucket   = process.env["S3_BUCKET"];
  const accessKey  = process.env["S3_ACCESS_KEY"];
  const secretKey  = process.env["S3_SECRET_KEY"];

  if (!s3Endpoint || !s3Bucket || !accessKey || !secretKey) {
    console.warn(`[report] S3 not configured — inlining report content for key: ${key}`);
    return {
      downloadUrl: null,
      inlinePreview: content.length <= 100_000 ? content : `${content.slice(0, 100_000)}\n[TRUNCATED]`,
    };
  }

  try {
    // MinIO/S3 presigned PUT via fetch (simple approach without SDK dependency)
    const url      = `${s3Endpoint}/${s3Bucket}/${key}`;
    const response = await fetch(url, {
      method:  "PUT",
      headers: {
        "Content-Type":   "text/plain; charset=utf-8",
        "Content-Length": String(Buffer.byteLength(content, "utf-8")),
        // Note: production S3 requires AWS SigV4 auth — use @aws-sdk/client-s3 for real deployments
        "x-amz-acl":     "private",
      },
      body: content,
    });

    if (!response.ok) {
      console.warn(`[report] S3 PUT failed (${response.status}) — inlining`);
      return {
        downloadUrl: null,
        inlinePreview: content.slice(0, 100_000),
      };
    }

    const normalized = s3Endpoint.endsWith("/") ? s3Endpoint.slice(0, -1) : s3Endpoint;
    return {
      downloadUrl: `${normalized}/${s3Bucket}/${key}`,
      inlinePreview: null,
    };
  } catch (err) {
    console.warn("[report] S3 upload failed — inlining:", err);
    return {
      downloadUrl: null,
      inlinePreview: content.slice(0, 100_000),
    };
  }
}

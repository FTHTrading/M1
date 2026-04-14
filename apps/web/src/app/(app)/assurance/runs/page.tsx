"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { assuranceApi } from "@/lib/api-client";
import type { AuditRunStatus, RatingTier } from "@/lib/api-client";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  ArrowRightIcon,
} from "@heroicons/react/24/outline";

// ── Colour helpers ────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<AuditRunStatus, string> = {
  QUEUED:    "text-slate-400  bg-slate-400/10  border-slate-400/30",
  RUNNING:   "text-blue-400   bg-blue-400/10   border-blue-400/30",
  COMPLETED: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
  FAILED:    "text-red-400    bg-red-400/10    border-red-400/30",
  CANCELLED: "text-slate-500  bg-slate-500/10  border-slate-500/30",
};

const STATUS_ICON: Record<AuditRunStatus, React.ElementType> = {
  QUEUED:    ClockIcon,
  RUNNING:   ArrowPathIcon,
  COMPLETED: CheckCircleIcon,
  FAILED:    XCircleIcon,
  CANCELLED: XCircleIcon,
};

const TIER_COLOR: Record<RatingTier, string> = {
  AAA: "text-emerald-400",
  AA:  "text-emerald-400",
  A:   "text-primary",
  BBB: "text-yellow-400",
  BB:  "text-orange-400",
  B:   "text-red-400",
  C:   "text-red-600",
};

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

function StatusBadge({ status }: { status: AuditRunStatus }) {
  const Icon = STATUS_ICON[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_COLOR[status]}`}
    >
      <Icon
        className={`h-3 w-3 ${status === "RUNNING" ? "animate-spin" : ""}`}
      />
      {status}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RunsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["assurance", "runs"],
    queryFn: () => assuranceApi.runs(1),
    staleTime: 30_000,
    refetchInterval: (d) => {
      const runs = d?.state?.data as { items?: { status: string }[] } | undefined;
      const hasRunning = runs?.items?.some((r) => r.status === "RUNNING" || r.status === "QUEUED");
      return hasRunning ? 5000 : false;
    },
  });

  const triggerMutation = useMutation({
    mutationFn: assuranceApi.triggerRun,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["assurance"] });
    },
  });

  const runs = data?.items ?? [];

  const navigateToRun = (runId: string) => {
    router.push(`/assurance/capabilities?runId=${runId}`);
  };

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <Header
        title="Audit Runs"
        actions={
          <button
            onClick={() => triggerMutation.mutate()}
            disabled={triggerMutation.isPending}
            className="flex items-center gap-2 rounded-md bg-primary/10 border border-primary/30 px-3 py-1.5 text-xs text-primary hover:bg-primary/20 transition disabled:opacity-50"
          >
            <ArrowPathIcon
              className={`h-3.5 w-3.5 ${triggerMutation.isPending ? "animate-spin" : ""}`}
            />
            {triggerMutation.isPending ? "Triggering…" : "Trigger New Run"}
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {isError && (
          <p className="text-sm text-red-400">Failed to load audit runs.</p>
        )}

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {data?.total ?? 0} run{data?.total !== 1 ? "s" : ""} total
          </p>
          <button
            onClick={() => refetch()}
            className="text-xs text-muted-foreground hover:text-primary transition"
          >
            Refresh
          </button>
        </div>

        {triggerMutation.isSuccess && (
          <div className="rounded-md border border-primary/30 bg-primary/5 px-4 py-2.5 text-xs text-primary">
            Audit run queued. The worker will pick it up shortly.
          </div>
        )}

        {isLoading && (
          <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
        )}

        {/* Runs table */}
        {runs.length === 0 && !isLoading && (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No audit runs yet. Click <strong>Trigger New Run</strong> to start the first one.
            </CardContent>
          </Card>
        )}

        <div className="space-y-2">
          {runs.map((run) => (
            <div
              key={run.id}
              className="rounded-lg border border-white/5 bg-white/[0.02] p-4 hover:border-white/10 hover:bg-white/[0.04] transition group cursor-pointer"
              onClick={() =>
                run.status === "COMPLETED" ? navigateToRun(run.id) : undefined
              }
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <StatusBadge status={run.status as AuditRunStatus} />
                    {run.ratingTier && (
                      <span
                        className={`text-sm font-bold ${TIER_COLOR[run.ratingTier as RatingTier]}`}
                      >
                        {run.ratingTier} · {run.overallScore}/100
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground font-mono truncate">
                      {run.id}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                    <span>Started: {fmtDate(run.startedAt)}</span>
                    <span>Completed: {fmtDate(run.completedAt)}</span>
                    <span>By: {run.triggeredBy}</span>
                  </div>

                  {run.status === "COMPLETED" && (
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>{run._count.capabilities} capabilities</span>
                      <span>{run._count.claims} claims</span>
                      <span>{run._count.gapItems} gaps</span>
                    </div>
                  )}
                </div>

                {run.status === "COMPLETED" && (
                  <ArrowRightIcon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition shrink-0" />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

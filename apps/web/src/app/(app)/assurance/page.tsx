"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { assuranceApi } from "@/lib/api-client";
import type { RatingTier, GapSeverity } from "@/lib/api-client";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DocumentMagnifyingGlassIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  ArrowPathIcon,
  ChartBarIcon,
} from "@heroicons/react/24/outline";
import Link from "next/link";

// ── Colour helpers ────────────────────────────────────────────────────────────

const TIER_COLOR: Record<RatingTier, string> = {
  AAA: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
  AA:  "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
  A:   "text-primary    bg-primary/10    border-primary/30",
  BBB: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
  BB:  "text-orange-400 bg-orange-400/10 border-orange-400/30",
  B:   "text-red-400    bg-red-400/10    border-red-400/30",
  C:   "text-red-600    bg-red-600/10    border-red-600/30",
};

const GAP_COLOR: Record<GapSeverity, string> = {
  CRITICAL:      "text-red-500    bg-red-500/10    border-red-500/30",
  HIGH:          "text-orange-400 bg-orange-400/10 border-orange-400/30",
  MEDIUM:        "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
  LOW:           "text-blue-400   bg-blue-400/10   border-blue-400/30",
  INFORMATIONAL: "text-slate-400  bg-slate-400/10  border-slate-400/30",
};

const CAP_STATUS_COLOR: Record<string, string> = {
  LIVE:           "bg-emerald-400/20 text-emerald-400",
  IMPLEMENTED:    "bg-primary/20    text-primary",
  PARTIAL:        "bg-yellow-400/20 text-yellow-400",
  SIMULATED:      "bg-orange-400/20 text-orange-400",
  DOCUMENTED_ONLY:"bg-slate-400/20  text-slate-400",
  MISSING:        "bg-red-400/20    text-red-400",
};

// ── Score arc (SVG gauge) ─────────────────────────────────────────────────────

function ScoreGauge({ score, tier }: { score: number; tier: RatingTier }) {
  const radius = 60;
  const cx = 80;
  const cy = 80;
  const circumference = Math.PI * radius; // half circle
  const offset = circumference - (score / 100) * circumference;

  const strokeColor =
    score >= 80 ? "#34d399" : score >= 60 ? "#10b981" : score >= 40 ? "#f59e0b" : "#f87171";

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="160" height="100" viewBox="0 0 160 100">
        {/* Background arc */}
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="14"
          strokeLinecap="round"
        />
        {/* Foreground arc */}
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          fill="none"
          stroke={strokeColor}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
        <text x={cx} y={cy - 6} textAnchor="middle" fill="white" fontSize="28" fontWeight="700">
          {score}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="11">
          out of 100
        </text>
      </svg>
      <span
        className={`px-3 py-1 rounded-full text-sm font-bold border ${TIER_COLOR[tier]}`}
      >
        {tier} Rating
      </span>
    </div>
  );
}

// ── Category score bar ────────────────────────────────────────────────────────

function CategoryBar({
  label,
  score,
  tier,
}: {
  label: string;
  score: number;
  tier: RatingTier;
}) {
  const barWidth = `${score}%`;
  const barColor =
    score >= 80 ? "bg-emerald-400" : score >= 60 ? "bg-primary" : score >= 40 ? "bg-yellow-400" : "bg-red-400";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-semibold ${TIER_COLOR[tier].split(" ")[0]}`}>
          {score} · {tier}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor} transition-all duration-700`}
          style={{ width: barWidth }}
        />
      </div>
    </div>
  );
}

// ── Capability distribution pill grid ────────────────────────────────────────

function CapDistribution({ dist }: { dist: Record<string, number> }) {
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(dist).map(([status, count]) => (
        <span
          key={status}
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${CAP_STATUS_COLOR[status] ?? "bg-slate-700 text-slate-300"}`}
        >
          {count} {status.replace("_", " ")}
        </span>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AssurancePage() {
  const queryClient = useQueryClient();
  const [triggerState, setTriggerState] = useState<"idle" | "running">("idle");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["assurance", "overview"],
    queryFn: assuranceApi.overview,
    staleTime: 120_000,
    refetchInterval: (d) =>
      (d?.state?.data as { hasRun?: boolean })?.hasRun === false ? 10_000 : false,
  });

  const triggerMutation = useMutation({
    mutationFn: assuranceApi.triggerRun,
    onSuccess: () => {
      setTriggerState("running");
      // Poll until a completed run shows up
      const poll = setInterval(() => {
        void queryClient.invalidateQueries({ queryKey: ["assurance"] });
      }, 5000);
      setTimeout(() => clearInterval(poll), 300_000); // stop after 5 min
    },
  });

  const overview = data;
  const hasRun = overview?.hasRun === true;

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <Header
        title="Assurance OS"
        actions={
          <button
            onClick={() => triggerMutation.mutate()}
            disabled={triggerMutation.isPending || triggerState === "running"}
            className="flex items-center gap-2 rounded-md bg-primary/10 border border-primary/30 px-3 py-1.5 text-xs text-primary hover:bg-primary/20 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowPathIcon
              className={`h-3.5 w-3.5 ${triggerMutation.isPending ? "animate-spin" : ""}`}
            />
            {triggerMutation.isPending || triggerState === "running"
              ? "Running audit…"
              : "Run Audit"}
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {isError && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            Failed to load assurance data. Ensure the API is running.
          </div>
        )}

        {triggerMutation.isError && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            Failed to trigger audit run. Check worker and Redis.
          </div>
        )}

        {!isLoading && !hasRun && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-4 py-12">
              <DocumentMagnifyingGlassIcon className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground text-center max-w-xs">
                No completed audit runs yet. Click <strong>Run Audit</strong> to assess the
                platform&apos;s capability maturity and generate a rating.
              </p>
            </CardContent>
          </Card>
        )}

        {hasRun && overview && (
          <>
            {/* Score + category breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="lg:col-span-1 flex flex-col items-center justify-center py-6">
                <CardHeader className="pb-2">
                  <CardTitle className="text-center">Overall Score</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScoreGauge
                    score={overview.overallScore ?? 0}
                    tier={overview.ratingTier ?? "C"}
                  />
                  <p className="text-xs text-muted-foreground text-center mt-3">
                    Last run:{" "}
                    {overview.completedAt
                      ? new Date(overview.completedAt).toLocaleString()
                      : "—"}
                  </p>
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle>Category Scores</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(overview.categoryScores ?? []).map((cs) => (
                    <CategoryBar
                      key={cs.category}
                      label={cs.label}
                      score={cs.score}
                      tier={cs.tier}
                    />
                  ))}
                </CardContent>
              </Card>
            </div>

            {/* Quick stats row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle>Capabilities</CardTitle>
                  <ChartBarIcon className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <CapDistribution dist={overview.capabilityDistribution ?? {}} />
                  <Link
                    href={`/assurance/capabilities?runId=${overview.runId}`}
                    className="mt-3 text-xs text-primary hover:underline block"
                  >
                    View all →
                  </Link>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle>Claims</CardTitle>
                  <ShieldCheckIcon className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {Object.entries(overview.claimDistribution ?? {}).map(
                      ([status, count]) => (
                        <span key={status} className="rounded bg-white/5 px-1.5 py-0.5">
                          {count}{" "}
                          <span className="text-muted-foreground">
                            {status.replace(/_/g, " ")}
                          </span>
                        </span>
                      ),
                    )}
                  </div>
                  <Link
                    href={`/assurance/claims?runId=${overview.runId}`}
                    className="mt-3 text-xs text-primary hover:underline block"
                  >
                    View all →
                  </Link>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle>Open Gaps</CardTitle>
                  <ExclamationTriangleIcon className="h-4 w-4 text-orange-400" />
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {Object.entries(overview.gapDistribution ?? {}).map(
                      ([sev, count]) => (
                        <span
                          key={sev}
                          className={`rounded border px-1.5 py-0.5 ${GAP_COLOR[sev as GapSeverity]}`}
                        >
                          {count} {sev}
                        </span>
                      ),
                    )}
                  </div>
                  <Link
                    href={`/assurance/gaps?runId=${overview.runId}`}
                    className="mt-3 text-xs text-primary hover:underline block"
                  >
                    View all →
                  </Link>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle>Audit Runs</CardTitle>
                  <ClockIcon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">
                    <CheckCircleIcon className="h-6 w-6 text-primary inline mr-1 -mt-0.5" />
                    Active
                  </p>
                  <Link
                    href="/assurance/runs"
                    className="mt-3 text-xs text-primary hover:underline block"
                  >
                    Run history →
                  </Link>
                </CardContent>
              </Card>
            </div>

            {/* Top gaps */}
            {(overview.topGaps ?? []).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Priority Gaps</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(overview.topGaps ?? []).map((gap) => (
                    <div
                      key={gap.id}
                      className="flex items-start gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3"
                    >
                      <span
                        className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${GAP_COLOR[gap.severity]}`}
                      >
                        {gap.severity}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{gap.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {gap.description}
                        </p>
                        <p className="text-xs text-primary mt-1">{gap.remediation}</p>
                      </div>
                    </div>
                  ))}
                  <Link
                    href={`/assurance/gaps?runId=${overview.runId}`}
                    className="text-xs text-primary hover:underline block"
                  >
                    View all gaps →
                  </Link>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

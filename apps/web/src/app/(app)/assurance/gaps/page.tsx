"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { assuranceApi } from "@/lib/api-client";
import type { GapSeverity } from "@/lib/api-client";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ArrowTopRightOnSquareIcon,
} from "@heroicons/react/24/outline";

// ── Colour helpers ────────────────────────────────────────────────────────────

const GAP_COLOR: Record<GapSeverity, string> = {
  CRITICAL:      "text-red-500    bg-red-500/10    border-red-500/30",
  HIGH:          "text-orange-400 bg-orange-400/10 border-orange-400/30",
  MEDIUM:        "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
  LOW:           "text-blue-400   bg-blue-400/10   border-blue-400/30",
  INFORMATIONAL: "text-slate-400  bg-slate-400/10  border-slate-400/30",
};

const SEV_ORDER: GapSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL"];

// ── Resolve gap dialog (inline) ───────────────────────────────────────────────

function ResolveButton({
  runId,
  gapId,
}: {
  runId: string;
  gapId: string;
}) {
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => assuranceApi.resolveGap(runId, gapId, note),
    onSuccess: () => {
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["assurance", "gaps"] });
    },
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-muted-foreground hover:text-primary transition"
      >
        Mark resolved
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Resolution note (optional)"
        className="flex-1 min-w-0 text-xs rounded border border-white/10 bg-white/[0.03] px-2 py-1 outline-none focus:border-primary/50"
      />
      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="text-xs px-2 py-1 rounded bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition disabled:opacity-50"
      >
        {mutation.isPending ? "Saving…" : "Confirm"}
      </button>
      <button
        onClick={() => setOpen(false)}
        className="text-xs text-muted-foreground hover:text-foreground transition"
      >
        Cancel
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function GapsPage() {
  const searchParams = useSearchParams();
  const runId = searchParams.get("runId") ?? "";

  const [severityFilter, setSeverityFilter] = useState<string>("ALL");
  const [showResolved, setShowResolved] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["assurance", "gaps", runId, severityFilter, showResolved],
    queryFn: () =>
      assuranceApi.gaps(runId, {
        ...(severityFilter !== "ALL" ? { severity: severityFilter } : {}),
        resolved: showResolved ? "true" : "false",
      }),
    enabled: !!runId,
    staleTime: 120_000,
  });

  const gaps = data?.items ?? [];

  const criticalCount = gaps.filter((g) => g.severity === "CRITICAL").length;
  const highCount     = gaps.filter((g) => g.severity === "HIGH").length;

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <Header title="Assurance Gaps" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">

        {!runId && (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Select a run from the{" "}
              <a href="/assurance/runs" className="text-primary hover:underline">
                Runs page
              </a>{" "}
              to view gap analysis.
            </CardContent>
          </Card>
        )}

        {runId && (
          <>
            {/* Alert bar for critical/high */}
            {(criticalCount > 0 || highCount > 0) && !showResolved && (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3">
                <ExclamationTriangleIcon className="h-4 w-4 text-red-500 shrink-0" />
                <p className="text-sm text-red-400">
                  {criticalCount > 0 && (
                    <strong>{criticalCount} CRITICAL</strong>
                  )}
                  {criticalCount > 0 && highCount > 0 && " and "}
                  {highCount > 0 && (
                    <strong>{highCount} HIGH</strong>
                  )}
                  {" "}
                  gap{criticalCount + highCount !== 1 ? "s" : ""} require immediate attention.
                </p>
              </div>
            )}

            {/* Filters */}
            <div className="flex flex-wrap gap-3">
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                className="px-2 py-1.5 text-xs rounded-md border border-white/10 bg-white/[0.03] text-foreground outline-none focus:border-primary/50"
              >
                <option value="ALL">All severities</option>
                {SEV_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={showResolved}
                  onChange={(e) => setShowResolved(e.target.checked)}
                  className="rounded"
                />
                Show resolved
              </label>
              <span className="ml-auto text-xs text-muted-foreground self-center">
                {gaps.length} gap{gaps.length !== 1 ? "s" : ""}
              </span>
            </div>

            {isError && (
              <p className="text-sm text-red-400">Failed to load gap data.</p>
            )}
            {isLoading && (
              <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
            )}

            {/* Gap list */}
            <div className="space-y-3">
              {gaps.map((gap) => (
                <div
                  key={gap.id}
                  className={`rounded-lg border bg-white/[0.02] p-4 transition ${
                    gap.resolved ? "opacity-50" : ""
                  }`}
                  style={{
                    borderColor: gap.resolved ? "rgba(255,255,255,0.05)" : undefined,
                  }}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`shrink-0 mt-0.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${GAP_COLOR[gap.severity]}`}
                    >
                      {gap.severity}
                    </span>

                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold">{gap.title}</p>
                        {gap.externalDep && (
                          <span className="flex items-center gap-0.5 rounded-full bg-slate-700 px-1.5 py-0.5 text-xs text-slate-400">
                            <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                            External
                          </span>
                        )}
                        {gap.resolved && (
                          <span className="flex items-center gap-0.5 rounded-full bg-emerald-400/10 text-emerald-400 px-1.5 py-0.5 text-xs">
                            <CheckCircleIcon className="h-3 w-3" />
                            Resolved
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {gap.description}
                      </p>

                      <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
                        <span className="text-primary font-medium">Remediation: </span>
                        <span className="text-foreground">{gap.remediation}</span>
                        <span className="ml-2 text-muted-foreground">
                          · Est. {gap.effortEstimate}
                        </span>
                      </div>

                      {gap.affectedClaims.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Affects:{" "}
                          {gap.affectedClaims.map((c) => (
                            <span
                              key={c}
                              className="rounded bg-white/5 px-1 py-0.5 mr-1 text-slate-400"
                            >
                              {c}
                            </span>
                          ))}
                        </p>
                      )}

                      {gap.resolved && gap.resolvedNote && (
                        <p className="text-xs text-muted-foreground italic border-l-2 border-emerald-400/30 pl-2">
                          Resolution note: {gap.resolvedNote}
                        </p>
                      )}

                      {!gap.resolved && (
                        <ResolveButton runId={runId} gapId={gap.id} />
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {gaps.length === 0 && !isLoading && (
                <Card className="border-dashed">
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    No gaps matching your filters.
                  </CardContent>
                </Card>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

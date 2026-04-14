"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { assuranceApi } from "@/lib/api-client";
import type { ClaimSupportStatus } from "@/lib/api-client";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheckIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";

// ── Colour helpers ────────────────────────────────────────────────────────────

const SUPPORT_COLOR: Record<ClaimSupportStatus, string> = {
  SUPPORTED:           "bg-emerald-400/20 text-emerald-400 border-emerald-400/30",
  PARTIALLY_SUPPORTED: "bg-primary/20    text-primary    border-primary/30",
  WEAKLY_SUPPORTED:    "bg-yellow-400/20 text-yellow-400 border-yellow-400/30",
  MARKETING_ONLY:      "bg-orange-400/20 text-orange-400 border-orange-400/30",
  UNSUPPORTED:         "bg-red-400/20    text-red-400    border-red-400/30",
  CANNOT_VERIFY:       "bg-slate-400/20  text-slate-400  border-slate-400/30",
};

const SUPPORT_ORDER: ClaimSupportStatus[] = [
  "SUPPORTED",
  "PARTIALLY_SUPPORTED",
  "WEAKLY_SUPPORTED",
  "MARKETING_ONLY",
  "UNSUPPORTED",
  "CANNOT_VERIFY",
];

const CONFIDENCE_DOT: Record<string, string> = {
  HIGH:   "bg-emerald-400",
  MEDIUM: "bg-yellow-400",
  LOW:    "bg-orange-400",
  NONE:   "bg-slate-500",
};

export default function ClaimsPage() {
  const searchParams = useSearchParams();
  const runId = searchParams.get("runId") ?? "";

  const [supportFilter, setSupportFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["assurance", "claims", runId, supportFilter],
    queryFn: () =>
      assuranceApi.claims(runId, {
        ...(supportFilter !== "ALL" ? { support: supportFilter } : {}),
      }),
    enabled: !!runId,
    staleTime: 300_000,
  });

  const items = (data?.items ?? []).filter(
    (c) =>
      !search ||
      c.claimText.toLowerCase().includes(search.toLowerCase()) ||
      c.claimKey.toLowerCase().includes(search.toLowerCase()),
  );

  // Stats
  const supported   = items.filter((c) => c.support === "SUPPORTED").length;
  const partial     = items.filter((c) => c.support === "PARTIALLY_SUPPORTED").length;
  const marketing   = items.filter((c) => c.support === "MARKETING_ONLY").length;
  const unsupported = items.filter((c) => c.support === "UNSUPPORTED").length;

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <Header title="Claims Registry" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">

        {!runId && (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Select a run from the{" "}
              <a href="/assurance/runs" className="text-primary hover:underline">
                Runs page
              </a>{" "}
              to view claim assessments.
            </CardContent>
          </Card>
        )}

        {runId && (
          <>
            {/* Summary pills */}
            <div className="flex flex-wrap gap-3">
              {[
                { label: "Supported",   count: supported,   color: "text-emerald-400" },
                { label: "Partial",     count: partial,     color: "text-primary"     },
                { label: "Mktg Only",   count: marketing,   color: "text-orange-400"  },
                { label: "Unsupported", count: unsupported, color: "text-red-400"     },
              ].map(({ label, count, color }) => (
                <div key={label} className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
                  <p className={`text-xl font-bold ${color}`}>{count}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search claims…"
                  className="pl-8 pr-3 py-1.5 text-xs rounded-md border border-white/10 bg-white/[0.03] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 w-64"
                />
              </div>
              <select
                value={supportFilter}
                onChange={(e) => setSupportFilter(e.target.value)}
                className="px-2 py-1.5 text-xs rounded-md border border-white/10 bg-white/[0.03] text-foreground outline-none focus:border-primary/50"
              >
                <option value="ALL">All support levels</option>
                {SUPPORT_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <span className="ml-auto text-xs text-muted-foreground self-center">
                {items.length} claims
              </span>
            </div>

            {isError && (
              <p className="text-sm text-red-400">Failed to load claims data.</p>
            )}
            {isLoading && (
              <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
            )}

            {/* Claims table */}
            <div className="space-y-2">
              {items.map((claim) => (
                <div
                  key={claim.id}
                  className="rounded-lg border border-white/5 bg-white/[0.02] p-4 space-y-2"
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`shrink-0 mt-0.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${SUPPORT_COLOR[claim.support]}`}
                    >
                      {claim.support.replace(/_/g, " ")}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium">{claim.claim}</p>
                        <div className="flex items-center gap-1">
                          <div
                            className={`h-1.5 w-1.5 rounded-full ${CONFIDENCE_DOT[claim.confidence] ?? "bg-slate-500"}`}
                          />
                          <span className="text-xs text-muted-foreground">
                            {claim.confidence} confidence
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Source: <span className="italic">{claim.source}</span>
                        {claim.category && (
                          <span className="ml-2 text-slate-500">
                            · {claim.category.replace(/_/g, " ")}
                          </span>
                        )}
                      </p>
                    </div>
                    <ShieldCheckIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>

                  {claim.analystNote && (
                    <p className="text-xs text-muted-foreground border-l-2 border-primary/30 pl-3">
                      {claim.analystNote}
                    </p>
                  )}

                  {claim.evidenceRefs.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {claim.evidenceRefs.map((ref) => (
                        <span
                          key={ref}
                          className="rounded bg-white/5 px-1.5 py-0.5 text-xs text-muted-foreground"
                        >
                          {ref}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

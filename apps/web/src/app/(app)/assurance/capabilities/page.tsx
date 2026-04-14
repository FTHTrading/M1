"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { assuranceApi } from "@/lib/api-client";
import type { CapabilityStatus } from "@/lib/api-client";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MagnifyingGlassIcon, ChartBarIcon } from "@heroicons/react/24/outline";

// ── Colour helpers ────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<CapabilityStatus, string> = {
  LIVE:           "bg-emerald-400/20 text-emerald-400 border-emerald-400/30",
  IMPLEMENTED:    "bg-primary/20    text-primary    border-primary/30",
  PARTIAL:        "bg-yellow-400/20 text-yellow-400 border-yellow-400/30",
  SIMULATED:      "bg-orange-400/20 text-orange-400 border-orange-400/30",
  DOCUMENTED_ONLY:"bg-slate-400/20  text-slate-400  border-slate-400/30",
  MISSING:        "bg-red-400/20    text-red-400    border-red-400/30",
};

const STATUS_ORDER: CapabilityStatus[] = [
  "LIVE",
  "IMPLEMENTED",
  "PARTIAL",
  "SIMULATED",
  "DOCUMENTED_ONLY",
  "MISSING",
];

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 80 ? "bg-emerald-400" : score >= 60 ? "bg-primary" : score >= 40 ? "bg-yellow-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-white/5 overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-500`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-xs font-semibold tabular-nums w-6 text-right">{score}</span>
    </div>
  );
}

function EvidenceBadge({ found, reference }: { found: boolean; reference: string }) {
  return (
    <span
      title={reference}
      className={`rounded px-1.5 py-0.5 text-xs border ${
        found
          ? "bg-emerald-400/10 text-emerald-400 border-emerald-400/20"
          : "bg-red-400/10 text-red-400 border-red-400/20"
      }`}
    >
      {found ? "✓" : "✗"} {reference}
    </span>
  );
}

export default function CapabilitiesPage() {
  const searchParams = useSearchParams();
  const runId = searchParams.get("runId") ?? "";

  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["assurance", "capabilities", runId, statusFilter, categoryFilter],
    queryFn: () =>
      assuranceApi.capabilities(runId, {
        ...(statusFilter !== "ALL" ? { status: statusFilter } : {}),
        ...(categoryFilter !== "ALL" ? { category: categoryFilter } : {}),
      }),
    enabled: !!runId,
    staleTime: 300_000,
  });

  const items = (data?.items ?? []).filter(
    (c) =>
      !search ||
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      c.capabilityKey.toLowerCase().includes(search.toLowerCase()),
  );

  // Derive category list from loaded items
  const categories = [
    "ALL",
    ...Array.from(new Set((data?.items ?? []).map((c) => c.category))).sort(),
  ];

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <Header title="Capabilities" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {!runId && (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Select a run from the{" "}
              <a href="/assurance/runs" className="text-primary hover:underline">
                Runs page
              </a>{" "}
              to view capability assessments.
            </CardContent>
          </Card>
        )}

        {runId && (
          <>
            {/* Filters */}
            <div className="flex flex-wrap gap-3">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter capabilities…"
                  className="pl-8 pr-3 py-1.5 text-xs rounded-md border border-white/10 bg-white/[0.03] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 w-56"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2 py-1.5 text-xs rounded-md border border-white/10 bg-white/[0.03] text-foreground outline-none focus:border-primary/50"
              >
                <option value="ALL">All statuses</option>
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ")}
                  </option>
                ))}
              </select>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-2 py-1.5 text-xs rounded-md border border-white/10 bg-white/[0.03] text-foreground outline-none focus:border-primary/50"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c === "ALL" ? "All categories" : c.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <span className="ml-auto text-xs text-muted-foreground self-center">
                {items.length} capabilities
              </span>
            </div>

            {isError && (
              <p className="text-sm text-red-400">Failed to load capability data.</p>
            )}

            {isLoading && (
              <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
            )}

            {/* Capability cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {items.map((cap) => (
                <Card key={cap.id} className="overflow-hidden">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_COLOR[cap.status]}`}
                          >
                            {cap.status.replace("_", " ")}
                          </span>
                          <span className="text-xs text-muted-foreground truncate">
                            {cap.category.replace(/_/g, " ")}
                          </span>
                        </div>
                        <CardTitle className="mt-1.5 text-sm leading-tight">
                          {cap.title}
                        </CardTitle>
                      </div>
                      <ChartBarIcon className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2.5">
                    <ScoreBar score={cap.maturityScore} />
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {cap.evidenceSummary}
                    </p>
                    {cap.evidence.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {cap.evidence.map((ev) => (
                          <EvidenceBadge
                            key={ev.id}
                            found={ev.found}
                            reference={ev.reference}
                          />
                        ))}
                      </div>
                    )}
                    {cap.gaps.length > 0 && (
                      <ul className="text-xs text-red-400 space-y-0.5 list-disc list-inside">
                        {cap.gaps.map((g, i) => (
                          <li key={i}>{g}</li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

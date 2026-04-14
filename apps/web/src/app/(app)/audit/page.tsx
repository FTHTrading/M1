"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { auditApi, type AuditLog } from "@/lib/api-client";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";

const ENTITY_TYPES = [
  { value: "", label: "All Types" },
  { value: "MintRequest", label: "Mint Request" },
  { value: "RedemptionRequest", label: "Redemption Request" },
  { value: "Approval", label: "Approval" },
  { value: "Wallet", label: "Wallet" },
  { value: "Entity", label: "Entity" },
];

export default function AuditPage() {
  const [page, setPage] = useState(0);
  const [entityType, setEntityType] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["audit-log", page, entityType],
    queryFn: () => auditApi.list({ page, entityType: entityType || undefined }),
  });

  const logs = data?.data ?? [];
  const total = data?.total ?? 0;
  const pageSize = 25;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <Header title="Audit Log" />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full flex-row">
              <CardTitle>
                {total > 0 ? `${total} entries` : "Audit Log"}
              </CardTitle>
              <Select
                className="w-48 h-7 text-xs"
                value={entityType}
                onChange={(e) => { setEntityType(e.target.value); setPage(0); }}
                options={ENTITY_TYPES}
              />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : logs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No entries found</p>
            ) : (
              <div className="divide-y divide-border/50">
                {logs.map((log) => (
                  <AuditRow key={log.id} log={log} />
                ))}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <span className="text-xs text-muted-foreground">
                  Page {page + 1} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page + 1 >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRightIcon className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AuditRow({ log }: { log: AuditLog }) {
  return (
    <div className="py-3 flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium bg-muted rounded px-1.5 py-0.5">
            {log.entityType}
          </span>
          <span className="text-sm font-medium">{log.action.replace(/_/g, " ")}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground">
            {log.actor?.name ?? log.actorId}
          </span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground font-mono truncate">
            {log.entityId}
          </span>
        </div>
      </div>
      <span className="text-xs text-muted-foreground shrink-0">
        {formatDate(log.createdAt)}
      </span>
    </div>
  );
}

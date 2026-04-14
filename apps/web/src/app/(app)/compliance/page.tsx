"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { complianceApi, entitiesApi, type ComplianceProfile } from "@/lib/api-client";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { FormField, Input, Select } from "@/components/ui/form";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/ui/data-table";
import { formatDate } from "@/lib/utils";
import { ShieldCheckIcon } from "@heroicons/react/24/outline";

const columns: ColumnDef<ComplianceProfile, unknown>[] = [
  {
    accessorKey: "entity.legalName",
    header: "Entity",
    cell: ({ row }) => row.original.entity?.legalName ?? row.original.entityId,
  },
  {
    accessorKey: "kycStatus",
    header: "KYC",
    cell: ({ row }) => <StatusBadge status={row.original.kycStatus} />,
  },
  {
    accessorKey: "screeningStatus",
    header: "Screening",
    cell: ({ row }) => <StatusBadge status={row.original.screeningStatus} />,
  },
  {
    accessorKey: "riskScore",
    header: "Risk Score",
    cell: ({ row }) => {
      const score = row.original.riskScore;
      if (score === null) return <span className="text-muted-foreground">N/A</span>;
      return (
        <Badge variant={score > 70 ? "destructive" : score > 40 ? "warning" : "success"}>
          {score}
        </Badge>
      );
    },
  },
  {
    accessorKey: "updatedAt",
    header: "Last Updated",
    cell: ({ row }) => formatDate(row.original.updatedAt),
  },
];

interface EvalForm {
  entityId: string;
  asset: string;
  amountUsd: string;
}

const EMPTY: EvalForm = { entityId: "", asset: "USDC", amountUsd: "" };

export default function CompliancePage() {
  const [evalOpen, setEvalOpen] = useState(false);
  const [evalForm, setEvalForm] = useState<EvalForm>(EMPTY);
  const [evalResult, setEvalResult] = useState<{
    allowed: boolean;
    requiresApproval: boolean;
    reasons: string[];
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["compliance-profiles"],
    queryFn: complianceApi.profiles,
  });
  const { data: entities } = useQuery({ queryKey: ["entities"], queryFn: entitiesApi.list });

  const evaluate = useMutation({
    mutationFn: () =>
      complianceApi.evaluate(
        evalForm.entityId,
        evalForm.asset,
        parseInt(evalForm.amountUsd, 10) * 100
      ),
    onSuccess: (res) => setEvalResult(res),
  });

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <Header
        title="Compliance"
        actions={
          <Button size="sm" variant="outline" onClick={() => setEvalOpen(true)}>
            <ShieldCheckIcon className="h-4 w-4" />
            Evaluate Policy
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Compliance Profiles</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <DataTable columns={columns} data={data?.data ?? []} />
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={evalOpen}
        onClose={() => { setEvalOpen(false); setEvalForm(EMPTY); setEvalResult(null); }}
        title="Evaluate Policy"
        className="max-w-lg"
      >
        {evalResult ? (
          <div className="space-y-3">
            <div
              className={`rounded-md p-3 text-sm ${
                evalResult.allowed
                  ? "bg-mint/10 border border-mint/30 text-mint"
                  : "bg-critical/10 border border-critical/30 text-critical"
              }`}
            >
              {evalResult.allowed ? "Transaction is allowed" : "Transaction is blocked"}
              {evalResult.requiresApproval && " (requires approval)"}
            </div>
            {evalResult.reasons.length > 0 && (
              <div>
                <p className="text-xs font-medium mb-2 text-muted-foreground">Policy notes:</p>
                <ul className="text-xs space-y-1">
                  {evalResult.reasons.map((r, i) => (
                    <li key={i} className="text-muted-foreground">• {r}</li>
                  ))}
                </ul>
              </div>
            )}
            <DialogFooter>
              <Button
                onClick={() => { setEvalResult(null); setEvalForm(EMPTY); }}
                variant="outline"
              >
                Reset
              </Button>
              <Button onClick={() => { setEvalOpen(false); setEvalResult(null); setEvalForm(EMPTY); }}>
                Close
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <FormField label="Entity">
                <Select
                  value={evalForm.entityId}
                  onChange={(e) => setEvalForm((f) => ({ ...f, entityId: e.target.value }))}
                  options={
                    entities?.data.map((e) => ({ value: e.id, label: e.legalName })) ?? []
                  }
                  placeholder="Select entity"
                />
              </FormField>
              <FormField label="Asset">
                <Select
                  value={evalForm.asset}
                  onChange={(e) => setEvalForm((f) => ({ ...f, asset: e.target.value }))}
                  options={[
                    { value: "USDC", label: "USDC" },
                    { value: "USDT", label: "USDT" },
                  ]}
                />
              </FormField>
              <FormField label="Amount (USD)">
                <Input
                  type="number"
                  placeholder="e.g. 250000"
                  value={evalForm.amountUsd}
                  onChange={(e) => setEvalForm((f) => ({ ...f, amountUsd: e.target.value }))}
                />
              </FormField>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => { setEvalOpen(false); setEvalForm(EMPTY); }}
              >
                Cancel
              </Button>
              <Button
                loading={evaluate.isPending}
                disabled={!evalForm.entityId || !evalForm.amountUsd}
                onClick={() => evaluate.mutate()}
              >
                Evaluate
              </Button>
            </DialogFooter>
          </>
        )}
      </Dialog>
    </div>
  );
}

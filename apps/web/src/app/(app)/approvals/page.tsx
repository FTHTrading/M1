"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { approvalsApi, type Approval } from "@/lib/api-client";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { FormField, Input } from "@/components/ui/form";
import { formatDate } from "@/lib/utils";
import { CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/outline";

export default function ApprovalsPage() {
  const qc = useQueryClient();
  const [target, setTarget] = useState<Approval | null>(null);
  const [decision, setDecision] = useState<"APPROVE" | "REJECT" | null>(null);
  const [note, setNote] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["approvals"],
    queryFn: approvalsApi.list,
  });

  const decide = useMutation({
    mutationFn: () => approvalsApi.decide(target!.id, decision!, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
      setTarget(null);
      setDecision(null);
      setNote("");
    },
  });

  const pending = data?.data.filter((a) => a.status === "PENDING") ?? [];
  const resolved = data?.data.filter((a) => a.status !== "PENDING") ?? [];

  function openDecide(a: Approval, d: "APPROVE" | "REJECT") {
    setTarget(a);
    setDecision(d);
  }

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <Header title="Approvals" />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Pending ({pending.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {pending.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No pending approvals
                  </p>
                ) : (
                  <div className="divide-y divide-border/50">
                    {pending.map((a) => (
                      <ApprovalRow
                        key={a.id}
                        approval={a}
                        onApprove={() => openDecide(a, "APPROVE")}
                        onReject={() => openDecide(a, "REJECT")}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {resolved.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Resolved ({resolved.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="divide-y divide-border/50">
                    {resolved.map((a) => (
                      <ApprovalRow key={a.id} approval={a} />
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      <Dialog
        open={!!target && !!decision}
        onClose={() => { setTarget(null); setDecision(null); setNote(""); }}
        title={decision === "APPROVE" ? "Approve Request" : "Reject Request"}
      >
        <p className="mb-4 text-sm text-muted-foreground">
          {decision === "APPROVE"
            ? "Confirm approval. This will advance the request to the next workflow step."
            : "Reject this request. The submitter will be notified."}
        </p>
        <FormField label="Note (optional)">
          <Input
            placeholder="Add a note…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => { setTarget(null); setDecision(null); setNote(""); }}
          >
            Cancel
          </Button>
          <Button
            variant={decision === "APPROVE" ? "default" : "destructive"}
            loading={decide.isPending}
            onClick={() => decide.mutate()}
          >
            Confirm {decision === "APPROVE" ? "Approval" : "Rejection"}
          </Button>
        </DialogFooter>
        {decide.isError && (
          <p className="mt-2 text-xs text-critical">
            {(decide.error as Error).message}
          </p>
        )}
      </Dialog>
    </div>
  );
}

function ApprovalRow({
  approval,
  onApprove,
  onReject,
}: {
  approval: Approval;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-3 gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {approval.mintRequestId
            ? `Mint · ${approval.mintRequestId}`
            : `Redeem · ${approval.redemptionRequestId}`}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatDate(approval.createdAt)}
          {approval.approver?.name && ` · ${approval.approver.name}`}
        </p>
        {approval.note && (
          <p className="text-xs text-muted-foreground italic mt-0.5">
            "{approval.note}"
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <StatusBadge status={approval.decision ?? approval.status} />
        {onApprove && (
          <button
            onClick={onApprove}
            className="rounded p-1 hover:bg-mint/10 text-mint transition-colors"
            title="Approve"
          >
            <CheckCircleIcon className="h-5 w-5" />
          </button>
        )}
        {onReject && (
          <button
            onClick={onReject}
            className="rounded p-1 hover:bg-critical/10 text-critical transition-colors"
            title="Reject"
          >
            <XCircleIcon className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}

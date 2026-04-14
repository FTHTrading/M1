"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { reconApi, entitiesApi, type ReconRun, type ReconBreak } from "@/lib/api-client";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { FormField, Input, Select } from "@/components/ui/form";
import { formatDate } from "@/lib/utils";
import { PlayIcon } from "@heroicons/react/24/outline";

export default function ReconciliationPage() {
  const qc = useQueryClient();
  const [entityId, setEntityId] = useState("");
  const [runEntityId, setRunEntityId] = useState("");
  const [runOpen, setRunOpen] = useState(false);
  const [resolveBreak, setResolveBreak] = useState<ReconBreak | null>(null);
  const [resolveNote, setResolveNote] = useState("");

  const { data: entities } = useQuery({ queryKey: ["entities"], queryFn: entitiesApi.list });
  const { data: runsData, isLoading: runsLoading } = useQuery({
    queryKey: ["recon-runs"],
    queryFn: reconApi.runs,
  });
  const { data: breaksData, isLoading: breaksLoading } = useQuery({
    queryKey: ["recon-breaks", entityId],
    queryFn: () => reconApi.breaks(entityId),
    enabled: !!entityId,
  });

  const runRecon = useMutation({
    mutationFn: () => reconApi.run(runEntityId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recon-runs"] });
      setRunOpen(false);
      setRunEntityId("");
    },
  });

  const resolve = useMutation({
    mutationFn: () => reconApi.resolve(resolveBreak!.id, resolveNote),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recon-breaks"] });
      setResolveBreak(null);
      setResolveNote("");
    },
  });

  const entityOptions = entities?.data.map((e) => ({ value: e.id, label: e.legalName })) ?? [];
  const runs = runsData?.data ?? [];
  const breaks = breaksData?.data ?? [];

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <Header
        title="Reconciliation"
        actions={
          <Button size="sm" onClick={() => setRunOpen(true)}>
            <PlayIcon className="h-4 w-4" />
            Run Recon
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Runs */}
        <Card>
          <CardHeader>
            <CardTitle>Reconciliation Runs</CardTitle>
          </CardHeader>
          <CardContent>
            {runsLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs yet</p>
            ) : (
              <div className="divide-y divide-border/50">
                {runs.map((r) => (
                  <RunRow key={r.id} run={r} onSelect={() => setEntityId(r.entityId)} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Breaks */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full flex-row">
              <CardTitle>Open Breaks</CardTitle>
              <Select
                className="w-52 h-7 text-xs"
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                options={entityOptions}
                placeholder="Select entity"
              />
            </div>
          </CardHeader>
          <CardContent>
            {!entityId ? (
              <p className="text-sm text-muted-foreground">Select an entity to view breaks</p>
            ) : breaksLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : breaks.length === 0 ? (
              <p className="text-sm text-mint">No open breaks — all clear!</p>
            ) : (
              <div className="divide-y divide-border/50">
                {breaks.map((b) => (
                  <BreakRow
                    key={b.id}
                    brk={b}
                    onResolve={() => setResolveBreak(b)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Run recon dialog */}
      <Dialog
        open={runOpen}
        onClose={() => { setRunOpen(false); setRunEntityId(""); }}
        title="Run Reconciliation"
      >
        <p className="mb-4 text-sm text-muted-foreground">
          Compares ledger, bank statement, and provider balances for a given entity.
        </p>
        <FormField label="Entity">
          <Select
            value={runEntityId}
            onChange={(e) => setRunEntityId(e.target.value)}
            options={entityOptions}
            placeholder="Select entity"
          />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setRunOpen(false); setRunEntityId(""); }}>
            Cancel
          </Button>
          <Button
            loading={runRecon.isPending}
            disabled={!runEntityId}
            onClick={() => runRecon.mutate()}
          >
            Run
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Resolve dialog */}
      <Dialog
        open={!!resolveBreak}
        onClose={() => { setResolveBreak(null); setResolveNote(""); }}
        title="Resolve Break"
      >
        {resolveBreak && (
          <div className="mb-4 rounded-md bg-muted/50 p-3 text-sm">
            <p className="font-medium">{resolveBreak.breakType.replace(/_/g, " ")}</p>
            <p className="text-muted-foreground text-xs mt-1">
              {resolveBreak.description}
            </p>
          </div>
        )}
        <FormField label="Resolution Note">
          <Input
            placeholder="Explain how this was resolved…"
            value={resolveNote}
            onChange={(e) => setResolveNote(e.target.value)}
          />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setResolveBreak(null); setResolveNote(""); }}>
            Cancel
          </Button>
          <Button
            loading={resolve.isPending}
            disabled={!resolveNote.trim()}
            onClick={() => resolve.mutate()}
          >
            Resolve
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

function RunRow({ run, onSelect }: { run: ReconRun; onSelect: () => void }) {
  return (
    <div
      className="flex items-center justify-between py-3 cursor-pointer hover:bg-muted/20 rounded px-2"
      onClick={onSelect}
    >
      <div>
        <p className="text-sm font-medium">{formatDate(run.createdAt)}</p>
        <p className="text-xs text-muted-foreground">
          {run.totalBreaks} breaks · {run.resolvedBreaks} resolved
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={run.totalBreaks - run.resolvedBreaks > 0 ? "destructive" : "success"}>
          {run.totalBreaks - run.resolvedBreaks} open
        </Badge>
        <StatusBadge status={run.status} />
      </div>
    </div>
  );
}

function BreakRow({ brk, onResolve }: { brk: ReconBreak; onResolve: () => void }) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">
          {brk.breakType.replace(/_/g, " ")}
        </p>
        <p className="text-xs text-muted-foreground truncate">{brk.description}</p>
      </div>
      <div className="flex items-center gap-3">
        <StatusBadge status={brk.resolved ? "RESOLVED" : "OPEN"} />
        {!brk.resolved && (
          <Button size="sm" variant="outline" onClick={onResolve}>
            Resolve
          </Button>
        )}
      </div>
    </div>
  );
}

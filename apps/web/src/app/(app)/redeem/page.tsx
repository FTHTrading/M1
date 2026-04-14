"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  redeemApi,
  entitiesApi,
  bankAccountsApi,
  walletsApi,
  treasuryAccountsApi,
  type RedemptionRequest,
} from "@/lib/api-client";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { FormField, Input, Select } from "@/components/ui/form";
import { formatCents, formatDate } from "@/lib/utils";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { PlusIcon } from "@heroicons/react/24/outline";

const columns: ColumnDef<RedemptionRequest, unknown>[] = [
  { accessorKey: "reference", header: "Reference" },
  { accessorKey: "asset", header: "Asset" },
  {
    accessorKey: "requestedUnits",
    header: "Stablecoin Units",
    cell: ({ row }) => (
      <span className="font-mono text-xs">{row.original.requestedUnits}</span>
    ),
  },
  {
    accessorKey: "expectedFiatCents",
    header: "Fiat",
    cell: ({ row }) =>
      row.original.expectedFiatCents ? formatCents(row.original.expectedFiatCents) : "—",
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "entity.legalName",
    header: "Entity",
    cell: ({ row }) => row.original.entity?.legalName ?? "—",
  },
  {
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
];

interface CreateFormState {
  entityId: string;
  treasuryAccountId: string;
  sourceWalletId: string;
  bankAccountId: string;
  asset: string;
  network: string;
  requestedUnits: string;
  memo: string;
}

const EMPTY: CreateFormState = {
  entityId: "",
  treasuryAccountId: "",
  sourceWalletId: "",
  bankAccountId: "",
  asset: "USDC",
  network: "",
  requestedUnits: "",
  memo: "",
};

export default function RedeemPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CreateFormState>(EMPTY);

  const { data, isLoading } = useQuery({
    queryKey: ["redemption-requests"],
    queryFn: () => redeemApi.list(),
  });
  const { data: entities } = useQuery({ queryKey: ["entities"], queryFn: entitiesApi.list });
  const { data: wallets } = useQuery({ queryKey: ["wallets"], queryFn: walletsApi.list });
  const { data: bankAccounts } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: () => bankAccountsApi.list(),
  });
  const { data: treasuryAccounts } = useQuery({
    queryKey: ["treasury-accounts", form.entityId],
    queryFn: () => treasuryAccountsApi.list(form.entityId || undefined),
    enabled: !!form.entityId,
  });

  const create = useMutation({
    mutationFn: () =>
      redeemApi.create({
        entityId:         form.entityId,
        treasuryAccountId: form.treasuryAccountId,
        sourceWalletId:   form.sourceWalletId,
        bankAccountId:    form.bankAccountId,
        asset:            form.asset,
        network:          form.network,
        requestedUnits:   form.requestedUnits,
        memo: form.memo || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["redemption-requests"] });
      setOpen(false);
      setForm(EMPTY);
    },
  });

  const rows = data?.items ?? [];

  function set(k: keyof CreateFormState, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <Header
        title="Redemption Requests"
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <PlusIcon className="h-4 w-4" />
            New Redemption
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="rounded-lg border border-border bg-card">
          {isLoading ? (
            <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">
              Loading…
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={rows}
              onRowClick={(row) => router.push(`/redeem/${row.id}`)}
            />
          )}
        </div>
      </div>

      <Dialog
        open={open}
        onClose={() => { setOpen(false); setForm(EMPTY); }}
        title="New Redemption Request"
        className="max-w-lg"
      >
        <div className="space-y-4">
          <FormField label="Entity">
            <Select
              value={form.entityId}
              onChange={(e) => set("entityId", e.target.value)}
              options={entities?.data.map((e) => ({ value: e.id, label: e.legalName })) ?? []}
              placeholder="Select entity"
            />
          </FormField>
          <FormField label="Treasury Account">
            <Select
              value={form.treasuryAccountId}
              onChange={(e) => set("treasuryAccountId", e.target.value)}
              options={
                treasuryAccounts?.data.map((t) => ({ value: t.id, label: t.name })) ?? []
              }
              placeholder="Select treasury account"
            />
          </FormField>
          <FormField label="Asset">
            <Select
              value={form.asset}
              onChange={(e) => set("asset", e.target.value)}
              options={[
                { value: "USDC", label: "USDC" },
                { value: "USDT", label: "USDT" },
              ]}
            />
          </FormField>
          <FormField label="Stablecoin Units (6 decimals)">
            <Input
              type="text"
              placeholder="e.g. 100000000000 (= 100,000 USDC)"
              value={form.requestedUnits}
              onChange={(e) => set("requestedUnits", e.target.value)}
            />
          </FormField>
          <FormField label="Source Wallet">
            <Select
              value={form.sourceWalletId}
              onChange={(e) => {
                const w = wallets?.data.find((x) => x.id === e.target.value);
                set("sourceWalletId", e.target.value);
                if (w) set("network", w.network);
              }}
              options={
                wallets?.data
                  .filter((w) => w.asset === form.asset)
                  .map((w) => ({ value: w.id, label: `${w.label} (${w.network})` })) ?? []
              }
              placeholder="Select wallet"
            />
          </FormField>
          <FormField label="Destination Bank Account">
            <Select
              value={form.bankAccountId}
              onChange={(e) => set("bankAccountId", e.target.value)}
              options={
                bankAccounts?.data.map((b) => ({
                  value: b.id,
                  label: `${b.bankName} ···${b.accountNumberMask}`,
                })) ?? []
              }
              placeholder="Select bank account"
            />
          </FormField>
          <FormField label="Memo (optional)">
            <Input
              placeholder="Internal memo"
              value={form.memo}
              onChange={(e) => set("memo", e.target.value)}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setOpen(false); setForm(EMPTY); }}>
            Cancel
          </Button>
          <Button
            loading={create.isPending}
            disabled={!form.entityId || !form.sourceWalletId || !form.bankAccountId || !form.requestedUnits}
            onClick={() => create.mutate()}
          >
            Create
          </Button>
        </DialogFooter>
        {create.isError && (
          <p className="mt-3 text-xs text-critical">{(create.error as Error).message}</p>
        )}
      </Dialog>
    </div>
  );
}

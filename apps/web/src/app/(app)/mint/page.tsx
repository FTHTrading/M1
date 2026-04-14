"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  mintApi,
  entitiesApi,
  bankAccountsApi,
  walletsApi,
  treasuryAccountsApi,
  type MintRequest,
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

const columns: ColumnDef<MintRequest, unknown>[] = [
  { accessorKey: "reference", header: "Reference" },
  {
    accessorKey: "asset",
    header: "Asset",
    cell: ({ row }) => (
      <span className="font-mono text-xs">{row.original.asset}</span>
    ),
  },
  {
    accessorKey: "requestedAmountCents",
    header: "Amount",
    cell: ({ row }) => formatCents(row.original.requestedAmountCents),
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
  bankAccountId: string;
  settlementWalletId: string;
  asset: string;
  network: string;
  requestedAmountCents: string;
  memo: string;
}

const EMPTY: CreateFormState = {
  entityId: "",
  treasuryAccountId: "",
  bankAccountId: "",
  settlementWalletId: "",
  asset: "USDC",
  network: "",
  requestedAmountCents: "",
  memo: "",
};

export default function MintPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CreateFormState>(EMPTY);

  const { data, isLoading } = useQuery({
    queryKey: ["mint-requests"],
    queryFn: () => mintApi.list(),
  });
  const { data: entities } = useQuery({
    queryKey: ["entities"],
    queryFn: entitiesApi.list,
  });
  const { data: bankAccounts } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: () => bankAccountsApi.list(),
  });
  const { data: wallets } = useQuery({
    queryKey: ["wallets"],
    queryFn: walletsApi.list,
  });
  const { data: treasuryAccounts } = useQuery({
    queryKey: ["treasury-accounts", form.entityId],
    queryFn: () => treasuryAccountsApi.list(form.entityId || undefined),
    enabled: !!form.entityId,
  });

  const create = useMutation({
    mutationFn: () =>
      mintApi.create({
        entityId:            form.entityId,
        treasuryAccountId:   form.treasuryAccountId,
        bankAccountId:       form.bankAccountId,
        settlementWalletId:  form.settlementWalletId,
        asset:               form.asset,
        network:             form.network,
        requestedAmountCents: parseInt(form.requestedAmountCents, 10) * 100,
        memo: form.memo || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mint-requests"] });
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
        title="Mint Requests"
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <PlusIcon className="h-4 w-4" />
            New Mint
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
              onRowClick={(row) => router.push(`/mint/${row.id}`)}
            />
          )}
        </div>
      </div>

      <Dialog
        open={open}
        onClose={() => { setOpen(false); setForm(EMPTY); }}
        title="New Mint Request"
        className="max-w-lg"
      >
        <div className="space-y-4">
          <FormField label="Entity">
            <Select
              value={form.entityId}
              onChange={(e) => set("entityId", e.target.value)}
              options={
                entities?.data.map((e) => ({ value: e.id, label: e.legalName })) ?? []
              }
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
                { value: "USDC", label: "USDC (Circle)" },
                { value: "USDT", label: "USDT (OTC)" },
              ]}
            />
          </FormField>
          <FormField label="Fiat Amount (USD)">
            <Input
              type="number"
              min="1"
              placeholder="e.g. 100000"
              value={form.requestedAmountCents}
              onChange={(e) => set("requestedAmountCents", e.target.value)}
            />
          </FormField>
          <FormField label="Bank Account">
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
          <FormField label="Settlement Wallet">
            <Select
              value={form.settlementWalletId}
              onChange={(e) => {
                const w = wallets?.data.find((x) => x.id === e.target.value);
                set("settlementWalletId", e.target.value);
                if (w) set("network", w.network);
              }}
              options={
                wallets?.data
                  .filter((w) => w.asset === form.asset)
                  .map((w) => ({
                    value: w.id,
                    label: `${w.label} (${w.network})`,
                  })) ?? []
              }
              placeholder="Select wallet"
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
            disabled={
              !form.entityId ||
              !form.treasuryAccountId ||
              !form.bankAccountId ||
              !form.settlementWalletId ||
              !form.requestedAmountCents
            }
            onClick={() => create.mutate()}
          >
            Create
          </Button>
        </DialogFooter>
        {create.isError && (
          <p className="mt-3 text-xs text-critical">
            {(create.error as Error).message}
          </p>
        )}
      </Dialog>
    </div>
  );
}

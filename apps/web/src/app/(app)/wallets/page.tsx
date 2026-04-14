"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { walletsApi, type Wallet } from "@/lib/api-client";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { FormField, Input, Select } from "@/components/ui/form";
import { truncateAddress } from "@/lib/utils";
import type { ColumnDef } from "@tanstack/react-table";
import { PlusIcon } from "@heroicons/react/24/outline";

const EMPTY = {
  label: "",
  network: "Ethereum",
  address: "",
  asset: "USDC",
  whitelisted: true,
  entityId: "",
};

export default function WalletsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const { data, isLoading } = useQuery({
    queryKey: ["wallets"],
    queryFn: walletsApi.list,
  });

  const create = useMutation({
    mutationFn: () => walletsApi.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wallets"] });
      setOpen(false);
      setForm(EMPTY);
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, whitelisted }: { id: string; whitelisted: boolean }) =>
      walletsApi.toggleWhitelist(id, whitelisted),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wallets"] }),
  });

  const columns: ColumnDef<Wallet, unknown>[] = [
    { accessorKey: "label", header: "Label" },
    { accessorKey: "asset", header: "Asset" },
    { accessorKey: "network", header: "Network" },
    {
      accessorKey: "address",
      header: "Address",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{truncateAddress(row.original.address)}</span>
      ),
    },
    {
      accessorKey: "whitelisted",
      header: "Whitelist",
      cell: ({ row }) => (
        <button
          onClick={() =>
            toggle.mutate({ id: row.original.id, whitelisted: !row.original.whitelisted })
          }
        >
          <Badge variant={row.original.whitelisted ? "success" : "destructive"}>
            {row.original.whitelisted ? "Active" : "Inactive"}
          </Badge>
        </button>
      ),
    },
  ];

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <Header
        title="Wallets"
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <PlusIcon className="h-4 w-4" />
            Add Wallet
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="rounded-lg border border-border bg-card">
          {isLoading ? (
            <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : (
            <DataTable columns={columns} data={data?.data ?? []} />
          )}
        </div>
      </div>

      <Dialog
        open={open}
        onClose={() => { setOpen(false); setForm(EMPTY); }}
        title="Add Wallet"
      >
        <div className="space-y-4">
          <FormField label="Label">
            <Input
              placeholder="e.g. Treasury Primary USDC"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            />
          </FormField>
          <FormField label="Asset">
            <Select
              value={form.asset}
              onChange={(e) => setForm((f) => ({ ...f, asset: e.target.value }))}
              options={[
                { value: "USDC", label: "USDC" },
                { value: "USDT", label: "USDT" },
              ]}
            />
          </FormField>
          <FormField label="Network">
            <Select
              value={form.network}
              onChange={(e) => setForm((f) => ({ ...f, network: e.target.value }))}
              options={[
                { value: "Ethereum", label: "Ethereum" },
                { value: "Solana", label: "Solana" },
                { value: "Tron", label: "Tron" },
                { value: "Polygon", label: "Polygon" },
                { value: "Avalanche", label: "Avalanche" },
              ]}
            />
          </FormField>
          <FormField label="Address">
            <Input
              placeholder="0x…"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            />
          </FormField>
          <FormField label="Entity ID">
            <Input
              placeholder="UUID"
              value={form.entityId}
              onChange={(e) => setForm((f) => ({ ...f, entityId: e.target.value }))}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setOpen(false); setForm(EMPTY); }}>
            Cancel
          </Button>
          <Button
            loading={create.isPending}
            disabled={!form.label || !form.address || !form.entityId}
            onClick={() => create.mutate()}
          >
            Add
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Settings {
  FEATURE_SANDBOX_ONLY: string;
  FEATURE_LIVE_TRANSFERS: string;
  ENABLE_USDT: string;
  MAX_SINGLE_TX_USD: string;
  REQUIRED_APPROVAL_THRESHOLD_USD: string;
  CIRCLE_ENVIRONMENT: string;
  REDIS_URL: string;
}

export default function AdminPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api.get<{ settings: Record<string, string> }>("/admin/settings"),
  });

  const settings = data?.settings ?? {};

  function flag(key: string) {
    const val = settings[key];
    if (!val) return null;
    const on = val === "true" || val === "1";
    return <Badge variant={on ? "success" : "muted"}>{on ? "ON" : "OFF"}</Badge>;
  }

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <Header title="Admin · Settings" />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Feature Flags</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <>
                <Row label="Sandbox Only" node={flag("FEATURE_SANDBOX_ONLY")} />
                <Row label="Live Transfers" node={flag("FEATURE_LIVE_TRANSFERS")} />
                <Row label="USDT Enabled" node={flag("ENABLE_USDT")} />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <>
                <Row
                  label="Max Single TX (USD)"
                  node={<span className="text-sm">${settings["MAX_SINGLE_TX_USD"] ?? "—"}</span>}
                />
                <Row
                  label="Approval Threshold (USD)"
                  node={
                    <span className="text-sm">
                      ${settings["REQUIRED_APPROVAL_THRESHOLD_USD"] ?? "—"}
                    </span>
                  }
                />
                <Row
                  label="Circle Environment"
                  node={
                    <Badge
                      variant={
                        settings["CIRCLE_ENVIRONMENT"] === "production"
                          ? "destructive"
                          : "warning"
                      }
                    >
                      {settings["CIRCLE_ENVIRONMENT"] ?? "sandbox"}
                    </Badge>
                  }
                />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>System Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="API URL" node={<span className="font-mono text-xs">http://localhost:4000</span>} />
            <Row label="Worker Queue" node={<span className="font-mono text-xs">Redis (BullMQ)</span>} />
            <Row label="Database" node={<span className="font-mono text-xs">PostgreSQL 16 / Prisma 5</span>} />
            <Row label="Version" node={<span className="font-mono text-xs">1.0.0</span>} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, node }: { label: string; node: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      {node}
    </div>
  );
}

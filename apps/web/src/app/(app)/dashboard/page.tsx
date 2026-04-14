"use client";

import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "@/lib/api-client";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/utils";
import {
  ArrowUpCircleIcon,
  ArrowDownCircleIcon,
  CheckBadgeIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import {
  ResponsiveContainer,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Line,
  Legend,
} from "recharts";

// Static placeholder chart data — replace with a real /reports/timeseries endpoint
const CHART_DATA = [
  { month: "Jan", usdc: 0, usdt: 0 },
  { month: "Feb", usdc: 250000, usdt: 0 },
  { month: "Mar", usdc: 500000, usdt: 100000 },
  { month: "Apr", usdc: 1200000, usdt: 300000 },
  { month: "May", usdc: 2500000, usdt: 750000 },
  { month: "Jun", usdc: 4100000, usdt: 1100000 },
];

function KpiCard({
  title,
  value,
  sub,
  icon: Icon,
  color,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>{title}</CardTitle>
        <div className={`rounded-md p-2 ${color}`}>
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: dashboardApi.summary,
    staleTime: 60_000,
  });

  const summary = data ?? {
    pendingMints: 0,
    completedMints: 0,
    pendingRedemptions: 0,
    openBreaks: 0,
    totalUsdcIssued: "0",
    totalUsdtIssued: "0",
    fiatCashBalance: "0",
  };

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <Header title="Dashboard" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {isError && (
          <div className="rounded-md border border-critical/30 bg-critical/10 px-4 py-3 text-sm text-critical">
            Failed to load dashboard data. Check that the API is running.
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Pending Mints"
            value={isLoading ? "…" : summary.pendingMints}
            icon={ArrowUpCircleIcon}
            color="bg-mint/10 text-mint"
            sub="awaiting action"
          />
          <KpiCard
            title="Completed Mints"
            value={isLoading ? "…" : summary.completedMints}
            icon={CheckBadgeIcon}
            color="bg-primary/10 text-primary"
            sub="all time"
          />
          <KpiCard
            title="Pending Redemptions"
            value={isLoading ? "…" : summary.pendingRedemptions}
            icon={ArrowDownCircleIcon}
            color="bg-redeem/10 text-redeem"
            sub="awaiting action"
          />
          <KpiCard
            title="Open Recon Breaks"
            value={isLoading ? "…" : summary.openBreaks}
            icon={ExclamationTriangleIcon}
            color={
              summary.openBreaks > 0
                ? "bg-critical/10 text-critical"
                : "bg-mint/10 text-mint"
            }
            sub="needs resolution"
          />
        </div>

        {/* Balance Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Fiat Cash (Bank)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xl font-bold">
                {isLoading ? "…" : formatCents(summary.fiatCashBalance)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>USDC Issued (Total)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xl font-bold text-mint">
                {isLoading ? "…" : formatCents(summary.totalUsdcIssued)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>USDT Issued (Total)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xl font-bold text-redeem">
                {isLoading ? "…" : formatCents(summary.totalUsdtIssued)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Cumulative Issuance</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={CHART_DATA}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  />
                  <YAxis
                    tickFormatter={(v: number) => `$${(v / 1_000_000).toFixed(1)}M`}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                    formatter={(v: number) => [`$${v.toLocaleString()}`, ""]}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="usdc"
                    name="USDC"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="usdt"
                    name="USDT"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

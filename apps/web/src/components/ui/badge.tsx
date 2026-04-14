import * as React from "react";
import { cn } from "@/lib/utils";

type BadgeVariant =
  | "default"
  | "success"
  | "warning"
  | "destructive"
  | "outline"
  | "muted";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variants: Record<BadgeVariant, string> = {
  default: "bg-primary/10 text-primary border-primary/20",
  success: "bg-mint/10 text-mint border-mint/20",
  warning: "bg-warn/10 text-warn border-warn/20",
  destructive: "bg-critical/10 text-critical border-critical/20",
  outline: "bg-transparent border-border text-foreground",
  muted: "bg-muted text-muted-foreground border-transparent",
};

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

// Convenience component that maps a request status string to the right variant
const STATUS_MAP: Record<string, BadgeVariant> = {
  // Shared
  DRAFT: "muted",
  PENDING_APPROVAL: "warning",
  PENDING_COMPLIANCE: "warning",
  COMPLIANCE_HOLD: "destructive",
  APPROVED: "success",
  REJECTED: "destructive",
  CANCELLED: "destructive",
  FAILED: "destructive",
  EXPIRED: "destructive",
  SETTLED: "success",
  // Mint-specific
  AWAITING_BANK_FUNDING: "warning",
  BANK_FUNDED: "default",
  SUBMITTED_TO_PROVIDER: "default",
  PROVIDER_PROCESSING: "default",
  MINT_COMPLETED: "success",
  SETTLEMENT_INITIATED: "default",
  // Redemption-specific
  REDEMPTION_COMPLETED: "success",
  AWAITING_FIAT_RECEIPT: "warning",
  FIAT_RECEIVED: "default",
  // Approval / misc
  PENDING: "warning",
  CLEARED: "success",
  FLAGGED: "destructive",
  OPEN: "warning",
  RESOLVED: "success",
};

export function StatusBadge({ status }: { status: string }) {
  const variant = STATUS_MAP[status] ?? "outline";
  return (
    <Badge variant={variant}>{status.replace(/_/g, " ")}</Badge>
  );
}

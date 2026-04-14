"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  HomeIcon,
  ArrowUpCircleIcon,
  ArrowDownCircleIcon,
  CheckBadgeIcon,
  WalletIcon,
  ScaleIcon,
  ShieldCheckIcon,
  DocumentTextIcon,
  Cog6ToothIcon,
  DocumentMagnifyingGlassIcon,
} from "@heroicons/react/24/outline";

const NAV = [
  { label: "Dashboard",   href: "/dashboard",  icon: HomeIcon },
  { label: "Mint",        href: "/mint",        icon: ArrowUpCircleIcon },
  { label: "Redeem",      href: "/redeem",      icon: ArrowDownCircleIcon },
  { label: "Approvals",   href: "/approvals",   icon: CheckBadgeIcon },
  { label: "Wallets",     href: "/wallets",      icon: WalletIcon },
  { label: "Reconciliation", href: "/reconciliation", icon: ScaleIcon },
  { label: "Compliance",  href: "/compliance",  icon: ShieldCheckIcon },
  { label: "Assurance",   href: "/assurance",   icon: DocumentMagnifyingGlassIcon },
  { label: "Audit Log",   href: "/audit",        icon: DocumentTextIcon },
  { label: "Admin",       href: "/admin",        icon: Cog6ToothIcon },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex h-screen w-56 flex-col border-r border-border bg-card px-3 py-6 shrink-0">
      {/* Brand */}
      <div className="mb-8 px-2">
        <span className="text-sm font-bold tracking-tight text-primary">
          Treasury OS
        </span>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Stablecoin Operations
        </p>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1 flex-1">
        {NAV.map(({ label, href, icon: Icon }) => {
          const active =
            href === "/dashboard"
              ? pathname === href
              : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-2 pt-4 border-t border-border">
        <p className="text-[10px] text-muted-foreground">v1.0.0 • Production</p>
      </div>
    </aside>
  );
}

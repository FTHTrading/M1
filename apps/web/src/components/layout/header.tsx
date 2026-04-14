"use client";

import { ArrowRightOnRectangleIcon } from "@heroicons/react/24/outline";
import { clearToken, getCurrentUser } from "@/lib/auth";
import { useRouter } from "next/navigation";

interface HeaderProps {
  title: string;
  actions?: React.ReactNode;
}

export function Header({ title, actions }: HeaderProps) {
  const user = getCurrentUser();
  const router = useRouter();

  function handleLogout() {
    clearToken();
    router.push("/login");
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6 shrink-0">
      <h1 className="text-sm font-semibold">{title}</h1>
      <div className="flex items-center gap-4">
        {actions}
        {user && (
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-xs font-medium">{user.name}</p>
              <p className="text-[10px] text-muted-foreground">{user.role}</p>
            </div>
            <button
              onClick={handleLogout}
              className="rounded p-1.5 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            >
              <ArrowRightOnRectangleIcon className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

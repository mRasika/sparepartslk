"use client";

import {
  AlertTriangle,
  Boxes,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageOpen,
  Settings,
  Truck,
  Undo2,
  UserCog,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logoutAction } from "@/app/(auth)/login/actions";
import { ThemeMenu } from "@/components/theme/theme-menu";
import { cn } from "@/lib/utils";
import type { Role } from "@/server/auth";

type NavItem = { href: string; label: string; icon: LucideIcon; adminOnly?: boolean; badge?: "lowStock" };

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Sell",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/invoices", label: "Invoices", icon: FileText },
      { href: "/returns", label: "Returns", icon: Undo2 },
      { href: "/payments", label: "Payments", icon: Wallet },
      { href: "/customers", label: "Customers", icon: Users },
    ],
  },
  {
    label: "Stock",
    items: [
      { href: "/parts", label: "Parts", icon: Wrench },
      { href: "/stock", label: "Stock", icon: Boxes },
      { href: "/low-stock", label: "Low stock", icon: AlertTriangle, badge: "lowStock" },
      { href: "/grn", label: "Goods received", icon: PackageOpen },
      { href: "/suppliers", label: "Suppliers", icon: Truck },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/settings", label: "Settings", icon: Settings, adminOnly: true },
      { href: "/users", label: "Users", icon: UserCog, adminOnly: true },
    ],
  },
];

export function Sidebar({
  fullName,
  role,
  lowStockCount = 0,
}: {
  fullName: string;
  role: Role;
  lowStockCount?: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.adminOnly || role === "admin"),
  })).filter((g) => g.items.length > 0);

  return (
    <aside className="bg-sidebar text-sidebar-foreground md:fixed md:inset-y-0 md:left-0 md:flex md:w-60 md:flex-col">
      <div className="flex h-14 items-center justify-between px-4 md:h-16">
        <Link href="/dashboard" className="text-lg font-semibold tracking-tight text-white">
          Sparepartslk
        </Link>
        <button
          type="button"
          className="rounded-md p-2 text-sidebar-foreground hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-sidebar-ring md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <Menu className="size-5" />
        </button>
      </div>

      <nav
        aria-label="Main"
        className={cn("flex-1 overflow-y-auto px-3 pb-4 md:block", open ? "block" : "hidden")}
      >
        {groups.map((group) => (
          <div key={group.label} className="mt-4 first:mt-1">
            <p className="px-3 pb-1 text-xs font-medium text-sidebar-foreground/60">{group.label}</p>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                const count = item.badge === "lowStock" ? lowStockCount : 0;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        "focus-visible:outline-2 focus-visible:outline-sidebar-ring",
                        active &&
                          "bg-sidebar-accent font-medium text-sidebar-accent-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-full before:bg-sidebar-primary",
                      )}
                    >
                      <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
                      <span className="flex-1">{item.label}</span>
                      {count > 0 && (
                        <span
                          className="rounded-full bg-sidebar-primary px-2 py-0.5 text-xs font-semibold tabular-nums text-sidebar-primary-foreground"
                          aria-label={`${count} parts low on stock`}
                        >
                          {count}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <div className="mt-6 border-t border-sidebar-border px-3 pt-4 md:hidden">
          <UserBlock fullName={fullName} role={role} />
        </div>
      </nav>

      <div className="hidden border-t border-sidebar-border px-6 py-4 md:block">
        <UserBlock fullName={fullName} role={role} />
      </div>
    </aside>
  );
}

function UserBlock({ fullName, role }: { fullName: string; role: Role }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-white">{fullName}</p>
        <p className="text-xs text-sidebar-foreground/70">{role === "admin" ? "Admin" : "Staff"}</p>
      </div>
      <div className="flex items-center">
        <ThemeMenu />
        <form action={logoutAction}>
          <button
            type="submit"
            className="rounded-md p-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-white focus-visible:outline-2 focus-visible:outline-sidebar-ring"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/erp/ui/badge";
import { cn } from "@/lib/erp/utils";
import type { AppRole } from "@/lib/erp/domain/roles";
import { accessibleModules, hasCatalogAccess, MODULE_LABEL, type ModuleKey } from "@/lib/erp/domain/modules";

const roleStyles: Record<string, string> = {
  admin: "border-clay-200 bg-clay-50 text-clay-700",
  manager: "border-slate-200 bg-slate-100 text-slate-600",
  staff: "border-slate-200 bg-slate-100 text-slate-600",
};

type Item = { href: string; label: string; managerPlus?: boolean };
const ITEMS: Item[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/catalog", label: "Catalog" },
  { href: "/purchasing", label: "Purchasing", managerPlus: true },
  { href: "/purchasing/orders", label: "PO ↔ Proforma", managerPlus: true },
  { href: "/purchasing/receiving", label: "Receiving", managerPlus: true },
  { href: "/inventory", label: "Inventory", managerPlus: true },
  { href: "/review", label: "Review", managerPlus: true },
  { href: "/requests", label: "Approvals", managerPlus: true },
  { href: "/po-upload", label: "PO upload", managerPlus: true },
  { href: "/decisions", label: "Bulk apply", managerPlus: true },
  { href: "/master", label: "Excel round-trip", managerPlus: true },
  { href: "/request", label: "Request" },
];
const ANALYTICS: Item[] = [
  { href: "/analytics/stores", label: "Stores", managerPlus: true },
  { href: "/analytics/vendors", label: "Vendors", managerPlus: true },
  { href: "/analytics/categories", label: "Categories", managerPlus: true },
  { href: "/analytics/salespeople", label: "Salespeople", managerPlus: true },
];

const MODULE_HREF: Record<ModuleKey, string> = {
  deliveries: "/deliveries",
  recruiting: "/recruiting",
  timetracker: "/timetracker",
};

export function SideNav({
  role,
  fullName,
  email,
  cost,
  moduleAccess,
  recruitingRole,
  timetrackerRole,
}: {
  role: AppRole;
  fullName: string | null;
  email: string;
  cost: boolean;
  moduleAccess?: string[] | null;
  recruitingRole?: string | null;
  timetrackerRole?: string | null;
}) {
  const pathname = usePathname();
  const managerPlus = role === "admin" || role === "manager";
  // Catalog nav is hidden entirely from the delivery-floor roles the merge added (ADR 0010): a
  // driver has no reason to browse the product master, and a list of links that all redirect is
  // worse than no list.
  const catalog = hasCatalogAccess(role);
  const items = catalog ? ITEMS.filter((i) => !i.managerPlus || managerPlus) : [];
  const modules = accessibleModules(role, { moduleAccess, recruitingRole, timetrackerRole });
  const analyticsItems = catalog && managerPlus ? ANALYTICS : [];
  // Exact-match the roots that have deeper siblings (/, /purchasing) so a sub-route like
  // /purchasing/orders highlights only its own item, not its parent.
  const exact = new Set(["/purchasing"]);
  const active = (href: string) => (exact.has(href) ? pathname === href : pathname.startsWith(href));

  const brand = (
    <Link href="/hub" className="flex items-baseline gap-2" title="All apps">
      <span className="text-sm font-bold tracking-tight text-clay-600">RTG</span>
      <span className="text-xs text-slate-400">All apps ⌂</span>
    </Link>
  );
  const signout = (
    <form action="/auth/signout" method="post">
      <button type="submit" className="rounded-md px-3 py-1.5 text-slate-500 hover:bg-slate-100">
        Sign out
      </button>
    </form>
  );
  const linkCls = (href: string) =>
    cn(
      "rounded-md px-3 py-2 text-slate-600 hover:bg-clay-50 hover:text-clay-700",
      active(href) && "bg-clay-50 font-medium text-clay-700"
    );

  return (
    <>
      {/* Desktop: fixed left sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-14 shrink-0 items-center px-4">{brand}</div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2 text-sm">
          {modules.length + (catalog ? 1 : 0) > 1 && (
            <Link
              href="/hub"
              className="mb-2 block rounded-md px-3 py-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              ⌂ All apps
            </Link>
          )}
          {items.map((i) => (
            <Link key={i.href} href={i.href} className={cn("block", linkCls(i.href))}>
              {i.label}
            </Link>
          ))}
          {analyticsItems.length > 0 && (
            <div className="pt-3">
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Analytics</div>
              {analyticsItems.map((i) => (
                <Link key={i.href} href={i.href} className={cn("block", linkCls(i.href))}>
                  {i.label}
                </Link>
              ))}
            </div>
          )}
          {modules.length > 0 && (
            <div className="pt-3">
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Modules</div>
              {modules.map((m) => (
                <Link key={m} href={MODULE_HREF[m]} className={cn("block", linkCls(MODULE_HREF[m]))}>
                  {MODULE_LABEL[m]}
                </Link>
              ))}
            </div>
          )}
        </nav>
        <div className="shrink-0 border-t border-slate-200 p-3 text-sm">
          <div className="mb-2 flex items-center gap-2">
            <Badge className={roleStyles[role] ?? roleStyles.staff}>{role}</Badge>
            <span
              className="text-xs text-slate-400"
              title="Cost & margin visibility is enforced at the database (#29)"
            >
              cost {cost ? "visible" : "hidden"}
            </span>
          </div>
          <div className="leading-tight">
            <div className="truncate font-medium">{fullName ?? email}</div>
            <div className="truncate text-xs text-slate-400">{email}</div>
          </div>
          <div className="mt-2">{signout}</div>
        </div>
      </aside>

      {/* Mobile: top bar with horizontal nav */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white lg:hidden">
        <div className="flex h-14 items-center gap-3 px-4">
          {brand}
          <div className="ml-auto flex items-center gap-2">
            <Badge className={roleStyles[role] ?? roleStyles.staff}>{role}</Badge>
            {signout}
          </div>
        </div>
        <nav className="flex items-center gap-1 overflow-x-auto border-t border-slate-100 px-2 py-1.5 text-sm">
          {items
            .concat(analyticsItems)
            .concat(modules.map((m) => ({ href: MODULE_HREF[m], label: MODULE_LABEL[m] })))
            .map((i) => (
            <Link key={i.href} href={i.href} className={cn("whitespace-nowrap", linkCls(i.href))}>
              {i.label}
            </Link>
          ))}
        </nav>
      </header>
    </>
  );
}

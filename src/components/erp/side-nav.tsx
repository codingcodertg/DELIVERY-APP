"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/erp/ui/badge";
import { cn } from "@/lib/erp/utils";
import type { AppRole } from "@/lib/erp/domain/roles";
import { hasCatalogAccess } from "@/lib/erp/domain/modules";
import { useErpNav } from "@/components/erp/nav-state";

const roleStyles: Record<string, string> = {
  admin: "border-clay-200 bg-clay-50 text-clay-700",
  manager: "border-slate-200 bg-slate-100 text-slate-600",
  staff: "border-slate-200 bg-slate-100 text-slate-600",
};

type Item = { href: string; label: string; managerPlus?: boolean };
const ITEMS: Item[] = [
  { href: "/erp/dashboard", label: "Dashboard" },
  { href: "/erp/catalog", label: "Catalog" },
  { href: "/erp/purchasing", label: "Purchasing", managerPlus: true },
  { href: "/erp/purchasing/orders", label: "PO ↔ Proforma", managerPlus: true },
  { href: "/erp/purchasing/receiving", label: "Receiving", managerPlus: true },
  { href: "/erp/inventory", label: "Inventory", managerPlus: true },
  { href: "/erp/review", label: "Review", managerPlus: true },
  { href: "/erp/requests", label: "Approvals", managerPlus: true },
  { href: "/erp/po-upload", label: "PO upload", managerPlus: true },
  { href: "/erp/decisions", label: "Bulk apply", managerPlus: true },
  { href: "/erp/master", label: "Excel round-trip", managerPlus: true },
  { href: "/erp/request", label: "Request" },
];
const ANALYTICS: Item[] = [
  { href: "/erp/analytics/stores", label: "Stores", managerPlus: true },
  { href: "/erp/analytics/vendors", label: "Vendors", managerPlus: true },
  { href: "/erp/analytics/categories", label: "Categories", managerPlus: true },
  { href: "/erp/analytics/salespeople", label: "Salespeople", managerPlus: true },
];


export function SideNav({
  role,
  fullName,
  email,
  cost,
}: {
  role: AppRole;
  fullName: string | null;
  email: string;
  cost: boolean;
}) {
  const pathname = usePathname();
  const managerPlus = role === "admin" || role === "manager";
  // Catalog nav is hidden entirely from the delivery-floor roles the merge added (ADR 0010): a
  // driver has no reason to browse the product master, and a list of links that all redirect is
  // worse than no list.
  const { collapsed, toggle } = useErpNav();
  const catalog = hasCatalogAccess(role);
  const items = catalog ? ITEMS.filter((i) => !i.managerPlus || managerPlus) : [];
  const analyticsItems = catalog && managerPlus ? ANALYTICS : [];
  // Exact-match the roots that have deeper siblings (/, /purchasing) so a sub-route like
  // /purchasing/orders highlights only its own item, not its parent.
  const exact = new Set(["/erp/purchasing"]);
  const active = (href: string) => (exact.has(href) ? pathname === href : pathname.startsWith(href));

  // Two things, not one: the product name (where you are) and the way back to the
  // hub (where you can go). They were both whispering at 14px/12px, and the hub
  // link is the only exit from this module now that the switcher is gone — it
  // should be legible.
  // One row: the product name and the way out, side by side. Two stacked lines cost a second
  // row of header height for no gain, and the hub link is the only exit from this module since
  // the switcher was removed — it belongs next to the name, not under it.
  const brand = (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 text-base font-bold tracking-tight text-clay-600">RTG ERP</span>
      <Link
        href="/home"
        title="All apps"
        className="shrink-0 text-sm text-slate-500 hover:text-clay-700"
      >
        <span aria-hidden="true">⌂</span> All apps
      </Link>
    </div>
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

  const burger = (
    <button
      type="button"
      onClick={toggle}
      aria-label={collapsed ? "Show menu" : "Hide menu"}
      aria-expanded={!collapsed}
      title={collapsed ? "Show menu" : "Hide menu"}
      className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path d="M2 4h14M2 9h14M2 14h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  );

  return (
    <>
      {/* Collapsed: the only way back. Fixed so it stays put while the page scrolls, and
          desktop-only because the mobile layout has its own top bar below. */}
      {collapsed && (
        <div className="fixed left-2 top-2 z-40 hidden lg:block">
          <div className="rounded-md border border-slate-200 bg-white shadow-sm">{burger}</div>
        </div>
      )}

      {/* Desktop: fixed left sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-slate-200 bg-white",
          collapsed ? "lg:hidden" : "lg:flex"
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-1 px-2">
          {burger}
          <div className="min-w-0 flex-1">{brand}</div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2 text-sm">
          {/* Always shown. In rtg-erp this was gated on having more than one
              destination, because there the ERP could be somebody's only module.
              Here the hub is the way back to Deliveries, Recruiting and Time
              Tracker, so it is never a dead end. */}
          <Link
            href="/home"
            className="mb-2 block rounded-md px-3 py-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            ⌂ All apps
          </Link>
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
        {/* Envuelve en vez de cortar (D-175, patrón de D-055). `overflow-x-auto` escondía
            media barra detrás de un scroll horizontal que en un móvil nadie descubre; con
            `flex-wrap` las pestañas bajan de línea. `min-w-0` es la otra mitad del patrón:
            un flex item mide por defecto lo que su hijo más ancho, y sin esto la fila se
            niega a encoger por debajo de la pestaña más larga. Cada enlace conserva su
            `whitespace-nowrap`: se parte la fila, no la palabra. */}
        <nav className="flex min-w-0 flex-wrap items-center gap-1 border-t border-slate-100 px-2 py-1.5 text-sm">
          {items
            .concat(analyticsItems)
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

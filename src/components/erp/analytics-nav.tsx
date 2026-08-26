"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/erp/utils";

const TABS = [
  { href: "/erp/analytics/stores", label: "Stores" },
  { href: "/erp/analytics/vendors", label: "Vendors" },
  { href: "/erp/analytics/categories", label: "Categories" },
  { href: "/erp/analytics/salespeople", label: "Salespeople" },
];

export function AnalyticsNav() {
  const pathname = usePathname();
  return (
    <div className="mb-4 inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
      {TABS.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "rounded-md px-3 py-1 text-sm transition-colors",
              active ? "bg-clay-50 font-medium text-clay-700" : "text-slate-500 hover:text-slate-800"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

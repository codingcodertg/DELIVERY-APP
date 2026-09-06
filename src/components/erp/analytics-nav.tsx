"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/erp/utils";
import { usePrefs } from "@/lib/prefs";

// G-10 (D-NEXT): las pestañas se construyen con t() dentro del render (una constante no cambia de
// idioma); los href no cambian. El guardián no las veía (palabra sola entre comillas), pero son texto.
type T = (en: string, es: string) => string;
const tabs = (t: T) => [
  { href: "/erp/analytics/stores", label: t("Stores", "Tiendas") },
  { href: "/erp/analytics/vendors", label: t("Vendors", "Proveedores") },
  { href: "/erp/analytics/categories", label: t("Categories", "Categorías") },
  { href: "/erp/analytics/salespeople", label: t("Salespeople", "Vendedores") },
];

export function AnalyticsNav() {
  const pathname = usePathname();
  const { t } = usePrefs();
  return (
    <div className="mb-4 inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
      {tabs(t).map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "rounded-md px-3 py-1 text-sm transition-colors",
              active ? "bg-clay-50 font-medium text-clay-700" : "text-slate-500 hover:text-slate-800"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

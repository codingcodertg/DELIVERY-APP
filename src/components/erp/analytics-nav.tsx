"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/erp/utils";
import { usePrefs } from "@/lib/prefs";
import { analyticsItems } from "@/lib/erp/nav";

// G-10 (D-204): las pestañas se construyen con t() dentro del render (una constante no cambia de
// idioma); los href no cambian. El guardián no las veía (palabra sola entre comillas), pero son texto.
//
// D-NEXT: esta fila era una SEGUNDA copia de los cuatro enlaces de Analítica de la barra lateral.
// Al pasar «Dashboard» a Analítica como «Product Analytics», la copia aparte se habría quedado sin
// él; ahora las dos leen la misma lista (`analyticsItems`, lib/erp/nav.ts). Aquí van TODAS, sin
// filtrar por rol, a sabiendas: la fila solo se pinta en /erp/analytics/*, cuyas cuatro páginas ya
// echan a quien no es manager+ (canSeeCost). Por eso /erp/dashboard, que también ve staff, NO pinta
// esta fila: le enseñaría cuatro enlaces que lo devuelven al catálogo.
export function AnalyticsNav() {
  const pathname = usePathname();
  const { t } = usePrefs();
  return (
    <div className="mb-4 inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
      {analyticsItems(t).map((tab) => {
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

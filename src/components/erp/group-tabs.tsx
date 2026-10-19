"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/erp/utils";
import { usePrefs } from "@/lib/prefs";
import type { AppRole } from "@/lib/erp/domain/roles";
import { pestanasDe, pestanaActiva, type GrupoId } from "@/lib/erp/nav";

// La fila de pestañas de un grupo del menú (D-NEXT): Catálogo · Inventario · Revisión · Aprobaciones
// arriba de /erp/catalog y sus hermanas; Compras · OC ↔ Proforma · Recepción en Compras; las cinco de
// Analítica en las suyas. Sustituye a analytics-nav.tsx, que pintaba TODAS las de Analítica sin mirar
// el rol (podía, porque esas cuatro páginas echaban a quien no era manager+). Esta recibe el rol y pinta
// solo lo que `pestanasDe` (lib/erp/nav.ts) dice: la misma puerta que tenía cada entrada en la barra.
//
// Con una sola pestaña visible (staff en Catálogo o en Analítica) no se pinta nada: una fila con una
// pastilla que ya es la página en la que estás no dice nada.
//
// G-10 (D-204): las etiquetas se construyen con t() dentro del render; los href no cambian.
export function GroupTabs({ grupo, role }: { grupo: GrupoId; role: AppRole }) {
  const pathname = usePathname();
  const { t } = usePrefs();
  const tabs = pestanasDe(grupo, role, t);
  if (tabs.length < 2) return null;
  const activa = pestanaActiva(tabs, pathname);
  return (
    <div className="mb-4 inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.href === activa ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1 text-sm transition-colors",
            tab.href === activa ? "bg-clay-50 font-medium text-clay-700" : "text-slate-500 hover:text-slate-800"
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}

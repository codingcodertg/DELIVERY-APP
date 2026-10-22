"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/erp/ui/badge";
import { BarraDeApp } from "@/components/BarraDeApp";
import { BotonRecargar } from "@/components/BotonRecargar";
import { MenuDeCuenta } from "@/components/MenuDeCuenta";
import type { AppRole } from "@/lib/erp/domain/roles";
import { erpNav, entradaActiva, type NavItem } from "@/lib/erp/nav";
import { usePrefs } from "@/lib/prefs";
import { RUTA_PERSONALIZAR } from "@/lib/personalizar";
import type { UserRole } from "@/lib/types";

/**
 * La barra de Inventario (antes «RTG ERP») y de Clientes: la MISMA barra superior que Entregas (D-622, 2026-10-21).
 *
 * El dueño: «quiero que toda la app se mire igual como deliveries app, al igual que el time tracker. Todo eso quiero
 * que hagamos una transformación de todo eso para que todo sea estandarizado e igual». Hasta D-622 este fichero
 * pintaba una barra LATERAL fija (blanca, con acento arcilla) en el escritorio y una cabecera aparte en el teléfono;
 * era el único módulo del hub sin la barra oscura de arriba. Ahora pinta `.topbar` de globals.css —el nombre de la
 * app, la casa del hub, las pestañas y el menú del nombre— con las mismas clases que Entregas y Time Tracker, y en el
 * teléfono se parte en dos filas por las mismas reglas (`.entregas-marca` / `.entregas-barra-resto`, D-545).
 *
 * Desde D-NEXT (2026-10-22) la barra no se copia: es `BarraDeApp`, la misma pieza de todas las apps, con la casa
 * `HubHomeLink`. Hasta entonces este fichero pintaba su propia casa con `{hubReachable && …}`, y el dueño veía la del
 * ERP en un sitio y la de RR. HH. en otro.
 *
 * El fichero conserva su nombre y su firma (`SideNav`, con `otra` para Clientes) a propósito: veinte páginas y seis
 * pruebas lo citan, y lo que cambia es cómo se pinta, no quién lo usa.
 *
 * G-10 (D-203): habla el idioma del HUB (usePrefs) con pares inline. Las entradas y quién ve cada una viven en
 * `lib/erp/nav.ts` (D-553, D-586); aquí solo se pintan. Y sigue sin decidir por su cuenta si hay hub al que volver: lo
 * decide `HubHomeLink` con `canReachHub` —la única regla, D-227—, con el rol del hub y los módulos que `header.tsx`
 * saca de la sesión.
 */

const roleStyles: Record<string, string> = {
  admin: "border-clay-200 bg-clay-50 text-clay-700",
  manager: "border-slate-200 bg-slate-100 text-slate-600",
  staff: "border-slate-200 bg-slate-100 text-slate-600",
};

export function SideNav({
  role,
  fullName,
  email,
  cost,
  deliveriesRole,
  moduleAccess,
  otra,
}: {
  role: AppRole;
  fullName: string | null;
  email: string;
  cost: boolean;
  /** El rol del HUB (la columna `role` de `profiles`, no el `AppRole` del ERP) y sus módulos: con ellos decide la casa
   *  (`HubHomeLink`, `canReachHub`, D-227). Llegan de la sesión que `header.tsx` ya leía. */
  deliveriesRole: UserRole;
  moduleAccess: string[] | null;
  /**
   * Otra app con esta misma barra (Clientes, migración 180): su nombre, sus entradas y la pastilla que enseña.
   * Sin esto, la barra es la de Inventario: «RTG Inventario», `erpNav(role)` y el nivel con la nota de costo. Con
   * `otra`, `cost` no se pinta (no hay costo que esconder) y la pastilla es la que diga `badge`.
   */
  otra?: { brand: string; nav: { main: NavItem[]; analytics: NavItem[] }; badge: string };
}) {
  const pathname = usePathname();
  const { t } = usePrefs();
  const { main: navItems, analytics: analyticsItems } = otra?.nav ?? erpNav(role, t);
  const marca = otra?.brand ?? t("RTG Inventory", "RTG Inventario");
  const pastilla = otra?.badge ?? role;
  const pestanas = navItems.concat(analyticsItems);
  const encendida = entradaActiva(pestanas, pathname);

  const personalizar = (soloIcono: boolean) => (
    <Link
      href={RUTA_PERSONALIZAR}
      role="menuitem"
      className="col-opt"
      style={{ textDecoration: "none" }}
      title={t("Customize: language and theme", "Personalizar: idioma y tema")}
      aria-label={t("Customize: language and theme", "Personalizar: idioma y tema")}
    >
      🎨{soloIcono ? null : <> {t("Customize", "Personalizar")}</>}
    </Link>
  );
  const signout = (
    <form action="/auth/signout" method="post">
      <button type="submit" role="menuitem" className="col-opt" style={{ width: "100%", textAlign: "left" }}>
        {t("Sign out", "Salir")}
      </button>
    </form>
  );

  return (
    <BarraDeApp nombre={marca} deliveriesRole={deliveriesRole} moduleAccess={moduleAccess}>
        <nav className="tabs">
          {pestanas.map((i) => (
            <Link key={i.href} href={i.href} className={"tab" + (i.href === encendida ? " active" : "")}>
              {i.label}
            </Link>
          ))}
        </nav>
        <BotonRecargar titulo={t("Reload", "Recargar")} />
        <MenuDeCuenta nombre={fullName ?? email}>
          {() => (
            <>
              <div className="col-opt" style={{ cursor: "default", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Badge className={roleStyles[role] ?? roleStyles.staff}>{pastilla}</Badge>
                  {!otra && (
                    <span
                      className="text-xs text-slate-400"
                      title={t("Cost & margin visibility is enforced at the database (#29)", "La visibilidad de costo y margen la impone la base de datos (#29)")}
                    >
                      {cost ? t("cost visible", "costo visible") : t("cost hidden", "costo oculto")}
                    </span>
                  )}
                </span>
                <span className="text-xs text-slate-400" style={{ wordBreak: "break-all" }}>{email}</span>
              </div>
              {personalizar(false)}{signout}
            </>
          )}
        </MenuDeCuenta>
    </BarraDeApp>
  );
}

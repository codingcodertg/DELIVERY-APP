"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { esGerenteDeTienda, pestanasVisibles } from "@/lib/recruiting/vista-del-gerente";
import { TABS, ROLE_INFO } from "@/lib/recruiting/constants";
import { useData } from "@/lib/recruiting-data-provider";
import { usePrefs } from "@/lib/prefs";
import { GlobalSearch } from "@/components/recruiting/GlobalSearch";
import { ModuleSwitcher } from "@/components/ModuleSwitcher";
import { BarraDeApp } from "@/components/BarraDeApp";
import { OPCIONES_DEL_MENU_RRHH } from "@/lib/account-menu";
import { MenuDeCuenta, OpcionPersonalizar, OpcionSalir } from "@/components/MenuDeCuenta";
import type { Profile } from "@/lib/recruiting/types";
import type { UserRole } from "@/lib/types";

const TAB_ES: Record<string, string> = {
  today: "📋 Hoy", calls: "📞 Llamadas pendientes", employees: "👤 Empleados", candidates: "👥 Candidatos", board: "🗂 Tablero", outcomes: "🤝 Resultados", questions: "❓ Preguntas",
  metrics: "📊 Métricas", calendar: "📅 Calendario", settings: "⚙️ Ajustes",
};
const ROLE_ES: Record<string, string> = { admin: "Admin", manager: "Gerente", recruiter: "Reclutador", store_manager: "Gerente de tienda" };

// deliveriesRole/moduleAccess are deliveries' own columns on the shared
// profiles row, threaded through separately from `me` (recruiting's own
// Profile type, where `role` means recruiting_role) — see ModuleSwitcher.tsx.
export function TopBar({ me, deliveriesRole, moduleAccess }: { me: Profile; deliveriesRole: UserRole; moduleAccess: string[] | null | undefined }) {
  const pathname = usePathname();
  const router = useRouter();
  const { settings, recruiters } = useData();
  // El gerente de tienda solo tiene Candidatos (D-600): cualquier otra ruta del módulo lo devuelve ahí.
  useEffect(() => {
    if (esGerenteDeTienda(me.role) && pathname !== "/recruiting") router.replace("/recruiting");
  }, [me.role, pathname, router]);
  const { lang } = usePrefs();
  const role = ROLE_INFO[me.role];
  const avatar = recruiters.find((r) => r.id === me.id)?.avatar_url ?? me.avatar_url ?? null;

  return (
    // La barra de todas las apps (D-643): el nombre con la casa pegada a la izquierda, como Entregas, y aquí dentro lo
    // de la derecha. La casa vivía en `ModuleSwitcher`, a la derecha; ahí queda solo el ⇄. La caja de la derecha es la
    // de Entregas (`.entregas-barra-resto`), con el mismo `min-width: 0` que esta fila llevaba en línea (D-054).
    // En el teléfono esa caja se deshace y las pestañas bajan a su fila (D-545); el buscador y la etiqueta del rol
    // bajan detrás de ellas (`entregas-tras-pestanas`) para que la fila del nombre no se desborde.
    <BarraDeApp nombre={settings.app_name || "RTG·HR"} deliveriesRole={deliveriesRole} moduleAccess={moduleAccess}>
        <div className="entregas-tras-pestanas"><GlobalSearch /></div>
        <div className="tabs">
          {pestanasVisibles(TABS, me.role).map((t) => {
            {/* "/recruiting" (candidates) needs an exact match — a plain
                startsWith would also light it up on /recruiting/board etc. */}
            const active = t.href === "/recruiting" ? pathname === "/recruiting" : pathname.startsWith(t.href);
            return (
              <Link key={t.id} href={t.href} className={"tab " + (active ? "active" : "")}>
                {lang === "es" ? TAB_ES[t.id] ?? t.label : t.label}
              </Link>
            );
          })}
        </div>
        <ModuleSwitcher current="recruiting" deliveriesRole={deliveriesRole} moduleAccess={moduleAccess} />
        {/* El nombre abre el menú de la cuenta, el mismo de Entregas y Time Tracker (D-490). Se llevó
            el botón ES/EN —el idioma se elige en «Personalizar», en el hub— y el «Salir» suelto. La
            etiqueta del rol se queda: el dueño pidió quitarla en Time Tracker, no aquí. */}
        <MenuDeCuenta nombre={me.full_name ?? ""} foto={avatar}>
          {(cierraMenu) => OPCIONES_DEL_MENU_RRHH.map((o) => {
            switch (o) {
              case "personalizar":
                return <OpcionPersonalizar key={o} alPulsar={cierraMenu} />;
              case "salir":
                return <OpcionSalir key={o} />;
            }
          })}
        </MenuDeCuenta>
        {role && <span className="sema entregas-tras-pestanas" style={{ background: role.color + "33", color: "#fff" }}>{lang === "es" ? ROLE_ES[me.role] : role.label}</span>}
    </BarraDeApp>
  );
}

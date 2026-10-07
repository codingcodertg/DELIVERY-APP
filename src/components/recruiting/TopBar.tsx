"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TABS, ROLE_INFO } from "@/lib/recruiting/constants";
import { useData } from "@/lib/recruiting-data-provider";
import { usePrefs } from "@/lib/prefs";
import { GlobalSearch } from "@/components/recruiting/GlobalSearch";
import { ModuleSwitcher } from "@/components/ModuleSwitcher";
import { OPCIONES_DEL_MENU_RRHH } from "@/lib/account-menu";
import { MenuDeCuenta, OpcionPersonalizar, OpcionSalir } from "@/components/MenuDeCuenta";
import type { Profile } from "@/lib/recruiting/types";
import type { UserRole } from "@/lib/types";

const TAB_ES: Record<string, string> = {
  today: "🏠 Hoy", employees: "👤 Empleados", candidates: "👥 Candidatos", board: "🗂 Tablero", outcomes: "🤝 Resultados", questions: "❓ Preguntas",
  metrics: "📊 Métricas", calendar: "📅 Calendario", settings: "⚙️ Ajustes",
};
const ROLE_ES: Record<string, string> = { admin: "Admin", manager: "Gerente", recruiter: "Reclutador" };

// deliveriesRole/moduleAccess are deliveries' own columns on the shared
// profiles row, threaded through separately from `me` (recruiting's own
// Profile type, where `role` means recruiting_role) — see ModuleSwitcher.tsx.
export function TopBar({ me, deliveriesRole, moduleAccess }: { me: Profile; deliveriesRole: UserRole; moduleAccess: string[] | null | undefined }) {
  const pathname = usePathname();
  const { settings, recruiters } = useData();
  const { lang } = usePrefs();
  const role = ROLE_INFO[me.role];
  const avatar = recruiters.find((r) => r.id === me.id)?.avatar_url ?? me.avatar_url ?? null;

  return (
    <div className="topbar">
      <h1>{settings.app_name || "RTG·HR"}</h1>
      {/* Same fix as deliveries' own TopBar.tsx, same reason: min-width:
          auto (the flex default) refuses to shrink this row below its
          widest unbreakable child, pushing siblings off-screen instead of
          wrapping. See D-054 follow-up. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
        <GlobalSearch />
        <div className="tabs">
          {TABS.filter((t) => (!t.adminOnly || me.role === "admin") && (!t.roles || t.roles.includes(me.role))).map((t) => {
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
        {role && <span className="sema" style={{ background: role.color + "33", color: "#fff" }}>{lang === "es" ? ROLE_ES[me.role] : role.label}</span>}
      </div>
    </div>
  );
}

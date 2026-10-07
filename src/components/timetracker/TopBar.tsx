"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { pestanasPara } from "@/lib/timetracker/vista-empleado";
import { useData } from "@/lib/timetracker-data-provider";
import { useT } from "@/lib/timetracker/i18n";
import { OPCIONES_DEL_MENU_TT } from "@/lib/account-menu";
import { BotonRecargar } from "@/components/BotonRecargar";
import { HubHomeLink } from "@/components/HubHomeLink";
import { MenuDeCuenta, OpcionPersonalizar, OpcionSalir } from "@/components/MenuDeCuenta";
import { NotificationBell } from "@/components/timetracker/NotificationBell";
import { TtCheckUpdateLink } from "@/components/timetracker/UpdateBanner";
import { AvisoDeCapacitacion, useCapacitacion } from "@/components/timetracker/Capacitacion";
import type { UserRole } from "@/lib/types";

/**
 * La barra de Time Tracker, como la de Entregas (D-490).
 *
 * El dueño, el 2026-10-07, mirando el perfil de un empleado: «hay demasiados botones […] quiero que sea
 * igual que el Delivery app. Que […] si aprietas el nombre de Carlos Fuentes, te sale Sign Out. Y
 * teaching mode […] Eso que sale employee, tampoco quiero que se mire. Y las notificaciones, eso sí, se
 * queda. Pero el botón para español y dark mode […] todo eso se elige desde su personalizar».
 *
 * Lo que queda en la barra: el nombre de la app con la casa al lado (como Entregas, D-274), las
 * pestañas, recargar (como Entregas), la campana, el ⟳ del escritorio, y **el nombre, que abre el menú**
 * de Entregas —el mismo componente, `MenuDeCuenta`— con lo que dice `OPCIONES_DEL_MENU_TT`: modo
 * capacitación, Mi cuenta, Personalizar y Cerrar sesión.
 *
 * Lo que se fue: la pastilla «Employee»/«Manager», el ES/EN, el 🌙 (al personalizador del hub), el
 * «Sign out» suelto (al menú) y el selector de módulos ⇄ (como en Entregas: se cambia de app desde el
 * hub, y la casa sigue). Encima de la barra, pegado a ella, el aviso del modo capacitación mientras dure.
 */
// deliveriesRole/moduleAccess threaded through separately from `me`
// (timetracker's own Employee type, where `role` means timetracker_role) —
// same pattern recruiting/TopBar.tsx already uses, same reason: `me.role`
// inside this module must never collide with the deliveries role (D-052's
// #1/#2 bug class).
export function TopBar({ deliveriesRole, moduleAccess }: { deliveriesRole: UserRole; moduleAccess: string[] | null | undefined }) {
  const pathname = usePathname();
  const { me, settings, listLiveSessions, notify } = useData();
  const t = useT();
  const capacitacion = useCapacitacion();
  // Admin: MANAGER_TABS. Empleado: TABS, ya sin «Mi diario» (D-489).
  const tabs = pestanasPara(me.role);

  /**
   * Encender la práctica con el cronómetro corriendo de verdad no se deja: encenderla vuelve a montar
   * Time Tracker, y un cronómetro real que se desmonta deja de latir —es el registro que el dueño
   * perdió en D-470—. Si no se puede comprobar, tampoco: ante la duda, lo real manda.
   */
  const alternaCapacitacion = async () => {
    if (capacitacion.activa) { capacitacion.apagar(); return; }
    try {
      if ((await listLiveSessions()).length > 0) { notify(t("training.timerRunning")); return; }
    } catch {
      notify(t("training.checkFail"));
      return;
    }
    capacitacion.encender();
  };

  return (
    <div className="tt-cabecera">
      <AvisoDeCapacitacion />
      <div className="topbar">
        {/* La casa va pegada al nombre de la app, como en Entregas (D-274). */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <div className="brand">{settings.appName || "TimeTracker"}</div>
          <HubHomeLink deliveriesRole={deliveriesRole} moduleAccess={moduleAccess} />
        </div>
        <div className="row" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <div className="tabs">
            {tabs.map((tb, i) => {
              const active = tb.href === "/timetracker" ? pathname === "/timetracker" : pathname.startsWith(tb.href);
              // For an admin, MANAGER_TABS packs 10 manager screens ahead of
              // the 5 personal ones everyone gets — a thin divider marks
              // where "manager tools" ends and "my own stuff" begins, so 15
              // flat tabs don't read as one undifferentiated wall.
              const startsPersonal = tb.id === "track" && i > 0;
              return (
                <span key={tb.id} style={{ display: "inline-flex", alignItems: "center" }}>
                  {startsPersonal && <span style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,.15)", margin: "0 6px" }} />}
                  <Link href={tb.href} className={active ? "active" : ""}>
                    {t("tab." + tb.id)}
                  </Link>
                </span>
              );
            })}
          </div>
          <BotonRecargar titulo={t("shell.reload")} className="btn-ghost btn-sm tt-recargar" />
          <NotificationBell />
          <TtCheckUpdateLink />
          {/* El nombre abre el menú (D-490). De D-160 a D-490 llevaba a «Mi cuenta», que ahora es
              una opción del menú; y al lado iba la pastilla del rol, que el dueño pidió quitar. */}
          <MenuDeCuenta nombre={me.fullName}>
            {(cierraMenu) => OPCIONES_DEL_MENU_TT.map((o) => {
              switch (o) {
                case "capacitacion":
                  return (
                    <button
                      key={o}
                      type="button"
                      className="col-opt"
                      role="menuitemcheckbox"
                      aria-checked={!!capacitacion.activa}
                      style={{ width: "100%", textAlign: "left" }}
                      title={t("training.menuHint")}
                      onClick={() => { cierraMenu(); void alternaCapacitacion(); }}
                    >
                      {capacitacion.activa ? t("training.menuOff") : t("training.menu")}
                    </button>
                  );
                case "cuenta":
                  return (
                    <Link key={o} href="/timetracker/account" role="menuitem" className="col-opt" style={{ textDecoration: "none" }} onClick={cierraMenu}>
                      {t("menu.account")}
                    </Link>
                  );
                case "personalizar":
                  return <OpcionPersonalizar key={o} alPulsar={cierraMenu} />;
                case "salir":
                  return <OpcionSalir key={o} />;
              }
            })}
          </MenuDeCuenta>
        </div>
      </div>
    </div>
  );
}

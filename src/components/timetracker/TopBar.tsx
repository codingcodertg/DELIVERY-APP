"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { barraDeTt, claveCorta, claveDelRotulo, esPestanaActiva, opcionesDelMenuMio } from "@/lib/timetracker/barra";
import { useData } from "@/lib/timetracker-data-provider";
import { useT } from "@/lib/timetracker/i18n";
import { OPCIONES_DEL_MENU_TT } from "@/lib/account-menu";
import { BotonRecargar } from "@/components/BotonRecargar";
import { BarraDeApp } from "@/components/BarraDeApp";
import { MenuDeCuenta, OpcionPersonalizar, OpcionSalir } from "@/components/MenuDeCuenta";
import { MenuDeAcciones } from "@/components/MenuDeAcciones";
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
 * Lo que queda en la barra (`BarraDeApp` desde D-643, la misma de todas las apps): el nombre de la app con la casa
 * al lado (como Entregas, D-274), las
 * pestañas, recargar (como Entregas), la campana, el ⟳ del escritorio, y **el nombre, que abre el menú**
 * de Entregas —el mismo componente, `MenuDeCuenta`— con lo que dice `OPCIONES_DEL_MENU_TT`: modo
 * capacitación, Mi cuenta, Personalizar y Cerrar sesión.
 *
 * Lo que se fue: la pastilla «Employee»/«Manager», el ES/EN, el 🌙 (al personalizador del hub), el
 * «Sign out» suelto (al menú) y el selector de módulos ⇄ (como en Entregas: se cambia de app desde el
 * hub, y la casa sigue). Encima de la barra, pegado a ella, el aviso del modo capacitación mientras dure.
 *
 * Las pestañas del admin, desde D-528: las ocho de gestión en fila y, en lugar de Ajustes y sus cuatro personales
 * sueltas, un solo «👤 Mío ▾» (`barraDeTt`, `lib/timetracker/barra.ts`). El dueño, el 2026-10-11: «ajustes, tegistrar
 * tiempo mi semana mi solicitus y mi diaro que vayan en un solo boton dropdwow».
 */
// deliveriesRole/moduleAccess threaded through separately from `me`
// (timetracker's own Employee type, where `role` means timetracker_role) —
// same pattern recruiting/TopBar.tsx already uses, same reason: `me.role`
// inside this module must never collide with the deliveries role (D-052's
// #1/#2 bug class).
export function TopBar({ deliveriesRole, moduleAccess }: { deliveriesRole: UserRole; moduleAccess: string[] | null | undefined }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, settings, listLiveSessions, notify } = useData();
  const t = useT();
  const capacitacion = useCapacitacion();
  // Empleado (y gerente): TABS en fila, ya sin «Mi diario» (D-489). Admin: las ocho de gestión de MANAGER_TABS en
  // fila, y sus cuatro personales y Ajustes dentro de «👤 Mío ▾» (D-528).
  const barra = barraDeTt(me.role, pathname);

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
      <BarraDeApp nombre={settings.appName || "TimeTracker"} deliveriesRole={deliveriesRole} moduleAccess={moduleAccess} claseDelResto="tt-barra-resto">
        {/* La barra de todas las apps (D-643): el nombre con la casa pegada, como en Entregas (D-274), con su mismo
            tamaño —el nombre era un `.brand` con su letra propia y su `line-height` de 1.45—. Aquí dentro, lo de la
            derecha. En el teléfono (≤ 520 px) la barra va en DOS filas (D-528): arriba el nombre de la app, la casa, la
            campana y solo la burbuja con las iniciales; debajo, las pestañas. Para eso la caja de la derecha deja de ser
            una caja (`display: contents`) y sus piezas se colocan con `order`; `tt-barra-resto` le pone encima lo propio
            de Time Tracker (timetracker.css). En el escritorio, como estaba. */}
          <div className={"tabs" + (barra.enUnaFila ? " tt-una-fila" : "")}>
            {barra.fila.map((tb) => (
              <Link key={tb.id} href={tb.href} className={esPestanaActiva(tb.href, pathname) ? "active" : ""}>
                {barra.enUnaFila ? (
                  // Los dos nombres; el CSS enseña el corto solo en el teléfono, donde las tres van en una fila.
                  <>
                    <span className="tt-nombre-largo">{t("tab." + tb.id)}</span>
                    <span className="tt-nombre-corto">{t(claveCorta(tb.id))}</span>
                  </>
                ) : t("tab." + tb.id)}
              </Link>
            ))}
            {/* «👤 Mío ▾» (D-528): Registrar tiempo, Mi semana, Mis solicitudes, Mi diario y Ajustes del admin,
                en un solo desplegable —el `MenuDeAcciones` de la ficha (D-497) y de «Mis acciones» (D-517)—.
                Ocupa el sitio de la raya que separaba las de gestión de las personales. Dentro de una de esas
                pantallas dice su nombre y se resalta como la pestaña activa. Sin opciones no pinta nada: el
                empleado y el gerente siguen con sus tres pestañas sueltas. */}
            <MenuDeAcciones
              rotulo={t(claveDelRotulo(barra))}
              className={"tt-menu-mio" + (barra.activaDelMenu ? " active" : "")}
              opciones={opcionesDelMenuMio(barra, t, (href) => router.push(href))}
            />
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
      </BarraDeApp>
    </div>
  );
}

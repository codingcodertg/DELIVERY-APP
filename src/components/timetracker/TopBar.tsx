"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { barraDeTt, claveCorta, claveDelRotulo, esPestanaActiva, opcionesDelMenuMio } from "@/lib/timetracker/barra";
import { useData } from "@/lib/timetracker-data-provider";
import { useT } from "@/lib/timetracker/i18n";
import { OPCIONES_DEL_MENU_TT } from "@/lib/account-menu";
import { BarraDeApp } from "@/components/BarraDeApp";
import { MenuDeCuenta, OpcionSalir } from "@/components/MenuDeCuenta";
import { MenuDeAcciones } from "@/components/MenuDeAcciones";
import { NotificationBell } from "@/components/timetracker/NotificationBell";
import { AvisoDeCapacitacion } from "@/components/timetracker/Capacitacion";
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
 * pestañas, la campana, y **el nombre, que abre el menú** de Entregas —el mismo componente, `MenuDeCuenta`— con lo
 * que dice `OPCIONES_DEL_MENU_TT`: desde D-NEXT (2026-10-29), solo Cerrar sesión.
 *
 * **D-NEXT:** fuera los dos botones de recargar («Recargar la app» y el ⟳ del escritorio, que buscaba actualización) y
 * del menú del nombre, el modo capacitación, Mi cuenta y Personalizar. El dueño: «hay dos botones de recargar la app.
 * Quitas los dos botones, ninguno de los dos se ocupa … ahí no debería haber nada más que eso, solo cerrar la sesión».
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
  const { me, settings } = useData();
  const t = useT();
  // Empleado (y gerente): TABS en fila, ya sin «Mi diario» (D-489). Admin: las ocho de gestión de MANAGER_TABS en
  // fila, y sus cuatro personales y Ajustes dentro de «👤 Mío ▾» (D-528).
  const barra = barraDeTt(me.role, pathname);

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
          <NotificationBell />
          {/* El nombre abre el menú (D-490); desde D-NEXT solo con «Cerrar sesión». */}
          <MenuDeCuenta nombre={me.fullName}>
            {() => OPCIONES_DEL_MENU_TT.map((o) => {
              switch (o) {
                case "salir":
                  return <OpcionSalir key={o} />;
              }
            })}
          </MenuDeCuenta>
      </BarraDeApp>
    </div>
  );
}

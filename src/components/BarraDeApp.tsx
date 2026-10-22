"use client";

import { HubHomeLink } from "@/components/HubHomeLink";
import { MenuDeCuenta, OpcionPersonalizar, OpcionSalir } from "@/components/MenuDeCuenta";
import { usePrefs } from "@/lib/prefs";
import type { UserRole } from "@/lib/types";

/**
 * LA barra de arriba de todas las apps (D-643): la de Entregas.
 *
 * El dueño, el 2026-10-22, con la barra de Entregas delante: «Quiero que así sea el header de todas. Todos. De ERP,
 * de HR. Todo con su casita del lado izquierdo, del mismo tamaño. […] Porque HR tiene la casa por acá, ERP tiene por
 * acá. Entonces quiero que todo sea igual.»
 *
 * Hasta aquí cada app montaba su barra a mano: Entregas y Time Tracker con `HubHomeLink` junto al nombre (D-274,
 * D-490), RR. HH. con la casa dentro de `ModuleSwitcher` y a la derecha, el ERP con una copia de la casa condicionada a
 * mano, y Leads, Encuestas, el Cotizador y Promos sin barra, con un botón «◂ Volver al hub». Ahora todas montan ESTE
 * componente: el fondo `.topbar`; a la izquierda el nombre de la app con la casa pegada —la misma `HubHomeLink`, que
 * decide con `canReachHub`—; y a la derecha lo que cada app pone dentro (`children`): sus pestañas, su campana, su
 * menú del nombre. Los tamaños (alto, letra del nombre, casa) viven en globals.css, en `.topbar` y `.entregas-marca`,
 * y ninguna app los repite. `barra-igual.test.ts` recorre las apps y exige que cada barra sea esta.
 *
 * Las clases conservan el nombre de Entregas (`entregas-marca`, `entregas-barra-resto`): las reglas del teléfono
 * (D-545) ya colgaban de ellas, y el ERP las usaba desde D-622.
 */
export function BarraDeApp({ nombre, deliveriesRole, moduleAccess, claseDelResto, children }: {
  nombre: string;
  /** El rol de ENTREGAS (la columna `role`), nunca el de la app: es el que decide la casa (ver `ModuleSwitcher`). */
  deliveriesRole: UserRole;
  moduleAccess: string[] | null | undefined;
  /** Una clase más para la caja de la derecha, para la app que tiene reglas propias encima (Time Tracker, D-528). */
  claseDelResto?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="topbar">
      <div className="entregas-marca">
        <h1>{nombre}</h1>
        <HubHomeLink deliveriesRole={deliveriesRole} moduleAccess={moduleAccess} />
      </div>
      <div className={"entregas-barra-resto" + (claseDelResto ? " " + claseDelResto : "")}>{children}</div>
    </div>
  );
}

/**
 * La barra de las apps que no tenían ninguna —Leads, Encuestas, el Cotizador y Promos—: la misma, con el nombre en los
 * dos idiomas y, a la derecha, solo el menú del nombre con Personalizar y Cerrar sesión, como RR. HH. La monta el
 * layout de cada una, que es de servidor y ya lee el rol y los módulos para su puerta; esto es de cliente porque el
 * idioma sale de `usePrefs`.
 */
export function BarraSencilla({ nombre, deliveriesRole, moduleAccess, persona }: {
  nombre: readonly [en: string, es: string];
  deliveriesRole: UserRole;
  moduleAccess: string[] | null | undefined;
  persona: string;
}) {
  const { t } = usePrefs();
  return (
    <BarraDeApp nombre={t(nombre[0], nombre[1])} deliveriesRole={deliveriesRole} moduleAccess={moduleAccess}>
      <MenuDeCuenta nombre={persona}>
        {(cierraMenu) => (
          <>
            <OpcionPersonalizar alPulsar={cierraMenu} />
            <OpcionSalir />
          </>
        )}
      </MenuDeCuenta>
    </BarraDeApp>
  );
}

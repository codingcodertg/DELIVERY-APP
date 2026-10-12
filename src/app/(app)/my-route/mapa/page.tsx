"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import RoutesPage from "@/app/(app)/routes/page";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { canDeliver } from "@/lib/constants";
import { SoloLectura } from "@/lib/gestor/solo-lectura";
import { SoloMisRutas } from "@/lib/gestor/solo-mis-rutas";
import { choferDelMapa } from "@/lib/gestor/chofer-del-mapa";
import { IrAlInicio } from "@/components/TabGate";

// ============================================================
// «🗺 El mapa de mi ruta» (D-506) — el MISMO mapa del Gestor de Rutas, con SUS rutas.
//
// El dueño (dictado, literal): «drivers view needs to look like to logistic manager view with the routes and
// everything the map view i mean change it and updat eit»; preguntado por la pantalla y el alcance: «quiero que el chofer
// mire el mapa con sus rutas asi como el logistic manager ese mismo mapa».
//
// No es una copia: es la página del Gestor (`routes/page.tsx`) montada dentro de `<SoloLectura>` (D-481: ni asignar, ni
// mover, ni optimizar, ni armar rutas) y de `<SoloMisRutas>` (`lib/gestor/mis-rutas`), que la acota a las rutas de este
// chofer. El acotado va en el origen —las órdenes, los carriles, los camiones en vivo— y no en el filtro de casillas, así
// que desde la pantalla no hay forma de ver la ruta de otro: no está cargada.
//
// **Esto NO revierte D-494** («Ruta de hoy» fuera para el chofer). Aquella pestaña enseñaba las rutas de TODOS; esto enseña
// solo las suyas, no es una pestaña de la barra (`TABS` no cambia) y se entra desde «Mi ruta». La URL cae bajo `/my-route`,
// así que `TabGate` la deja pasar o la cierra exactamente como a «Mi ruta» (`tabForPath`, D-240/D-480).
//
// «Mi ruta» (`/my-route`) sigue entera y es donde se trabaja: la siguiente parada, los botones de cada parada (D-487),
// entregar y rechazar con razón (D-495) y el aviso de ruta cambiada (D-341). Esta pantalla no sustituye nada de eso: añade
// la vista de mapa del Gestor, que allí no había. Desde aquí no se cierra ninguna parada — para eso se vuelve.
//
// **D-NEXT (2026-10-11): ya no la enlaza nadie.** «Mi ruta» quitó su botón «🗓 Ver la ruta completa» («FULL ROUTE VIEW
// PLEASE QUITALO DEL DRIVER VIEW»). La pantalla sigue existiendo y se abre por su dirección; borrarla es otra decisión.
// ============================================================
export default function MiMapaPage() {
  const { me, users } = useData();
  const { t } = usePrefs();
  const searchParams = useSearchParams();
  // De quién es este mapa (D-508). Va en la URL porque el enlace cruza de pantalla y el contexto de React no viaja con
  // él. Quién puede pedir el de OTRO no lo decide el enlace: lo vuelve a decidir aquí `choferDelMapa`, con la misma
  // regla que abre la pestaña «Chofer» (D-502). Quien no pueda, recibe el suyo.
  const delMapa = choferDelMapa(me, searchParams.get("chofer"), users);

  if (!me || !delMapa) return null;
  // La misma puerta que «Mi ruta»: esta pantalla es la suya, en mapa. Almacén tiene su propia Ruta del día (D-380).
  // Quien no es chofer va a su pantalla de inicio en vez de quedarse con «No disponible» (D-NEXT, `IrAlInicio`).
  if (!canDeliver(me) || me.role === "warehouse") {
    return <IrAlInicio />;
  }

  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <Link className="btn btn-ghost btn-sm" data-volver-a-mi-ruta href="/my-route">
          ◀ {t("My route", "Mi ruta")}
        </Link>
        {/* De quién es, cuando no es la propia: el admin revisando la pestaña «Chofer» tiene que saber a quién mira. */}
        {delMapa.id !== me.id && (
          <span className="hint" style={{ marginLeft: 8 }}>
            {t(`Route of ${delMapa.full_name}`, `Ruta de ${delMapa.full_name}`)}
          </span>
        )}
      </div>
      <SoloMisRutas chofer={delMapa.full_name}>
        <SoloLectura><RoutesPage /></SoloLectura>
      </SoloMisRutas>
    </>
  );
}

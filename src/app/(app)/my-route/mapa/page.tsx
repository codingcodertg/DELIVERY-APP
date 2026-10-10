"use client";

import Link from "next/link";
import RoutesPage from "@/app/(app)/routes/page";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { canDeliver } from "@/lib/constants";
import { SoloLectura } from "@/lib/gestor/solo-lectura";
import { SoloMisRutas } from "@/lib/gestor/solo-mis-rutas";

// ============================================================
// «🗺 El mapa de mi ruta» (D-NEXT) — el MISMO mapa del Gestor de Rutas, con SUS rutas.
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
// ============================================================
export default function MiMapaPage() {
  const { me } = useData();
  const { t } = usePrefs();

  if (!me) return null;
  // La misma puerta que «Mi ruta»: esta pantalla es la suya, en mapa. Almacén tiene su propia Ruta del día (D-380).
  if (!canDeliver(me) || me.role === "warehouse") {
    return <div className="empty">{t("Not available for your role.", "No disponible para tu rol.")}</div>;
  }

  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <Link className="btn btn-ghost btn-sm" data-volver-a-mi-ruta href="/my-route">
          ◀ {t("My route", "Mi ruta")}
        </Link>
      </div>
      <SoloMisRutas chofer={me.full_name}>
        <SoloLectura><RoutesPage /></SoloLectura>
      </SoloMisRutas>
    </>
  );
}

"use client";

import { useMemo } from "react";
import type { DayPhoto, PhotoSite } from "@/app/timetracker/clock-in/actions/photos";
import { enlaceMapa, fmtDistancia } from "@/lib/clockin/day-photos";
import { comoFence, estadoFoto } from "@/lib/clockin/photo-map";
import { getLang, useT } from "@/lib/timetracker/i18n";
import { GeofenceMap, type Fence, type MapPoint } from "./GeofenceMap";
import { Modal } from "./Modal";

/**
 * La ventana del mapa de UNA foto (Auditoría → Fotos): la geocerca del sitio de esa foto —solo
 * esa, no las seis—, el punto donde se tomó, y arriba el veredicto que el servidor ya calculó en
 * D-212 (`distanceM`, `siteName`): «Dentro de la geocerca» o «Fuera · a 1,2 km». Aquí no se mide
 * nada: la distancia de la ventana es la misma que la de la línea de debajo de la foto.
 *
 * Este fichero entra en diferido (DayPhotos lo carga con next/dynamic al abrirlo): arrastra el
 * cargador de Google Maps y GeofenceMap, y /timetracker/audit no tiene por qué pagarlos hasta
 * que alguien pulse una ubicación (patrón D-209).
 *
 * Si no hay clave de navegador o el script no carga (hoy la clave está restringida a un dominio
 * viejo), se dice y queda el enlace a Google Maps de D-212 como respaldo: nunca un rectángulo en
 * blanco.
 */
export function PhotoMapModal({ photo, sites, onClose }: { photo: DayPhoto; sites: PhotoSite[]; onClose: () => void }) {
  const t = useT();
  const lang = getLang() === "es" ? "es" : "en";
  const e = useMemo(() => estadoFoto(photo, sites), [photo, sites]);

  // Memoizados: GeofenceMap reconstruye el mapa (una carga de Maps facturable) cuando cambian
  // `fences` o `points`, y un array inline sería uno nuevo en cada re-render de esta ventana.
  const fences = useMemo<Fence[]>(() => (e.kind === "dentro" || e.kind === "fuera" ? [comoFence(e.site)] : []), [e]);
  const points = useMemo<MapPoint[]>(() => {
    if (e.kind === "sinCoords") return [];
    const label = e.kind === "fuera" ? fmtDistancia(e.distanceM, lang) : photo.who;
    return [{ lat: e.lat, lng: e.lng, label, inside: e.kind === "dentro" }];
  }, [e, lang, photo.who]);

  if (e.kind === "sinCoords") return null; // la línea no es pulsable sin coordenadas

  const veredicto =
    e.kind === "dentro" ? t("mgr.photos.mapInside", { site: e.site.name })
    : e.kind === "fuera" ? t("mgr.photos.mapOutside", { d: fmtDistancia(e.distanceM, lang), site: e.site.name })
    : t("mgr.photos.mapNoSite");
  const enlace = enlaceMapa(e.lat, e.lng);

  return (
    <Modal title={t("mgr.photos.mapTitle")} onClose={onClose} maxWidth={720}>
      <p className={`banner ${e.kind === "fuera" ? "warn" : e.kind === "dentro" ? "ok" : "info"}`} style={{ marginTop: 0 }}>
        {veredicto}
      </p>
      <GeofenceMap
        fences={fences}
        points={points}
        height={360}
        fallback={(message) => (
          <div className="banner warn" style={{ marginTop: 0 }}>
            <div>{t("mgr.photos.mapFailed")}</div>
            <div className="small muted">{message}</div>
            <a href={enlace} target="_blank" rel="noopener noreferrer">{t("mgr.photos.openMap")}</a>
          </div>
        )}
      />
      <p className="small muted" style={{ marginBottom: 0 }}>
        <a href={enlace} target="_blank" rel="noopener noreferrer">{t("mgr.photos.openMap")}</a>
        {" · "}{e.lat.toFixed(5)}, {e.lng.toFixed(5)}
      </p>
    </Modal>
  );
}

export default PhotoMapModal;

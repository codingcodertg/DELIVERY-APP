"use client";

import { useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { mapLink } from "@/lib/geo";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { usePausasDelChofer } from "@/lib/usePausasDelChofer";
import { minutosDePausa, nombreDelMotivo } from "@/lib/pausas-del-chofer";

/**
 * Las paradas que el chofer REGISTRÓ ese día —baño, gasolina, comida, tráfico— con su recibo, para logística y admin
 * (D-NEXT). Va en el Recorrido del chofer (`/track`), que es donde ya se revisa su día, encima de las paradas que se
 * deducen del GPS: estas las dijo él, aquellas se reconstruyen.
 *
 * Quién la ve lo decide la pestaña (admin, gerente, logística) y, en la base, la RLS de la 167. Sin la 167 aplicada lo
 * dice en una línea en vez de enseñar una lista vacía que parezca «no paró nunca».
 */
export function PausasDelDia({ driverId, fecha, clock }: { driverId: string; fecha: string; clock: (iso: string | null) => string }) {
  const { teaching } = useData();
  const { t, lang } = usePrefs();
  const { pausas, estado } = usePausasDelChofer(driverId, fecha, { practica: teaching });
  const [viendo, setViendo] = useState<string | null>(null);
  const fmtMin = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);

  return (
    <div className="card" data-pausas-del-dia>
      <h2>⏸ {t("Stops the driver logged", "Paradas que registró el chofer")}<span className="count-tag">{pausas.length}</span></h2>
      {estado === "sin-tabla" ? (
        <div className="empty">{t("Not available yet: the database is missing its update (migration 167).", "Aún no disponible: a la base le falta su actualización (migración 167).")}</div>
      ) : estado === "error" ? (
        <div className="empty">{t("Couldn't read the logged stops.", "No se pudieron leer las paradas registradas.")}</div>
      ) : estado === "cargando" ? (
        <div className="empty">{t("Loading…", "Cargando…")}</div>
      ) : pausas.length === 0 ? (
        <div className="empty">{t("The driver didn't log any stop that day.", "El chofer no registró ninguna parada ese día.")}</div>
      ) : (
        <div className="tbl-scroll">
          <table className="orders">
            <thead>
              <tr>
                <th>{t("Why", "Motivo")}</th>
                <th>{t("From", "Desde")}</th>
                <th>{t("Until", "Hasta")}</th>
                <th>{t("Time", "Tiempo")}</th>
                <th>{t("Note", "Nota")}</th>
                <th>{t("Where", "Dónde")}</th>
                <th>{t("Receipt", "Recibo")}</th>
              </tr>
            </thead>
            <tbody>
              {pausas.map((p) => (
                <tr key={p.id} data-pausa={p.motivo}>
                  <td><b>{nombreDelMotivo(p.motivo, lang)}</b></td>
                  <td>{clock(p.empezo_at)}</td>
                  <td>{p.termino_at ? clock(p.termino_at) : <b style={{ color: "var(--amber-text)" }}>{t("still stopped", "sigue parado")}</b>}</td>
                  <td>{fmtMin(minutosDePausa(p))}</td>
                  <td>{p.nota ?? "—"}</td>
                  <td>{p.lat != null && p.lng != null ? <a href={mapLink(p.lat, p.lng)} target="_blank" rel="noopener noreferrer">📍 {t("Map", "Mapa")}</a> : "—"}</td>
                  <td data-recibo>
                    {p.recibo_foto ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.recibo_foto} alt={t("Gas receipt", "Recibo de gasolina")} onClick={() => setViendo(p.recibo_foto)}
                        style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, cursor: "pointer", verticalAlign: "middle" }} />
                    ) : p.sin_recibo ? <span className="hint" style={{ margin: 0 }}>{t("No receipt (driver said)", "Sin recibo (lo dijo el chofer)")}</span> : null}
                    {p.recibo_monto != null && <span style={{ marginLeft: 6 }}>${Number(p.recibo_monto).toFixed(2)}</span>}
                    {p.recibo_galones != null && <span className="hint" style={{ marginLeft: 6 }}>{p.recibo_galones} gal</span>}
                    {!p.recibo_foto && !p.sin_recibo && p.recibo_monto == null && p.recibo_galones == null && "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {viendo && <PhotoLightbox photos={[viendo]} index={0} onIndex={() => {}} onClose={() => setViendo(null)} t={t} />}
    </div>
  );
}

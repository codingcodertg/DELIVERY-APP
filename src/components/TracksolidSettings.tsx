"use client";

import { useState } from "react";
import { soloActivos } from "@/lib/baja";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { colorDeChofer } from "@/lib/map-legend";
import { COLOR_DE_CAMION_SIN_CHOFER, textoDelCamion, type CamionDeTracksolid } from "@/lib/tracksolid/camiones";
import { useCamionesDeTracksolid } from "@/lib/tracksolid/useCamiones";

/**
 * Ajustes → «Camiones (rastreadores GPS)» — D-NEXT. Solo el admin (la página ya lo exige, y la ruta también).
 *
 * Cada rastreador de la cuenta de TrackSolid, con dos listas: de qué chofer es y cuál es su tienda base.
 * Enlazado, el camión sale en el mapa del Gestor con el nombre y el color de ese chofer. Sin enlazar sale
 * igual, con su nombre de TrackSolid. El enlace vive solo en esta app: en TrackSolid no se cambia nada.
 *
 * Si la instalación no tiene TrackSolid (faltan las variables o la migración 257), la tarjeta no se pinta.
 */
export function TracksolidSettings() {
  const { settings, users, notify } = useData();
  const { t, lang } = usePrefs();
  const { disponible, camiones, atrasado, recarga } = useCamionesDeTracksolid(true);
  const [guardando, setGuardando] = useState<string | null>(null);

  if (!disponible) return null;

  const choferes = soloActivos(users.filter((u) => u.role === "driver")).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const tiendas = settings.stores.map((s) => s.name);
  const ahora = Date.now();

  const guarda = async (c: CamionDeTracksolid, cambio: { driver_id?: string | null; home_store?: string | null }) => {
    setGuardando(c.imei);
    try {
      const r = await fetch("/api/tracksolid/links", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imei: c.imei, device_name: c.nombre, driver_id: c.choferId, home_store: c.tienda, ...cambio }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => null)) as { error?: string } | null;
        notify(j?.error || t("Could not save the link.", "No se pudo guardar el enlace."));
      } else {
        notify(t("Saved", "Guardado"));
      }
    } catch {
      notify(t("Could not save the link.", "No se pudo guardar el enlace."));
    } finally {
      setGuardando(null);
      recarga();
    }
  };

  return (
    <div className="card" data-ajustes-tracksolid>
      <h2>🚛 {t("Trucks (GPS trackers)", "Camiones (rastreadores GPS)")}</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        {t(
          "The GPS trackers installed in the trucks (TrackSolid). Link each one to its driver and home store: on the Routes Manager map the truck then shows the driver's name and route colour. Unlinked trackers still show, with their TrackSolid name. Nothing changes in TrackSolid itself.",
          "Los rastreadores GPS instalados en los camiones (TrackSolid). Enlace cada uno con su chofer y su tienda base: en el mapa del Gestor de Rutas el camión sale entonces con el nombre y el color de ruta del chofer. Los que no estén enlazados salen igual, con su nombre de TrackSolid. En TrackSolid no se cambia nada.",
        )}
      </p>
      {atrasado && <p className="hint" style={{ color: "var(--amber)" }}>{t("TrackSolid isn't answering right now; showing the last reading.", "TrackSolid no contesta ahora; se muestra la última lectura.")}</p>}
      {camiones.length === 0 ? (
        <p className="hint">{t("No trackers found in the TrackSolid account.", "No se encontraron rastreadores en la cuenta de TrackSolid.")}</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="orders" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>{t("Tracker", "Rastreador")}</th>
                <th style={{ textAlign: "left" }}>{t("Status", "Estado")}</th>
                <th style={{ textAlign: "left" }}>{t("Driver", "Chofer")}</th>
                <th style={{ textAlign: "left" }}>{t("Home store", "Tienda base")}</th>
              </tr>
            </thead>
            <tbody>
              {camiones.map((c) => {
                const txt = textoDelCamion(c, ahora, t, lang);
                // Un chofer dado de baja o una tienda renombrada siguen saliendo en la lista, para que se vea qué había.
                const choferFuera = c.choferId && !choferes.some((d) => d.id === c.choferId);
                const tiendaFuera = c.tienda && !tiendas.includes(c.tienda);
                return (
                  <tr key={c.imei} data-rastreador={c.imei}>
                    <td>
                      <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, marginRight: 6, background: c.chofer ? colorDeChofer(settings.driver_colors, c.chofer) : COLOR_DE_CAMION_SIN_CHOFER }} />
                      <b>{c.nombre}</b>
                      <div className="hint" style={{ margin: 0 }}>IMEI {c.imei}</div>
                    </td>
                    <td style={{ color: txt.estado === "stale" ? "var(--red)" : undefined }}>{txt.lineas[0]}</td>
                    <td>
                      <select value={c.choferId ?? ""} disabled={guardando === c.imei} aria-label={t(`Driver of ${c.nombre}`, `Chofer de ${c.nombre}`)}
                        onChange={(e) => guarda(c, { driver_id: e.target.value || null })}>
                        <option value="">{t("— not linked —", "— sin enlazar —")}</option>
                        {choferFuera && <option value={c.choferId!}>{c.chofer}</option>}
                        {choferes.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={c.tienda ?? ""} disabled={guardando === c.imei} aria-label={t(`Home store of ${c.nombre}`, `Tienda base de ${c.nombre}`)}
                        onChange={(e) => guarda(c, { home_store: e.target.value || null })}>
                        <option value="">{t("— none —", "— ninguna —")}</option>
                        {tiendaFuera && <option value={c.tienda!}>{c.tienda}</option>}
                        {tiendas.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

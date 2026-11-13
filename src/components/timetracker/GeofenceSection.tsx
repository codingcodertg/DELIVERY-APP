"use client";

import { useCallback, useEffect, useState } from "react";
import { getGeofences, setSiteActive } from "@/app/timetracker/clock-in/actions/sites";
import { GeofenceMap, type Fence } from "./GeofenceMap";
import { GeofenceEditor } from "./GeofenceEditor";
import { useT } from "@/lib/timetracker/i18n";
import { TablaEstandar } from "@/components/TablaEstandar";

/**
 * Las geocercas de las tiendas, dentro de Ajustes de Time Tracker: verlas, encenderlas,
 * apagarlas, dibujarlas y corregirlas. Todo aquí.
 *
 * Un paso antes esta sección solo enseñaba y "editar" mandaba a la pantalla de fichaje —
 * te sacaba de Ajustes a la app vieja, con otro mapa y otro estilo. Se descartó por lo que
 * era: una costura visible en mitad de una tarea.
 *
 * El editor está en GeofenceEditor y guarda con las MISMAS acciones de servidor que usaba
 * la pantalla vieja, que son las que calculan el centro del polígono y comprueban el
 * permiso. Cambiar de mapa no era motivo para tener dos formas de escribir una geocerca.
 *
 * G-9 (D-202): textos por claves mgr.geo.*. Los nombres de los sitios son dato.
 */
export function GeofenceSection() {
  const t = useT();
  const [sites, setSites] = useState<Fence[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // null = nada abierto · "new" = alta · un id = editando ese sitio.
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await getGeofences();
    if (!res.ok) { setErr(res.message); setLoaded(true); return; }
    setErr(null);
    setSites(res.sites as Fence[]);
    setLoaded(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function toggle(f: Fence) {
    setBusy(f.id);
    const res = await setSiteActive(f.id, !f.active);
    setBusy(null);
    if (!res.ok) { setErr(res.message ?? t("mgr.geo.updateFail")); return; }
    await load();
  }

  return (
    <>
      <div className="hr" />
      <h3 style={{ color: "var(--tt-muted)" }}>{t("mgr.geo.title")}</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        {t("mgr.geo.note")}
      </p>

      {editing === null && (
        <button className="btn-ghost btn-sm" onClick={() => setEditing("new")}>{t("mgr.geo.new")}</button>
      )}
      {editing !== null && (
        <GeofenceEditor
          site={editing === "new" ? null : sites.find((f) => f.id === editing)}
          onDone={() => { setEditing(null); void load(); }}
          onCancel={() => setEditing(null)}
        />
      )}

      {err && <div className="banner err">{err}</div>}
      {!loaded ? (
        <div className="hint">{t("mgr.geo.loading")}</div>
      ) : sites.length === 0 ? (
        <p className="small muted">{t("mgr.geo.none")}</p>
      ) : (
        <>
          <GeofenceMap fences={sites} />
          <div style={{ marginTop: 12 }}>
            <TablaEstandar id="tt-geocercas" claveDe={(f) => f.id} filas={sites}
              claseDeFila={(f) => (f.active ? undefined : "atenuado")}
              columnas={[
                { key: "sitio", en: t("mgr.geo.colSite"), es: t("mgr.geo.colSite"), ancho: 200, valor: (f) => f.name },
                { key: "forma", en: t("mgr.geo.colShape"), es: t("mgr.geo.colShape"), ancho: 200,
                  valor: (f) => (f.boundary && f.boundary.length >= 3
                    ? t("mgr.geo.outlinePoints", { n: f.boundary.length })
                    : t("mgr.geo.circleRadius", { r: f.radius_meters ?? "?" })),
                  clase: "small muted" },
                { key: "margen", en: t("mgr.geo.colPadding"), es: t("mgr.geo.colPadding"), ancho: 110, numerico: true,
                  valor: (f) => f.padding_meters ?? null, celda: (f) => (f.padding_meters != null ? `${f.padding_meters} m` : "—"), clase: "num small muted" },
                { key: "estado", en: t("mgr.geo.colState"), es: t("mgr.geo.colState"), ancho: 120,
                  valor: (f) => (f.active ? t("mgr.geo.active") : t("mgr.geo.off")),
                  celda: (f) => (f.active ? <span className="pill on">{t("mgr.geo.active")}</span> : <span className="pill off">{t("mgr.geo.off")}</span>) },
              ]}
              acciones={(f) => (
                <>
                  <button className="btn-ghost btn-sm" disabled={busy === f.id} onClick={() => toggle(f)}>
                    {f.active ? t("mgr.geo.turnOff") : t("mgr.geo.turnOn")}
                  </button>{" "}
                  <button className="btn-ghost btn-sm" onClick={() => setEditing(f.id)}>{t("mgr.geo.editOutline")}</button>
                </>
              )}
              anchoDeAcciones={210} />
          </div>
        </>
      )}
    </>
  );
}

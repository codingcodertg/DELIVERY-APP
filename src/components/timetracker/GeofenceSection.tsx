"use client";

import { useCallback, useEffect, useState } from "react";
import { getGeofences, setSiteActive } from "@/app/timetracker/clock-in/actions/sites";
import { GeofenceMap, type Fence } from "./GeofenceMap";
import { GeofenceEditor } from "./GeofenceEditor";

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
 */
export function GeofenceSection() {
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
    if (!res.ok) { setErr(res.message ?? "Could not update the site."); return; }
    await load();
  }

  return (
    <>
      <div className="hr" />
      <h3 style={{ color: "var(--tt-muted)" }}>Job sites · geofencing</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        A punch counts as on-site when it falls inside one of these. Turning a site off does not delete it —
        punches there start being flagged as off-site instead.
      </p>

      {editing === null && (
        <button className="btn-ghost btn-sm" onClick={() => setEditing("new")}>+ New job site</button>
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
        <div className="hint">Loading…</div>
      ) : sites.length === 0 ? (
        <p className="small muted">No job sites yet.</p>
      ) : (
        <>
          <GeofenceMap fences={sites} />
          <table className="orders" style={{ marginTop: 12 }}>
            <thead>
              <tr><th>Site</th><th>Shape</th><th style={{ textAlign: "right" }}>Padding</th><th /><th /></tr>
            </thead>
            <tbody>
              {sites.map((f) => (
                <tr key={f.id} style={f.active ? undefined : { opacity: 0.55 }}>
                  <td>{f.name}</td>
                  <td className="small muted">
                    {f.boundary && f.boundary.length >= 3
                      ? `Outline · ${f.boundary.length} points`
                      : `Circle · ${f.radius_meters ?? "?"} m`}
                  </td>
                  <td style={{ textAlign: "right" }} className="small muted">
                    {f.padding_meters != null ? `${f.padding_meters} m` : "—"}
                  </td>
                  <td>{f.active ? <span className="pill on">active</span> : <span className="pill off">off</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn-ghost btn-sm" disabled={busy === f.id} onClick={() => toggle(f)}>
                      {f.active ? "Turn off" : "Turn on"}
                    </button>{" "}
                    <button className="btn-ghost btn-sm" onClick={() => setEditing(f.id)}>Edit outline</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

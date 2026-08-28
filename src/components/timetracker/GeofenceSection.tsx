"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getGeofences, setSiteActive } from "@/app/timetracker/clock-in/actions/sites";
import { GeofenceMap, type Fence } from "./GeofenceMap";

/**
 * Las geocercas de las tiendas, dentro de Ajustes de Time Tracker.
 *
 * Enseña las seis en un mapa y las lista con su forma, su margen y su interruptor. Lo que NO
 * trae es el editor de dibujo, y conviene decir por qué en vez de que parezca un descuido:
 * son 318 líneas de Tailwind con un mapa donde cada clic pone un vértice, y esta pantalla
 * vive bajo el grupo (timetracker), cuyo chunk de CSS no incluye Tailwind. Reescribirlo aquí
 * sería duplicar la herramienta más delicada del módulo — la que decide si el fichaje de
 * alguien cuenta — para que existan dos versiones que se pueden desincronizar.
 *
 * Así que aquí se VE y se apaga o enciende, que es el 90% de lo que se hace con una geocerca
 * ya dibujada, y dibujar abre la pantalla que ya funciona.
 */
export function GeofenceSection() {
  const [sites, setSites] = useState<Fence[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

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
                    <Link className="btn btn-ghost btn-sm" href="/timetracker/clock-in/sites">Edit outline</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <p className="small muted" style={{ marginTop: 10 }}>
        Drawing and moving an outline happens on the{" "}
        <Link href="/timetracker/clock-in/sites">job sites screen</Link> — it needs the map editor, which is
        not duplicated here on purpose.
      </p>
    </>
  );
}

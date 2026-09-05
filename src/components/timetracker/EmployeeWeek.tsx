"use client";

import { useCallback, useEffect, useState } from "react";
import { getEmployeeWeek } from "@/app/timetracker/clock-in/actions/reports";
import { APP_SETTINGS, fmtDayLong } from "@/lib/timetracker/helpers";

/**
 * La semana de una persona, desplegada desde su fila en Empleados (D-135).
 *
 * Es lo último que quedaba de "Today's Crew". Va aquí porque es la pregunta que uno se hace
 * mirando esa lista —*¿y esta persona qué hizo esta semana?*— y tenerla en otra pantalla
 * obligaba a apuntarse el nombre, salir y buscarlo.
 *
 * Se pide **al abrir**, una fila cada vez. Cargar la semana de las doce personas para que
 * alguien mire una sería doce veces el trabajo para un doceavo del provecho.
 */

type Data = Extract<Awaited<ReturnType<typeof getEmployeeWeek>>, { ok: true }>;

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: APP_SETTINGS.timeZone /* G-25: la zona del ajuste, no America/Chicago a pelo */ });
const dia = (iso: string) => iso.slice(0, 10);
const horas = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;

export function EmployeeWeek({ employeeId }: { employeeId: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await getEmployeeWeek(employeeId);
    if (!r.ok) setErr(r.message); else { setErr(null); setD(r); }
  }, [employeeId]);

  useEffect(() => { void load(); }, [load]);

  if (err) return <div className="banner err">{err}</div>;
  if (!d) return <div className="hint">Loading…</div>;

  // Fichajes y descansos juntos, agrupados por día: así se lee la jornada tal como pasó en vez
  // de tener que cruzar dos listas por la hora.
  const filas = [
    ...d.punches.map((p) => ({
      k: p.id, cuando: p.clockInAt,
      que: p.manual ? "⏰ Shift · manual" : "⏰ Shift",
      cls: "on", desde: p.clockInAt, hasta: p.clockOutAt, min: p.minutes,
      aviso: p.onSite === false ? "off site" : null,
    })),
    ...d.breaks.map((b) => ({
      k: b.id, cuando: b.leftAt,
      que: b.reason === "lunch" ? "🍽 Lunch" : "🚚 Out",
      cls: b.reason === "lunch" ? "wait" : "", desde: b.leftAt, hasta: b.returnedAt, min: b.minutes,
      aviso: null as string | null,
    })),
  ].sort((a, b) => a.cuando.localeCompare(b.cuando));

  const porDia = new Map<string, typeof filas>();
  filas.forEach((f) => porDia.set(dia(f.cuando), [...(porDia.get(dia(f.cuando)) ?? []), f]));

  return (
    <div className="box" style={{ marginTop: 8 }}>
      <div className="between">
        <span className="small muted">{d.period[0]} → {d.period[6]} (Fri–Thu)</span>
        <span>
          <strong>{horas(d.totalMin)}</strong>
          {d.lunchMin > 0 && <span className="small muted"> · 🍽 {d.lunchMin}m</span>}
          {d.outMin > 0 && <span className="small muted"> · 🚚 {d.outMin}m</span>}
        </span>
      </div>

      {filas.length === 0 ? (
        <p className="muted small" style={{ marginTop: 8 }}>Nothing this period.</p>
      ) : (
        d.period.map((f) => {
          const delDia = porDia.get(f);
          if (!delDia) return null;
          return (
            <div key={f} style={{ marginTop: 10 }}>
              <div className="small" style={{ fontWeight: 700 }}>{fmtDayLong(f)}</div>
              <table>
                <tbody>
                  {delDia.map((r) => (
                    <tr key={r.k}>
                      <td className="nowrap"><span className={`pill ${r.cls}`}>{r.que}</span></td>
                      <td className="small nowrap">{hhmm(r.desde)} – {r.hasta ? hhmm(r.hasta) : <span className="pill wait">open</span>}</td>
                      <td className="small nowrap">{horas(r.min)}</td>
                      <td className="small">{r.aviso && <span className="pill off">{r.aviso}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getScheduleWeek, createShifts, applySchedule, deleteShift } from "@/app/timetracker/clock-in/actions/schedule";
import { adminClock } from "@/app/timetracker/clock-in/actions/clock";
import { fmtDayLong, addDaysISO, dateISO } from "@/lib/timetracker/helpers";

/**
 * El horario de la cuadrilla, dentro de Time Tracker (D-121).
 *
 * Quinta pantalla que baja del módulo de fichaje. Se rehace en el idioma de Time Tracker y no
 * se muda tal cual porque las de fichaje son de Tailwind y este grupo de rutas no lo incluye —
 * el mismo motivo por el que se rehicieron las anteriores.
 *
 * **Ahora se puede ver y programar otra semana.** La pantalla vieja solo sabía enseñar la
 * semana en curso, y eso no era un detalle: un horario se planifica hacia delante, así que no
 * había forma de dejar programada la semana siguiente. Es la única diferencia funcional; el
 * resto es la misma pantalla con los mismos permisos.
 *
 * Las acciones de servidor son las mismas —`createShifts`, `applySchedule`, `deleteShift`,
 * `adminClock`—, así que los avisos, el alcance por tienda y las validaciones no cambian.
 */

const SIN_TIENDA = "__none__";
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dowIndex = (d: string) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;

type Data = Extract<Awaited<ReturnType<typeof getScheduleWeek>>, { ok: true }>;

export function ScheduleWeek() {
  const [periodo, setPeriodo] = useState<string | undefined>(undefined);
  const [d, setD] = useState<Data | null>(null);
  const [cargando, setCargando] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // --- alta de turnos ---
  const [quien, setQuien] = useState("");
  const [dias, setDias] = useState<Set<string>>(new Set());
  const [desde, setDesde] = useState("08:00");
  const [hasta, setHasta] = useState("16:30");
  const [comida, setComida] = useState(30);
  const [sitio, setSitio] = useState("");

  // --- fichar a mano ---
  const [acQuien, setAcQuien] = useState("");
  const [acMotivo, setAcMotivo] = useState("");

  const load = useCallback(async () => {
    setCargando(true);
    const res = await getScheduleWeek(periodo);
    if (!res.ok) { setErr(res.message); setD(null); }
    else {
      setErr(null);
      setD(res);
      setQuien((q) => q || res.people[0]?.id || "");
      setAcQuien((q) => q || res.people[0]?.id || "");
      setSitio((s) => s || res.sites[0]?.id || "");
    }
    setCargando(false);
  }, [periodo]);

  useEffect(() => { void load(); }, [load]);

  const porTienda = useMemo(() => {
    if (!d) return [];
    const tiendaDe = new Map(d.people.map((p) => [p.id, p.store_id ?? SIN_TIENDA]));
    const nombreTienda = new Map(d.sites.map((s) => [s.id, s.name]));
    const claves = [...new Set(d.shifts.map((s) => tiendaDe.get(s.employee_id) ?? SIN_TIENDA))];
    return claves
      .map((k) => ({
        key: k,
        name: k === SIN_TIENDA ? "No store" : nombreTienda.get(k) ?? "No store",
        shifts: d.shifts.filter((s) => (tiendaDe.get(s.employee_id) ?? SIN_TIENDA) === k),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [d]);

  async function corre(fn: () => Promise<{ ok: boolean; message?: string }>, exito: string) {
    setBusy(true);
    setMsg(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: res.message ?? "Could not save." }); return; }
    setMsg({ ok: true, text: exito });
    await load();
  }

  if (cargando && !d) return <div className="card"><div className="hint">Loading…</div></div>;
  if (!d) return <div className="card"><div className="banner err">{err ?? "Could not read the schedule."}</div></div>;

  const nombreDe = new Map(d.people.map((p) => [p.id, p.full_name]));
  const persona = d.people.find((p) => p.id === quien);
  const conPatron = persona?.default_schedule === "A" || persona?.default_schedule === "B" || persona?.default_schedule === "C";
  const hoy = dateISO(new Date());
  const minutos = d.shifts.reduce((sum, s) => {
    const [h1, m1] = s.start_time.split(":").map(Number);
    const [h2, m2] = s.end_time.split(":").map(Number);
    let min = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (min < 0) min += 1440;
    return sum + Math.max(0, min - (s.lunch_minutes ?? 0));
  }, 0);

  const alterna = (dia: string) =>
    setDias((prev) => {
      const n = new Set(prev);
      if (n.has(dia)) n.delete(dia); else n.add(dia);
      return n;
    });

  return (
    <>
      <div className="card">
        <div className="between">
          <div>
            <h2 style={{ margin: 0 }}>📅 Schedule</h2>
            <div className="small muted">
              {fmtDayLong(d.week[0])} → {fmtDayLong(d.week[6])} · {(minutos / 60).toFixed(1)} h scheduled
            </div>
          </div>
          <div className="row" style={{ gap: 6, alignItems: "center" }}>
            <button className="btn-ghost btn-sm" disabled={busy} onClick={() => setPeriodo(addDaysISO(d.week[0], -7))}>← previous</button>
            {/* La semana siguiente es la que más se usa: es donde se programa. */}
            <button className="btn-ghost btn-sm" disabled={busy} onClick={() => setPeriodo(addDaysISO(d.week[0], 7))}>next →</button>
            {periodo && <button className="btn-ghost btn-sm" onClick={() => setPeriodo(undefined)}>this week</button>}
          </div>
        </div>
        {msg && <div className={`banner ${msg.ok ? "ok" : "err"}`} style={{ marginTop: 12 }}>{msg.text}</div>}
      </div>

      <div className="card">
        <h2>Add shifts</h2>
        <div className="grid g2">
          <div>
            <label>Person</label>
            <select value={quien} onChange={(e) => setQuien(e.target.value)}>
              {d.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </div>
          <div>
            <label>Job site</label>
            <select value={sitio} onChange={(e) => setSitio(e.target.value)}>
              <option value="">—</option>
              {d.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        <label style={{ marginTop: 8 }}>Days</label>
        <div className="row" style={{ gap: 6 }}>
          {d.week.map((dia) => (
            <button
              key={dia}
              type="button"
              className={dias.has(dia) ? "btn-sm" : "btn-ghost btn-sm"}
              onClick={() => alterna(dia)}
            >
              {DOW[dowIndex(dia)]} {dia.slice(8)}
            </button>
          ))}
        </div>

        <div className="grid g3" style={{ marginTop: 8 }}>
          <div><label>From</label><input type="time" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
          <div><label>To</label><input type="time" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
          <div>
            <label>Lunch</label>
            <select value={comida} onChange={(e) => setComida(Number(e.target.value))}>
              {[0, 15, 30, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
          </div>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <button
            disabled={busy || !quien || dias.size === 0}
            onClick={() => corre(
              () => createShifts({
                employeeId: quien, dates: [...dias], start: desde, end: hasta,
                lunch: comida, siteId: sitio || null,
              }),
              `${dias.size} shift${dias.size === 1 ? "" : "s"} added.`,
            ).then(() => setDias(new Set()))}
          >
            Add {dias.size > 0 ? `${dias.size} shift${dias.size === 1 ? "" : "s"}` : "shifts"}
          </button>
          {/* Solo tiene sentido para quien tenga un patrón asignado; si no, no hay nada que
              aplicar y el botón sería una promesa vacía. */}
          {conPatron && (
            <button className="btn-ghost" disabled={busy}
              onClick={() => corre(() => applySchedule({ employeeId: quien }), "Their usual schedule was applied.")}>
              Apply their usual schedule ({persona?.default_schedule})
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Clock someone in or out</h2>
        <p className="small muted" style={{ marginTop: 0 }}>
          For when a phone died or somebody forgot. It is recorded as a manual punch with your reason.
        </p>
        <div className="grid g2">
          <div>
            <label>Person</label>
            <select value={acQuien} onChange={(e) => setAcQuien(e.target.value)}>
              {d.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </div>
          <div>
            <label>Reason</label>
            <input value={acMotivo} onChange={(e) => setAcMotivo(e.target.value)} placeholder="phone died" />
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button disabled={busy || !acMotivo.trim()}
            onClick={() => corre(() => adminClock({ employeeId: acQuien, action: "in", reason: acMotivo }), "Clocked in.")}>
            Clock in
          </button>
          <button className="btn-ghost" disabled={busy || !acMotivo.trim()}
            onClick={() => corre(() => adminClock({ employeeId: acQuien, action: "out", reason: acMotivo }), "Clocked out.")}>
            Clock out
          </button>
        </div>
      </div>

      {porTienda.length === 0 ? (
        <div className="card"><p className="muted">No shifts scheduled this week.</p></div>
      ) : (
        porTienda.map((g) => (
          <div className="card" key={g.key}>
            <div className="between">
              <h2 style={{ margin: 0 }}>📍 {g.name}</h2>
              <span className="chip">{g.shifts.length}</span>
            </div>
            {d.week.map((dia) => {
              const delDia = g.shifts
                .filter((s) => s.shift_date === dia)
                .sort((a, b) => a.start_time.localeCompare(b.start_time));
              return (
                <div key={dia} className="box" style={{ marginTop: 10, ...(dia === hoy ? { borderColor: "var(--tt-accent)" } : {}) }}>
                  <div className="small" style={{ fontWeight: 700 }}>
                    {fmtDayLong(dia)}{dia === hoy ? " · today" : ""}
                  </div>
                  {delDia.length === 0 ? (
                    <div className="small muted">—</div>
                  ) : (
                    <table style={{ marginTop: 6 }}>
                      <tbody>
                        {delDia.map((s) => (
                          <tr key={s.id}>
                            <td>{nombreDe.get(s.employee_id) ?? "Unknown"}</td>
                            <td className="small muted nowrap">
                              {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                              {s.lunch_minutes ? ` · 🍽 ${s.lunch_minutes}m` : ""}
                            </td>
                            <td className="nowrap" style={{ textAlign: "right" }}>
                              <button className="btn-ghost btn-sm" disabled={busy}
                                onClick={() => { if (confirm("Delete this shift?")) void corre(() => deleteShift(s.id), "Shift deleted."); }}>
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}
    </>
  );
}

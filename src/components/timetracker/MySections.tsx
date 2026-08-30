"use client";

import { useCallback, useEffect, useState } from "react";
import { getMySchedule, getMyNotes, getMyScorecard, type MiHorario, type MiBoletin } from "@/app/timetracker/clock-in/actions/myday";
import { addNote } from "@/app/timetracker/clock-in/actions/notes";
import { fmtDayLong } from "@/lib/timetracker/helpers";

/**
 * Mi horario, mis notas y mi boletín — desplegables dentro de Registrar tiempo (D-129).
 *
 * Eran tres pantallas del módulo de fichaje y eran el último motivo para tener que ir allí.
 * Van plegadas y **cada una se pide al abrirla**: son datos que casi nadie mira cada vez que
 * ficha, y cobrárselos a todo el mundo en cada carga solo haría más lento el botón de fichar,
 * que es lo que sí se usa siempre.
 *
 * `<details>` del navegador y no un desplegable propio: recuerda su estado al teclado, se puede
 * buscar dentro con Ctrl+F aunque esté cerrado, y no hace falta escribir nada para que
 * funcione. Un acordeón hecho a mano solo habría añadido formas de que fallara.
 */

/** Carga perezosa: la primera vez que se abre, y no antes. */
function useAlAbrir<T>(traer: () => Promise<T | null>) {
  const [datos, setDatos] = useState<T | null>(null);
  const [cargando, setCargando] = useState(false);
  const [pedido, setPedido] = useState(false);
  const abrir = useCallback(() => {
    if (pedido) return;
    setPedido(true);
    setCargando(true);
    void traer().then((d) => { setDatos(d); setCargando(false); });
  }, [pedido, traer]);
  return { datos, cargando, abrir, recargar: () => { setPedido(false); setDatos(null); } };
}

const hhmm = (t: string) => t.slice(0, 5);
const horas = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m`;

export function MySections() {
  return (
    <>
      <MiHorarioSec />
      <MisNotasSec />
      <MiBoletinSec />
    </>
  );
}

function MiHorarioSec() {
  const traer = useCallback(async () => {
    const r = await getMySchedule();
    return r.ok ? r.data : null;
  }, []);
  const { datos, cargando, abrir } = useAlAbrir<MiHorario>(traer);
  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <div className="card">
      <details onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) abrir(); }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>📅 My schedule</summary>
        {cargando && <div className="hint">Loading…</div>}
        {datos && (
          <>
            {datos.off.length > 0 && (
              // Un día aprobado libre se dice ARRIBA: sin eso, un hueco en el horario parece
              // un olvido y la gente pregunta si tiene que venir.
              <div className="banner info" style={{ marginTop: 10 }}>
                Approved time off: {datos.off.map((o) => `${o.type} ${o.start_date}→${o.end_date}`).join(" · ")}
              </div>
            )}
            <table style={{ marginTop: 10 }}>
              <tbody>
                {datos.week.map((d) => {
                  const t = datos.shifts.find((x) => x.shift_date === d);
                  return (
                    <tr key={d} style={d === hoy ? { fontWeight: 700 } : undefined}>
                      <td className="nowrap">{fmtDayLong(d)}{d === hoy ? " · today" : ""}</td>
                      <td className="nowrap">{t ? `${hhmm(t.start_time)}–${hhmm(t.end_time)}` : <span className="muted">—</span>}</td>
                      <td className="small muted nowrap">
                        {t?.lunch_minutes ? `🍽 ${t.lunch_minutes}m` : ""}
                        {t?.site ? ` · ${t.site}` : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </details>
    </div>
  );
}

function MisNotasSec() {
  const traer = useCallback(async () => {
    const r = await getMyNotes();
    return r.ok ? r.notes : null;
  }, []);
  const { datos, cargando, abrir, recargar } = useAlAbrir<{ id: string; note: string; created_at: string }[]>(traer);
  const [texto, setTexto] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Se vuelve a abrir sola tras guardar, para que la nota recién escrita se vea sin tocar nada.
  const [abierta, setAbierta] = useState(false);
  useEffect(() => { if (abierta) abrir(); }, [abierta, abrir]);

  async function guardar() {
    if (!texto.trim()) return;
    setBusy(true);
    setErr(null);
    const r = await addNote(texto.trim());
    setBusy(false);
    if (!r.ok) { setErr(r.message ?? "Could not save."); return; }
    setTexto("");
    recargar();
    setAbierta(false);
    setTimeout(() => setAbierta(true), 0);
  }

  return (
    <div className="card">
      <details onToggle={(e) => setAbierta((e.currentTarget as HTMLDetailsElement).open)}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>📝 Daily notes</summary>
        <div className="row" style={{ marginTop: 10 }}>
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="What happened today?" />
          <button disabled={busy || !texto.trim()} onClick={guardar}>Add</button>
        </div>
        {err && <div className="banner err">{err}</div>}
        {cargando && <div className="hint">Loading…</div>}
        {datos && (datos.length === 0
          ? <p className="muted" style={{ marginTop: 10 }}>No notes yet.</p>
          : (
            <table style={{ marginTop: 10 }}>
              <tbody>
                {datos.map((n) => (
                  <tr key={n.id}>
                    <td className="small muted nowrap">{n.created_at.slice(0, 10)}</td>
                    <td>{n.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </details>
    </div>
  );
}

function MiBoletinSec() {
  const traer = useCallback(async () => {
    const r = await getMyScorecard();
    return r.ok ? r.data : null;
  }, []);
  const { datos, cargando, abrir } = useAlAbrir<MiBoletin>(traer);

  return (
    <div className="card">
      <details onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) abrir(); }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>📊 My scorecard</summary>
        {cargando && <div className="hint">Loading…</div>}
        {datos && (
          <>
            <p className="small muted" style={{ marginTop: 8 }}>Since {datos.desde}</p>
            <div className="grid g3">
              <div className="stat">
                <div className="small muted">On time</div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{datos.onTimeDays}</div>
              </div>
              <div className="stat">
                <div className="small muted">Late</div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{datos.lateCount}</div>
                {datos.lateMinTotal > 0 && <div className="small muted">{datos.lateMinTotal} min total</div>}
              </div>
              <div className="stat">
                <div className="small muted">Hours</div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{horas(datos.workedMins)}</div>
              </div>
            </div>
            {/* Lo que hay que mejorar solo se enseña si existe: una fila de ceros no informa,
                y una lista de faltas vacía se lee como un reproche por si acaso. */}
            {(datos.missed > 0 || datos.earlyDepartures > 0 || datos.longLunches > 0) && (
              <ul className="small muted" style={{ marginTop: 10, paddingLeft: 18 }}>
                {datos.missed > 0 && <li>{datos.missed} scheduled shift{datos.missed === 1 ? "" : "s"} with no punch</li>}
                {datos.earlyDepartures > 0 && <li>{datos.earlyDepartures} early departure{datos.earlyDepartures === 1 ? "" : "s"}</li>}
                {datos.longLunches > 0 && <li>{datos.longLunches} long lunch{datos.longLunches === 1 ? "" : "es"}</li>}
              </ul>
            )}
          </>
        )}
      </details>
    </div>
  );
}

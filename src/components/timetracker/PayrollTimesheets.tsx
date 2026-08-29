"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addEntry, deleteEntry, editEntry, getPayrollPeriod,
  approveTimesheet, unapproveTimesheet, ownerSignoff, revokeSignoff,
} from "@/app/timetracker/clock-in/actions/reports";
import { entryMinutes, hrs, summarize, type PayEntry } from "@/lib/clockin/payroll";
import { utcToCentralInput } from "@/lib/clockin/tz";

/**
 * Los partes de fichaje de un periodo: aprobar, corregir y cerrar la nómina (D-117).
 *
 * Última pantalla grande que quedaba en el módulo de fichaje, y la que peor sentaba tener
 * aparte: la nómina de fichaje y la de Time Tracker cuentan **el mismo periodo**, viernes a
 * jueves, y aun así vivían en dos sitios con dos estéticas. El pie de la pantalla de Payroll
 * decía literalmente que "cada mitad conserva su propia pantalla" — esa costura es la que
 * cierra esto.
 *
 * **La aritmética no se reescribió.** Los totales, la comida, las extras y los turnos abiertos
 * salen de `lib/clockin/payroll.ts`, el mismo módulo que usaba la pantalla vieja. Es puro y
 * corre igual aquí; recalcularlo a mano habría creado una segunda aritmética de nómina, y dos
 * nóminas que no cuadran son peor que una sola pantalla fea.
 *
 * Las acciones de servidor también son las mismas —`editEntry`, `addEntry`, `deleteEntry`,
 * `approveTimesheet`, `ownerSignoff`— así que aprobar desde aquí y aprobar desde donde fuera
 * hacen exactamente lo mismo, incluidos sus avisos y su bloqueo cuando el periodo está cerrado.
 */

const LUNCH_OPTS = [0, 15, 30, 45, 60, 90];
const SIN_TIENDA = "__none__";

type Data = Extract<Awaited<ReturnType<typeof getPayrollPeriod>>, { ok: true }>;
type Draft = { clockIn: string; clockOut: string; lunch: number; note: string };

const fmtDia = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Chicago" });
const fmtHora = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

export function PayrollTimesheets({ period }: { period: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [buscar, setBuscar] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [anadiendo, setAnadiendo] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ clockIn: "", clockOut: "", lunch: 0, note: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getPayrollPeriod(period);
    if (!res.ok) { setErr(res.message); setD(null); }
    else { setErr(null); setD(res); }
    setLoading(false);
  }, [period]);

  useEffect(() => { void load(); }, [load]);

  const porEmpleado = useMemo(() => {
    const m = new Map<string, PayEntry[]>();
    for (const e of d?.entries ?? []) m.set(e.employee_id, [...(m.get(e.employee_id) ?? []), e]);
    return m;
  }, [d]);

  const corre = useCallback(async (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) { setErr(res.message ?? "Could not save."); return; }
    setErr(null);
    setEditando(null);
    setAnadiendo(null);
    await load();
  }, [load]);

  if (loading && !d) return <div className="card"><div className="hint">Loading…</div></div>;
  if (!d) return <div className="card"><div className="banner err">{err ?? "Could not read the period."}</div></div>;

  const aprobados = new Set(d.approved);
  const tiendaNombre = new Map(d.stores.map((s) => [s.key, s.name]));
  const gente = new Map(d.people.map((p) => [p.id, p]));

  // Solo sale quien tenga fichajes en el periodo: una fila con cero horas no es información,
  // es ruido entre las que sí hay que revisar.
  const ids = [...porEmpleado.keys()]
    .filter((id) => gente.has(id))
    .sort((a, b) => (gente.get(a)?.name ?? "").localeCompare(gente.get(b)?.name ?? ""));

  const visible = (id: string) =>
    !buscar || (gente.get(id)?.name ?? "").toLowerCase().includes(buscar.toLowerCase());

  const grupos = new Map<string, string[]>();
  for (const id of ids) {
    const k = gente.get(id)?.store ?? SIN_TIENDA;
    grupos.set(k, [...(grupos.get(k) ?? []), id]);
  }

  let cReg = 0, cOt = 0, cTot = 0, cAbiertos = 0;
  for (const id of ids) {
    const s = summarize(porEmpleado.get(id)!);
    cReg += s.regularMin; cOt += s.otMin; cTot += s.totalMin; cAbiertos += s.openCount;
  }

  function empiezaEdicion(e: PayEntry) {
    setAnadiendo(null);
    setEditando(e.id);
    setDraft({
      clockIn: utcToCentralInput(e.clock_in_at),
      clockOut: e.clock_out_at ? utcToCentralInput(e.clock_out_at) : "",
      lunch: e.lunch_minutes ?? 0,
      note: e.edit_note ?? "",
    });
  }
  function empiezaAlta(empId: string) {
    setEditando(null);
    setAnadiendo(empId);
    setDraft({ clockIn: `${period}T08:00`, clockOut: `${period}T16:30`, lunch: 30, note: "" });
  }

  const formulario = (onSave: () => void, onCancel: () => void) => (
    <div className="box" style={{ marginTop: 8 }}>
      <div className="grid g2">
        <div>
          <label>Clock in</label>
          <input type="datetime-local" value={draft.clockIn} onChange={(e) => setDraft({ ...draft, clockIn: e.target.value })} />
        </div>
        <div>
          <label>Clock out</label>
          <input type="datetime-local" value={draft.clockOut} onChange={(e) => setDraft({ ...draft, clockOut: e.target.value })} />
        </div>
      </div>
      <div className="grid g2">
        <div>
          <label>Lunch</label>
          <select value={draft.lunch} onChange={(e) => setDraft({ ...draft, lunch: Number(e.target.value) })}>
            {LUNCH_OPTS.map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </div>
        <div>
          <label>Note</label>
          <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="why it changed" />
        </div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button onClick={onSave} disabled={busy}>Save</button>
        <button className="btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );

  return (
    <>
      <div className="card">
        <div className="between">
          <div>
            <div className="small muted">Company total</div>
            <div style={{ fontSize: 32, fontWeight: 800 }}>{hrs(cTot)} h</div>
            <div className="small muted">
              regular {hrs(cReg)} · overtime {hrs(cOt)} · {ids.length} people · {aprobados.size}/{ids.length} approved
            </div>
          </div>
          <div>
            {d.signedOff
              ? <span className="pill on">🔒 period signed off</span>
              : <span className="pill wait">period open</span>}
          </div>
        </div>

        {cAbiertos > 0 && (
          // Un fichaje sin salida cuenta horas que nadie trabajó. Es lo primero que mirar
          // antes de aprobar nada, así que va arriba y no escondido dentro de la persona.
          <div className="banner warn" style={{ marginTop: 12 }}>
            ⚠️ {cAbiertos} punch{cAbiertos === 1 ? "" : "es"} with no clock-out in this period. Fix them before approving.
          </div>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          <a className="btn btn-ghost btn-sm" href={`/timetracker/clock-in/api/reports/xlsx?week=${period}`}>⬇ Excel</a>
          <a className="btn btn-ghost btn-sm" href={`/timetracker/clock-in/api/reports/export?type=summary&week=${period}`}>⬇ Summary CSV</a>
          <a className="btn btn-ghost btn-sm" href={`/timetracker/clock-in/api/reports/export?type=detail&week=${period}`}>⬇ Detail CSV</a>
          {d.isOwner && (
            <button
              className={d.signedOff ? "btn-ghost btn-sm" : "btn-sm"}
              disabled={busy}
              onClick={() => corre(() => (d.signedOff ? revokeSignoff({ periodStart: period }) : ownerSignoff({ periodStart: period })))}
            >
              {d.signedOff ? "Reopen period" : "🔒 Sign off period"}
            </button>
          )}
        </div>
        {!d.isOwner && <p className="small muted" style={{ marginTop: 8 }}>Only the owner closes the period.</p>}
        {err && <div className="banner err" style={{ marginTop: 12 }}>{err}</div>}
      </div>

      {ids.length === 0 ? (
        <div className="card"><p className="muted">No punches in this period.</p></div>
      ) : (
        <div className="card">
          <div className="between">
            <h2 style={{ margin: 0 }}>Timesheets</h2>
            <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="🔍 search a person"
              style={{ width: "auto", minWidth: 200 }} />
          </div>

          {[...grupos.entries()].map(([key, miembros]) => {
            const suyos = miembros.filter(visible);
            if (!suyos.length) return null;
            const totalGrupo = suyos.reduce((s, id) => s + summarize(porEmpleado.get(id)!).totalMin, 0);
            return (
              <details key={key} open={grupos.size === 1 || !!buscar} style={{ marginTop: 12 }}>
                <summary style={{ cursor: "pointer", fontWeight: 700 }}>
                  📍 {key === SIN_TIENDA ? "No store" : tiendaNombre.get(key) ?? "No store"}
                  <span className="chip" style={{ marginLeft: 6 }}>{suyos.length}</span>
                  <span className="muted small" style={{ marginLeft: 6 }}>{hrs(totalGrupo)} h</span>
                </summary>

                {suyos.map((id) => {
                  const p = gente.get(id)!;
                  const s = summarize(porEmpleado.get(id)!);
                  const ok = aprobados.has(id);
                  const suyas = porEmpleado.get(id)!;
                  return (
                    <div key={id} className="box" style={{ marginTop: 10 }}>
                      <div className="between">
                        <div>
                          <strong>{p.name}</strong>
                          <div className="small muted">
                            <b>{hrs(s.totalMin)}</b> / {p.scheduledMin > 0 ? hrs(p.scheduledMin) : "—"} h scheduled
                            {s.otMin > 0 ? ` · ${hrs(s.otMin)} OT` : ""}
                            {s.lunchMin > 0 ? ` · 🍽 ${Math.round(s.lunchMin)}m` : ""}
                          </div>
                        </div>
                        <button
                          className={ok ? "btn-ghost btn-sm" : "btn-sm"}
                          disabled={busy || d.signedOff}
                          onClick={() => corre(() => (ok
                            ? unapproveTimesheet({ employeeId: id, periodStart: period })
                            : approveTimesheet({ employeeId: id, periodStart: period })))}
                        >
                          {ok ? "✓ approved" : "Approve"}
                        </button>
                      </div>

                      <table style={{ marginTop: 8 }}>
                        <tbody>
                          {suyas.map((e) => (
                            <tr key={e.id}>
                              <td className="small nowrap">{fmtDia(e.clock_in_at)}</td>
                              <td className="small nowrap">
                                {fmtHora(e.clock_in_at)} – {e.clock_out_at ? fmtHora(e.clock_out_at) : <span className="pill wait">open</span>}
                              </td>
                              <td className="small nowrap">{hrs(entryMinutes(e))} h</td>
                              <td className="small muted">
                                {e.manual ? <span className="chip">manual</span> : null}
                                {e.edit_note ? ` ${e.edit_note}` : ""}
                              </td>
                              <td className="nowrap">
                                {!d.signedOff && (
                                  <>
                                    <button className="btn-ghost btn-sm" onClick={() => empiezaEdicion(e)}>Edit</button>{" "}
                                    <button className="btn-ghost btn-sm" disabled={busy}
                                      onClick={() => { if (confirm("Delete this entry?")) void corre(() => deleteEntry(e.id)); }}>
                                      Delete
                                    </button>
                                  </>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {editando && suyas.some((e) => e.id === editando) &&
                        formulario(
                          () => corre(() => editEntry({
                            id: editando, clockIn: draft.clockIn, clockOut: draft.clockOut || null,
                            lunch: draft.lunch, note: draft.note || undefined,
                          })),
                          () => setEditando(null),
                        )}

                      {anadiendo === id
                        ? formulario(
                            () => corre(() => addEntry({
                              employeeId: id, clockIn: draft.clockIn, clockOut: draft.clockOut,
                              lunch: draft.lunch, note: draft.note || undefined,
                            })),
                            () => setAnadiendo(null),
                          )
                        : !d.signedOff && (
                            <button className="btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => empiezaAlta(id)}>
                              + Add an entry
                            </button>
                          )}
                    </div>
                  );
                })}
              </details>
            );
          })}
          <p className="small muted" style={{ marginTop: 12 }}>
            People with no punches this period are not listed.
          </p>
        </div>
      )}
    </>
  );
}

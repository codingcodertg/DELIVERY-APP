"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getScheduleWeek, createShifts, applySchedule, deleteShift } from "@/app/timetracker/clock-in/actions/schedule";
import { adminClock } from "@/app/timetracker/clock-in/actions/clock";
import { fmtDayLong, addDaysISO, dateISO } from "@/lib/timetracker/helpers";
import { useT } from "@/lib/timetracker/i18n";
import { Modal } from "./Modal";

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
 *
 * D-187: los dos formularios ("Agregar turnos" y "Fichar a alguien") dejan de ocupar sitio
 * permanente; cada uno es un botón en la cabecera que abre una ventana encima. Y todo el
 * texto pasa por el diccionario (`mgr.sch.*`): desde D-121 estaba en inglés a pelo, y al
 * quedar junto a la sección de tarifas, traducida entera, se notaba (D-186 lo dejó pendiente).
 * Lo que NO se traduce aquí son las fechas largas: `fmtDayLong` usa el LOCALE fijo de
 * helpers.ts, compartido por todo el módulo, y cambiarlo es otro cambio.
 *
 * La lista de personas (`d.people`) sigue siendo la del servidor, acotada por tienda y sin
 * inactivos (D-127). No es la de la sección de tarifas y no se unifican (D-186).
 */

const SIN_TIENDA = "__none__";
const dowIndex = (d: string) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;

type Data = Extract<Awaited<ReturnType<typeof getScheduleWeek>>, { ok: true }>;
type Ventana = null | "turnos" | "fichar";

export function ScheduleWeek() {
  const t = useT();
  const [periodo, setPeriodo] = useState<string | undefined>(undefined);
  const [d, setD] = useState<Data | null>(null);
  const [cargando, setCargando] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ventana, setVentana] = useState<Ventana>(null);

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
        name: k === SIN_TIENDA ? t("mgr.sch.noStore") : nombreTienda.get(k) ?? t("mgr.sch.noStore"),
        shifts: d.shifts.filter((s) => (tiendaDe.get(s.employee_id) ?? SIN_TIENDA) === k),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [d, t]);

  const cerrar = useCallback(() => setVentana(null), []);

  // Devuelve si salió bien, para que quien llama desde una ventana pueda cerrarla solo entonces:
  // con error, la ventana se queda abierta y el aviso se ve dentro, no detrás del velo.
  async function corre(fn: () => Promise<{ ok: boolean; message?: string }>, exito: string): Promise<boolean> {
    setBusy(true);
    setMsg(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: res.message ?? t("mgr.sch.errSave") }); return false; }
    setMsg({ ok: true, text: exito });
    await load();
    return true;
  }

  if (cargando && !d) return <div className="card"><div className="hint">{t("mgr.sch.loading")}</div></div>;
  if (!d) return <div className="card"><div className="banner err">{err ?? t("mgr.sch.errRead")}</div></div>;

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

  const rotuloAgregar = dias.size === 0 ? t("mgr.sch.addNone") : dias.size === 1 ? t("mgr.sch.addOne") : t("mgr.sch.addMany", { n: dias.size });
  const exitoAgregar = dias.size === 1 ? t("mgr.sch.addedOne") : t("mgr.sch.addedMany", { n: dias.size });
  const errorEnVentana = ventana && msg && !msg.ok ? <div className="banner err" style={{ marginBottom: 8 }}>{msg.text}</div> : null;

  return (
    <>
      {ventana === "turnos" && (
        <Modal title={t("mgr.sch.addTitle")} onClose={cerrar}>
          {errorEnVentana}
          <div className="grid g2">
            <div>
              <label>{t("mgr.sch.person")}</label>
              <select value={quien} onChange={(e) => setQuien(e.target.value)}>
                {d.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </div>
            <div>
              <label>{t("mgr.sch.site")}</label>
              <select value={sitio} onChange={(e) => setSitio(e.target.value)}>
                <option value="">—</option>
                {d.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          <label style={{ marginTop: 8 }}>{t("mgr.sch.days")}</label>
          <div className="row" style={{ gap: 6 }}>
            {d.week.map((dia) => (
              <button
                key={dia}
                type="button"
                className={dias.has(dia) ? "btn-sm" : "btn-ghost btn-sm"}
                onClick={() => alterna(dia)}
              >
                {t(`mgr.sch.dow.${dowIndex(dia)}`)} {dia.slice(8)}
              </button>
            ))}
          </div>

          <div className="grid g3" style={{ marginTop: 8 }}>
            <div><label>{t("mgr.sch.from")}</label><input type="time" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
            <div><label>{t("mgr.sch.to")}</label><input type="time" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
            <div>
              <label>{t("mgr.sch.lunch")}</label>
              <select value={comida} onChange={(e) => setComida(Number(e.target.value))}>
                {[0, 15, 30, 45, 60].map((m) => <option key={m} value={m}>{t("mgr.sch.min", { m })}</option>)}
              </select>
            </div>
          </div>

          <div className="modal-actions">
            {/* Solo tiene sentido para quien tenga un patrón asignado; si no, no hay nada que
                aplicar y el botón sería una promesa vacía. */}
            {conPatron && (
              <button className="btn-ghost" disabled={busy}
                onClick={() => corre(() => applySchedule({ employeeId: quien }), t("mgr.sch.applied")).then((ok) => { if (ok) cerrar(); })}>
                {t("mgr.sch.applyUsual", { p: persona?.default_schedule ?? "" })}
              </button>
            )}
            <button className="btn-ghost" onClick={cerrar}>{t("common.cancel")}</button>
            <button
              disabled={busy || !quien || dias.size === 0}
              onClick={() => corre(
                () => createShifts({
                  employeeId: quien, dates: [...dias], start: desde, end: hasta,
                  lunch: comida, siteId: sitio || null,
                }),
                exitoAgregar,
              ).then((ok) => { if (ok) { setDias(new Set()); cerrar(); } })}
            >
              {rotuloAgregar}
            </button>
          </div>
        </Modal>
      )}

      {ventana === "fichar" && (
        <Modal title={t("mgr.sch.clockTitle")} onClose={cerrar} maxWidth={520}>
          {errorEnVentana}
          <p className="small muted" style={{ marginTop: 0 }}>{t("mgr.sch.clockNote")}</p>
          {/* Ficha a una persona real y le manda una notificación: que se lea antes de tocar. */}
          <div className="banner warn">{t("mgr.sch.clockWarn")}</div>
          <div className="grid g2">
            <div>
              <label>{t("mgr.sch.person")}</label>
              <select value={acQuien} onChange={(e) => setAcQuien(e.target.value)}>
                {d.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </div>
            <div>
              <label>{t("mgr.sch.reason")}</label>
              <input value={acMotivo} onChange={(e) => setAcMotivo(e.target.value)} placeholder={t("mgr.sch.reasonPh")} />
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn-ghost" onClick={cerrar}>{t("common.cancel")}</button>
            <button className="btn-ghost" disabled={busy || !acMotivo.trim()}
              onClick={() => corre(() => adminClock({ employeeId: acQuien, action: "out", reason: acMotivo }), t("mgr.sch.clockedOut")).then((ok) => { if (ok) cerrar(); })}>
              {t("mgr.sch.clockOut")}
            </button>
            <button disabled={busy || !acMotivo.trim()}
              onClick={() => corre(() => adminClock({ employeeId: acQuien, action: "in", reason: acMotivo }), t("mgr.sch.clockedIn")).then((ok) => { if (ok) cerrar(); })}>
              {t("mgr.sch.clockIn")}
            </button>
          </div>
        </Modal>
      )}

      <div className="card">
        <div className="between">
          <div>
            <h2 style={{ margin: 0 }}>{t("mgr.sch.title")}</h2>
            <div className="small muted">
              {fmtDayLong(d.week[0])} → {fmtDayLong(d.week[6])} · {t("mgr.sch.hoursScheduled", { h: (minutos / 60).toFixed(1) })}
            </div>
          </div>
          <div className="row" style={{ gap: 6, alignItems: "center" }}>
            <button className="btn-ghost btn-sm" disabled={busy} onClick={() => setPeriodo(addDaysISO(d.week[0], -7))}>{t("mgr.sch.prev")}</button>
            {/* La semana siguiente es la que más se usa: es donde se programa. */}
            <button className="btn-ghost btn-sm" disabled={busy} onClick={() => setPeriodo(addDaysISO(d.week[0], 7))}>{t("mgr.sch.next")}</button>
            {periodo && <button className="btn-ghost btn-sm" onClick={() => setPeriodo(undefined)}>{t("mgr.sch.thisWeek")}</button>}
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button disabled={busy} onClick={() => setVentana("turnos")}>{t("mgr.sch.addBtn")}</button>
          <button className="btn-ghost" disabled={busy} onClick={() => setVentana("fichar")}>{t("mgr.sch.clockBtn")}</button>
        </div>
        {msg && !ventana && <div className={`banner ${msg.ok ? "ok" : "err"}`} style={{ marginTop: 12 }}>{msg.text}</div>}
      </div>

      {porTienda.length === 0 ? (
        <div className="card"><p className="muted">{t("mgr.sch.empty")}</p></div>
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
                    {fmtDayLong(dia)}{dia === hoy ? t("mgr.sch.today") : ""}
                  </div>
                  {delDia.length === 0 ? (
                    <div className="small muted">—</div>
                  ) : (
                    <table style={{ marginTop: 6 }}>
                      <tbody>
                        {delDia.map((s) => (
                          <tr key={s.id}>
                            <td>{nombreDe.get(s.employee_id) ?? t("mgr.sch.unknown")}</td>
                            <td className="small muted nowrap">
                              {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                              {s.lunch_minutes ? ` · 🍽 ${s.lunch_minutes}m` : ""}
                            </td>
                            <td className="nowrap" style={{ textAlign: "right" }}>
                              <button className="btn-ghost btn-sm" disabled={busy}
                                onClick={() => { if (confirm(t("mgr.sch.delConfirm"))) void corre(() => deleteShift(s.id), t("mgr.sch.deleted")); }}>
                                {t("common.delete")}
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

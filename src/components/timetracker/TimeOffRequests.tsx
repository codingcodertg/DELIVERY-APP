"use client";

import { useCallback, useEffect, useState } from "react";
import { getMyTimeOff, submitTimeOff } from "@/app/timetracker/clock-in/actions/timeoff";
import { usePrefs } from "@/lib/prefs";
import { dateISO, fmtDayLong } from "@/lib/timetracker/helpers";

/**
 * Pedir tiempo libre y ver en qué quedó, dentro de "My Requests".
 *
 * Vive aquí porque es **la misma pregunta** que ya se hacía en esta pantalla: qué le he pedido
 * a mi encargado y qué me contestó. Que una petición sea de horas y la otra de días no cambia
 * lo que la persona viene a hacer; tenerlas en dos pestañas obligaba a acordarse de en cuál
 * estaba cada cosa (D-116).
 *
 * La mitad de gerente de la pantalla vieja —la cola de aprobar— no se mudó aquí: ya estaba en
 * Pendientes desde D-106. Aquí solo hay lo de uno mismo.
 */

const TYPES = ["vacation", "sick", "schedule_change", "shift_swap"] as const;

/**
 * El rótulo de cada tipo, en los dos idiomas (D-159).
 *
 * La clave —`vacation`, `sick`…— es lo que se guarda y no se traduce nunca: con ella cuenta
 * la oficina. Solo cambia lo que se lee.
 */
const LABEL: Record<string, { en: string; es: string }> = {
  vacation: { en: "Vacation", es: "Vacaciones" },
  sick: { en: "Sick", es: "Enfermedad" },
  schedule_change: { en: "Schedule change", es: "Cambio de horario" },
  shift_swap: { en: "Shift swap", es: "Cambio de turno" },
};

type Row = {
  id: string; type: string; start_date: string; end_date: string;
  note: string | null; status: string; manager_comment: string | null;
};

export function TimeOffRequests() {
  const { t, lang } = usePrefs();
  const hoy = dateISO(new Date());
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [type, setType] = useState<(typeof TYPES)[number]>("vacation");
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    const res = await getMyTimeOff();
    if (!res.ok) { setErr(res.message); return; }
    setErr(null);
    setRows(res.rows);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // La fecha de fin sigue a la de inicio mientras vaya por detrás. Sin esto, el error más
  // común de la pantalla vieja era mandar un rango invertido y que el servidor lo rechazara.
  function cambiaDesde(v: string) {
    setDesde(v);
    if (hasta < v) setHasta(v);
  }

  async function enviar() {
    setBusy(true);
    setMsg(null);
    const res = await submitTimeOff({ type, startDate: desde, endDate: hasta, note: nota || undefined });
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.message, ok: false }); return; }
    setMsg({ text: t("Sent — your manager has been notified.", "Enviado — se avisó a su encargado."), ok: true });
    setNota("");
    void load();
  }

  const dias = (r: Row) =>
    r.start_date === r.end_date
      ? fmtDayLong(r.start_date)
      : `${fmtDayLong(r.start_date)} → ${fmtDayLong(r.end_date)}`;

  return (
    <>
      <div className="card">
        <h2>{t("Request time off", "Solicitar tiempo libre")}</h2>
        <div className="grid g3">
          <div>
            <label>{t("Type", "Tipo")}</label>
            <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              {TYPES.map((ty) => <option key={ty} value={ty}>{lang === "es" ? LABEL[ty].es : LABEL[ty].en}</option>)}
            </select>
          </div>
          <div>
            <label>{t("From", "Desde")}</label>
            <input type="date" value={desde} onChange={(e) => cambiaDesde(e.target.value)} />
          </div>
          <div>
            <label>{t("To", "Hasta")}</label>
            <input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} />
          </div>
        </div>
        <label style={{ marginTop: 8 }}>{t("Reason (optional)", "Motivo (opcional)")}</label>
        <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder={t("e.g. family trip", "p. ej. viaje familiar")} />
        <button style={{ marginTop: 14 }} onClick={enviar} disabled={busy}>
          {busy ? "…" : t("Send request", "Enviar solicitud")}
        </button>
        {msg && <div className={`banner ${msg.ok ? "ok" : "err"}`} style={{ marginTop: 12 }}>{msg.text}</div>}
      </div>

      <div className="card">
        <h2>{t("My time off", "Mi tiempo libre")}</h2>
        {err && <div className="banner err">{err}</div>}
        {rows.length === 0 ? (
          <p className="muted">{t("You haven\u2019t asked for any yet.", "Todavía no ha pedido ninguno.")}</p>
        ) : (
          <table>
            <thead><tr><th>{t("Type", "Tipo")}</th><th>{t("Days", "Días")}</th><th>{t("Status", "Estado")}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{LABEL[r.type] ? (lang === "es" ? LABEL[r.type].es : LABEL[r.type].en) : r.type}</td>
                  <td className="small muted">
                    {dias(r)}
                    {r.note ? ` · “${r.note}”` : ""}
                    {/* El comentario del encargado es la razón por la que alguien vuelve a
                        esta pantalla después de que le contesten. Va con la fila, no escondido. */}
                    {r.manager_comment ? ` · ${t("manager", "encargado")}: “${r.manager_comment}”` : ""}
                  </td>
                  <td>
                    {r.status === "pending" ? <span className="pill wait">{t("Pending", "Pendiente")}</span>
                      : r.status === "approved" ? <span className="pill on">{t("Approved", "Aprobado")}</span>
                      : <span className="pill off">{t("Denied", "Rechazado")}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

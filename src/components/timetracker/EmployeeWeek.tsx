"use client";

import { useCallback, useEffect, useState } from "react";
import { getEmployeeWeek } from "@/app/timetracker/clock-in/actions/reports";
import { APP_SETTINGS, fmtDayLong } from "@/lib/timetracker/helpers";
import { useT } from "@/lib/timetracker/i18n";
import { TablaEstandar } from "@/components/TablaEstandar";

/**
 * La semana de una persona, desplegada desde su fila en Empleados (D-135).
 *
 * Es lo último que quedaba de "Today's Crew". Va aquí porque es la pregunta que uno se hace
 * mirando esa lista —*¿y esta persona qué hizo esta semana?*— y tenerla en otra pantalla
 * obligaba a apuntarse el nombre, salir y buscarlo.
 *
 * Se pide **al abrir**, una fila cada vez. Cargar la semana de las doce personas para que
 * alguien mire una sería doce veces el trabajo para un doceavo del provecho.
 *
 * G-9 (D-202): textos por claves mgr.ew.*. fmtDayLong no se toca: el día largo sigue en inglés;
 * hhmm sigue en "en-US" (formato de hora, no texto).
 */

type Data = Extract<Awaited<ReturnType<typeof getEmployeeWeek>>, { ok: true }>;

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: APP_SETTINGS.timeZone /* G-25: la zona del ajuste, no America/Chicago a pelo */ });
const dia = (iso: string) => iso.slice(0, 10);
const horas = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;

export function EmployeeWeek({ employeeId }: { employeeId: string }) {
  const t = useT();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await getEmployeeWeek(employeeId);
    if (!r.ok) setErr(r.message); else { setErr(null); setD(r); }
  }, [employeeId]);

  useEffect(() => { void load(); }, [load]);

  if (err) return <div className="banner err">{err}</div>;
  if (!d) return <div className="hint">{t("mgr.ew.loading")}</div>;

  // Fichajes y descansos juntos, agrupados por día: así se lee la jornada tal como pasó en vez
  // de tener que cruzar dos listas por la hora.
  const filas = [
    ...d.punches.map((p) => ({
      k: p.id, cuando: p.clockInAt,
      que: p.manual ? t("mgr.ew.shiftManual") : t("mgr.ew.shift"),
      cls: "on", desde: p.clockInAt, hasta: p.clockOutAt, min: p.minutes,
      aviso: p.onSite === false ? t("mgr.ew.offSite") : null,
    })),
    ...d.breaks.map((b) => ({
      k: b.id, cuando: b.leftAt,
      que: b.reason === "lunch" ? t("mgr.ew.lunch") : t("mgr.ew.out"),
      cls: b.reason === "lunch" ? "wait" : "", desde: b.leftAt, hasta: b.returnedAt, min: b.minutes,
      aviso: null as string | null,
    })),
  ].sort((a, b) => a.cuando.localeCompare(b.cuando));

  // Una sola tabla, con el día en su columna: antes eran una por día, y cada una pedía su propia vista guardada.
  return (
    <div className="box" style={{ marginTop: 8 }}>
      <div className="between">
        <span className="small muted">{t("mgr.ew.period", { from: d.period[0], to: d.period[6] })}</span>
        <span>
          <strong>{horas(d.totalMin)}</strong>
          {d.lunchMin > 0 && <span className="small muted"> · 🍽 {d.lunchMin}m</span>}
          {d.outMin > 0 && <span className="small muted"> · 🚚 {d.outMin}m</span>}
        </span>
      </div>

      {filas.length === 0 ? (
        <p className="muted small" style={{ marginTop: 8 }}>{t("mgr.ew.nothing")}</p>
      ) : (
        <div style={{ marginTop: 10 }}>
          <TablaEstandar id={`tt-semana-empleado-${employeeId}`} claveDe={(r) => r.k} filas={filas} sinCaja
            columnas={[
              { key: "dia", en: t("mgr.rep.colDay"), es: t("mgr.rep.colDay"), ancho: 150, valor: (r) => dia(r.cuando), etiqueta: (v) => fmtDayLong(String(v)),
                celda: (r) => fmtDayLong(dia(r.cuando)) },
              { key: "que", en: t("emp.punch.colWhat"), es: t("emp.punch.colWhat"), ancho: 170, valor: (r) => r.que,
                celda: (r) => <span className={`pill ${r.cls}`}>{r.que}</span> },
              { key: "horario", en: t("emp.week.colInOut"), es: t("emp.week.colInOut"), ancho: 170, valor: (r) => r.desde,
                celda: (r) => <>{hhmm(r.desde)} – {r.hasta ? hhmm(r.hasta) : <span className="pill wait">{t("mgr.ew.open")}</span>}</>, clase: "small nowrap" },
              { key: "tiempo", en: t("emp.punch.colTime"), es: t("emp.punch.colTime"), ancho: 110, numerico: true, valor: (r) => r.min,
                celda: (r) => horas(r.min), clase: "num small nowrap" },
              { key: "aviso", en: "Notice", es: "Aviso", ancho: 160, valor: (r) => r.aviso,
                celda: (r) => (r.aviso ? <span className="pill off">{r.aviso}</span> : null), clase: "small" },
            ]} />
        </div>
      )}
    </div>
  );
}

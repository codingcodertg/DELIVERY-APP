"use client";

import { useEffect, useState } from "react";
import type { getMyDay } from "@/app/timetracker/clock-in/actions/clock";
import { useAccionesDeFichar } from "@/components/timetracker/Capacitacion";
import { APP_SETTINGS } from "@/lib/timetracker/helpers";
import { useT } from "@/lib/timetracker/i18n";

/**
 * «Fichajes de hoy» (Today's punches), como tarjeta suelta (D-489).
 *
 * Vivía dentro de PunchPanel, debajo del reloj. El dueño pidió (2026-10-06) que al EMPLEADO le
 * salga en «Mi semana», junto a «Mi boletín», y que debajo del reloj solo queden «Mi horario» y
 * «Notas del día». El admin lo sigue viendo donde estaba. Para no tener dos copias de la misma
 * tabla, la tarjeta sale de aquí y la usan las dos pantallas; `semanaDePago` decide si lleva
 * encima la cifra «Esta semana de pago», que al empleado ya no se le enseña.
 */
export type DiaDeFichaje = Extract<Awaited<ReturnType<typeof getMyDay>>, { ok: true }>;

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: APP_SETTINGS.timeZone /* G-25: la zona del ajuste, no America/Chicago a pelo */ });
export const horasYMinutos = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;

export function FichajesDeHoy({ d, semanaDePago }: { d: DiaDeFichaje; semanaDePago: boolean }) {
  const t = useT();
  return (
    <div className="card">
      <div className={semanaDePago ? "grid g2" : "grid"}>
        <div className="stat">
          <div className="small muted">{t("emp.punch.today")}</div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{horasYMinutos(d.todayMinutes)}</div>
        </div>
        {semanaDePago && (
          <div className="stat">
            <div className="small muted">{t("emp.punch.payWeek")}</div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{horasYMinutos(d.weekMinutes)}</div>
          </div>
        )}
      </div>

      <h2 style={{ marginTop: 16 }}>{t("emp.punch.todayPunches")}</h2>
      {d.today.length === 0 && d.breaks.length === 0 ? (
        <p className="muted">{t("emp.punch.nothingToday")}</p>
      ) : (
        <table>
          <thead><tr><th>{t("emp.punch.colWhat")}</th><th>{t("emp.punch.colIn")}</th><th>{t("emp.punch.colOut")}</th><th style={{ textAlign: "right" }}>{t("emp.punch.colTime")}</th></tr></thead>
          <tbody>
            {/* Fichajes y descansos EN UNA SOLA tabla, ordenados por hora. Antes solo salían
                los fichajes, así que un almuerzo de 40 minutos no aparecía por ninguna parte.
                En dos tablas habría que reconstruir el día mentalmente; así se lee de arriba
                abajo tal como pasó: entré, comí, volví, salí a repartir. */}
            {[
              ...d.today.map((e) => ({
                k: e.id, orden: e.clockInAt, que: t("emp.punch.shift"), cls: "on",
                desde: e.clockInAt, hasta: e.clockOutAt, min: e.minutes,
              })),
              ...d.breaks.map((b) => ({
                k: b.id, orden: b.leftAt,
                que: b.reason === "lunch" ? t("emp.punch.lunchRow") : t("emp.punch.outRow"),
                cls: b.reason === "lunch" ? "wait" : "",
                desde: b.leftAt, hasta: b.returnedAt, min: b.minutes,
              })),
            ]
              .sort((a, b) => a.orden.localeCompare(b.orden))
              .map((r) => (
                <tr key={r.k}>
                  <td className="nowrap"><span className={`pill ${r.cls}`}>{r.que}</span></td>
                  <td className="nowrap">{hhmm(r.desde)}</td>
                  <td className="nowrap">{r.hasta ? hhmm(r.hasta) : <span className="pill wait">{t("emp.punch.open")}</span>}</td>
                  <td className="nowrap" style={{ textAlign: "right" }}>{horasYMinutos(r.min)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
      {(d.lunchMinutes > 0 || d.outMinutes > 0) && (
        // El total del día, por separado: comer y salir a repartir no son lo mismo ni para
        // la nómina ni para quien revisa.
        <p className="small muted" style={{ marginTop: 8 }}>
          {d.lunchMinutes > 0 && <>🍽 {t("emp.punch.lunch")} {d.lunchMinutes} min</>}
          {d.lunchMinutes > 0 && d.outMinutes > 0 && " · "}
          {d.outMinutes > 0 && <>🚚 {t("emp.punch.out")} {d.outMinutes} min</>}
        </p>
      )}
    </div>
  );
}

/**
 * El día de fichaje de quien mira, leído una vez. Para «Mi semana», que no tiene el estado de
 * PunchPanel. `null` mientras carga o si falló: la pantalla no pinta la tarjeta en ese caso.
 */
export function useMiDiaDeFichaje(activo: boolean): DiaDeFichaje | null {
  const [d, setD] = useState<DiaDeFichaje | null>(null);
  // En práctica (D-490), el día real con lo practicado encima, igual que bajo el reloj.
  const { getMyDay } = useAccionesDeFichar();
  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    void getMyDay().then((r) => { if (vivo && r.ok) setD(r); });
    return () => { vivo = false; };
  }, [activo, getMyDay]);
  return d;
}

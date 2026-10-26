"use client";

import { useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { timeTrackerFor } from "@/app/recruiting/actions/hr";
import {
  pagosDelEmpleado, semanasDeHoras, totalesDeHoras, totalesDePagos, type Pago, type SemanaDeHoras,
} from "@/lib/recruiting/horas-del-expediente";

/**
 * El bloque «Time Tracker» del expediente (D-NEXT): todas las semanas con horas y todos los
 * pagos de esa cuenta, de lo más reciente a lo más viejo. Solo lectura; se carga al abrir la ficha.
 */
export function BloqueTimeTracker({ profileId }: { profileId: string | null }) {
  const { t, lang } = usePrefs();
  const [estado, setEstado] = useState<
    | { k: "cargando" }
    | { k: "error"; msg: string }
    | { k: "listo"; semanas: SemanaDeHoras[]; pagos: Pago[]; avisos: string[] }
  >({ k: "cargando" });

  useEffect(() => {
    if (!profileId) return;
    let vivo = true;
    void timeTrackerFor(profileId).then((r) => {
      if (!vivo) return;
      if (!r.ok) setEstado({ k: "error", msg: r.message });
      else setEstado({ k: "listo", semanas: semanasDeHoras(r.horas), pagos: pagosDelEmpleado(r.lotes, r.talones), avisos: r.avisos });
    }).catch((e: unknown) => { if (vivo) setEstado({ k: "error", msg: e instanceof Error ? e.message : String(e) }); });
    return () => { vivo = false; };
  }, [profileId]);

  const dinero = (n: number) => n.toLocaleString(lang === "es" ? "es-US" : "en-US", { style: "currency", currency: "USD" });
  const horas = (n: number) => n.toLocaleString(lang === "es" ? "es-US" : "en-US", { maximumFractionDigits: 2 });

  return (
    <div data-bloque="time-tracker">
      <div className="sec-head">
        <span className="sec-title">{t("TIME TRACKER", "TIME TRACKER")}</span>
      </div>
      {!profileId ? (
        <span className="hint" style={{ marginTop: 0 }}>
          {t("No hub account linked, so there are no Time Tracker hours or payments to show.",
            "Sin cuenta del hub vinculada: no hay horas ni pagos del Time Tracker que mostrar.")}
        </span>
      ) : estado.k === "cargando" ? (
        <span className="hint" style={{ marginTop: 0 }}>{t("Loading…", "Cargando…")}</span>
      ) : estado.k === "error" ? (
        <span className="hint" style={{ marginTop: 0, color: "var(--red)" }}>
          {t("Could not read the Time Tracker: ", "No se pudo leer el Time Tracker: ")}{estado.msg}
        </span>
      ) : (
        <Contenido semanas={estado.semanas} pagos={estado.pagos} avisos={estado.avisos} dinero={dinero} horas={horas} />
      )}
    </div>
  );
}

function Contenido({ semanas, pagos, avisos, dinero, horas }: {
  semanas: SemanaDeHoras[]; pagos: Pago[]; avisos: string[];
  dinero: (n: number) => string; horas: (n: number) => string;
}) {
  const { t } = usePrefs();
  const th = totalesDeHoras(semanas);
  const tp = totalesDePagos(pagos);
  const caja = { overflowX: "auto" as const, maxHeight: 320, overflowY: "auto" as const, marginBottom: 12 };

  return (
    <>
      {avisos.length > 0 && (
        <div className="hint" style={{ marginTop: 0, color: "var(--red)" }}>
          {t("Part of the data could not be read: ", "Parte de los datos no se pudo leer: ")}{avisos.join(" · ")}
        </div>
      )}

      <div style={{ fontWeight: 600, margin: "6px 0" }}>{t("Hours by pay week", "Horas por semana de pago")}</div>
      {semanas.length === 0 ? (
        <div className="hint" style={{ marginTop: 0 }}>{t("No tracked hours.", "Sin horas registradas.")}</div>
      ) : (
        <div style={caja}>
          <table data-tabla="horas">
            <thead>
              <tr>
                <th>{t("Week", "Semana")}</th>
                <th>{t("Clock-in hours", "Horas de fichaje")}</th>
                <th>{t("Project hours", "Horas de proyecto")}</th>
              </tr>
            </thead>
            <tbody>
              {semanas.map((s) => (
                <tr key={s.desde}>
                  <td>{s.desde} – {s.hasta}{s.revisar && (
                    <span className="badge" style={{ marginLeft: 6 }}
                      title={t("Has both clock-in and project hours this week; they are not added together.",
                        "Tiene fichaje y horas de proyecto esta semana; no se suman.")}>
                      {t("review", "revisar")}
                    </span>
                  )}</td>
                  <td>{horas(s.fichaje)}</td>
                  <td>{horas(s.proyecto)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>{t("Total", "Total")} · {th.semanas} {t("weeks", "semanas")}</th>
                <th>{horas(th.fichaje)}</th>
                <th>{horas(th.proyecto)}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div style={{ fontWeight: 600, margin: "6px 0" }}>{t("Payments", "Pagos")}</div>
      {pagos.length === 0 ? (
        <div className="hint" style={{ marginTop: 0 }}>{t("No payments recorded.", "Sin pagos registrados.")}</div>
      ) : (
        <div style={caja}>
          <table data-tabla="pagos">
            <thead>
              <tr>
                <th>{t("Date", "Fecha")}</th>
                <th>{t("Period", "Periodo")}</th>
                <th>{t("Method", "Método")}</th>
                <th>{t("Hours", "Horas")}</th>
                <th>{t("Amount", "Monto")}</th>
                <th>{t("Status", "Estado")}</th>
              </tr>
            </thead>
            <tbody>
              {pagos.map((p) => (
                <tr key={`${p.origen}-${p.id}`}>
                  <td>{p.fecha}</td>
                  <td>{p.periodo ?? "—"}</td>
                  <td>{p.metodo ?? "—"}</td>
                  <td>{p.horas == null ? "—" : horas(p.horas)}</td>
                  <td>{dinero(p.monto)}</td>
                  <td>{p.pagado ? t("paid", "pagado") : t("pending", "pendiente")}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={4}>{t("Total paid", "Total pagado")}</th>
                <th>{dinero(tp.pagado)}</th>
                <th>{tp.pendiente > 0 ? `${t("pending", "pendiente")} ${dinero(tp.pendiente)}` : ""}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}

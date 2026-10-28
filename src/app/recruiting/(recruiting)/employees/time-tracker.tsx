"use client";

import { useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { timeTrackerFor } from "@/app/recruiting/actions/hr";
import {
  pagosDelEmpleado, semanasConPago, semanasDeHoras, totalesDeHoras, totalesDePagos, type Pago, type SemanaConPago,
} from "@/lib/recruiting/horas-del-expediente";

/**
 * El bloque «Time Tracker» del expediente (D-686): semana por semana, las horas y su pago, en UNA tabla (D-NEXT; el
 * dueño: «esas horas pueden ir en la misma cosa de pagos, ahí mismo […] es lo mismo tener duplicado eso»). Solo
 * lectura; se carga al abrir la ficha. El título lo pone la Seccion que lo envuelve.
 */
export function BloqueTimeTracker({ profileId }: { profileId: string | null }) {
  const { t, lang } = usePrefs();
  const [estado, setEstado] = useState<
    | { k: "cargando" }
    | { k: "error"; msg: string }
    | { k: "listo"; filas: SemanaConPago[]; pagos: Pago[]; avisos: string[] }
  >({ k: "cargando" });

  useEffect(() => {
    if (!profileId) return;
    let vivo = true;
    void timeTrackerFor(profileId).then((r) => {
      if (!vivo) return;
      if (!r.ok) setEstado({ k: "error", msg: r.message });
      else {
        const pagos = pagosDelEmpleado(r.lotes, r.talones);
        setEstado({ k: "listo", filas: semanasConPago(semanasDeHoras(r.horas), pagos), pagos, avisos: r.avisos });
      }
    }).catch((e: unknown) => { if (vivo) setEstado({ k: "error", msg: e instanceof Error ? e.message : String(e) }); });
    return () => { vivo = false; };
  }, [profileId]);

  const dinero = (n: number) => new Intl.NumberFormat(lang === "es" ? "es-US" : "en-US", { style: "currency", currency: "USD" }).format(n);
  const horas = (n: number) => new Intl.NumberFormat(lang === "es" ? "es-US" : "en-US", { maximumFractionDigits: 2 }).format(n);

  return (
    <div data-bloque="time-tracker">
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
        <Contenido filas={estado.filas} pagos={estado.pagos} avisos={estado.avisos} dinero={dinero} horas={horas} />
      )}
    </div>
  );
}

function Contenido({ filas, pagos, avisos, dinero, horas }: {
  filas: SemanaConPago[]; pagos: Pago[]; avisos: string[];
  dinero: (n: number) => string; horas: (n: number) => string;
}) {
  const { t } = usePrefs();
  const th = totalesDeHoras(filas);
  const tp = totalesDePagos(pagos);

  return (
    <>
      {avisos.length > 0 && (
        <div className="hint" style={{ marginTop: 0, color: "var(--red)" }}>
          {t("Part of the data could not be read: ", "Parte de los datos no se pudo leer: ")}{avisos.join(" · ")}
        </div>
      )}
      {filas.length === 0 ? (
        <div className="hint" style={{ marginTop: 0 }}>{t("No tracked hours or payments.", "Sin horas ni pagos registrados.")}</div>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: 360, overflowY: "auto", marginBottom: 12 }}>
          <table data-tabla="semanas-y-pagos">
            <thead>
              <tr>
                <th>{t("Week", "Semana")}</th>
                <th>{t("Clock-in hours", "Horas de fichaje")}</th>
                <th>{t("Project hours", "Horas de proyecto")}</th>
                <th>{t("Paid", "Pago")}</th>
                <th>{t("Method", "Método")}</th>
                <th>{t("Status", "Estado")}</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={`${f.desde}-${f.pago?.origen ?? "sin"}-${f.pago?.id ?? ""}`} data-semana={f.desde}>
                  <td>
                    {f.desde}{f.hasta ? ` – ${f.hasta}` : ""}
                    {f.revisar && (
                      <span className="badge" style={{ marginLeft: 6 }}
                        title={t("Has both clock-in and project hours this week; they are not added together.",
                          "Tiene fichaje y horas de proyecto esta semana; no se suman.")}>
                        {t("review", "revisar")}
                      </span>
                    )}
                  </td>
                  <td>{f.fichaje ? horas(f.fichaje) : "—"}</td>
                  <td>{f.proyecto ? horas(f.proyecto) : "—"}</td>
                  <td>{f.pago ? dinero(f.pago.monto) : "—"}</td>
                  <td>{f.pago?.metodo ?? "—"}</td>
                  <td>{!f.pago ? (
                    <span className="hint" style={{ marginTop: 0 }}>{t("no payment", "sin pago")}</span>
                  ) : f.pago.pagado ? t("paid", "pagado") : t("pending", "pendiente")}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>{t("Total", "Total")} · {th.semanas} {t("weeks", "semanas")}</th>
                <th>{horas(th.fichaje)}</th>
                <th>{horas(th.proyecto)}</th>
                <th>{dinero(tp.pagado)}</th>
                <th colSpan={2}>{tp.pendiente > 0 ? `${t("pending", "pendiente")} ${dinero(tp.pendiente)}` : ""}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}

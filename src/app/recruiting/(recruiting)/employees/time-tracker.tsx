"use client";

import { mensajeDeErrorAlCargar } from "@/lib/mensaje-de-error";
import { useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { AVISO_DEMO, MODO_DEMO } from "@/lib/recruiting/modo-demo";
import { timeTrackerFor } from "@/app/recruiting/actions/hr";
import {
  pagosDelEmpleado, semanasConPago, semanasDeHoras, totalesDeHoras, totalesDePagos, type Pago, type SemanaConPago,
} from "@/lib/recruiting/horas-del-expediente";

/**
 * El bloque «Time Tracker» del expediente (D-686): semana por semana, las horas y su pago, en UNA tabla (D-720; el
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
    // D-932: las horas viven en el servidor; el demo lo dice en vez de pedirlas.
    if (MODO_DEMO) { setEstado({ k: "error", msg: lang === "es" ? AVISO_DEMO.es : AVISO_DEMO.en }); return; }
    let vivo = true;
    void timeTrackerFor(profileId).then((r) => {
      if (!vivo) return;
      if (!r.ok) setEstado({ k: "error", msg: mensajeDeErrorAlCargar(r.message) });
      else {
        const pagos = pagosDelEmpleado(r.lotes, r.talones);
        setEstado({ k: "listo", filas: semanasConPago(semanasDeHoras(r.horas), pagos), pagos, avisos: r.avisos });
      }
    }).catch((e: unknown) => { if (vivo) setEstado({ k: "error", msg: e instanceof Error ? e.message : String(e) }); });
    return () => { vivo = false; };
  }, [profileId, lang]);

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

  // Las columnas son de la tabla estándar (▾, ⚙, mover, anchos); los totales van en una línea debajo.
  const columnas: ColumnaEstandar<SemanaConPago>[] = [
    { key: "semana", en: "Week", es: "Semana", ancho: 200, fija: true, valor: (f) => f.desde,
      celda: (f) => (
        <>
          {f.desde}{f.hasta ? ` – ${f.hasta}` : ""}
          {f.revisar && (
            <span className="badge" style={{ marginLeft: 6 }}
              title={t("Has both clock-in and project hours this week; they are not added together.",
                "Tiene fichaje y horas de proyecto esta semana; no se suman.")}>
              {t("review", "revisar")}
            </span>
          )}
        </>
      ) },
    { key: "fichaje", en: "Clock-in hours", es: "Horas de fichaje", ancho: 150, numerico: true, valor: (f) => f.fichaje || null, celda: (f) => (f.fichaje ? horas(f.fichaje) : "—") },
    { key: "proyecto", en: "Project hours", es: "Horas de proyecto", ancho: 150, numerico: true, valor: (f) => f.proyecto || null, celda: (f) => (f.proyecto ? horas(f.proyecto) : "—") },
    { key: "pago", en: "Paid", es: "Pago", ancho: 120, numerico: true, valor: (f) => f.pago?.monto ?? null, celda: (f) => (f.pago ? dinero(f.pago.monto) : "—") },
    { key: "metodo", en: "Method", es: "Método", ancho: 130, valor: (f) => f.pago?.metodo ?? null },
    { key: "estado", en: "Status", es: "Estado", ancho: 130, valor: (f) => (!f.pago ? t("no payment", "sin pago") : f.pago.pagado ? t("paid", "pagado") : t("pending", "pendiente")),
      celda: (f) => (!f.pago ? (
        <span className="hint" style={{ marginTop: 0 }}>{t("no payment", "sin pago")}</span>
      ) : f.pago.pagado ? t("paid", "pagado") : t("pending", "pendiente")) },
  ];

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
        <>
          <TablaEstandar
            id="rrhh-expediente-time-tracker"
            data-tabla="semanas-y-pagos"
            sinCaja
            filas={filas}
            claveDe={(f) => `${f.desde}-${f.pago?.origen ?? "sin"}-${f.pago?.id ?? ""}`}
            columnas={columnas}
          />
          <div className="hint" data-totales-time-tracker>
            {t("Total", "Total")} · {th.semanas} {t("weeks", "semanas")} · {t("Clock-in", "Fichaje")} {horas(th.fichaje)} · {t("Project", "Proyecto")} {horas(th.proyecto)} · {t("Paid", "Pagado")} {dinero(tp.pagado)}
            {tp.pendiente > 0 ? ` · ${t("pending", "pendiente")} ${dinero(tp.pendiente)}` : ""}
          </div>
        </>
      )}
    </>
  );
}

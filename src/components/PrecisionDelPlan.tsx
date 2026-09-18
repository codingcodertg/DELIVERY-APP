"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
import type { ErrorDeHora, ReporteDePrecision } from "@/lib/route-plan/llegadas";

/**
 * «¿Se cumplió el plan?» — la hora real de cada parada del plan PUBLICADO contra la estimada (D-NEXT).
 *
 * El orden de la pantalla es el orden de la honestidad: PRIMERO cuánto dato hay y de quién —choferes con
 * ruta, cuántos han entrado alguna vez a la app, cuántos abrieron turno, cuántos mandaron alguna posición—,
 * DESPUÉS por qué falta el resto, y solo al final el error, separado por fuente y sin mezclar nunca la
 * llegada medida por GPS con la hora a la que el chofer tocó «entregado».
 *
 * No decide nada: todo llega calculado de `/api/route-plan/actuals`. Solo admin y logística.
 */

type Chofer = { driver_id: string; nombre: string; ha_entrado: boolean | null; con_turno: boolean; posiciones: number };
type Respuesta = { reporte: ReporteDePrecision; choferes: Chofer[]; guardadas: number; noGuardadas: string[] };

const MOTIVO: Record<string, [string, string]> = {
  sin_chofer: ["the stop has no driver", "la parada no tiene chofer"], sin_punto: ["the stop has no map point", "la parada no tiene punto en el mapa"],
  sin_posiciones_ese_dia: ["the driver sent no position that day", "el chofer no mandó ninguna posición ese día"],
  sin_posiciones_cerca: ["no position near the stop", "ninguna posición cerca de la parada"],
  la_marco_otra_persona: ["someone else marked it, not the driver", "la marcó otra persona, no el chofer"],
};

export function PrecisionDelPlan({ date }: { date: string }) {
  const { t, lang } = usePrefs();
  const es = lang === "es" ? 1 : 0;
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [r, setR] = useState<Respuesta | null>(null);
  const [sinPlan, setSinPlan] = useState(false);

  const mide = async () => {
    setOcupado(true); setError(null); setSinPlan(false);
    try {
      const res = await fetch("/api/route-plan/actuals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok || !b.ok) setError(String(b.error ?? res.status)); else if (!b.plan) { setSinPlan(true); setR(null); } else setR(b as Respuesta);
    } catch { setError(t("Network error.", "Error de red.")); }
    setOcupado(false);
  };

  const estadistica = (e: ErrorDeHora | null, n: number, queMide: string) => (e
    ? t(`${queMide}: median ${e.medianaMin > 0 ? "+" : ""}${e.medianaMin} min, 9 of 10 within ${e.p90AbsMin} min, average ${e.sesgoMin > 0 ? "+" : ""}${e.sesgoMin} min (positive = later than estimated), ${e.dentroDe15} of ${e.n} within 15 min.`,
        `${queMide}: mediana ${e.medianaMin > 0 ? "+" : ""}${e.medianaMin} min, 9 de cada 10 dentro de ${e.p90AbsMin} min, media ${e.sesgoMin > 0 ? "+" : ""}${e.sesgoMin} min (positivo = más tarde de lo estimado), ${e.dentroDe15} de ${e.n} dentro de 15 min.`)
    : t(`${queMide}: ${n} stop(s) — too few to say anything (fewer than 8).`, `${queMide}: ${n} parada(s) — muy pocas para decir nada (menos de 8).`));

  return (
    <div style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
      <button type="button" className="btn btn-ghost btn-sm" disabled={ocupado} onClick={() => void mide()}>
        {ocupado ? t("Measuring…", "Midiendo…") : t("Was the plan met? Real vs estimated times", "¿Se cumplió el plan? Horas reales contra estimadas")}
      </button>
      {error && <div className="hint" style={{ margin: "6px 0 0", color: "var(--red)" }}>{error}</div>}
      {sinPlan && <div className="hint" style={{ margin: "6px 0 0" }}>{t("There is no published plan for this date.", "No hay un plan publicado para esta fecha.")}</div>}
      {r && (
        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          <div>
            <b>{t("How much data there is", "Cuánto dato hay")}:</b>{" "}
            {t(`${r.reporte.captura.choferesConRuta} driver(s) with a route · ${r.reporte.captura.hanIniciadoSesion} have ever signed in to the app · ${r.reporte.captura.conTurno} opened a shift that day · ${r.reporte.captura.conPosiciones} sent any GPS position.`,
               `${r.reporte.captura.choferesConRuta} chofer(es) con ruta · ${r.reporte.captura.hanIniciadoSesion} han entrado alguna vez a la app · ${r.reporte.captura.conTurno} abrieron turno ese día · ${r.reporte.captura.conPosiciones} mandaron alguna posición GPS.`)}
          </div>
          <div className="hint" style={{ margin: 0 }}>
            {t("GPS only exists with an open shift AND from the installed app (not a browser). A gap here is a capture gap, not a routing error.",
               "El GPS solo existe con un turno abierto Y desde la app instalada (no desde un navegador). Un hueco aquí es de captura, no un error de la ruta.")}
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {r.choferes.map((c) => (
              <li key={c.driver_id}>
                <b>{c.nombre}</b>:{" "}
                {c.ha_entrado === null ? t("sign-in unknown", "no se sabe si ha entrado") : c.ha_entrado ? t("has signed in", "ha entrado a la app") : t("has NEVER signed in — sees no notice and no route", "NUNCA ha entrado a la app — no ve avisos ni su ruta")}
                {" · "}{c.con_turno ? t("opened a shift", "abrió turno") : t("no shift that day", "sin turno ese día")}
                {" · "}{t(`${c.posiciones} position(s)`, `${c.posiciones} posición(es)`)}
              </li>
            ))}
          </ul>
          <div>
            <b>{t(`Of ${r.reporte.paradas} stops`, `De ${r.reporte.paradas} paradas`)}:</b>{" "}
            {t(`${r.reporte.conGPS} with GPS arrival · ${r.reporte.conToque} with only the driver's tap · ${r.reporte.paradas - r.reporte.conGPS - r.reporte.conToque} with no data.`,
               `${r.reporte.conGPS} con llegada por GPS · ${r.reporte.conToque} solo con el toque del chofer · ${r.reporte.paradas - r.reporte.conGPS - r.reporte.conToque} sin dato.`)}
          </div>
          {Object.entries(r.reporte.sinDato).filter(([, n]) => n > 0).length > 0 && (
            <div className="hint" style={{ margin: 0 }}>
              {t("Why there is no data", "Por qué no hay dato")}: {Object.entries(r.reporte.sinDato).filter(([, n]) => n > 0).map(([m, n]) => `${n} — ${MOTIVO[m]?.[es] ?? m}`).join(" · ")}.
            </div>
          )}
          <div>{estadistica(r.reporte.llegadaPorGPS, r.reporte.conGPS, t("Real ARRIVAL (GPS) vs estimated arrival", "LLEGADA real (GPS) contra llegada estimada"))}</div>
          <div>{estadistica(r.reporte.cierrePorToque, r.reporte.conToque, t("Driver's TAP (stop closed) vs estimated departure", "TOQUE del chofer (parada cerrada) contra salida estimada"))}</div>
          <div className="hint" style={{ margin: 0 }}>
            {t("These are two different measures and are never combined: the tap includes the service time and how long the driver took to tap.",
               "Son dos medidas distintas y no se combinan nunca: el toque incluye lo que tardó el servicio y lo que tardó el chofer en tocar.")}
            {r.noGuardadas.length > 0 && ` ${t(`${r.noGuardadas.length} real time(s) could not be saved.`, `${r.noGuardadas.length} hora(s) real(es) no se pudieron guardar.`)}`}
          </div>
        </div>
      )}
    </div>
  );
}

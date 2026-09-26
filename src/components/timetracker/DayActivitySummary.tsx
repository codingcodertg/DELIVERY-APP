"use client";

import { useMemo, useState } from "react";
import { useT } from "@/lib/timetracker/i18n";
import { fmtClock, fmtTime } from "@/lib/timetracker/helpers";
import { UMBRAL_HORA_BAJA_PCT, pctEntero, resumenDelDia, type MuestraActividad } from "@/lib/timetracker/resumen-dia";

// D-403. Resumen del día del empleado y «horas bajas», en la cabecera de Auditoría → Capturas de
// escritorio, a la derecha del selector de fecha. Toda la cuenta está en `resumen-dia.ts` (pura,
// con pruebas); aquí solo se pinta. `shots` son los `dayShots` que `WorkDiary` ya filtró por
// empleado y día, y `totalSec` el total de sesiones que ya enseñaba: al cambiar de día cambia
// `shots`, y al cambiar de empleado `TeamDiary` remonta `WorkDiary` entero (`key={activeUid}`).
export function DayActivitySummary({ shots, totalSec, hourLabel }: { shots: MuestraActividad[]; totalSec: number; hourLabel: (h: number) => string }) {
  const t = useT();
  const [abierto, setAbierto] = useState(false);
  const r = useMemo(() => resumenDelDia(shots, totalSec), [shots, totalSec]);

  const n = r.horasBajas.length;
  const lista = r.horasBajas.map((h) => `${hourLabel(h.hora)} · ${pctEntero(h.media)}%`);
  const sinDatos = r.horasSinDatos.length ? [t("mgr.diary.sum.noData", { n: r.horasSinDatos.length })] : [];
  const titulo = [...(n ? lista : [t("mgr.diary.sum.lowNone", { pct: UMBRAL_HORA_BAJA_PCT })]), ...sinDatos].join("\n");

  return (
    <div className="row" style={{ alignItems: "center", gap: 6, position: "relative" }} data-resumen-dia>
      <span className="chip" title={t("mgr.diary.sum.workedTitle")}>⏱ {fmtClock(r.segundosTrabajados)} {t("mgr.diary.hrs")}</span>
      <span className="chip" title={t("mgr.diary.sum.avgTitle")}>
        ⚡ {r.actividadMediaPct === null ? "—" : t("mgr.diary.sum.avg", { pct: r.actividadMediaPct })}
      </span>
      <span className="chip">📷 {r.capturas} {t("mgr.diary.shots")}</span>
      {r.primeraMs !== null && r.ultimaMs !== null && (
        <span className="chip" title={t("mgr.diary.sum.spanTitle")}>🕘 {fmtTime(r.primeraMs)} – {fmtTime(r.ultimaMs)}</span>
      )}
      <button
        type="button"
        className="chip"
        data-horas-bajas={n}
        title={titulo}
        aria-expanded={abierto}
        disabled={n === 0}
        onClick={() => setAbierto((v) => !v)}
        style={{
          border: "none", cursor: n ? "pointer" : "default", fontWeight: 600, padding: "3px 10px", fontSize: 12,
          background: n ? "var(--tt-warn)" : "var(--tt-chip)", color: n ? "#3a2800" : "var(--tt-txt)",
        }}
      >
        {t("mgr.diary.sum.low", { n, pct: UMBRAL_HORA_BAJA_PCT })}
      </button>
      {abierto && n > 0 && (
        <div className="box" role="dialog" data-horas-bajas-lista
          style={{ position: "absolute", top: "100%", right: 0, zIndex: 5, marginTop: 6, minWidth: 220, background: "var(--tt-panel)", border: "1px solid var(--tt-line)", borderRadius: 10, padding: 10, boxShadow: "0 6px 20px rgba(0,0,0,.25)" }}>
          <div className="small muted" style={{ marginBottom: 6 }}>{t("mgr.diary.sum.lowHead", { pct: UMBRAL_HORA_BAJA_PCT })}</div>
          {r.horasBajas.map((h) => (
            <div key={h.hora} className="small nowrap">{hourLabel(h.hora)} · <b>{pctEntero(h.media)}%</b> <span className="muted">({h.muestras})</span></div>
          ))}
          {r.horasSinDatos.length > 0 && (
            <div className="small muted" style={{ marginTop: 6 }}>{t("mgr.diary.sum.noData", { n: r.horasSinDatos.length })}</div>
          )}
        </div>
      )}
    </div>
  );
}

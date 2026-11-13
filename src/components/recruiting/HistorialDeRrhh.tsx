"use client";

import { mensajeDeErrorAlCargar } from "@/lib/mensaje-de-error";
import { useCallback, useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { MODO_DEMO } from "@/lib/recruiting/modo-demo";
import { listHistory } from "@/app/recruiting/actions/historial";
import { esDeEmpleado, etiquetaDeHistorial, type EntradaDeHistorial } from "@/lib/recruiting/historial";
import { fmtDateTime } from "@/lib/utils";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";

/**
 * El historial de RR. HH. (D-734, migración 212) como tabla: cuándo, quién lo hizo, qué, a quién / qué activo, detalle
 * y motivo. Sin filtro es todo; con `employeeId` lo de esa persona; con `assetId` lo de ese correo o número. La tabla
 * es `<TablaEstandar>` (CLAUDE.md, docs/ESTANDAR-DE-TABLAS.md): ▾, ⚙, cabeceras que se mueven y anchos por persona.
 */
export function HistorialDeRrhh({ employeeId, assetId, recarga = 0, compacto = false }: {
  employeeId?: string; assetId?: string; recarga?: number; compacto?: boolean;
}) {
  const { t, lang } = usePrefs();
  const [rows, setRows] = useState<EntradaDeHistorial[] | null>(null);
  const [sinTabla, setSinTabla] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    // D-932: en el demo no hay historial de RR. HH. (vive en el servidor); la tabla sale vacía y no se llama a nada.
    if (MODO_DEMO) { setRows([]); setErr(null); return; }
    const r = await listHistory({ employeeId, assetId });
    if (!r.ok) { setSinTabla(r.sinTabla); setErr(r.sinTabla ? null : mensajeDeErrorAlCargar(r.message)); setRows([]); return; }
    setRows(r.rows); setErr(null);
  }, [employeeId, assetId]);
  useEffect(() => { void cargar(); }, [cargar, recarga]);

  if (rows === null) return <div className="hint">{t("Loading…", "Cargando…")}</div>;
  if (sinTabla) return <div className="hint" data-aviso="212">{t("Migration 212 is not applied yet: there is no HR history.", "Falta aplicar la migración 212: no hay historial todavía.")}</div>;
  if (err) return <div className="hint" style={{ color: "var(--red)" }}>{err}</div>;

  // Cada variante (todo / de un empleado / de un activo) tiene sus columnas: su propia vista guardada.
  const variante = employeeId ? "empleado" : assetId ? "activo" : "todo";
  const columnas: ColumnaEstandar<EntradaDeHistorial>[] = [
    { key: "cuando", en: "When", es: "Cuándo", ancho: 160, valor: (e) => e.at, celda: (e) => <span style={{ whiteSpace: "nowrap" }}>{fmtDateTime(e.at)}</span> },
    { key: "quien", en: "By", es: "Quién", ancho: 160, valor: (e) => e.actor_name ?? null },
    { key: "que", en: "What", es: "Qué", ancho: 170, valor: (e) => etiquetaDeHistorial(e.kind, lang), celda: (e) => <b>{etiquetaDeHistorial(e.kind, lang)}</b> },
    ...(employeeId ? [] : [{ key: "empleado", en: "Employee", es: "Empleado", ancho: 170, valor: (e: EntradaDeHistorial) => e.employee_name ?? (esDeEmpleado(e.kind) ? null : "") }]),
    ...(assetId ? [] : [{ key: "activo", en: "Asset", es: "Activo", ancho: 170, valor: (e: EntradaDeHistorial) => e.asset_text ?? null }]),
    ...(compacto ? [] : [{ key: "detalle", en: "Detail", es: "Detalle", ancho: 240, envuelve: true as const, valor: (e: EntradaDeHistorial) => e.detail ?? null }]),
    { key: "motivo", en: "Reason", es: "Motivo", ancho: 220, envuelve: true, valor: (e) => e.reason ?? null },
  ];
  return (
    <div data-historial-de-rrhh={variante}>
      <TablaEstandar
        id={"rrhh-historial-" + variante + (compacto ? "-compacto" : "")}
        filas={rows}
        claveDe={(e) => e.id}
        vacio={t("Nothing yet.", "Nada todavía.")}
        columnas={columnas}
      />
    </div>
  );
}

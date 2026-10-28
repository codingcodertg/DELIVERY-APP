"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { listHistory } from "@/app/recruiting/actions/historial";
import { esDeEmpleado, etiquetaDeHistorial, type EntradaDeHistorial } from "@/lib/recruiting/historial";
import { fmtDateTime } from "@/lib/utils";

/**
 * El historial de RR. HH. (D-NEXT, migración 212) como tabla: cuándo, quién lo hizo, qué, a quién / qué activo, detalle
 * y motivo. Sin filtro es todo; con `employeeId` lo de esa persona; con `assetId` lo de ese correo o número. La tabla
 * es la de Órdenes (CLAUDE.md), sin anchos ajustables: cinco columnas fijas que caben en cualquier sitio.
 */
export function HistorialDeRrhh({ employeeId, assetId, recarga = 0, compacto = false }: {
  employeeId?: string; assetId?: string; recarga?: number; compacto?: boolean;
}) {
  const { t, lang } = usePrefs();
  const [rows, setRows] = useState<EntradaDeHistorial[] | null>(null);
  const [sinTabla, setSinTabla] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const r = await listHistory({ employeeId, assetId });
    if (!r.ok) { setSinTabla(r.sinTabla); setErr(r.sinTabla ? null : r.message); setRows([]); return; }
    setRows(r.rows); setErr(null);
  }, [employeeId, assetId]);
  useEffect(() => { void cargar(); }, [cargar, recarga]);

  if (rows === null) return <div className="hint">{t("Loading…", "Cargando…")}</div>;
  if (sinTabla) return <div className="hint" data-aviso="212">{t("Migration 212 is not applied yet: there is no HR history.", "Falta aplicar la migración 212: no hay historial todavía.")}</div>;
  if (err) return <div className="hint" style={{ color: "var(--red)" }}>{err}</div>;

  return (
    <div className="tbl-scroll tbl-caja" data-historial-de-rrhh={employeeId ? "empleado" : assetId ? "activo" : "todo"}>
      <table className="orders">
        <thead>
          <tr>
            <th>{t("When", "Cuándo")}</th>
            <th>{t("By", "Quién")}</th>
            <th>{t("What", "Qué")}</th>
            {!employeeId && <th>{t("Employee", "Empleado")}</th>}
            {!assetId && <th>{t("Asset", "Activo")}</th>}
            {!compacto && <th>{t("Detail", "Detalle")}</th>}
            <th>{t("Reason", "Motivo")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="hint">{t("Nothing yet.", "Nada todavía.")}</td></tr>}
          {rows.map((e) => (
            <tr key={e.id} data-entrada={e.kind}>
              <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(e.at)}</td>
              <td>{e.actor_name ?? "—"}</td>
              <td style={{ fontWeight: 700 }}>{etiquetaDeHistorial(e.kind, lang)}</td>
              {!employeeId && <td>{e.employee_name ?? (esDeEmpleado(e.kind) ? "—" : "")}</td>}
              {!assetId && <td>{e.asset_text ?? ""}</td>}
              {!compacto && <td className="hint" style={{ whiteSpace: "normal" }}>{e.detail ?? ""}</td>}
              <td style={{ whiteSpace: "normal" }}>{e.reason ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

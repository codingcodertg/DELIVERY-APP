"use client";

import { mensajeDeError } from "@/lib/mensaje-de-error";
import { useCallback, useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { AVISO_DEMO, MODO_DEMO } from "@/lib/recruiting/modo-demo";
import { useData } from "@/lib/recruiting-data-provider";
import { fmtDateTime } from "@/lib/utils";
import { getChecklist, setChecklistItem } from "@/app/recruiting/actions/checklist";
import {
  ESTADOS_ITEM, FASES, PASOS_CHECKLIST, etiquetaDeEstadoItem, etiquetaDePaso, resumenChecklist,
  type EstadoItem, type FaseChecklist, type ItemDeChecklist,
} from "@/lib/recruiting/checklist";

/**
 * Checklist de alta y baja dentro del expediente (D-934, migración 275). Roberto: los pasos del alta (correo firmado,
 * número de RingCentral, acceso a QuickBooks, acceso a SharePoint/app y riesgo del app) y la baja en reversa, cada uno
 * marcable (pendiente / hecho / n-a), con quién y cuándo. La plantilla vive en `@/lib/recruiting/checklist`.
 */
export function ChecklistDelEmpleado({ employeeId, faseInicial }: { employeeId: string; faseInicial?: FaseChecklist }) {
  const { t, lang } = usePrefs();
  const { notify } = useData();
  const [fase, setFase] = useState<FaseChecklist>(faseInicial ?? "onboarding");
  const [items, setItems] = useState<ItemDeChecklist[] | null>(null);
  const [sinTabla, setSinTabla] = useState(false);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    if (MODO_DEMO) { setItems([]); return; }
    const r = await getChecklist(employeeId, fase);
    if (!r.ok) { setSinTabla(r.sinTabla); setItems([]); return; }
    setSinTabla(false);
    setItems(r.items);
  }, [employeeId, fase]);
  useEffect(() => { void cargar(); }, [cargar]);

  const marca = async (itemKey: string, status: EstadoItem) => {
    if (MODO_DEMO) { notify(t(AVISO_DEMO.en, AVISO_DEMO.es)); return; }
    setBusy(true);
    const r = await setChecklistItem({ employeeId, phase: fase, itemKey, status });
    setBusy(false);
    if (!r.ok) { notify(mensajeDeError(r.message)); return; }
    await cargar();
  };

  const resumen = items ? resumenChecklist(items) : null;

  return (
    <div data-bloque="checklist">
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {FASES.map((f) => (
          <button key={f.key} className={`btn btn-sm ${fase === f.key ? "btn-primary" : "btn-ghost"}`} data-fase={f.key}
            onClick={() => setFase(f.key)}>
            {lang === "es" ? f.es : f.en}
          </button>
        ))}
        {resumen && (
          <span className="badge" data-resumen style={{ marginLeft: "auto", alignSelf: "center" }}>
            {resumen.hechos}/{resumen.total} {t("done", "hechos")}{resumen.completo ? " ✓" : ""}
          </span>
        )}
      </div>

      {items === null ? (
        <div className="hint">{t("Loading…", "Cargando…")}</div>
      ) : sinTabla ? (
        <div className="hint" data-aviso="275">{t("Migration 275 is not applied yet.", "Falta aplicar la migración 275.")}</div>
      ) : (
        <table className="cmp-tbl"><tbody>
          {items.map((it) => {
            const paso = PASOS_CHECKLIST.find((p) => p.key === it.key)!;
            return (
              <tr key={it.key} data-item={it.key}>
                <td style={{ fontWeight: 600 }}>{paso.icon} {etiquetaDePaso(paso, fase, lang)}</td>
                <td style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {ESTADOS_ITEM.map((e) => (
                    <button key={e.key} className={`btn btn-sm ${it.status === e.key ? (e.key === "done" ? "btn-primary" : "btn-secondary") : "btn-ghost"}`}
                      data-estado={e.key} disabled={busy} onClick={() => void marca(it.key, e.key)}>
                      {etiquetaDeEstadoItem(e.key, lang)}
                    </button>
                  ))}
                </td>
                <td className="hint" style={{ marginTop: 0 }}>
                  {it.status === "done" && it.done_by_name ? `${it.done_by_name}${it.done_at ? ` · ${fmtDateTime(it.done_at)}` : ""}` : ""}
                </td>
              </tr>
            );
          })}
        </tbody></table>
      )}
      <p className="hint">
        {t("Onboarding steps and offboarding (the same list, in reverse). Each step: pending, done or N/A.",
           "Pasos del alta y de la baja (la misma lista, en reversa). Cada paso: pendiente, hecho o N/A.")}
      </p>
    </div>
  );
}

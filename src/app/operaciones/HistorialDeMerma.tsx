"use client";

import { useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime } from "@/lib/utils";
import { historialDeReporte, type EntradaDeHistorial, type Reporte } from "@/lib/almacen-ops/datos";
import { eventosDeHistorial } from "@/lib/almacen-ops/historial";
import type { Contexto } from "./Operaciones";

/**
 * «🕘 Historial» de una merma (reunión 11 nov, 11 PM): todo lo que le pasó al reporte, de lo más viejo a lo más nuevo.
 * Solo lectura. Lo de antes de la 297 se deriva de la fila (alta y etapas); desde la 297 lo anota la base.
 */
export function HistorialDeMerma({ r, ctx }: { r: Reporte; ctx: Contexto }) {
  const { t, lang } = usePrefs();
  const [abierto, setAbierto] = useState(false);
  const [bitacora, setBitacora] = useState<EntradaDeHistorial[] | null>(null);
  useEffect(() => {
    if (!abierto || bitacora !== null) return;
    if (ctx.demo) { setBitacora([]); return; }
    let vivo = true;
    void historialDeReporte(createClient(), r.id).then((b) => { if (vivo) setBitacora(b); });
    return () => { vivo = false; };
  }, [abierto, bitacora, ctx.demo, r.id]);
  // Si el reporte cambia con la tarjeta abierta, se vuelve a leer al reabrir.
  useEffect(() => { setBitacora(null); }, [r]);
  const nombre = (id: string | null | undefined) => (id ? ctx.personas.find((p) => p.id === id)?.full_name ?? null : null);
  const eventos = eventosDeHistorial(r, bitacora ?? [], nombre, lang === "es" ? "es" : "en");
  return (
    <details className="ops-historial" data-historial={r.id} onToggle={(e) => setAbierto((e.target as HTMLDetailsElement).open)}>
      <summary>🕘 {t("History", "Historial")}</summary>
      {abierto && bitacora === null && <p className="hint">{t("Loading…", "Cargando…")}</p>}
      {abierto && bitacora !== null && (
        <ol className="ops-historial-lista">
          {eventos.map((e, n) => (
            <li key={`${e.at}-${n}`}>
              <span className="ops-historial-cuando">{fmtDateTime(e.at)}</span>
              <span className="ops-historial-texto">{e.texto}{e.quien ? <span className="hint"> · {e.quien}</span> : null}</span>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

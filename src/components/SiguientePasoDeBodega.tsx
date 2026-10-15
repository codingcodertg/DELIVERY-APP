"use client";

import { useState, type ReactNode } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { stageLabel } from "@/lib/constants";
import { suggestDeliveryFee } from "@/lib/pricing";
import { orderLabel } from "@/lib/utils";
import { escribeComenzar, escribeListo, pasosDeBodega, type PasoDeBodega } from "@/lib/pasos-de-bodega";
import { ConfirmarTarifaAlComenzar } from "@/components/ConfirmarTarifaAlComenzar";
import { ConfirmarPallets } from "@/components/ConfirmarPallets";
import type { Delivery } from "@/lib/types";

/**
 * La columna «Siguiente paso» de Almacén (D-551). El dueño, 2026-10-14: «It would be easier if changing the stage for
 * warehouse was a dropdown as a next column instead of having to open the orders one by one».
 *
 * Qué ofrece cada fila lo decide `pasosDeBodega` (la misma regla que los botones de la ficha). Al elegir:
 *  - si el paso pide confirmación, se abre EL MISMO diálogo de la ficha —la tarifa (D-450) o los pallets (D-287)— y lo
 *    que devuelve se escribe con la misma función que usa la ficha;
 *  - si no (comenzar una Intertienda o un Transfer), se escribe ya, y el aviso dice qué orden pasó a qué etapa.
 *
 * Devuelve la celda (para cada fila) y el diálogo (uno para toda la página, fuera de la tabla: dentro de una celda
 * quedaría recortado por la caja que se desplaza).
 */
export function usePasoEnLaFila(): { celda: (d: Delivery) => ReactNode; dialogo: ReactNode } {
  const { me, settings, setStage, notify, realRole } = useData();
  const { lang, t } = usePrefs();
  const [abierto, setAbierto] = useState<{ pedido: Delivery; paso: PasoDeBodega } | null>(null);
  // La orden que se está guardando: su selector se apaga hasta que vuelve la escritura.
  const [guardando, setGuardando] = useState<string | null>(null);

  const hecho = (pedido: Delivery, paso: PasoDeBodega, detalle?: string) => {
    const etapa = stageLabel(paso.destino, lang);
    notify(t(`#${orderLabel(pedido)} → ${etapa}${detalle ? ` — ${detalle}` : ""}`, `#${orderLabel(pedido)} → ${etapa}${detalle ? ` — ${detalle}` : ""}`));
  };

  const escribe = async (pedido: Delivery, paso: PasoDeBodega, escritura: () => Promise<boolean>, detalle?: string) => {
    setGuardando(pedido.id);
    const ok = await escritura();
    setGuardando(null);
    if (!ok) return;
    setAbierto(null);
    hecho(pedido, paso, detalle);
  };

  const elegir = (pedido: Delivery, paso: PasoDeBodega) => {
    if (paso.confirmacion) { setAbierto({ pedido, paso }); return; }
    // Sin confirmación solo llega «Comenzar» de un tipo que no cobra: la escritura de la ficha sin diálogo.
    void escribe(pedido, paso, () => escribeComenzar(setStage, pedido.id, null, t));
  };

  const celda = (d: Delivery): ReactNode => {
    if (!me) return null;
    const pasos = pasosDeBodega(me, d, settings.order_type_rules);
    if (pasos.length === 0) return <span className="muted">—</span>;
    return (
      <span className="paso-en-la-fila" onClick={(e) => e.stopPropagation()}>
        <select value="" disabled={guardando === d.id}
          aria-label={t(`Next step for #${orderLabel(d)}`, `Siguiente paso de #${orderLabel(d)}`)}
          onChange={(e) => {
            const paso = pasos.find((p) => p.id === e.target.value);
            if (paso) elegir(d, paso);
          }}>
          <option value="">{guardando === d.id ? t("Saving…", "Guardando…") : t("Choose…", "Elegir…")}</option>
          {pasos.map((p) => (
            <option key={p.id} value={p.id}>{(lang === "es" ? p.texto.es : p.texto.en)} → {stageLabel(p.destino, lang)}{p.confirmacion ? "…" : ""}</option>
          ))}
        </select>
      </span>
    );
  };

  let dialogo: ReactNode = null;
  if (abierto) {
    const { pedido, paso } = abierto;
    const ocupado = guardando === pedido.id;
    dialogo = paso.confirmacion === "tarifa" ? (
      <ConfirmarTarifaAlComenzar pedido={pedido} sugerencia={suggestDeliveryFee(pedido, settings)} adminReal={realRole === "admin"} ocupado={ocupado}
        onCancelar={() => setAbierto(null)}
        onConfirmar={(escritura) => void escribe(pedido, paso, () => escribeComenzar(setStage, pedido.id, escritura, t), t(escritura.nota.en, escritura.nota.es))} />
    ) : (
      <ConfirmarPallets pedido={pedido} ocupado={ocupado} onDescartar={() => setAbierto(null)}
        onConfirmar={(escritura) => void escribe(pedido, paso, () => escribeListo(setStage, pedido.id, escritura, t), t(escritura.nota.en, escritura.nota.es))}
        onInvalido={() => notify(t("Enter the confirmed pallet count.", "Ingrese la cantidad confirmada de pallets."))} />
    );
  }

  return { celda, dialogo };
}

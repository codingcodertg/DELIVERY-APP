"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { ChoferYPallets } from "@/components/ChoferYPallets";
import { BotonesDeTarifa } from "@/components/BotonesDeTarifa";
import { CampoDecimal } from "@/components/CampoDecimal";
import { FeeBreakdownDetails } from "@/components/FeeBreakdown";
import { escrituraAlComenzar, llegaSinTarifa, type EscrituraAlComenzar } from "@/lib/confirmar-tarifa";
import type { FeeSuggestion } from "@/lib/pricing";
import { fmtMoney } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

/**
 * Confirmar el MONTO al comenzar la preparación (D-450). Vuelve el diálogo de D-146 sin su bloqueo: el dueño,
 * «they just need to confirm the amount», y preguntado, «confirmar el monto, sin bloqueo». Se ve lo que cobró ventas,
 * se confirma o se corrige ahí mismo, y sin tarifa hay salida.
 *
 * Vivía dentro de `OrderModal`. Sale aquí (D-551) porque lo abre también la columna «Siguiente paso» de Almacén: el
 * mismo diálogo, con el mismo campo, los mismos precios y los mismos tres botones. Quien lo abre decide cuándo (solo
 * para los tipos que cobran, `pideConfirmarTarifa`) y escribe lo que este devuelve con `escribeComenzar`.
 */
export function ConfirmarTarifaAlComenzar({ pedido, sugerencia, adminReal, ocupado, onCancelar, onConfirmar }: {
  pedido: Delivery;
  /** `suggestDeliveryFee` de la orden: los precios Lista/Descuento y de dónde salen. */
  sugerencia: FeeSuggestion;
  /** El desglose de la tarifa sugerida, solo para el admin real (D-249). */
  adminReal: boolean;
  ocupado: boolean;
  onCancelar: () => void;
  /** La escritura que decidió `escrituraAlComenzar`: confirmada, corregida o sin tarifa. */
  onConfirmar: (escritura: EscrituraAlComenzar) => void;
}) {
  const { t } = usePrefs();
  // El número del campo; `null` es el campo vacío. Abre con lo que puso ventas.
  const [tarifaAlComenzar, setTarifaAlComenzar] = useState<number | null>(pedido.delivery_fee ?? null);
  const escritura = escrituraAlComenzar(pedido.delivery_fee, tarifaAlComenzar);
  // La orden llega sin cobrar: vacía o $0 (D-147). Es cuando se ofrece «Sin tarifa — continuar igual».
  const sinCobrar = llegaSinTarifa(pedido.delivery_fee);
  const sinTarifa = escrituraAlComenzar(pedido.delivery_fee, tarifaAlComenzar, true);
  return (
    <div className="overlay" style={{ zIndex: 60 }} onClick={(e) => e.stopPropagation()}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <h3 style={{ marginTop: 0 }}>{t("Confirm the delivery fee", "Confirmar la tarifa de entrega")}</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          {t("Check the amount before you start preparing. If it is wrong, correct it here.",
             "Revise el monto antes de comenzar a preparar. Si está mal, corríjalo aquí.")}
        </p>
        <ChoferYPallets pedido={pedido} />
        <div className="field">
          <label>{t("Delivery fee ($)", "Tarifa de entrega ($)")}</label>
          <CampoDecimal value={tarifaAlComenzar} onValor={setTarifaAlComenzar} autoFocus placeholder="0.00" />
          <div className="hint">
            {/* Lo que puso ventas, y de dónde sale el precio calculado —ciudad, zona y millas— (D-144): un importe
                suelto obliga a creérselo. */}
            {t("Sales charged:", "Ventas cobró:")} <strong>{fmtMoney(pedido.delivery_fee)}</strong>
            {sugerencia.list != null && (
              <>{" · "}{sugerencia.city || t("this address", "esta dirección")}{" · "}
                {sugerencia.zone === "local" ? t("local", "local") : t("out of area", "fuera de zona")}
                {pedido.route_miles != null ? ` · ${pedido.route_miles} mi` : ""}</>
            )}
          </div>
          <BotonesDeTarifa tarifa={tarifaAlComenzar} list={sugerencia.list} discount={sugerencia.discount}
            elegir={setTarifaAlComenzar} t={t} />
          {/* Donde sale «Tarifa sugerida» sale su desglose, para el admin real (D-249). */}
          {adminReal && sugerencia.breakdown && (
            <FeeBreakdownDetails desglose={sugerencia.breakdown} />
          )}
          {escritura?.caso === "corregida" && (
            <div className="banner warn" style={{ marginTop: 8 }}>
              {t(`It will be corrected: ${fmtMoney(pedido.delivery_fee)} → ${fmtMoney(tarifaAlComenzar)}`,
                 `Se corregirá: ${fmtMoney(pedido.delivery_fee)} → ${fmtMoney(tarifaAlComenzar)}`)}
            </div>
          )}
          {sinCobrar && (
            <div className="banner err" style={{ marginTop: 8 }}>
              🚩 {pedido.delivery_fee == null
                ? t("No fee was charged on this order.", "Esta orden no tiene tarifa cobrada.")
                : t("The fee on this order is $0.", "La tarifa de esta orden es $0.")}
              {" "}{t("You can continue anyway: it is noted in the history and the order stays flagged.",
                      "Puede continuar igual: queda anotado en el historial y la orden sigue marcada.")}
            </div>
          )}
        </div>
        {/* La salida sin tarifa a la izquierda del principal, para que no se pulse por inercia (D-287). No escribe
            tarifa: la orden sigue con su 🚩 y quien tenga que cobrarla la encuentra. */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16, flexWrap: "wrap" }}>
          <button className="btn btn-ghost" onClick={onCancelar} disabled={ocupado}>{t("Cancel", "Cancelar")}</button>
          <span style={{ flex: 1 }} />
          {sinCobrar && sinTarifa && (
            <button className="btn btn-ghost" onClick={() => onConfirmar(sinTarifa)} disabled={ocupado}>{t("No fee — continue anyway", "Sin tarifa — continuar igual")}</button>
          )}
          <button className="btn btn-primary" onClick={() => { if (escritura) onConfirmar(escritura); }} disabled={ocupado || !escritura}>
            {escritura
              ? t(`Confirm ${fmtMoney(tarifaAlComenzar)} and start`, `Confirmar ${fmtMoney(tarifaAlComenzar)} y comenzar`)
              : t("Confirm the fee and start", "Confirmar la tarifa y comenzar")}
          </button>
        </div>
      </div>
    </div>
  );
}

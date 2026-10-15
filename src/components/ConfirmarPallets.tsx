"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { ChoferYPallets } from "@/components/ChoferYPallets";
import { escrituraAlMarcarListo, palletsPropuestas, type EscrituraAlMarcarListo } from "@/lib/pasos-de-bodega";
import type { Delivery } from "@/lib/types";

/**
 * «Marcar listo»: almacén confirma los pallets REALES, que se escriben en la misma escritura que la etapa (D-143, D-287).
 *
 * Vivía dentro de `OrderModal`. Sale aquí (D-551) porque lo abre también la columna «Siguiente paso» de Almacén: el
 * mismo campo, el mismo número propuesto y los mismos dos botones. Quien lo abre escribe lo que este devuelve con
 * `escribeListo`. Si lo tecleado no vale, `onInvalido` (la ficha y la fila avisan con el mismo texto).
 */
export function ConfirmarPallets({ pedido, ocupado, onDescartar, onConfirmar, onInvalido }: {
  pedido: Delivery;
  ocupado: boolean;
  onDescartar: () => void;
  onConfirmar: (escritura: EscrituraAlMarcarListo) => void;
  onInvalido: () => void;
}) {
  const { t } = usePrefs();
  const [readyPallets, setReadyPallets] = useState(() => palletsPropuestas(pedido));
  const confirmar = () => {
    const escritura = escrituraAlMarcarListo(readyPallets);
    if (!escritura) { onInvalido(); return; }
    onConfirmar(escritura);
  };
  return (
    <div className="overlay" style={{ zIndex: 60 }} onClick={(e) => e.stopPropagation()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>{t("Confirm pallets", "Confirmar pallets")}</h3>
        <ChoferYPallets pedido={pedido} />
        <div className="field">
          {/* De quién es cada número (D-287), que es lo que pidió almacén: *«cuando yo pongo
              cuántos pallets realmente era, quiero ver cuánto había puesto oficina o ventas»*.
              Antes el estimado salía como «cantidad original de la orden», sin decir de quién
              era, y el campo se rellenaba con él sin distinguirlos. Los dos números se guardan
              aparte —`est_pallets` y `actual_pallets`—, así que esto solo los nombra. */}
          <label>{t("Real pallets (warehouse)", "Pallets reales (almacén)")}</label>
          <input type="number" min={1} step="any" autoFocus value={readyPallets} onChange={(e) => setReadyPallets(e.target.value)}
            placeholder={pedido.est_pallets != null ? `est. ${pedido.est_pallets}` : ""} />
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onDescartar} disabled={ocupado}>{t("Discard", "Descartar")}</button>
          <button className="btn btn-green" onClick={confirmar} disabled={ocupado}>{t("Confirm & mark ready", "Confirmar y marcar listo")}</button>
        </div>
      </div>
    </div>
  );
}

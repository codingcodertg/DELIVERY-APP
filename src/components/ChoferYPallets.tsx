"use client";

import { usePrefs } from "@/lib/prefs";
import type { Delivery } from "@/lib/types";

/**
 * A quién se le carga y qué dijo cada uno de los pallets (D-287).
 *
 * Dos quejas de almacén, la misma tira: *«quiero ver a qué chofer le voy a cargar»* y *«cuando yo
 * pongo cuántos pallets realmente era, quiero ver cuánto había puesto oficina o ventas»*.
 *
 * La tabla de almacén ya traía la columna del chofer; lo que no lo traía era ninguno de los
 * diálogos donde almacén trabaja de verdad —confirmar la tarifa al agarrar la orden, marcar listo
 * y recoger—, que es donde hay que saberlo. Va en un componente porque lo piden los tres, y la
 * misma línea escrita tres veces acaba diciendo tres cosas.
 *
 * Los dos números de pallets se guardan en columnas distintas (`est_pallets` es de quien creó la
 * orden, `actual_pallets` lo escribe almacén al marcar listo), así que aquí no se calcula nada:
 * solo se dice de quién es cada uno. Un guion cuando no hay dato, nunca un cero inventado.
 */
export function ChoferYPallets({ pedido }: { pedido: Delivery }) {
  const { t } = usePrefs();
  const chofer = (pedido.assigned_driver || "").trim();

  return (
    <div className="box" style={{ padding: "8px 10px", marginBottom: 10 }}>
      <div className="small">
        <span className="muted">🚚 {t("Driver to load", "Chofer al que se carga")}: </span>
        <b>{chofer || t("Unassigned", "Sin asignar")}</b>
      </div>
      <div className="small" style={{ marginTop: 2 }}>
        <span className="muted">{t("Sales/office estimate", "Estimado de ventas u oficina")}: </span>
        <b>{pedido.est_pallets ?? "—"}</b>
        <span className="muted"> · {t("Warehouse real", "Real de almacén")}: </span>
        <b>{pedido.actual_pallets ?? "—"}</b>
      </div>
    </div>
  );
}

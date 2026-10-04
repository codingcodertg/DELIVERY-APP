"use client";

import { useState } from "react";
import { useConfirm } from "@/lib/confirm";
import { useData } from "@/lib/data-provider";
import { camposCapturablesEnFila, documentosPendientes, etiquetaDePendiente, otraConLaMismaFactura, valorDeDocumento } from "@/lib/documento-pendiente";
import type { DocumentoDeLaOrden } from "@/lib/order-document";
import { usePrefs } from "@/lib/prefs";
import { orderLabel } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

/**
 * La pastilla «Invoice pending / PO pending / Estimate pending» de una orden, y —para quien puede— el
 * número escrito ahí mismo, sin abrir la orden (D-310). Qué falta lo decide `documentosPendientes` y quién
 * puede escribir qué campo, `camposCapturablesEnFila`; aquí solo se pinta.
 *
 * **Una pastilla por documento que falte (D-NEXT).** Desde que la factura se le cuenta a toda orden, a una
 * Intertienda le pueden faltar dos cosas a la vez —su PO y la factura—, y cada una se escribe en su campo.
 *
 * Vive dentro de una fila que abre la orden al pulsarla, así que todo lo que se pulsa aquí para el
 * clic: escribir una factura no debe abrir la ficha.
 */
export function DocumentoPendiente({ d, vacio = null }: { d: Delivery; /** Lo que se pinta si no falta nada (el «—» de una celda vacía). */ vacio?: string | null }) {
  const { me, settings } = useData();
  const reglas = settings.order_type_rules ?? {};
  const pendientes = documentosPendientes(d, reglas);
  if (!pendientes.length) return <>{vacio}</>;
  const capturables = camposCapturablesEnFila(me, d, reglas);
  const pastillas = pendientes.map((doc) => <UnDocumentoPendiente key={doc.campo} d={d} doc={doc} capturable={capturables.includes(doc.campo)} />);
  // Dos pastillas en la misma línea no caben en la columna `#` (medido: la segunda salía cortada, «Invo…»): una debajo de otra.
  return pendientes.length > 1 ? <span className="doc-pend-varias">{pastillas}</span> : <>{pastillas}</>;
}

/** Una pastilla, con su captura si `capturable`. El campo que se escribe es SIEMPRE el de la pastilla pulsada. */
function UnDocumentoPendiente({ d, doc, capturable }: { d: Delivery; doc: DocumentoDeLaOrden; capturable: boolean }) {
  const { deliveries, ponerDocumento } = useData();
  const { lang, t } = usePrefs();
  const confirmAction = useConfirm();
  const [abierto, setAbierto] = useState(false);
  const [escrito, setEscrito] = useState("");
  const [guardando, setGuardando] = useState(false);

  const etiqueta = etiquetaDePendiente(doc, lang);
  const campo = doc.campo;
  if (!capturable) return <span className="doc-pend">{etiqueta}</span>;

  if (!abierto) {
    return (
      <button
        className="doc-pend doc-pend-btn"
        title={t(`Enter the ${doc.en} here`, `Escribir ${doc.es} aquí`)}
        onClick={(e) => { e.stopPropagation(); setEscrito(""); setAbierto(true); }}
      >{etiqueta} ✎</button>
    );
  }

  const cerrar = () => { setAbierto(false); setEscrito(""); };
  const guardar = async () => {
    const valor = valorDeDocumento(escrito);
    if (!valor || guardando) return;
    // Se avisa, no se bloquea: una factura repartida en varias entregas existe. Como en la ficha.
    const otra = campo === "invoice_num" ? otraConLaMismaFactura(d.id, valor, deliveries) : undefined;
    if (otra && !(await confirmAction(t(
      `⚠ Duplicate invoice: order #${orderLabel(otra)} already uses invoice #${otra.invoice_num}. Save anyway?`,
      `⚠ Factura duplicada: la orden #${orderLabel(otra)} ya usa la factura #${otra.invoice_num}. ¿Guardar de todos modos?`,
    )))) return;
    setGuardando(true);
    const ok = await ponerDocumento(d.id, campo, valor);
    setGuardando(false);
    if (ok) cerrar();
  };

  return (
    <span className="doc-pend-form" onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        value={escrito}
        disabled={guardando}
        placeholder={lang === "es" ? doc.es : doc.en}
        aria-label={lang === "es" ? doc.es : doc.en}
        onChange={(e) => setEscrito(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") { e.preventDefault(); void guardar(); }
          if (e.key === "Escape") { e.preventDefault(); cerrar(); }
        }}
      />
      <button className="btn btn-primary btn-sm" disabled={guardando || !valorDeDocumento(escrito)} onClick={() => void guardar()}>
        {t("Save", "Guardar")}
      </button>
      <button className="btn btn-ghost btn-sm" disabled={guardando} onClick={cerrar} aria-label={t("Cancel", "Cancelar")}>✕</button>
    </span>
  );
}

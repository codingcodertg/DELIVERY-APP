"use client";

import { useState } from "react";
import { useConfirm } from "@/lib/confirm";
import { useData } from "@/lib/data-provider";
import { campoCapturableEnFila, documentoPendiente, etiquetaDePendiente, otraConLaMismaFactura, valorDeDocumento } from "@/lib/documento-pendiente";
import { usePrefs } from "@/lib/prefs";
import { orderLabel } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

/**
 * La pastilla «Invoice pending / PO pending / Estimate pending» de una orden, y —para quien puede— el
 * número escrito ahí mismo, sin abrir la orden (D-NEXT). Quién puede y qué campo lo decide
 * `campoCapturableEnFila`; aquí solo se pinta.
 *
 * Vive dentro de una fila que abre la orden al pulsarla, así que todo lo que se pulsa aquí para el
 * clic: escribir una factura no debe abrir la ficha.
 */
export function DocumentoPendiente({ d, vacio = null }: { d: Delivery; /** Lo que se pinta si no falta nada (el «—» de una celda vacía). */ vacio?: string | null }) {
  const { me, settings, deliveries, ponerDocumento } = useData();
  const { lang, t } = usePrefs();
  const confirmAction = useConfirm();
  const [abierto, setAbierto] = useState(false);
  const [escrito, setEscrito] = useState("");
  const [guardando, setGuardando] = useState(false);

  const reglas = settings.order_type_rules ?? {};
  const doc = documentoPendiente(d, reglas);
  if (!doc) return <>{vacio}</>;
  const etiqueta = etiquetaDePendiente(doc, lang);
  const campo = campoCapturableEnFila(me, d, reglas);
  if (!campo) return <span className="doc-pend">{etiqueta}</span>;

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

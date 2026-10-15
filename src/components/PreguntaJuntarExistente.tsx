"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { stageLabel } from "@/lib/constants";
import { useData } from "@/lib/data-provider";
import {
  avisoTrasJuntar, juntarExistentes, ofreceJuntarExistente, porQueNoPuedeJuntar, quienSeQueda, type PorQueNoSeJunta,
} from "@/lib/juntar-intertienda";
import { usePrefs } from "@/lib/prefs";
import type { Delivery } from "@/lib/types";
import { orderLabel } from "@/lib/utils";

/**
 * «Juntar en #X» al escribir la factura en una Intertienda que YA EXISTE (D-557, 2026-10-15). El dueño aprobó, «si a
 * todo»: «when an invoice is put on an Intertienda that already has an open Intertienda with the same invoice, offer
 * "Juntar en #X": that order gets CANCELED with reason "Juntada en #X", and its PO and pallets move to #X».
 *
 * La regla —con quién, cuál se queda, quién puede, qué se escribe y en qué orden— vive en `lib/juntar-intertienda.ts`;
 * aquí la pregunta y el aviso. La usan los tres sitios donde se escribe una factura en una orden hecha: la ficha al
 * guardar, «Factura pendiente» desde la fila (D-310) y «Agregar material» (D-339).
 *
 * Cómo se usa: `const juntar = useJuntarExistente();`, pintar `{juntar.dialogo}`, y antes de escribir la factura
 * `const salida = await juntar.intentar(orden, loQueSeVaAEscribir, facturaNueva)`:
 * - `seguir`: no hay con quién, o eligió «Dejarla aparte» (`decidida`: no repetir el aviso de factura duplicada).
 * - `hecho`: se juntó; quien llama NO escribe nada más.
 * - `parar`: canceló, o la junta falló (ya se avisó).
 */
export type SalidaDeJuntar = { r: "seguir"; decidida: boolean } | { r: "hecho" } | { r: "parar" };
type Respuesta = "juntar" | "aparte" | "cancelar";

type Pregunta = { queda: Delivery; anula: Delivery; factura: string; porque: PorQueNoSeJunta | null; resolver: (r: Respuesta) => void };

export function useJuntarExistente(): { intentar: (orden: Delivery, propia: Partial<Delivery>, factura: string | null) => Promise<SalidaDeJuntar>; dialogo: ReactNode } {
  const { me, settings, deliveries, updateDelivery, addNote, setStage, notify } = useData();
  const { lang, t } = usePrefs();
  const [pregunta, setPregunta] = useState<Pregunta | null>(null);

  const intentar = async (orden: Delivery, propia: Partial<Delivery>, factura: string | null): Promise<SalidaDeJuntar> => {
    if (!factura) return { r: "seguir", decidida: false };
    const despues = { ...orden, ...propia } as Delivery;
    const con = ofreceJuntarExistente(despues, factura, deliveries, settings.order_type_rules);
    if (!con) return { r: "seguir", decidida: false };
    const { queda, anula } = quienSeQueda<Delivery>(despues, con);
    const porque = porQueNoPuedeJuntar(me?.role, queda.stage, anula.stage);
    const respuesta = await new Promise<Respuesta>((resolver) => setPregunta({ queda, anula, factura, porque, resolver }));
    if (respuesta === "cancelar") return { r: "parar" };
    if (respuesta === "aparte") return { r: "seguir", decidida: true };
    // «Juntar» no se pinta si no puede; si aun así llegara aquí, no se escribe nada.
    if (porque) return { r: "parar" };
    // Las dos tal como están en la base: lo que la persona estaba escribiendo viaja aparte, como `propia`.
    const resultado = await juntarExistentes({ updateDelivery: (id, p) => updateDelivery(id, p), addNote, setStage }, {
      queda: queda.id === orden.id ? orden : con,
      anula: anula.id === orden.id ? orden : con,
      idPropia: orden.id, propia, factura,
      minutosPorPallet: { recoger: settings.pickup_min_per_pallet, entregar: settings.delivery_min_per_pallet },
      lang,
    });
    const aviso = avisoTrasJuntar(resultado, queda, anula, lang);
    if (aviso) notify(aviso);
    return resultado === "juntada" ? { r: "hecho" } : { r: "parar" };
  };

  const responder = (r: Respuesta) => { pregunta?.resolver(r); setPregunta(null); };

  const pallets = (o: Delivery) => Number(o.est_pallets) || 0;
  const dialogo = pregunta && typeof document !== "undefined" ? createPortal(
    // Vive dentro de filas que abren la orden al pulsarlas: un clic aquí no debe llegar a la fila (React lo sube por el portal).
    <div className="overlay" style={{ zIndex: 10000 }} data-pregunta-juntar-existente onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) responder("cancelar"); }}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 480 }}>
        <h3 style={{ marginTop: 0 }}>{t("Invoice # already exists", "La factura ya existe")}</h3>
        <p style={{ whiteSpace: "pre-wrap" }}>{t(
          `Orders #${orderLabel(pregunta.queda)} (PO ${pregunta.queda.po2 || "—"}, ${pallets(pregunta.queda)} pallets) and #${orderLabel(pregunta.anula)} (PO ${pregunta.anula.po2 || "—"}, ${pallets(pregunta.anula)} pallets) have the same invoice #${pregunta.factura}. Join them for 1 trip, or keep them separate (multiple trips)?`,
          `Las órdenes #${orderLabel(pregunta.queda)} (PO ${pregunta.queda.po2 || "—"}, ${pallets(pregunta.queda)} pallets) y #${orderLabel(pregunta.anula)} (PO ${pregunta.anula.po2 || "—"}, ${pallets(pregunta.anula)} pallets) tienen la misma factura #${pregunta.factura}. ¿Juntarlas en un viaje o dejarlas aparte (varios viajes)?`,
        )}</p>
        <p className="hint" data-juntar-quien-se-queda>{t(
          `Joining keeps #${orderLabel(pregunta.queda)} with both POs and all the pallets, and cancels #${orderLabel(pregunta.anula)} (reason: Joined into #${orderLabel(pregunta.queda)}). The one further along stays; if they are at the same stage, the older one.`,
          `Al juntar, #${orderLabel(pregunta.queda)} se queda con las dos PO y todos los pallets, y #${orderLabel(pregunta.anula)} se anula (motivo: Juntada en #${orderLabel(pregunta.queda)}). Se queda la que va más adelante; si van igual, la más vieja.`,
        )}</p>
        {pregunta.porque && (
          <p className="hint" data-juntar-no-permitido>{pregunta.porque === "editar"
            ? t(`You can't join them: your role can't change #${orderLabel(pregunta.queda)} while it is ${stageLabel(pregunta.queda.stage, lang)}. Office or a manager can.`,
              `No puedes juntarlas: tu rol no puede cambiar #${orderLabel(pregunta.queda)} mientras está en ${stageLabel(pregunta.queda.stage, lang)}. Oficina o un gerente sí.`)
            : pregunta.porque === "anular"
              ? t(`You can't join them: your role can't cancel #${orderLabel(pregunta.anula)} while it is ${stageLabel(pregunta.anula.stage, lang)}. Office or a manager can.`,
                `No puedes juntarlas: tu rol no puede anular #${orderLabel(pregunta.anula)} mientras está en ${stageLabel(pregunta.anula.stage, lang)}. Oficina o un gerente sí.`)
              : t("These two orders can't be joined at their stage.", "Estas dos órdenes no se pueden juntar en su etapa.")}</p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={() => responder("cancelar")}>{t("Cancel", "Cancelar")}</button>
          <button type="button" className="btn" data-dejar-aparte onClick={() => responder("aparte")}>{t("Keep separate (another trip)", "Dejarla aparte (otro viaje)")}</button>
          {!pregunta.porque && (
            <button type="button" className="btn btn-primary" data-juntar-en autoFocus onClick={() => responder("juntar")}>
              {t(`Join into #${orderLabel(pregunta.queda)} (one trip)`, `Juntar en #${orderLabel(pregunta.queda)} (un viaje)`)}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  return { intentar, dialogo };
}

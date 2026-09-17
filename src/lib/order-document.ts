import type { Delivery } from "./types";
import { orderTypeRule, type OrderTypeRules } from "./required";

/**
 * El número de documento que se resalta al ver una orden (D-NEXT).
 *
 * El dueño: «en el formulario de orden, al verla, resalta el número de factura». Pero no todos los
 * tipos llevan factura: el documento que cuenta lo dice la regla del tipo (`docRef`, Ajustes → Datos),
 * la misma que decide qué falta al enviar (`missingFields`). En producción, medido por el orquestador:
 * Customer pide factura, Intertienda pide PO y Transfer pide un número de estimación.
 *
 * - `invoice` → Factura #. `po` → PO #. `estimate` → Estimación #. Sale aunque esté vacío, con un «—»:
 *   que falte el documento que el tipo exige también es algo que ver de un vistazo.
 * - `any` → el primero que tenga, en el orden en que `missingFields` los pide: PO, factura, SO. Si no
 *   tiene ninguno, PO vacío.
 * - `none` → la factura si la hay; si no, nada que resaltar.
 */

export type CampoDeDocumento = "invoice_num" | "po2" | "estimate_num" | "so_num";

export type DocumentoDeLaOrden = { campo: CampoDeDocumento; corto: string; en: string; es: string; numero: string };

const DOCUMENTOS: Record<CampoDeDocumento, { corto: string; en: string; es: string }> = {
  invoice_num: { corto: "INV", en: "Invoice #", es: "Factura #" },
  po2: { corto: "PO", en: "PO #", es: "PO #" },
  estimate_num: { corto: "EST", en: "Estimate #", es: "Estimación #" },
  so_num: { corto: "SO", en: "SO #", es: "SO #" },
};

type ConDocumentos = Pick<Partial<Delivery>, "order_type" | CampoDeDocumento>;

const limpio = (v: unknown) => String(v ?? "").trim();
const documento = (campo: CampoDeDocumento, d: ConDocumentos): DocumentoDeLaOrden => ({ campo, ...DOCUMENTOS[campo], numero: limpio(d[campo]) });

export function documentoPrincipal(d: ConDocumentos, reglas: OrderTypeRules): DocumentoDeLaOrden | null {
  const docRef = orderTypeRule(d.order_type, reglas).docRef ?? "invoice";
  switch (docRef) {
    case "invoice": return documento("invoice_num", d);
    case "po": return documento("po2", d);
    case "estimate": return documento("estimate_num", d);
    case "any": {
      const primero = (["po2", "invoice_num", "so_num"] as const).find((c) => limpio(d[c]));
      return documento(primero ?? "po2", d);
    }
    case "none": return limpio(d.invoice_num) ? documento("invoice_num", d) : null;
  }
}

/**
 * Lo que enseña la fila «Factura / Estimación #» del resumen, **si no es lo que ya se resalta arriba**.
 * Repetido, el mismo número dos veces en la misma tarjeta; distinto —la factura de una Intertienda, cuyo
 * documento es el PO—, sigue a la vista.
 */
export function filaFacturaOEstimacion(d: ConDocumentos, principal: DocumentoDeLaOrden | null): string | null {
  const valor = limpio(d.invoice_num) || limpio(d.estimate_num);
  if (!valor) return null;
  return principal && principal.numero === valor ? null : valor;
}

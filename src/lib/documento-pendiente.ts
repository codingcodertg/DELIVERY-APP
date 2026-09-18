import { canEditFields } from "./constants";
import { documentoPrincipal, type CampoDeDocumento, type DocumentoDeLaOrden } from "./order-document";
import type { OrderTypeRules } from "./required";
import type { Delivery, Stage, UserRole } from "./types";
import { orderOwner } from "./utils";

/**
 * El documento que a una orden le FALTA, y quién puede ponerlo desde la fila (D-NEXT).
 *
 * El dueño: «las órdenes que no tengan invoice number tengan un distintivo… los de sales no pueden
 * editar, pero si les falta el invoice solo eso pueden ingresar, directo en la orden sin abrirla».
 *
 * Qué documento cuenta lo decide `documentoPrincipal` —la regla del tipo—, no «la factura» a secas:
 * contado a secas salían 35 órdenes sin `invoice_num`, y 31 eran Intertiendas, cuyo documento es el PO.
 */

/** El valor de `filter` de la pestaña «Invoice pending». No es una etapa: ninguna se llama así. */
export const PESTANA_DOCUMENTO_PENDIENTE = "doc_pending";

/** Etapas en las que todavía no se espera el documento, o ya da igual. */
const ETAPAS_SIN_DOCUMENTO: readonly Stage[] = ["draft", "rejected", "canceled"];

type OrdenConDocumento = Pick<Delivery, "stage" | "order_type" | CampoDeDocumento>;

/**
 * El documento pendiente de la orden, o `null` si no le falta ninguno.
 * `any` solo está pendiente si no tiene NINGUNO; `none` nunca. Las dos cosas ya las resuelve
 * `documentoPrincipal`: devuelve el primero que haya, y en `none` no devuelve nada que esté vacío.
 */
export function documentoPendiente(d: OrdenConDocumento, reglas: OrderTypeRules): DocumentoDeLaOrden | null {
  if (ETAPAS_SIN_DOCUMENTO.includes(d.stage)) return null;
  const principal = documentoPrincipal(d, reglas);
  return principal && !principal.numero ? principal : null;
}

/** El texto de la pastilla: «Invoice pending», «PO pending», «Estimate pending». */
export function etiquetaDePendiente(doc: DocumentoDeLaOrden, lang: "en" | "es"): string {
  const nombre = (lang === "es" ? doc.es : doc.en).replace(/\s*#$/, "");
  return lang === "es" ? `${nombre} pendiente` : `${nombre} pending`;
}

/**
 * El campo que ESTA persona puede escribir desde la fila, o `null` si solo ve la pastilla.
 *
 * - Quien ya edita la orden en esa etapa (`canEditFields`): el documento que falte, sea cual sea.
 * - Ventas, fuera de eso: solo `invoice_num`, y solo en SU orden. Es exactamente lo que abre la
 *   migración 125 en `guard_delivery_stage`; un input que la base rechaza es peor que ninguno (D-044).
 *   En una Intertienda con el PO pendiente el vendedor ve la pastilla y no el input.
 * - Chofer y almacén, nunca: almacén edita campos en sus etapas, pero el papeleo no es suyo.
 */
export function campoCapturableEnFila(
  yo: { id: string; role: UserRole } | null | undefined,
  d: OrdenConDocumento & Pick<Delivery, "created_by" | "assigned_sales_rep">,
  reglas: OrderTypeRules,
): CampoDeDocumento | null {
  const pendiente = documentoPendiente(d, reglas);
  if (!yo || !pendiente) return null;
  if (yo.role === "driver" || yo.role === "warehouse") return null;
  if (canEditFields(yo.role, d.stage)) return pendiente.campo;
  if (yo.role === "sales" && pendiente.campo === "invoice_num" && orderOwner(d) === yo.id) return "invoice_num";
  return null;
}

/** Lo que se va a guardar: sin espacios alrededor, o `null` si no queda nada. */
export function valorDeDocumento(escrito: string): string | null {
  return escrito.trim() || null;
}

/**
 * Otra orden viva que ya usa esa factura. Se AVISA, no se bloquea: una factura repartida en varias
 * entregas existe. Es la misma comparación que hace la ficha al guardar.
 */
export function otraConLaMismaFactura<T extends Pick<Delivery, "id" | "stage" | "invoice_num">>(
  id: string, factura: string, todas: readonly T[],
): T | undefined {
  const buscada = factura.trim().toLowerCase();
  if (!buscada) return undefined;
  return todas.find((x) => x.id !== id && x.stage !== "canceled" && (x.invoice_num || "").trim().toLowerCase() === buscada);
}

/**
 * Si el guardado entró de verdad. Un UPDATE que la RLS deja en cero filas vuelve de PostgREST sin
 * error, y leído a secas parece guardado; por eso la escritura pide `.select("id")` y esto lo mira.
 */
export function falloAlGuardarDocumento(error: { message: string } | null, filas: readonly unknown[] | null): string | null {
  if (error) return error.message;
  if (!filas || filas.length === 0) return "0 rows";
  return null;
}

/** Por tienda, y dentro de cada tienda por fecha de entrega; sin tienda y sin fecha, al final. */
export function ordenPorTienda<T extends Pick<Delivery, "store" | "delivery_date">>(filas: readonly T[]): T[] {
  const alFinal = (a: string, b: string) => (!a && !b ? 0 : !a ? 1 : !b ? -1 : a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  return [...filas].sort((a, b) =>
    alFinal((a.store ?? "").trim(), (b.store ?? "").trim()) || alFinal(a.delivery_date ?? "", b.delivery_date ?? ""));
}

/** Las filas ya ordenadas, partidas en un grupo por tienda con su cuenta. */
export function gruposPorTienda<T extends Pick<Delivery, "store" | "delivery_date">>(filas: readonly T[]): { tienda: string; filas: T[] }[] {
  const grupos: { tienda: string; filas: T[] }[] = [];
  for (const f of ordenPorTienda(filas)) {
    const tienda = (f.store ?? "").trim();
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.tienda.toLowerCase() === tienda.toLowerCase()) ultimo.filas.push(f);
    else grupos.push({ tienda, filas: [f] });
  }
  return grupos;
}

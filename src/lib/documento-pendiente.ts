import { canEditFields } from "./constants";
import { documentoDeFactura, documentoPrincipal, type CampoDeDocumento, type DocumentoDeLaOrden } from "./order-document";
import { orderTypeRule, type OrderTypeRules } from "./required";
import type { Delivery, Stage, UserRole } from "./types";
import { orderOwner } from "./utils";
import { PESTANA_ATRASADAS } from "./atrasadas";

/**
 * El documento que a una orden le FALTA, y quién puede ponerlo desde la fila (D-310).
 *
 * El dueño: «las órdenes que no tengan invoice number tengan un distintivo… los de sales no pueden
 * editar, pero si les falta el invoice solo eso pueden ingresar, directo en la orden sin abrirla».
 *
 * Qué documento cuenta lo decide `documentoPrincipal` —la regla del tipo—, no «la factura» a secas:
 * contado a secas salían 35 órdenes sin `invoice_num`, y 31 eran Intertiendas, cuyo documento es el PO.
 *
 * **Desde D-465 la factura se cuenta APARTE, y a toda orden.** El dueño, 2026-10-04: «there are orders
 * without invoice and is not showing, interiteda are pending». El documento del tipo sigue siendo el suyo
 * (`documentoPendiente`: el PO de una Intertienda), pero **además** a toda orden sin `invoice_num` le falta
 * la factura (`facturaPendiente`), y las dos cosas se ven en la fila (`documentosPendientes`).
 */

/** El valor de `filter` de la pestaña «Invoice pending». No es una etapa: ninguna se llama así. */
export const PESTANA_DOCUMENTO_PENDIENTE = "doc_pending";

/**
 * A qué chip de fecha se mueve la pantalla al pulsar una pastilla (D-380).
 *
 * **Solo la de factura pendiente y la de «Outdated» mueven nada, y solo hacia «Todas».** Lo demás
 * se queda como esté.
 *
 * El problema que arregla: la pestaña **cuenta** sobre `conPendientes` —lo pendiente aunque sea
 * viejo, que es lo que D-313 arregló para que a office no le saliera 0— pero la **lista** sigue
 * pasando por el chip de fecha, que arranca en «Reciente». Casi todo lo que tiene factura pendiente
 * está entregado hace semanas, así que la pastilla decía «52» y debajo salían tres filas o ninguna.
 * Un número que no es el de la lista es exactamente lo que D-357 vino a quitar de esta pantalla.
 * (Desde D-407 la pestaña ya no lleva lo viejo —de ayer en adelante, para todos—, pero el chip
 * sigue moviéndose a «Todas»: «Hoy» o «Reciente» seguirían dejando fuera parte de lo que cuenta.)
 *
 * Se mueve el chip en vez de ignorarlo dentro de la pestaña: así **se ve** por qué aparecen órdenes
 * viejas, y quien quiera volver a acotar por fecha lo hace y ve el chip que lo está haciendo. Un
 * filtro que se salta en silencio es el mismo problema al revés.
 *
 * **Y la de «Outdated» (D-384), por la misma razón y hacia el mismo sitio.** Todo lo que lista es
 * de antes de ayer: con «Hoy» puesto enseñaría cero filas con la pastilla diciendo otro número, y
 * con «Reciente» no enseñaría ninguna (desde D-477 `withinRecent` es solo ayer, hoy y mañana) con la
 * pastilla diciendo otro número: la confusión que D-380 quitó.
 */
export function presetAlElegirPastilla<P extends string>(clave: string, presetActual: P, todas: P): P {
  return clave === PESTANA_DOCUMENTO_PENDIENTE || clave === PESTANA_ATRASADAS ? todas : presetActual;
}

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
/**
 * Lo que entra en la pestaña «Factura pendiente» (D-338). El dueño: «in the invoice pending just to show invoice not po».
 * La pestaña se llama así y contaba también las Intertienda sin PO, que no son una factura que perseguir. La pastilla de la
 * FILA sigue diciendo «PO pendiente» donde toque (`documentoPendiente`): eso es de la orden, no de la pestaña.
 */
/**
 * **D-465: es de TODA orden sin `invoice_num`, no solo de los tipos cuyo documento es la factura.** El dueño, 2026-10-04:
 * «invoice number not working there are orders without invoice and is not showing, interiteda are pending». Medido ese día:
 * 13 Intertiendas abiertas sin factura (todas con su PO) y la pestaña decía 0, porque esto miraba `documentoPendiente`, que
 * para una Intertienda es el PO. Ya no pasa por el documento del tipo: mira la etapa y la factura.
 *
 * La única salida es el tipo configurado como «sin documento» (`docRef: "none"`): ahí alguien dijo a propósito, en Ajustes,
 * que ese tipo no lleva papel, y perseguirle una factura sería la app discutiendo con un ajuste (hoy no hay ninguno así).
 */
export function facturaPendiente(d: OrdenConDocumento, reglas: OrderTypeRules): boolean {
  if (ETAPAS_SIN_DOCUMENTO.includes(d.stage)) return false;
  if (String(d.invoice_num ?? "").trim()) return false;
  return (orderTypeRule(d.order_type, reglas).docRef ?? "invoice") !== "none";
}

/**
 * Todo lo que la fila enseña como pendiente (D-465): el documento del tipo si falta, **y** la factura si falta. Una Intertienda
 * con su PO y sin factura enseña «Factura pendiente»; sin ninguno de los dos, las dos pastillas, el PO primero. Nunca repite
 * la factura cuando ya es el documento del tipo.
 */
export function documentosPendientes(d: OrdenConDocumento, reglas: OrderTypeRules): DocumentoDeLaOrden[] {
  const principal = documentoPendiente(d, reglas);
  const salida = principal ? [principal] : [];
  if (facturaPendiente(d, reglas) && principal?.campo !== "invoice_num") salida.push(documentoDeFactura(d));
  return salida;
}

export function etiquetaDePendiente(doc: DocumentoDeLaOrden, lang: "en" | "es"): string {
  const nombre = (lang === "es" ? doc.es : doc.en).replace(/\s*#$/, "");
  return lang === "es" ? `${nombre} pendiente` : `${nombre} pending`;
}

/**
 * Los campos que ESTA persona puede escribir desde la fila, de entre los que faltan (`documentosPendientes`).
 * Vacío si solo ve las pastillas.
 *
 * - Quien ya edita la orden en esa etapa (`canEditFields`): todo documento que falte, sea cual sea.
 * - Ventas, fuera de eso: solo `invoice_num`, y solo en SU orden. Es exactamente lo que abre la
 *   migración 125 en `guard_delivery_stage`, que no mira el tipo; un input que la base rechaza es peor
 *   que ninguno (D-044). En una Intertienda sin PO ni factura el vendedor ve «PO pendiente» sin input y
 *   escribe la factura (D-465; hasta entonces no podía escribir nada en una Intertienda).
 * - Chofer y almacén, nunca: almacén edita campos en sus etapas, pero el papeleo no es suyo.
 */
export function camposCapturablesEnFila(
  yo: { id: string; role: UserRole } | null | undefined,
  d: OrdenConDocumento & Pick<Delivery, "created_by" | "assigned_sales_rep">,
  reglas: OrderTypeRules,
): CampoDeDocumento[] {
  const pendientes = documentosPendientes(d, reglas).map((p) => p.campo);
  if (!yo) return [];
  if (yo.role === "driver" || yo.role === "warehouse") return [];
  if (canEditFields(yo.role, d.stage)) return pendientes;
  if (yo.role === "sales" && orderOwner(d) === yo.id) return pendientes.filter((c) => c === "invoice_num");
  return [];
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
/**
 * `primero`: las tiendas de quien mira, en orden —la suya y luego las que además ve (D-338)—. Sus grupos salen ANTES que los
 * demás; dentro de cada tramo, el orden de siempre. El dueño: «in pending the store it shows first is the store you have
 * assigned». Sin tiendas (admin, quien no tiene), nada cambia.
 */
export function tiendasDeQuienMira(yo: { store?: string | null; visible_stores?: string[] | null } | null | undefined): string[] {
  return [yo?.store, ...(yo?.visible_stores ?? [])].map((s) => (s ?? "").trim()).filter(Boolean);
}

export function gruposPorTienda<T extends Pick<Delivery, "store" | "delivery_date">>(filas: readonly T[], primero: readonly string[] = []): { tienda: string; filas: T[] }[] {
  const puesto = (tienda: string) => { const i = primero.findIndex((p) => p.trim().toLowerCase() === tienda.toLowerCase()); return i < 0 ? primero.length : i; };
  return gruposEnOrden(filas).map((g, i) => ({ g, i })).sort((a, b) => puesto(a.g.tienda) - puesto(b.g.tienda) || a.i - b.i).map((x) => x.g);
}

function gruposEnOrden<T extends Pick<Delivery, "store" | "delivery_date">>(filas: readonly T[]): { tienda: string; filas: T[] }[] {
  const grupos: { tienda: string; filas: T[] }[] = [];
  for (const f of ordenPorTienda(filas)) {
    const tienda = (f.store ?? "").trim();
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.tienda.toLowerCase() === tienda.toLowerCase()) ultimo.filas.push(f);
    else grupos.push({ tienda, filas: [f] });
  }
  return grupos;
}

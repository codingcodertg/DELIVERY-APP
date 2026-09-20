import { facturaComparable } from "@/lib/misma-factura";
import { palletDuration, orderOwner } from "@/lib/utils";
import type { Delivery, Profile, Stage } from "@/lib/types";

/**
 * Ventas agrega material a una orden ya hecha (D-339): más facturas y más pallets.
 *
 * Un vendedor, literal: *«A veces agendo un Delivery pero luego el cliente me solicita más material.
 * Para enviarlo con el mismo envío quiero que agregues la opción de "editar" pero no voy a poder
 * editar sino que voy a poder agregar más facturas e incrementar # de Pallets»*.
 *
 * **Dos cosas, y solo esas dos.** No es «editar la orden»: ni cambiar ni quitar facturas, ni bajar
 * pallets, ni tocar dirección, fecha o tarifa. Lo mismo dice el guard de la migración 138, que es
 * quien lo hace cumplir de verdad; esto decide lo que la pantalla ofrece y lo que se escribe.
 *
 * **`invoice_num` no se toca y sigue significando lo mismo.** Las facturas añadidas después viven en
 * `invoices_extra`, aparte, porque `invoice_num` lo leen trece sitios —comprobante, hoja de carga,
 * manifiesto, la columna y el agrupado de la tabla, el documento que exige el tipo, la pestaña de
 * factura pendiente (D-338), el control de duplicados, la búsqueda, el CSV…— y meterle varios
 * números con comas los rompe a todos **sin que ninguno falle**.
 */

/** Las etapas en las que tiene sentido agregar material. */
export const ETAPAS_AGREGA_MATERIAL: readonly Stage[] = ["pending", "approved", "fulfilling"];

/**
 * Los topes de `invoices_extra`. **Son los mismos que exige el guard de la 138**, y hay una prueba
 * que los compara con el `.sql`: dos números distintos aquí y allí son un formulario que acepta lo
 * que la base rechaza.
 */
export const MAX_FACTURAS_EXTRA = 20;
export const MAX_LARGO_FACTURA = 40;

type OrdenConFacturas = Pick<Delivery, "invoice_num"> & { invoices_extra?: string[] | null };

/**
 * Todas las facturas de una orden, **como están guardadas**.
 *
 * `invoice_num` primero —es «la» factura— y detrás las añadidas. No se normaliza el texto: medido en
 * producción el 2026-09-19, **15 órdenes ya llevan varios números metidos a mano** en `invoice_num`
 * con separadores (`,` `;` `/` `+`, «y», «and»), 2 de ellas vivas. No se migran ni se parten: se
 * enseñan tal cual. Presumir que `invoice_num` es un solo número inventaría datos.
 *
 * Sí se quitan los blancos y las repetidas, comparando con `facturaComparable` para no enseñar dos
 * veces «1234» y «#1234».
 */
export function facturasDeLaOrden(d: OrdenConFacturas): string[] {
  const salida: string[] = [];
  const vistas = new Set<string>();
  for (const bruta of [d.invoice_num, ...(d.invoices_extra ?? [])]) {
    const texto = (bruta ?? "").trim();
    const clave = facturaComparable(texto);
    if (!texto || !clave || vistas.has(clave)) continue;
    vistas.add(clave);
    salida.push(texto);
  }
  return salida;
}

/**
 * ¿Esta persona puede agregar material a esta orden?
 *
 * **Su orden y su etapa.** El dueño es `orderOwner` —quien la creó o a quien se le asignó—, el mismo
 * criterio que abre la migración 125 para poner la factura que falta.
 *
 * Desde `ready` **no**, y no es solo que almacén ya montó el camión: a partir de ahí existe
 * `actual_pallets`, y **todo lo que cuelga de los pallets lee `actual_pallets ?? est_pallets`**, así
 * que subir el estimado no movería ni la capacidad, ni el manifiesto, ni la hoja de carga. Dejar
 * hacer algo que no hace nada es peor que no dejarlo.
 */
export function puedeAgregarMaterial(
  yo: Pick<Profile, "id" | "role"> | null | undefined,
  d: Pick<Delivery, "stage" | "created_by" | "assigned_sales_rep">,
): boolean {
  if (!yo || yo.role !== "sales") return false;
  if (!ETAPAS_AGREGA_MATERIAL.includes(d.stage)) return false;
  return orderOwner(d) === yo.id;
}

/** Por qué no se puede añadir esta factura. `null` = se puede. */
export type ProblemaDeFactura = "vacia" | "larga" | "tope" | "repetida";

/**
 * Lo que impide añadir ESTE número a ESTA orden.
 *
 * «Repetida» mira las que ya tiene la orden —`invoice_num` incluida—, porque añadir dos veces la
 * misma es siempre un error de dedo. Que el número esté en OTRA orden **no** lo impide: es un aviso
 * aparte (`avisoDeFacturaEnOtraOrden`), porque lo normal cuando un cliente pide más material es que
 * la factura nueva sea suya y no de nadie más.
 */
export function problemaDeFactura(tecleada: string, orden: OrdenConFacturas): ProblemaDeFactura | null {
  const texto = (tecleada ?? "").trim();
  if (!texto) return "vacia";
  if (texto.length > MAX_LARGO_FACTURA) return "larga";
  if ((orden.invoices_extra ?? []).length >= MAX_FACTURAS_EXTRA) return "tope";
  const clave = facturaComparable(texto);
  if (facturasDeLaOrden(orden).some((f) => facturaComparable(f) === clave)) return "repetida";
  return null;
}

/** La otra orden viva que ya usa ese número, para avisar sin bloquear. `null` si no hay. */
export function avisoDeFacturaEnOtraOrden<T extends OrdenConFacturas & Pick<Delivery, "id" | "order_no" | "stage">>(
  todas: readonly T[],
  tecleada: string,
  laQueSeEdita: string,
): T | null {
  const clave = facturaComparable(tecleada);
  if (!clave) return null;
  let mejor: T | null = null;
  for (const o of todas) {
    if (o.id === laQueSeEdita || o.stage === "canceled") continue;
    if (!facturasDeLaOrden(o).some((f) => facturaComparable(f) === clave)) continue;
    if (!mejor || o.order_no > mejor.order_no) mejor = o;
  }
  return mejor;
}

/** Lo que se va a escribir, en UNA sola actualización. `null` si no hay nada que cambiar. */
export type EscrituraDeMaterial = Partial<Pick<Delivery, "invoices_extra" | "est_pallets" | "pickup_duration" | "delivery_duration">>;

/**
 * El parche de «agregar material»: la factura nueva, los pallets nuevos y **las duraciones**.
 *
 * Las duraciones van aquí y no se olvidan a propósito: `pickup_duration` y `delivery_duration` son
 * `pallets × minutos-por-pallet`, y hasta ahora solo se recalculaban al guardar el formulario. Una
 * escritura que suba los pallets sin recalcularlas deja al plan de ruta con los tiempos de antes.
 *
 * Todo en **una** actualización: en dos, un fallo entre medias dejaría la factura puesta y los
 * pallets sin subir, y nadie sabría que quedó a medias.
 */
export function escrituraDeAgregarMaterial(args: {
  pedido: OrdenConFacturas & Pick<Delivery, "est_pallets">;
  /** La factura nueva, o vacío si solo se suben pallets. */
  factura: string;
  /** Los pallets nuevos, o `null` si solo se añade factura. */
  pallets: number | null;
  minutosRecogida: number;
  minutosEntrega: number;
}): EscrituraDeMaterial | null {
  const { pedido, factura, pallets, minutosRecogida, minutosEntrega } = args;
  const texto = (factura ?? "").trim();
  const sube = pallets != null && Number.isFinite(pallets) && pallets > Number(pedido.est_pallets ?? 0);
  if (!texto && !sube) return null;

  const parche: EscrituraDeMaterial = {};
  if (texto) parche.invoices_extra = [...(pedido.invoices_extra ?? []), texto];
  if (sube) {
    parche.est_pallets = pallets;
    parche.pickup_duration = palletDuration(pallets, minutosRecogida);
    parche.delivery_duration = palletDuration(pallets, minutosEntrega);
  }
  return parche;
}

/**
 * La nota del evento de etapa, que es cómo se entera quien abra la orden después.
 *
 * La orden **no vuelve a pendiente**: el material es del mismo cliente y del mismo envío, y
 * devolverla la sacaría de la cola de almacén, que es lo contrario de lo que se pide. Lo que queda
 * es el rastro, y tiene que decir **qué** cambió y **desde qué número**, o dentro de una semana
 * nadie sabrá si los 6 pallets son los de siempre.
 */
export function notaDeAgregarMaterial(args: {
  factura: string;
  palletsAntes: number | null;
  palletsDespues: number | null;
  lang: "en" | "es";
}): string {
  const { factura, palletsAntes, palletsDespues, lang } = args;
  const partes: string[] = [];
  const texto = (factura ?? "").trim();
  if (texto) partes.push(lang === "es" ? `agregó la factura ${texto}` : `added invoice ${texto}`);
  if (palletsDespues != null && palletsDespues !== palletsAntes) {
    partes.push(lang === "es"
      ? `subió los pallets de ${palletsAntes ?? 0} a ${palletsDespues}`
      : `raised pallets from ${palletsAntes ?? 0} to ${palletsDespues}`);
  }
  if (!partes.length) return "";
  const unidas = partes.length === 2 ? partes.join(lang === "es" ? " y " : " and ") : partes[0];
  return lang === "es" ? `Ventas ${unidas}` : `Sales ${unidas}`;
}

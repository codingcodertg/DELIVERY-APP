import type { Delivery, Stage } from "./types";
import { missingFields, textoDeBloqueo, type MissingField, type OrderTypeRules } from "./required";

/**
 * Una orden cuyo tipo pide factura (hoy, Customer) no sale de borrador ni se entrega sin ella (D-399).
 *
 * El dueño (2026-09-25): *«Invoice pending shouldn't show customers, that shouldn't be possible anyway»*, y
 * aclarado: *«el pending invoice no debería aparecer para customer porque el customer siempre debe llevar
 * invoice»*.
 *
 * Hasta aquí la factura solo se exigía en UN sitio: el botón de enviar del modal (`submitBlockers`, D-049).
 * Todo lo demás la dejaba pasar: «Marcar entregada ya» (D-361/D-397), enviar, aprobar y entregar en bloque
 * desde la lista, forzar el estado (admin) y la re-entrega. En producción había 5 Customer entregadas sin
 * factura, creadas y entregadas sin pasar nunca por el envío.
 *
 * Por eso vive aquí y la llaman los **dos proveedores de datos**, en `addDelivery`, `updateDelivery` y
 * `setStage`, junto a la guarda de sitio de D-276: por ahí pasa toda escritura de una orden desde el
 * cliente, venga del botón que venga. La base dice lo mismo con la migración 146.
 *
 * **Qué tipo pide factura lo decide la regla del tipo** (`docRef = "invoice"` en Ajustes), no el nombre
 * «Customer»: se reutiliza `missingFields` y se mira solo su clave `invoice_num`, que es exactamente lo que
 * el envío ya bloqueaba. Así hay un solo sitio que dice qué es «falta la factura».
 */

/** Las etapas en las que una orden todavía no necesita la factura, o ya da igual. */
export const ETAPAS_SIN_FACTURA: ReadonlySet<Stage> = new Set<Stage>(["draft", "rejected", "canceled"]);

const lleno = (v: unknown) => !!String(v ?? "").trim();

/**
 * Lo que impide esta escritura por falta de factura, o nada.
 *
 * Bloquea cuando la orden **queda** fuera de borrador/rechazada/anulada, su tipo pide factura, no la tiene,
 * **y** la escritura es de las que la dejan así:
 * - **crear** (la orden no existía);
 * - **cambiar la etapa** (enviar, aprobar, entregar, deshacer…);
 * - **cambiar el tipo** (una Intertienda viva que pasa a Customer);
 * - **vaciar la factura** que tenía.
 *
 * Lo que **no** para, a propósito: una escritura que no toca nada de eso en una orden que ya estaba sin
 * factura —las 5 viejas de producción—. Asignarle chofer, cambiarle la fecha o ponerle una nota no la deja
 * peor de lo que estaba, y bloquearlo haría que cualquier pantalla reventara al tocarla. Lo que sí se le
 * pide es la factura antes de moverla de etapa.
 */
export function escrituraSinFactura(
  antes: Delivery | undefined,
  cambioIn: Partial<Delivery>,
  reglas: OrderTypeRules,
): MissingField[] {
  // Una clave con `undefined` no viaja a la base (JSON la quita): no cuenta como cambio ni pisa lo que había.
  const cambio = Object.fromEntries(Object.entries(cambioIn).filter(([, v]) => v !== undefined)) as Partial<Delivery>;
  const despues: Partial<Delivery> = { ...(antes ?? {}), ...cambio };
  const etapa = (despues.stage ?? "draft") as Stage;
  if (ETAPAS_SIN_FACTURA.has(etapa)) return [];
  const falta = missingFields(despues, reglas).filter((m) => m.key === "invoice_num");
  if (!falta.length) return [];
  if (!antes) return falta;
  const cambiaEtapa = cambio.stage !== undefined && cambio.stage !== antes.stage;
  const cambiaTipo = cambio.order_type !== undefined && (cambio.order_type ?? "").trim() !== (antes.order_type ?? "").trim();
  const vaciaFactura = "invoice_num" in cambio && lleno(antes.invoice_num);
  return cambiaEtapa || cambiaTipo || vaciaFactura ? falta : [];
}

/**
 * Lo que se añade al resumen de una acción en bloque (enviar, aprobar, marcar entregadas, forzar estado).
 *
 * En bloque, el aviso de cada orden lo pisa el resumen «0 de 1 orden(es) actualizadas» en el mismo instante
 * (medido en el demo el 2026-09-25): la persona veía que no se movió y no por qué. Así el resumen nombra las que
 * se quedaron por la factura, con el mismo texto del envío. Se calcula con la orden **antes** del bloque.
 */
export function resumenSinFactura(
  ordenes: Delivery[],
  hacia: Stage,
  reglas: OrderTypeRules,
  etiqueta: (d: Delivery) => string,
  lang: "en" | "es",
): string {
  const sin = ordenes.filter((d) => escrituraSinFactura(d, { stage: hacia }, reglas).length > 0);
  if (!sin.length) return "";
  const cuales = sin.map((d) => `#${etiqueta(d)}`).join(", ");
  const faltan = escrituraSinFactura(sin[0], { stage: hacia }, reglas);
  return (lang === "es" ? `\n\nSin factura, no se movieron: ${cuales}. ` : `\n\nNo invoice, not moved: ${cuales}. `)
    + textoDeBloqueo(faltan, lang);
}

/** El aviso: el mismo texto que el envío («Todavía falta: • Factura #»), con la entrada de un guardado. */
export function avisoSinFactura(faltan: MissingField[], lang: "en" | "es"): string {
  return (lang === "es" ? "No se guardó — " : "Not saved — ") + textoDeBloqueo(faltan, lang);
}

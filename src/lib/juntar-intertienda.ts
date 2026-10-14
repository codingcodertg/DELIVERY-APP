/**
 * «Juntar» dos Intertiendas con la misma factura (D-NEXT).
 *
 * El dueño, 2026-10-14: «when intertienda has 2 of the same invoice order ask if you want to create a duplicate or to merge
 * the order», y después «entonces crea el merge option». El caso, de un chat que mandó: la tienda A le compra a la tienda B
 * con varias PO; B saca UNA factura para todas; A mete tres órdenes y B pone la misma factura en las tres; el almacén prepara
 * una sola carga pero tiene que hacer el proceso tres veces. Lo que se propuso en ese chat: «Invoice # already exists, would
 * you like to make a separate order (multiple trips) or join the orders for 1 trip».
 *
 * Lo de aquí es la regla, sin pantalla: cuándo se ofrece, quién puede, y qué se escribe en la orden que ya existía.
 *
 * **Solo al CREAR** una orden nueva (el botón «Crear» de la ficha). Al editar una orden que ya existe, o al escribir la
 * factura después desde la fila (D-310) o con «Agregar material» (D-339), sigue el aviso de siempre: juntar ahí significaría
 * anular la otra orden, que es otra decisión (y otra escritura que el guard no deja a todos).
 */
import { facturaComparable } from "./misma-factura";
import { orderTypeRule, type OrderTypeRules } from "./required";
import type { Delivery } from "./types";
import { palletDuration } from "./utils";

/**
 * ¿Es una Intertienda? Por la REGLA del tipo, no por su nombre: de tienda a tienda (`storeToStore`) y con la tienda propia
 * como DESTINO (`homeIsDestination`, la que compra). Un «Transfer» (de tienda a tienda sin `homeIsDestination`) no cuenta.
 */
export function esIntertienda(tipo: string | null | undefined, reglas?: OrderTypeRules): boolean {
  const regla = orderTypeRule(tipo, reglas);
  return regla.storeToStore === true && regla.homeIsDestination === true;
}

/**
 * Las etapas en las que la otra orden todavía es UN viaje por hacer: ni recogida, ni entregada, ni anulada. Tampoco la
 * rechazada: no va a salir, y meterle pallets sería esconderlos en una orden muerta.
 */
export const ETAPAS_EN_LAS_QUE_SE_JUNTA: readonly string[] = ["draft", "pending", "approved", "fulfilling", "ready"];

const igual = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

type Nueva = Pick<Partial<Delivery>, "order_type" | "invoice_num" | "store" | "delivery_name">;

/**
 * La Intertienda abierta con la que se puede juntar la orden que se está creando, o `null`.
 *
 * - Las dos son Intertienda (por la regla del tipo).
 * - La misma factura (`facturaComparable`: sin espacios, sin «#», sin mayúsculas), en su factura o entre sus facturas
 *   agregadas (D-339).
 * - La misma tienda que vende (`store`): una factura es de UNA tienda, y si no casan es un error de dedo, no un viaje.
 * - El mismo destino (`delivery_name`) si las dos lo tienen: dos destinos no son un viaje.
 * - La otra sigue abierta (`ETAPAS_EN_LAS_QUE_SE_JUNTA`).
 *
 * Si hay varias, la más reciente (el `order_no` más alto), como `ordenConEsaFactura`.
 */
export function ofreceJuntar<T extends Delivery>(nueva: Nueva, existentes: readonly T[], reglas?: OrderTypeRules): T | null {
  const factura = facturaComparable(nueva.invoice_num);
  if (!factura || !esIntertienda(nueva.order_type, reglas)) return null;
  let mejor: T | null = null;
  for (const o of existentes) {
    if (!ETAPAS_EN_LAS_QUE_SE_JUNTA.includes(o.stage)) continue;
    if (!esIntertienda(o.order_type, reglas)) continue;
    const suyas = [o.invoice_num, ...(o.invoices_extra ?? [])].map(facturaComparable);
    if (!suyas.includes(factura)) continue;
    if (!igual(o.store, nueva.store)) continue;
    if ((o.delivery_name ?? "").trim() && (nueva.delivery_name ?? "").trim() && !igual(o.delivery_name, nueva.delivery_name)) continue;
    if (!mejor || (o.order_no ?? 0) > (mejor.order_no ?? 0)) mejor = o;
  }
  return mejor;
}

/**
 * ¿Le deja la base a este rol escribir la PO y los pallets de la otra orden, en su etapa, sin cambiarla de etapa? Es el
 * espejo del tramo «misma etapa» de `guard_delivery_stage` (169):
 *
 * - admin: siempre (sale antes del guard).
 * - gerente y oficina (`manager`, `accounting`): cualquier etapa.
 * - logística: borrador a lista.
 * - almacén: aprobada, preparando y lista (las de su cola).
 * - ventas y chofer: solo borrador y pendiente. En `approved` en adelante la base solo le deja a ventas poner la factura
 *   que falta (125) y agregar facturas y pallets a SU orden (138): la PO no. A ellos «Juntar» no se les ofrece en esas
 *   etapas, y la pregunta lo dice.
 */
export function puedeJuntarEn(rol: string | null | undefined, etapa: string | null | undefined): boolean {
  if (!etapa || !ETAPAS_EN_LAS_QUE_SE_JUNTA.includes(etapa)) return false;
  if (rol === "admin" || rol === "manager" || rol === "accounting" || rol === "logistics") return true;
  if (rol === "warehouse") return ["approved", "fulfilling", "ready"].includes(etapa);
  if (rol === "sales" || rol === "driver") return etapa === "draft" || etapa === "pending";
  return false;
}

/** Las PO de las dos órdenes, separadas por «, », sin repetir ninguna (ni por mayúsculas ni por espacios). */
export function unirPOs(existente: string | null | undefined, nueva: string | null | undefined): string | null {
  const todas: string[] = [];
  for (const trozo of [existente, nueva].flatMap((s) => (s ?? "").split(","))) {
    const po = trozo.trim();
    if (po && !todas.some((ya) => igual(ya, po))) todas.push(po);
  }
  return todas.length ? todas.join(", ") : null;
}

/**
 * Lo que se escribe en la orden que ya existía al juntar: la PO de la nueva sumada a la suya, sus pallets sumados, y las dos
 * duraciones recalculadas con el total (son `pallets × minutos por pallet`, como en la ficha). Nada más: ni fecha, ni
 * tienda, ni etapa. Sin pallets en ninguna de las dos, los pallets no se tocan.
 */
export function parcheAlJuntar(
  existente: Pick<Delivery, "po2" | "est_pallets">,
  nueva: Pick<Partial<Delivery>, "po2" | "est_pallets">,
  minutosPorPallet: { recoger: number; entregar: number },
): Partial<Delivery> {
  const parche: Partial<Delivery> = {};
  const po = unirPOs(existente.po2, nueva.po2);
  if (po !== (existente.po2 ?? null)) parche.po2 = po;
  const suyos = Number(existente.est_pallets) || 0;
  const mas = Number(nueva.est_pallets) || 0;
  if (mas > 0) {
    const total = suyos + mas;
    parche.est_pallets = total;
    parche.pickup_duration = palletDuration(total, minutosPorPallet.recoger);
    parche.delivery_duration = palletDuration(total, minutosPorPallet.entregar);
  }
  return parche;
}

/** La nota que queda en el historial de la orden que recibe: qué PO, cuántos pallets, y por qué (la misma factura). */
export function notaAlJuntar(nueva: Pick<Partial<Delivery>, "po2" | "est_pallets" | "invoice_num">, lang: "en" | "es"): string {
  const po = (nueva.po2 ?? "").trim() || (lang === "es" ? "sin PO" : "no PO");
  const pallets = Number(nueva.est_pallets) || 0;
  const factura = (nueva.invoice_num ?? "").trim();
  return lang === "es"
    ? `Se juntó la PO ${po} (${pallets} pallets) — misma factura #${factura}`
    : `PO ${po} joined (${pallets} pallets) — same invoice #${factura}`;
}

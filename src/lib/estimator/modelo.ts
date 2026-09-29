/**
 * El Estimador (T-0408): el modelo de una cotización y sus cálculos.
 *
 * La regla de todo el módulo es **Entradas internas → Salida al cliente**. Lo que el vendedor mete
 * aquí (código, descripción interna, $/SF, teléfono, empresa, dirección) es interno; lo que ve el
 * cliente lo construye `hoja.ts` a partir de esto, y solo eso se imprime.
 *
 * Las claves de estos tipos van en inglés a propósito: son las mismas que se guardan en los `jsonb`
 * de `public.estimator_quotes` (migración 148), y un nombre por cada lado sería una traducción que
 * se puede equivocar al guardar.
 */

import { telefonoValido } from "@/lib/avisos-cliente";
import type { PinSource } from "@/lib/pin-draft";

export type Salutation = "Ms." | "Mr." | "Mrs.";
/** «Mr.» primero: es el de por defecto (D-432, lo pidió el dueño sobre la captura). */
export const SALUTATIONS: readonly Salutation[] = ["Mr.", "Ms.", "Mrs."];
export const DEFAULT_SALUTATION: Salutation = "Mr.";

/** Basic / Standard / Detailed: cuánto enseña la hoja del cliente. Standard es el de por defecto. */
export type DisplayLevel = "basic" | "standard" | "detailed";
export const DISPLAY_LEVELS: readonly DisplayLevel[] = ["basic", "standard", "detailed"];
export const DEFAULT_DISPLAY_LEVEL: DisplayLevel = "standard";

export interface Customer {
  salutation: Salutation;
  /**
   * El nombre completo. El apellido que se imprime SALE DE AQUÍ (`apellidoDe`): el campo «Last name as printed» se
   * quitó (D-432, «This Field is unnecessary»). Las filas viejas de la 148 traen `last_name` y `last_name_edited`
   * en el `jsonb`; `borradorDeFila` no los lee y se abren igual.
   */
  full_name: string;
  company: string;
  phone: string;
  address: string;
}

/**
 * La entrega de la cotización. **Todo esto es interno** (D-413): la hoja del cliente solo dice «Delivery: Available upon
 * request…» y no lleva ni la dirección, ni el pin, ni las millas, ni el cargo (`hoja.ts`, y su prueba).
 *
 * Desde D-NEXT la dirección es UNA línea, buscada con el mismo `AddressInput` de la ficha de Entregas, y lleva el pin del
 * mapa, la tienda de salida y las millas: lo que necesita `suggestDeliveryFee` (la misma función que la ficha) para dar
 * la tarifa de lista y la de descuento. Las filas guardadas antes traían `street`/`city`/`state`/`zip`; `borradorDeFila`
 * las junta en `address` y se abren igual.
 */
export interface Delivery {
  mode: "pickup" | "delivery";
  /** La dirección de entrega en una línea, como `delivery_address` de una orden. */
  address: string;
  /** El pin del mapa, o null. Decide la zona LOCAL / NO LOCAL cuando lo hay (D-219), como en la ficha. */
  lat: number | null;
  lng: number | null;
  /** Quién puso el pin: los mismos dos valores que en una orden (`lib/pin-draft.ts`). */
  pin_source: PinSource | null;
  /** La tienda de la que sale el camión: su dirección es el origen de las millas. */
  store: string;
  /**
   * Las millas de manejo tienda → dirección, o null hasta pulsar «Calcular distancia y tarifa». Cuestan una llamada a
   * Google, así que solo se piden con el botón, y se borran al cambiar la dirección o la tienda: unas millas de otra
   * dirección darían un precio que no es de esta.
   */
  miles: number | null;
  /** Interno. **No entra en el total** ni se imprime: al cliente se le dice que se confirma aparte. */
  charge: number | null;
}

/** Una línea que se vende por superficie: cajas completas de N SF. */
export interface SfLine {
  kind: "sf";
  id: string;
  item_code: string;
  internal_description: string;
  customer_category: string;
  customer_note: string;
  requested_sf: number | null;
  /** Lo que escribió el vendedor. Null = las de por defecto, `ceil(requested / sf_per_box)`. */
  boxes: number | null;
  sf_per_box: number | null;
  /** El **precio regular** por SF (D-NEXT: antes se llamaba «$/SF interno»; la clave del `jsonb` no cambia). */
  price_per_sf: number | null;
  /** Un precio más bajo por SF, opcional (D-NEXT). Solo vale si es menor que el regular: `precioAplicado`. */
  lower_price_per_sf: number | null;
}

/** Una línea sin superficie: «Installation Materials, 1 Lot, $385». */
export interface UnitLine {
  kind: "unit";
  id: string;
  item_code: string;
  internal_description: string;
  customer_category: string;
  customer_note: string;
  quantity: number | null;
  unit: string;
  /** El **precio regular** de la unidad. */
  unit_price: number | null;
  /** Un precio más bajo de la unidad, opcional (D-NEXT). */
  lower_unit_price: number | null;
}

export type QuoteLine = SfLine | UnitLine;

export interface QuoteDraft {
  estimate_num: string;
  sales_ext: string;
  customer: Customer;
  delivery: Delivery;
  lines: QuoteLine[];
  display_level: DisplayLevel;
  /** `YYYY-MM-DD`, en la hora local del vendedor. Por defecto, hoy: la validez es del mismo día. */
  valid_through: string;
  project_summary: string;
}

// ---------------------------------------------------------------------------------------------
// Cálculos
// ---------------------------------------------------------------------------------------------

/** A centavos, con el medio hacia arriba. `EPSILON` para que 2383.565 no se quede en ...56 por el binario. */
export function aCentavos(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const positivo = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * Las cajas de por defecto: las **completas** que cubren lo pedido. 1,250 SF a 23.80 SF/caja son
 * 52.52 cajas → **53**. Se redondea el cociente a seis decimales antes del `ceil` porque 1,250 / 25
 * en binario puede salir 50.000000000001 y pedir una caja de más.
 */
export function cajasPorDefecto(requestedSf: number | null, sfPorCaja: number | null): number | null {
  if (!positivo(requestedSf) || !positivo(sfPorCaja)) return null;
  return Math.ceil(Math.round((requestedSf / sfPorCaja) * 1e6) / 1e6);
}

/** Las cajas que valen para la línea: las que escribió el vendedor, o las de por defecto. */
export function cajasDeLinea(l: SfLine): number | null {
  if (l.boxes !== null) return positivo(l.boxes) ? l.boxes : null;
  return cajasPorDefecto(l.requested_sf, l.sf_per_box);
}

/** Actual SF: lo que de verdad se lleva, cajas × SF/caja. 53 × 23.80 = 1,261.40. */
export function sfReal(l: SfLine): number | null {
  const cajas = cajasDeLinea(l);
  if (cajas === null || !positivo(l.sf_per_box)) return null;
  return aCentavos(cajas * l.sf_per_box);
}

// ---- El precio más bajo y su % de descuento (D-NEXT) ------------------------------------------------
//
// El dueño, 2026-09-28, sobre su imagen: «For each item, the rep enters a regular price and, optionally, a lower price.
// The system automatically calculates the discount percentage using: Discount % = (Regular Price − Lower Price) /
// Regular Price × 100». Un solo sitio decide si hay descuento; el total, la pantalla y la hoja lo leen de aquí.

/** Qué pasa con el precio más bajo: no hay, vale, o se escribió pero no es un descuento (y la pantalla lo dice). */
export type EstadoDelPrecioBajo = "sin" | "aplica" | "no-menor" | "sin-regular";

export function estadoDelPrecioBajo(regular: number | null, bajo: number | null): EstadoDelPrecioBajo {
  if (bajo === null) return "sin";
  // Sin regular (o regular 0) no hay de qué descontar: la fórmula dividiría por cero.
  if (regular === null || !(regular > 0)) return "sin-regular";
  // Igual o mayor NO es un descuento: no se acepta en silencio un «descuento» de 0 % o negativo.
  if (!(bajo >= 0) || !(bajo < regular)) return "no-menor";
  return "aplica";
}

/** Discount % = (Regular − Lower) / Regular × 100, a un decimal. Null si no hay descuento que aplicar. */
export function porcentajeDeDescuento(regular: number | null, bajo: number | null): number | null {
  if (estadoDelPrecioBajo(regular, bajo) !== "aplica") return null;
  return Math.round((((regular! - bajo!) / regular!) * 100 + Number.EPSILON) * 10) / 10;
}

/** El precio con el que se calcula la línea: el más bajo si es un descuento de verdad; si no, el regular. */
export function precioAplicado(regular: number | null, bajo: number | null): number | null {
  return estadoDelPrecioBajo(regular, bajo) === "aplica" ? bajo : regular;
}

/** El regular y el más bajo de una línea, sea por SF o por unidad. */
export function preciosDeLinea(l: QuoteLine): { regular: number | null; bajo: number | null } {
  return l.kind === "sf"
    ? { regular: l.price_per_sf, bajo: l.lower_price_per_sf }
    : { regular: l.unit_price, bajo: l.lower_unit_price };
}

/**
 * El total de una línea. Por superficie, **cajas × SF/caja × $/SF** (el SF real, no el pedido: el
 * cliente paga las cajas completas). Sin superficie, cantidad × precio. Null si falta un dato: una
 * línea a medias no suma cero, no suma.
 *
 * El $/SF (o el precio de la unidad) es el **aplicado** (D-NEXT): el más bajo si lo hay y es menor que el regular. El
 * regular sigue siendo obligatorio: sin él no hay de qué calcular el descuento.
 */
export function totalDeLinea(l: QuoteLine): number | null {
  const { regular, bajo } = preciosDeLinea(l);
  const precio = precioAplicado(regular, bajo);
  if (l.kind === "sf") {
    const cajas = cajasDeLinea(l);
    if (cajas === null || !positivo(l.sf_per_box) || regular === null || !(regular >= 0) || precio === null) return null;
    return aCentavos(cajas * l.sf_per_box * precio);
  }
  if (!positivo(l.quantity) || regular === null || !(regular >= 0) || precio === null) return null;
  return aCentavos(l.quantity * precio);
}

/**
 * El total de materiales: la suma de las líneas. **Solo recibe las líneas**, a propósito: el cargo
 * de entrega vive en `Delivery` y la firma no lo deja entrar. El cliente ve «Delivery charges are
 * not included».
 */
export function totalDeMateriales(lineas: readonly QuoteLine[]): number {
  return aCentavos(lineas.reduce((s, l) => s + (totalDeLinea(l) ?? 0), 0));
}

/**
 * El total de la línea **a precio regular** (D-NEXT): es el «Amount» que ve el cliente en la hoja. El dueño, 2026-09-28:
 * «the estimate will show the line total with the regular price they input but then it will show a % discount (not
 * amount) if they provide a secondary lower price».
 */
export function totalRegularDeLinea(l: QuoteLine): number | null {
  return l.kind === "sf" ? totalDeLinea({ ...l, lower_price_per_sf: null }) : totalDeLinea({ ...l, lower_unit_price: null });
}

/**
 * El impuesto de venta, en % (D-NEXT). **8.25 % es un supuesto a validar por el dueño**: la tasa de venta habitual del
 * Valle del Río Grande en Texas (6.25 % del estado + 2 % local). No es configurable todavía: hacerlo pide una columna
 * nueva en `settings` (no hay un `jsonb` de Ajustes del Estimador donde quepa) y eso es una migración, que esta rama no
 * escribe. Cambiarla es cambiar esta constante; la hoja escribe la tasa que se usó.
 */
export const TASA_DE_IMPUESTO = 8.25;

export interface ResumenDeTotales {
  /** La suma de las líneas a precio regular. */
  subtotal: number;
  /** Lo ahorrado con los precios más bajos: subtotal regular − subtotal con los precios aplicados. 0 si no hay. */
  ahorro: number;
  /** Lo que paga impuesto: el subtotal con el ahorro ya restado (= `totalDeMateriales`). */
  baseImponible: number;
  tasa: number;
  impuesto: number;
  /** El total final: base + impuesto. **Sin la entrega** (D-413): esta función solo recibe líneas. */
  total: number;
}

/**
 * Subtotal → ahorro → impuesto → total (D-NEXT). El dueño: «at the bottom after the subtotal we will show the amount of
 * savings to then give the final total price with taxes». El impuesto va sobre el subtotal **ya con el ahorro**, y se
 * redondea a centavos. Como `totalDeMateriales`, **solo recibe las líneas**: el cargo de entrega no puede entrar.
 */
export function resumenDeTotales(lineas: readonly QuoteLine[], tasa: number = TASA_DE_IMPUESTO): ResumenDeTotales {
  const subtotal = aCentavos(lineas.reduce((s, l) => s + (totalRegularDeLinea(l) ?? 0), 0));
  const baseImponible = totalDeMateriales(lineas);
  const ahorro = aCentavos(Math.max(0, subtotal - baseImponible));
  const impuesto = aCentavos((baseImponible * tasa) / 100);
  return { subtotal, ahorro, baseImponible, tasa, impuesto, total: aCentavos(baseImponible + impuesto) };
}

/**
 * El apellido que se imprime: la ÚLTIMA palabra del nombre completo. «Maria Gonzalez» → «Gonzalez»; con dos apellidos
 * sale el último. Una sola palabra es esa palabra (D-432): ya no hay campo donde escribir el apellido aparte, así que
 * un nombre de una palabra no puede dejar la hoja sin destinatario. Vacío solo si el nombre está vacío.
 */
export function apellidoDe(nombreCompleto: string): string {
  const partes = nombreCompleto.trim().split(/\s+/).filter(Boolean);
  return partes.length > 0 ? partes[partes.length - 1] : "";
}

/** Lo único del cliente que se imprime: «Mr. Gonzalez», sacado del nombre completo. */
export function paraQuienSeImprime(c: Pick<Customer, "salutation" | "full_name">): string {
  const apellido = apellidoDe(c.full_name);
  return apellido ? `${c.salutation} ${apellido}` : "";
}

/**
 * El teléfono del cliente con forma limpia, `956-555-0123` (D-432). Reutiliza `telefonoValido` (el de los avisos al
 * cliente: 10 dígitos de EE. UU., o 11 con el 1 delante; paréntesis, espacios, puntos y `+1` se quitan). Null si no es
 * un número de EE. UU. completo: entonces se deja lo escrito tal cual y la pantalla lo marca.
 */
export function telefonoLimpio(raw: string): string | null {
  const e164 = telefonoValido(raw);
  if (!e164) return null;
  const d = e164.slice(2);
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Lo que el campo Teléfono deja escrito: la forma limpia si es un número completo, y si no, lo tecleado sin tocar. */
export function telefonoAlEscribir(raw: string): string {
  return telefonoLimpio(raw) ?? raw;
}

// ---------------------------------------------------------------------------------------------
// Fechas y formatos (inglés de EE. UU.: es la lengua de la hoja del cliente)
// ---------------------------------------------------------------------------------------------

const MESES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Hoy en la hora LOCAL de quien cotiza. `toISOString` daría el día UTC, que por la tarde en Texas ya es mañana. */
export function hoyLocal(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** `2026-09-08` → «September 8, 2026». Sin `Date`: una fecha sin hora no tiene zona que la mueva de día. */
export function fechaLarga(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  const mes = MESES[Number(m[2]) - 1];
  return mes ? `${mes} ${Number(m[3])}, ${m[1]}` : "";
}

export function dinero(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function numero(n: number, decimales = 0): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimales, maximumFractionDigits: Math.max(decimales, 2) });
}

// ---------------------------------------------------------------------------------------------
// Borradores vacíos
// ---------------------------------------------------------------------------------------------

let contador = 0;
export function idDeLinea(): string {
  contador += 1;
  return `l${Date.now().toString(36)}${contador}`;
}

export function lineaSfVacia(): SfLine {
  return {
    kind: "sf", id: idDeLinea(), item_code: "", internal_description: "", customer_category: "", customer_note: "",
    requested_sf: null, boxes: null, sf_per_box: null, price_per_sf: null, lower_price_per_sf: null,
  };
}

export function lineaUnidadVacia(): UnitLine {
  return {
    kind: "unit", id: idDeLinea(), item_code: "", internal_description: "", customer_category: "", customer_note: "",
    quantity: 1, unit: "Lot", unit_price: null, lower_unit_price: null,
  };
}

export function entregaVacia(): Delivery {
  return { mode: "pickup", address: "", lat: null, lng: null, pin_source: null, store: "", miles: null, charge: null };
}

export function borradorVacio(hoy: string = hoyLocal()): QuoteDraft {
  return {
    estimate_num: "",
    sales_ext: "",
    customer: { salutation: DEFAULT_SALUTATION, full_name: "", company: "", phone: "", address: "" },
    delivery: entregaVacia(),
    lines: [lineaSfVacia()],
    display_level: DEFAULT_DISPLAY_LEVEL,
    valid_through: hoy,
    project_summary: "",
  };
}

/**
 * La extensión con la que nace el borrador (D-432, «should be automatic»). Primero la del expediente de RR. HH. de
 * quien prepara (`recruiting.employee_files.ringcentral_ext`, la misma que enseña el directorio), que la lee el
 * servidor; si no tiene, la que esa persona escribió la última vez en este navegador; si tampoco, vacía y se escribe.
 * Siempre editable: esto solo decide el punto de partida.
 */
export function extensionDePartida(
  delExpediente: string | null | undefined, recordada: string | null | undefined,
): { valor: string; origen: "expediente" | "navegador" | "ninguno" } {
  const e = (delExpediente ?? "").trim();
  if (e) return { valor: e, origen: "expediente" };
  const r = (recordada ?? "").trim();
  if (r) return { valor: r, origen: "navegador" };
  return { valor: "", origen: "ninguno" };
}

/** Normaliza el número de estimado como lo compara la base (`lower(btrim(...))` en el índice único). */
export function claveDeEstimado(num: string): string {
  return num.trim().toLowerCase();
}

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

export type Salutation = "Ms." | "Mr." | "Mrs.";
export const SALUTATIONS: readonly Salutation[] = ["Ms.", "Mr.", "Mrs."];

/** Basic / Standard / Detailed: cuánto enseña la hoja del cliente. Standard es el de por defecto. */
export type DisplayLevel = "basic" | "standard" | "detailed";
export const DISPLAY_LEVELS: readonly DisplayLevel[] = ["basic", "standard", "detailed"];
export const DEFAULT_DISPLAY_LEVEL: DisplayLevel = "standard";

export interface Customer {
  salutation: Salutation;
  full_name: string;
  /** El apellido tal como se imprime. Sale del nombre completo mientras nadie lo toque. */
  last_name: string;
  last_name_edited: boolean;
  company: string;
  phone: string;
  address: string;
}

export interface Delivery {
  mode: "pickup" | "delivery";
  street: string;
  city: string;
  state: string;
  zip: string;
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
  price_per_sf: number | null;
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
  unit_price: number | null;
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

/**
 * El total de una línea. Por superficie, **cajas × SF/caja × $/SF** (el SF real, no el pedido: el
 * cliente paga las cajas completas). Sin superficie, cantidad × precio. Null si falta un dato: una
 * línea a medias no suma cero, no suma.
 */
export function totalDeLinea(l: QuoteLine): number | null {
  if (l.kind === "sf") {
    const cajas = cajasDeLinea(l);
    if (cajas === null || !positivo(l.sf_per_box) || l.price_per_sf === null || !(l.price_per_sf >= 0)) return null;
    return aCentavos(cajas * l.sf_per_box * l.price_per_sf);
  }
  if (!positivo(l.quantity) || l.unit_price === null || !(l.unit_price >= 0)) return null;
  return aCentavos(l.quantity * l.unit_price);
}

/**
 * El total de materiales: la suma de las líneas. **Solo recibe las líneas**, a propósito: el cargo
 * de entrega vive en `Delivery` y la firma no lo deja entrar. El cliente ve «Delivery charges are
 * not included».
 */
export function totalDeMateriales(lineas: readonly QuoteLine[]): number {
  return aCentavos(lineas.reduce((s, l) => s + (totalDeLinea(l) ?? 0), 0));
}

/** El apellido de «Maria Gonzalez» es «Gonzalez». Con dos apellidos acierta el último: por eso se edita. */
export function apellidoDe(nombreCompleto: string): string {
  const partes = nombreCompleto.trim().split(/\s+/).filter(Boolean);
  return partes.length > 1 ? partes[partes.length - 1] : "";
}

/** Lo único del cliente que se imprime: «Ms. Gonzalez». */
export function paraQuienSeImprime(c: Pick<Customer, "salutation" | "last_name">): string {
  const apellido = c.last_name.trim();
  return apellido ? `${c.salutation} ${apellido}` : "";
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
    requested_sf: null, boxes: null, sf_per_box: null, price_per_sf: null,
  };
}

export function lineaUnidadVacia(): UnitLine {
  return {
    kind: "unit", id: idDeLinea(), item_code: "", internal_description: "", customer_category: "", customer_note: "",
    quantity: 1, unit: "Lot", unit_price: null,
  };
}

export function borradorVacio(hoy: string = hoyLocal()): QuoteDraft {
  return {
    estimate_num: "",
    sales_ext: "",
    customer: { salutation: "Ms.", full_name: "", last_name: "", last_name_edited: false, company: "", phone: "", address: "" },
    delivery: { mode: "pickup", street: "", city: "", state: "", zip: "", charge: null },
    lines: [lineaSfVacia()],
    display_level: DEFAULT_DISPLAY_LEVEL,
    valid_through: hoy,
    project_summary: "",
  };
}

/** Normaliza el número de estimado como lo compara la base (`lower(btrim(...))` en el índice único). */
export function claveDeEstimado(num: string): string {
  return num.trim().toLowerCase();
}

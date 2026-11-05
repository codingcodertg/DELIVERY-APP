/**
 * El historial PRINCIPAL del cliente: lo que se ha hecho con él en las otras apps (D-874, migración 245).
 *
 * El dueño: «el historial principal va a ser de las entregas que se hicieron con ese cliente […] conecta Deliveries con
 * Customers, y hasta con el Quote Builder, para que todo lo que se haya hecho con ese cliente salga ahí».
 *
 * Cómo se une una orden o una cotización a una fila de Clientes:
 *  - Con la 245, por `deliveries.customer_id` / `estimator_quotes.customer_id`. Los pone la base (disparador), con la
 *    MISMA regla que aquí `clienteDeLaCuenta`: nombre igual sin mayúsculas, acentos, puntuación ni sufijos (LLC, INC…);
 *    primero la fila de LA MISMA tienda; si en esa tienda no hay, la única fila si hay exactamente una; archivadas nunca;
 *    lo ambiguo queda sin unir. En la cotización, además, el cliente que se ELIGE en el buscador manda (su id va en el
 *    `customer` de la cotización y la base lo copia a la columna).
 *  - Sin la 245 (la columna aún no existe), por el nombre: las órdenes cuya `account` es la cuenta del cliente y las
 *    cotizaciones cuya empresa lo es. Es lo que la pantalla puede enseñar mientras tanto.
 *
 * Lo que se ve lo decide la RLS de cada tabla, leída con la sesión de quien mira: nadie ve aquí una orden o una
 * cotización que no vería en su app.
 */
import { totalDeMateriales, type QuoteLine } from "@/lib/estimator/modelo";
import { isoInTZ } from "@/lib/utils";

/** El día (YYYY-MM-DD) de una fecha o fecha y hora, en la hora de Texas (`BUSINESS_TZ`). */
export function diaDeTexas(s: string): string {
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s.slice(0, 10) : isoInTZ(d);
}

/** Sufijos que no distinguen una empresa (= `SUF` del informe de coincidencias y `erp.clave_de_cuenta` de la 245). */
export const SUFIJOS_DE_EMPRESA: readonly string[] = ["llc", "inc", "co", "corp", "ltd", "company", "the", "lp", "pllc"];

/**
 * La clave de una cuenta para compararla: sin acentos, sin mayúsculas, «&» = «and», sin puntuación y sin sufijos de
 * empresa. «AIDEN JETT, LLC» y «Aiden Jett» dan lo mismo. Gemela de `erp.clave_de_cuenta` (245): si cambia una, la otra.
 */
export function claveDeCuenta(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/).filter((t) => t && !SUFIJOS_DE_EMPRESA.includes(t)).join(" ");
}

const TIENDA_POR_NOMBRE: Record<string, string> = {
  "RDZ BROWNSVILLE": "BRO", "RDZ EDINBURG": "EDG", "RDZ MCALLEN": "MCA", "RDZ PHARR": "PHR", "RDZ WESLACO": "WES", "RDZ MISSION": "MIS",
};

/** La tienda como código (BRO, EDG…): Clientes guarda el código y Entregas el nombre. Gemela de `erp.clave_de_tienda`. */
export function claveDeTienda(s: string | null | undefined): string {
  const u = (s ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  return TIENDA_POR_NOMBRE[u] ?? u;
}

export interface FilaParaUnir { id: number; account: string; store: string; archived_at: string | null }

/** La fila de Clientes a la que se une una cuenta escrita en una orden o cotización, o null si no hay una sola. */
export function clienteDeLaCuenta(filas: readonly FilaParaUnir[], cuenta: string | null | undefined, tienda: string | null | undefined): number | null {
  const k = claveDeCuenta(cuenta);
  if (!k) return null;
  const vivas = filas.filter((f) => f.archived_at === null && claveDeCuenta(f.account) === k);
  const t = claveDeTienda(tienda);
  const deLaTienda = t ? vivas.filter((f) => claveDeTienda(f.store) === t) : [];
  if (deLaTienda.length === 1) return deLaTienda[0].id;
  if (deLaTienda.length > 1) return null;
  return vivas.length === 1 ? vivas[0].id : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Las filas del historial principal
// ---------------------------------------------------------------------------------------------------------------

export type ClaseDeTrato = "orden" | "cotizacion";

export interface Trato {
  clase: ClaseDeTrato;
  id: string;
  /** ISO (fecha o fecha y hora): por esto se ordena. */
  fecha: string;
  /** Orden: el código (FA100a); cotización: el número de estimado. */
  numero: string;
  factura: string | null;
  /** Orden: la etapa (clave); cotización: «printed» o «draft». */
  estado: string;
  tienda: string | null;
  chofer: string | null;
  monto: number | null;
  tarimas: number | null;
  href: string;
}

const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const numero = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Las columnas de `public.deliveries` que se leen (sin `customer_id`, que es el filtro). */
export const COLUMNAS_DE_ORDEN = "id, order_code, order_suffix, invoice_num, stage, store, assigned_driver, delivery_fee, est_pallets, actual_pallets, delivery_date, input_date, created_at, is_training";
/** Las de `public.estimator_quotes`. */
export const COLUMNAS_DE_COTIZACION = "id, estimate_num, store, lines, printed_at, created_at, updated_at";

export function tratoDeOrden(f: Record<string, unknown>): Trato {
  const codigo = txt(f.order_code);
  return {
    clase: "orden",
    id: String(f.id),
    fecha: txt(f.delivery_date) ?? txt(f.input_date) ?? txt(f.created_at) ?? "",
    numero: codigo ? `${codigo}${txt(f.order_suffix) ?? ""}` : String(f.id).slice(0, 8),
    factura: txt(f.invoice_num),
    estado: txt(f.stage) ?? "",
    tienda: txt(f.store),
    chofer: txt(f.assigned_driver),
    monto: numero(f.delivery_fee),
    tarimas: numero(f.actual_pallets) ?? numero(f.est_pallets),
    href: `/?order=${encodeURIComponent(String(f.id))}`,
  };
}

export function tratoDeCotizacion(f: Record<string, unknown>): Trato {
  const lineas = Array.isArray(f.lines) ? (f.lines as QuoteLine[]) : [];
  let total: number | null = null;
  try { total = lineas.length ? totalDeMateriales(lineas) : null; } catch { total = null; }
  return {
    clase: "cotizacion",
    id: String(f.id),
    fecha: txt(f.created_at) ?? txt(f.updated_at) ?? "",
    numero: txt(f.estimate_num) ?? "—",
    factura: null,
    estado: txt(f.printed_at) ? "printed" : "draft",
    tienda: txt(f.store),
    chofer: null,
    monto: total,
    tarimas: null,
    href: `/estimator?quote=${encodeURIComponent(String(f.id))}`,
  };
}

export type FiltroDeTratos = "todo" | ClaseDeTrato;

/** Órdenes y cotizaciones juntas, lo más nuevo primero (a igual fecha, la orden antes y luego por número), filtradas. */
export function mezclaTratos(ordenes: readonly Trato[], cotizaciones: readonly Trato[], filtro: FiltroDeTratos = "todo"): Trato[] {
  const todas = [...ordenes, ...cotizaciones].filter((x) => filtro === "todo" || x.clase === filtro);
  return todas.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.clase.localeCompare(b.clase) || b.numero.localeCompare(a.numero));
}

/** Para el fallback sin la 245: un patrón ILIKE que casa el texto tal cual (sin comodines del usuario). */
export function patronExacto(s: string): string {
  return s.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Entregada por otro (solo admin): una orden YA entregada que sale en la ruta de un chofer, cuando en realidad la entregó
 * otra persona (p. ej. un gerente de almacén el día anterior). El admin la saca de esa ruta dejándola «entregada»: se
 * cambia el chofer por quien la entregó, el día real de la entrega y se quitan los puestos de ruta. La etapa no se toca.
 *
 * Reglas puras (sin base ni pantalla): el Gestor las usa en el diálogo y los tests las fijan.
 */

/** Largo máximo de «Quién la entregó». */
export const LARGO_MAX_QUIEN = 80;

/** Lo que el diálogo escribe en la orden: el nuevo chofer (quien la entregó), el día real y los puestos a null. */
export interface ParcheDeEntregadaPorOtro {
  assigned_driver: string;
  delivery_date: string;
  route_seq: null;
  load_no: null;
  pickup_seq?: null;
}

export type MotivoDeEntregadaPorOtro = "quien-vacio" | "quien-largo" | "mismo-chofer" | "dia-no-valido" | "dia-futuro";

const TIENDA_CON_PREFIJO = /^warehouse\s/i;
const FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `yyyy-mm-dd` que existe de verdad (no 2026-02-31). */
export function esFechaISO(valor: string): boolean {
  const m = FECHA_ISO.exec(valor);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === valor;
}

/**
 * Sugerencias para «Quién la entregó»: «Warehouse <tienda>» (la tienda de la orden, sin repetir el prefijo si ya lo trae)
 * y los nombres de las demás rutas del día. Sin duplicados (sin mayúsculas) y sin el chofer actual.
 */
export function sugerenciasDeQuien(tienda: string | null | undefined, lanes: readonly string[], choferActual: string | null | undefined): string[] {
  const actual = (choferActual ?? "").trim().toLowerCase();
  const t = (tienda ?? "").trim();
  const candidatos = [t ? (TIENDA_CON_PREFIJO.test(t) ? t : `Warehouse ${t}`) : "", ...lanes.map((l) => (l ?? "").trim())];
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const c of candidatos) {
    const clave = c.toLowerCase();
    if (!c || clave === actual || vistos.has(clave)) continue;
    vistos.add(clave);
    out.push(c);
  }
  return out;
}

/** Devuelve el motivo por el que no se puede guardar, o null si está bien. `hoy` es el día de Texas (yyyy-mm-dd). */
export function validaEntregadaPorOtro({ quien, dia, hoy, choferActual }: {
  quien: string; dia: string; hoy: string; choferActual?: string | null;
}): MotivoDeEntregadaPorOtro | null {
  const q = quien.trim();
  if (!q) return "quien-vacio";
  if (q.length > LARGO_MAX_QUIEN) return "quien-largo";
  if (choferActual && q.toLowerCase() === choferActual.trim().toLowerCase()) return "mismo-chofer";
  if (!esFechaISO(dia)) return "dia-no-valido";
  if (dia > hoy) return "dia-futuro";
  return null;
}

/** El parche de la orden. La recogida (`pickup_seq`) solo va si la base tiene esa columna (154). */
export function parcheDeEntregadaPorOtro({ quien, dia, conRecogida }: { quien: string; dia: string; conRecogida: boolean }): ParcheDeEntregadaPorOtro {
  return {
    assigned_driver: quien.trim(),
    delivery_date: dia,
    route_seq: null,
    load_no: null,
    ...(conRecogida ? { pickup_seq: null } : {}),
  };
}

/** La nota del historial, en las dos lenguas (una línea, como las demás notas bilingües). */
export function notaDeEntregadaPorOtro({ quien, dia, anterior }: { quien: string; dia: string; anterior: string | null | undefined }): string {
  const q = quien.trim();
  const a = (anterior ?? "").trim();
  const porAnterior = a && a.toLowerCase() !== q.toLowerCase() ? { en: `, not by ${a}`, es: `, no por ${a}` } : { en: "", es: "" };
  return `Delivered on ${dia} by ${q}${porAnterior.en}. / Entregada el ${dia} por ${q}${porAnterior.es}.`;
}

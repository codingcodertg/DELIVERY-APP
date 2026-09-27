/**
 * Encuesta de satisfacción en la página pública de seguimiento (D-418, migración 151).
 *
 * El dueño, 2026-09-27, tras explicarle OptimoRoute: *«solos haz 1 3 y 4»*; el 4 incluía la encuesta que OptimoRoute
 * pone en su página de seguimiento. Aquí: **1 a 5 estrellas y un comentario opcional**, en `/track/<id>` cuando la orden
 * está ENTREGADA, sin login. **Una respuesta por orden** (la clave primaria de `delivery_surveys` es la orden). **No se
 * manda por SMS**: solo aparece en la página que el cliente ya tiene.
 *
 * Esto NO revive el recuadro de la ficha que quitó D-043 (las estrellas que nadie rellenaba desde la oficina): la
 * calificación la da el cliente, y se ve en el Panel, no en la orden ni en la vista del chofer (D-026).
 *
 * Aquí vive lo que decide, sin red ni base: qué respuesta vale, cuándo se puede responder, quién ve los resultados y el
 * resumen que pinta el Panel.
 */
import type { Stage, UserRole } from "./types";

export const MAX_COMENTARIO = 500;

/** El id de una orden es un uuid v4 (`gen_random_uuid()`): 122 bits al azar, no se adivina. Lo que no tenga esa forma
 *  ni se busca. */
export const esIdDeOrden = (id: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/** Solo una orden entregada se puede calificar: antes, no hay entrega que calificar. */
export const sePuedeCalificar = (stage: Stage | string | null | undefined): boolean => stage === "delivered";

export type Respuesta = { rating: number; comment: string | null };

/**
 * Lo que manda el cliente, comprobado. Estrellas: un ENTERO del 1 al 5 (no "5", no 4.5). Comentario: opcional; se
 * recortan los espacios, se quitan los caracteres de control (menos el salto de línea) y se corta a `MAX_COMENTARIO`
 * — igual que el `check` de la 151, para que la base no rechace lo que la ruta dio por bueno. Vacío = sin comentario.
 */
export function validaRespuesta(cuerpo: unknown): { ok: true; respuesta: Respuesta } | { ok: false; error: string } {
  if (!cuerpo || typeof cuerpo !== "object") return { ok: false, error: "Invalid body." };
  const { rating, comment } = cuerpo as { rating?: unknown; comment?: unknown };
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, error: "Rating must be 1 to 5 stars." };
  if (comment != null && typeof comment !== "string") return { ok: false, error: "Invalid comment." };
  // eslint-disable-next-line no-control-regex
  const limpio = (comment ?? "").replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "").trim().slice(0, MAX_COMENTARIO);
  return { ok: true, respuesta: { rating, comment: limpio || null } };
}

/** Quién ve los resultados (y lo mismo dice la política de la 151): admin, logística y gerentes. De qué tiendas lo
 *  decide el Panel con sus mismas órdenes (`ordenesDelPanel`), y la base, con lo que cada uno ve de `deliveries`. */
export const ROLES_QUE_VEN_ENCUESTAS: readonly UserRole[] = ["admin", "logistics", "manager"];
export const veEncuestas = (rol: UserRole | null | undefined): boolean => !!rol && ROLES_QUE_VEN_ENCUESTAS.includes(rol);

export interface FilaDeEncuesta { delivery_id: string; rating: number; comment: string | null; created_at: string }

export interface ResumenDeEncuestas {
  respuestas: number;
  /** Con un decimal. `null` sin respuestas. */
  media: number | null;
  /** Cuántas de 1, 2, 3, 4 y 5 estrellas (índice 0 = una estrella). */
  reparto: [number, number, number, number, number];
  /** Las que traen comentario, de la más reciente a la más vieja. */
  comentarios: FilaDeEncuesta[];
}

/** El resumen del Panel, solo de las órdenes que cuentan en él (las de sus tiendas y su rango de fechas). */
export function resumenDeEncuestas(filas: readonly FilaDeEncuesta[], ordenesDelPanel: ReadonlySet<string>): ResumenDeEncuestas {
  const mias = filas.filter((f) => ordenesDelPanel.has(f.delivery_id) && Number.isInteger(f.rating) && f.rating >= 1 && f.rating <= 5);
  const reparto: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let suma = 0;
  for (const f of mias) { reparto[f.rating - 1]++; suma += f.rating; }
  return {
    respuestas: mias.length,
    media: mias.length ? Math.round((suma / mias.length) * 10) / 10 : null,
    reparto,
    comentarios: mias.filter((f) => !!f.comment).sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0)),
  };
}

/** Los códigos con los que la base dice «esa tabla no existe» (la 151 sin aplicar): PostgREST `PGRST205`, Postgres `42P01`. */
export const faltaLaTabla = (e: { code?: string } | null | undefined): boolean => !!e && (e.code === "PGRST205" || e.code === "42P01");

// ---- El demo (`NEXT_PUBLIC_LOCAL_MODE`): sin base, las respuestas viven en este navegador ----------------------------

export const LS_ENCUESTAS = "rtg_delivery_surveys_local_v1";

type Almacen = Pick<Storage, "getItem" | "setItem">;

export function leeEncuestasLocales(almacen: Almacen | null | undefined): FilaDeEncuesta[] {
  try {
    const crudo = almacen?.getItem(LS_ENCUESTAS);
    const v = crudo ? JSON.parse(crudo) : [];
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

/** Guarda una respuesta en el demo, con la misma regla que la base: una por orden. `false` = ya había una. */
export function guardaEncuestaLocal(almacen: Almacen | null | undefined, deliveryId: string, r: Respuesta, ahoraISO: string): boolean {
  const filas = leeEncuestasLocales(almacen);
  if (filas.some((f) => f.delivery_id === deliveryId)) return false;
  try { almacen?.setItem(LS_ENCUESTAS, JSON.stringify([...filas, { delivery_id: deliveryId, ...r, created_at: ahoraISO }])); } catch { return false; }
  return true;
}

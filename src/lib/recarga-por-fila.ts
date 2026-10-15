// ============================================================
// Un evento realtime recarga SOLO la fila que cambió (D-564; reemplaza en parte a D-201 / G-15).
//
// Hasta hoy, un evento en `deliveries` volvía a bajar la LISTA ENTERA (120 días, ~670 filas el 2026-10-15) en cada
// cliente conectado: un UPDATE de una orden = tantas descargas de la lista como sesiones abiertas. Con la instancia
// Micro de Supabase saturada, el dueño pidió «solo que se descargue lo necesario que se ocupa para ese momento».
//
// Este módulo es la parte PURA: dado lo que llegó en una ráfaga (el debounce de 250 ms sigue igual), decide por tabla
// qué ids leer por `in(id, [...])`, cuáles quitar del estado, y cuándo rendirse y recargar la lista como antes (red de
// seguridad). Y la fusión de lo leído en el estado. Nada de aquí toca Supabase ni React.
//
// Por qué no se usa `payload.new` como fila: la RLS la aplica la base al LEER (el evento llega aunque la fila no sea
// visible para ese usuario), y `photo_count` lo calcula un disparador (177) —se lee de la base, no del eco—.
// ============================================================

export type TipoDeEvento = "INSERT" | "UPDATE" | "DELETE";

/** Lo que el proveedor guarda de cada `postgres_changes` mientras el debounce está abierto. */
export interface EventoRealtime {
  table: string;
  eventType: TipoDeEvento;
  new: Record<string, unknown> | null | undefined;
  old: Record<string, unknown> | null | undefined;
}

/** Las tablas que se recargan por fila. Las demás siguen con su consulta entera (D-201, `queriesForTables`). */
export const TABLAS_POR_FILA = ["deliveries", "order_events", "notifications"] as const;
export type TablaPorFila = (typeof TABLAS_POR_FILA)[number];

/**
 * Más ids que esto en una ráfaga y se recarga la lista entera: una lectura `in()` de 25 ids ya es casi tan cara como
 * la lista de 670, y una ráfaga así (reordenar una ruta, partir una carga) es justo el caso en que el eco puede llegar
 * a medias. Red de seguridad, no optimización.
 */
export const MAX_IDS_POR_RAFAGA = 25;

export interface PlanDeTabla {
  /** ids a leer de la base (`in(id, leer)`); nunca se llama con una lista vacía. */
  leer: string[];
  /** ids a quitar del estado sin leer nada (DELETE). */
  quitar: string[];
}

export interface PlanDeRafaga {
  /** Tablas que se recargan enteras, como hasta ahora (no mapeadas, sin id, o demasiadas filas). */
  listas: string[];
  /** Por tabla, qué filas leer y cuáles quitar. */
  porFila: Partial<Record<TablaPorFila, PlanDeTabla>>;
}

function esTablaPorFila(t: string): t is TablaPorFila {
  return (TABLAS_POR_FILA as readonly string[]).includes(t);
}

function idDe(e: EventoRealtime): string | null {
  const fuente = e.eventType === "DELETE" ? e.old : e.new;
  const id = fuente?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Qué hacer con una ráfaga. Por tabla:
 * - INSERT/UPDATE → leer esa fila por id; DELETE → quitarla. El último evento de un id manda.
 * - `notifications`: un evento de OTRO usuario se ignora del todo (la campana solo lista las de `meId`); así el abanico
 *   de N filas que escribe `emitStageNotifs` no cuesta nada a quien no es destinatario. Un DELETE no trae `user_id`
 *   (replica identity por defecto = clave), así que se quita por id: quitar lo que no está no hace nada.
 * - Sin id en el payload, o más de `max` ids a leer → esa tabla se recarga entera (red de seguridad).
 */
export function planDeRafaga(eventos: Iterable<EventoRealtime>, opts: { meId: string | null; max?: number }): PlanDeRafaga {
  const max = opts.max ?? MAX_IDS_POR_RAFAGA;
  const listas = new Set<string>();
  const leer = new Map<TablaPorFila, Set<string>>();
  const quitar = new Map<TablaPorFila, Set<string>>();
  for (const e of eventos) {
    if (!esTablaPorFila(e.table)) { listas.add(e.table); continue; }
    if (listas.has(e.table)) continue;
    if (e.table === "notifications" && e.eventType !== "DELETE") {
      const para = e.new?.user_id;
      if (typeof para === "string" && para !== opts.meId) continue;
    }
    const id = idDe(e);
    if (!id) { listas.add(e.table); continue; }
    const l = leer.get(e.table) ?? new Set<string>();
    const q = quitar.get(e.table) ?? new Set<string>();
    if (e.eventType === "DELETE") { q.add(id); l.delete(id); } else { l.add(id); q.delete(id); }
    leer.set(e.table, l); quitar.set(e.table, q);
  }
  const porFila: PlanDeRafaga["porFila"] = {};
  for (const t of TABLAS_POR_FILA) {
    if (listas.has(t)) continue;
    const l = [...(leer.get(t) ?? [])];
    const q = [...(quitar.get(t) ?? [])];
    if (!l.length && !q.length) continue;
    if (l.length > max) { listas.add(t); continue; }
    porFila[t] = { leer: l, quitar: q };
  }
  return { listas: [...listas], porFila };
}

/**
 * Fusiona lo leído en el estado.
 * - Una fila pedida que NO volvió (RLS, o borrada entre el eco y la lectura) se quita.
 * - Una fila que volvió pero ya no `cumple` el filtro de la lista (p. ej. pasó a `is_training`, o salió de la ventana
 *   de fechas) se quita.
 * - Las que cumplen reemplazan a la suya en su sitio, o se insertan donde las deja `antes` (el orden de la consulta),
 *   sin reordenar lo que ya estaba.
 * - `max`, si viene, recorta la lista por el final (las consultas con `limit`).
 */
export function fusionarFilas<T extends { id: string }>(
  prev: readonly T[],
  leidas: readonly T[],
  plan: PlanDeTabla,
  cumple: (fila: T) => boolean,
  antes: (a: T, b: T) => boolean,
  max?: number,
): T[] {
  const fuera = new Set<string>(plan.quitar);
  for (const id of plan.leer) fuera.add(id);
  const buenas = new Map<string, T>();
  for (const f of leidas) if (cumple(f)) { buenas.set(f.id, f); fuera.delete(f.id); }
  const out: T[] = [];
  for (const f of prev) {
    if (fuera.has(f.id)) continue;
    const nueva = buenas.get(f.id);
    if (nueva) { out.push(nueva); buenas.delete(f.id); } else out.push(f);
  }
  for (const nueva of buenas.values()) {
    let i = out.findIndex((f) => antes(nueva, f));
    if (i < 0) i = out.length;
    out.splice(i, 0, nueva);
  }
  return max !== undefined && out.length > max ? out.slice(0, max) : out;
}

/** El mismo filtro que la consulta de la lista (`deliveriesQuery`): sin enseñanza, y dentro de la ventana o abierta. */
export function cumpleFiltroDeLaLista(
  d: { is_training?: boolean | null; delivery_date?: string | null; input_date?: string | null; stage?: string | null },
  floor: string | null,
): boolean {
  if (d.is_training !== false) return false;
  if (floor === null) return true;
  if (d.delivery_date == null) return true;
  if (d.delivery_date >= floor) return true;
  if (d.input_date != null && d.input_date >= floor) return true;
  return d.stage !== "delivered" && d.stage !== "canceled";
}

/** `order("order_no", desc)`: la lista de órdenes. */
export const porOrderNoDesc = (a: { order_no: number }, b: { order_no: number }) => a.order_no > b.order_no;
/** `order("created_at", desc)`: eventos y notificaciones. */
export const porCreatedAtDesc = (a: { created_at: string }, b: { created_at: string }) => a.created_at > b.created_at;

/**
 * Cuántas filas baja un cliente por un evento en `deliveries`: antes la lista entera, después las de la ráfaga. Para
 * la entrada de DECISIONS.md, con el tamaño de la lista del día.
 */
export function filasPorEvento(filasEnLaLista: number, idsEnLaRafaga: number): { antes: number; despues: number } {
  return { antes: filasEnLaLista, despues: Math.min(idsEnLaRafaga, filasEnLaLista) };
}

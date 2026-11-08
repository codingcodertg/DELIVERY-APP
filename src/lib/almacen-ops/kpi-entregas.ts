/**
 * Operaciones de almacén: el KPI de ENTREGAS del almacén (fase 1 de los KPI de Roberto, gerente de almacén):
 * «% de órdenes listas antes de que llegue el chofer».
 *
 * La regla, exacta:
 *   - Cuenta toda orden que el chofer RECOGIÓ en el rango (su primer evento `picked_up`, por el día de Texas en que
 *     ocurrió). Una orden que nunca se recogió no cuenta.
 *   - «Lista a tiempo» = su ÚLTIMO evento `ready` es ESTRICTAMENTE anterior a su PRIMER `picked_up`. Un empate (misma
 *     marca de tiempo) NO cuenta como a tiempo.
 *   - Con `picked_up` y sin ningún `ready`: NO lista (el almacén nunca la marcó). Cuenta en el total y en «no listas».
 *   - Minutos listo→recogida = (primer picked_up − último ready) en minutos; positivo = la orden esperó al chofer;
 *     negativo = se marcó después de recogida. Null si no hay `ready`.
 *   - La mediana de minutos se calcula sobre las órdenes que SÍ tienen `ready` (signo incluido).
 *   - Las «peores 10»: primero las marcadas DESPUÉS de recogidas, de más a menos minutos tarde; luego las que nunca se
 *     marcaron (sin minutos).
 *   - El desglose por empleado va por `created_by` del ÚLTIMO `ready` de cada orden (el KPI personal). Las órdenes sin
 *     `ready` no pertenecen a nadie y no entran en esa tabla.
 *
 * Todo puro: recibe las filas de `deliveries` y `order_events` y devuelve números. Sin React, sin base. Lo usan la
 * ruta del servidor (`/api/almacen-ops/kpi-entregas`), la pantalla y las pruebas.
 */
import { diaEnTexas } from "./fecha-del-dano";

/** Los tipos de evento que cuentan (`order_events.kind`, los mismos que `Stage` en `types.ts`). */
export const KIND_LISTA = "ready";
export const KIND_RECOGIDA = "picked_up";

export interface EventoDeOrden {
  delivery_id: string;
  kind: string;
  created_by: string | null;
  created_at: string;
}

export interface EntregaDelKpi {
  id: string;
  order_code: string | null;
  invoice_num: string | null;
  /** La tienda de donde sale (la que vende: `deliveries.store`). */
  store: string | null;
  pickup_name: string | null;
  delivery_date: string | null;
}

export interface OrdenEvaluada {
  id: string;
  /** La factura, o el código de la orden si no la tiene. */
  factura: string;
  tienda: string;
  /** El día de Texas en que se recogió (YYYY-MM-DD). */
  dia: string;
  /** El domingo de esa semana (YYYY-MM-DD). */
  semana: string;
  listaEn: string | null;
  recogidaEn: string;
  /** Minutos entre el último `ready` y el primer `picked_up`; null sin `ready`. */
  minutos: number | null;
  aTiempo: boolean;
  /** Quién marcó el último `ready` (su id), o null. */
  quienMarco: string | null;
}

export interface Grupo {
  clave: string;
  total: number;
  aTiempo: number;
  /** Marcadas lista DESPUÉS de recogidas (o al mismo tiempo). */
  tarde: number;
  /** Recogidas sin ningún `ready`. */
  sinMarcar: number;
  /** 0–100, o null sin órdenes. */
  pct: number | null;
  /** Mediana de minutos listo→recogida sobre las que tienen `ready`; null si ninguna. */
  medianaMin: number | null;
}

export interface GrupoDeEmpleado extends Grupo {
  nombre: string;
}

/** El rango que acepta la ruta: días `YYYY-MM-DD`, `desde <= hasta`, y como mucho 62 días (como `/api/puntualidad`). */
export const DIAS_MAX_DEL_RANGO = 62;
export function rangoValido(desde: string, hasta: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return false;
  const a = Date.parse(`${desde}T00:00:00Z`), b = Date.parse(`${hasta}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) && a <= b && (b - a) / 86_400_000 < DIAS_MAX_DEL_RANGO;
}

/** Sin nombre en profiles. */
export const SIN_NOMBRE = "—";
export const SIN_TIENDA = "—";

const ms = (iso: string) => Date.parse(iso);

/** El domingo de la semana de `dia` (como en el rango de la merma: las semanas empiezan en domingo). */
export function domingoDe(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  f.setUTCDate(f.getUTCDate() - f.getUTCDay());
  return f.toISOString().slice(0, 10);
}

/** La mediana de una lista (promedio de los dos del medio si son pares), redondeada a enteros. Null si está vacía. */
export function mediana(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
}

/**
 * Evalúa cada orden recogida: último `ready` contra primer `picked_up`. Las órdenes sin `picked_up` (o que no están
 * en `entregas`) se descartan. Si viene `rango`, solo quedan las recogidas en esos días de Texas (extremos inclusive).
 */
export function evaluarOrdenes(
  entregas: readonly EntregaDelKpi[],
  eventos: readonly EventoDeOrden[],
  rango?: { desde: string; hasta: string },
): OrdenEvaluada[] {
  const porOrden = new Map(entregas.map((e) => [e.id, e]));
  const recogida = new Map<string, string>();
  const lista = new Map<string, { en: string; quien: string | null }>();
  for (const ev of eventos) {
    if (!Number.isFinite(ms(ev.created_at))) continue;
    if (ev.kind === KIND_RECOGIDA) {
      const antes = recogida.get(ev.delivery_id);
      if (!antes || ms(ev.created_at) < ms(antes)) recogida.set(ev.delivery_id, ev.created_at);
    } else if (ev.kind === KIND_LISTA) {
      const antes = lista.get(ev.delivery_id);
      if (!antes || ms(ev.created_at) > ms(antes.en)) lista.set(ev.delivery_id, { en: ev.created_at, quien: ev.created_by });
    }
  }
  const out: OrdenEvaluada[] = [];
  for (const [id, recogidaEn] of recogida) {
    const e = porOrden.get(id);
    if (!e) continue;
    const dia = diaEnTexas(recogidaEn);
    if (rango && (dia < rango.desde || dia > rango.hasta)) continue;
    const l = lista.get(id) ?? null;
    const minutos = l ? Math.round((ms(recogidaEn) - ms(l.en)) / 60_000) : null;
    out.push({
      id,
      factura: (e.invoice_num ?? "").trim() || (e.order_code ?? "").trim() || id.slice(0, 8),
      tienda: (e.store ?? "").trim() || SIN_TIENDA,
      dia,
      semana: domingoDe(dia),
      listaEn: l?.en ?? null,
      recogidaEn,
      minutos,
      aTiempo: !!l && ms(l.en) < ms(recogidaEn),
      quienMarco: l?.quien ?? null,
    });
  }
  return out.sort((a, b) => a.recogidaEn.localeCompare(b.recogidaEn) || a.id.localeCompare(b.id));
}

function resumen(clave: string, ordenes: readonly OrdenEvaluada[]): Grupo {
  const g: Grupo = { clave, total: ordenes.length, aTiempo: 0, tarde: 0, sinMarcar: 0, pct: null, medianaMin: null };
  const mins: number[] = [];
  for (const o of ordenes) {
    if (o.aTiempo) g.aTiempo++;
    else if (o.minutos === null) g.sinMarcar++;
    else g.tarde++;
    if (o.minutos !== null) mins.push(o.minutos);
  }
  g.pct = g.total > 0 ? Math.round((g.aTiempo / g.total) * 100) : null;
  g.medianaMin = mediana(mins);
  return g;
}

function agrupar(ordenes: readonly OrdenEvaluada[], claveDe: (o: OrdenEvaluada) => string | null): Grupo[] {
  const m = new Map<string, OrdenEvaluada[]>();
  for (const o of ordenes) {
    const k = claveDe(o);
    if (k === null) continue;
    const xs = m.get(k);
    if (xs) xs.push(o); else m.set(k, [o]);
  }
  return [...m.entries()].map(([k, xs]) => resumen(k, xs)).sort((a, b) => a.clave.localeCompare(b.clave));
}

/** El total de todas (la cifra grande). */
export function totalDelKpi(ordenes: readonly OrdenEvaluada[]): Grupo {
  return resumen("*", ordenes);
}

/** Por tienda de origen, ordenadas por nombre. */
export function porTienda(ordenes: readonly OrdenEvaluada[]): Grupo[] {
  return agrupar(ordenes, (o) => o.tienda);
}

/** Por día de Texas o por semana (el domingo que la abre), en orden cronológico. */
export function porPeriodo(ordenes: readonly OrdenEvaluada[], periodo: "dia" | "semana"): Grupo[] {
  return agrupar(ordenes, (o) => (periodo === "dia" ? o.dia : o.semana));
}

/**
 * Por empleado del almacén: quién marcó el último `ready`. Las órdenes sin `ready` no entran. De más a menos órdenes,
 * y a igual cuenta por nombre.
 */
export function porEmpleado(ordenes: readonly OrdenEvaluada[], nombres: ReadonlyMap<string, string> | Record<string, string>): GrupoDeEmpleado[] {
  const nombre = (id: string) => (nombres instanceof Map ? nombres.get(id) : (nombres as Record<string, string>)[id]) ?? SIN_NOMBRE;
  return agrupar(ordenes, (o) => o.quienMarco)
    .map((g) => ({ ...g, nombre: nombre(g.clave) }))
    .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre));
}

/**
 * Las peores `n`: primero las marcadas después de recogidas (de más a menos minutos tarde), luego las que nunca se
 * marcaron (más recientes primero).
 */
export function peores(ordenes: readonly OrdenEvaluada[], n = 10): OrdenEvaluada[] {
  const tarde = ordenes.filter((o) => !o.aTiempo && o.minutos !== null).sort((a, b) => (a.minutos as number) - (b.minutos as number) || b.recogidaEn.localeCompare(a.recogidaEn));
  const sinMarcar = ordenes.filter((o) => !o.aTiempo && o.minutos === null).sort((a, b) => b.recogidaEn.localeCompare(a.recogidaEn));
  return [...tarde, ...sinMarcar].slice(0, n);
}

/** El color del porcentaje: verde ≥ 90, ámbar ≥ 70, rojo abajo; gris sin datos. */
export function colorDelPct(pct: number | null): "verde" | "ambar" | "rojo" | "gris" {
  if (pct === null) return "gris";
  return pct >= 90 ? "verde" : pct >= 70 ? "ambar" : "rojo";
}

/** Las tiendas que le tocan a quien pide: el admin de la app, todas (null); los demás, la suya y las visibles. */
export function tiendasDelKpi(q: { role: string; warehouse_ops_role?: string | null; store?: string | null; visible_stores?: string[] | null }): string[] | null {
  if (q.role === "admin" || q.warehouse_ops_role === "admin") return null;
  const mias = [q.store ?? "", ...(q.visible_stores ?? [])].map((s) => s.trim()).filter(Boolean);
  return mias.length ? [...new Set(mias)] : null;
}

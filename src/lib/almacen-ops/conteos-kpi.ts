/**
 * Operaciones de almacén (274): el KPI de conteos de inventario que ve el gerente.
 *
 *   - Conteos hechos (ajustados) por tienda en el periodo (por `adjusted_at`).
 *   - Exactitud %: líneas contadas con diferencia 0 / líneas contadas con cantidad del sistema.
 *   - Variación total en $: suma de |precio × diferencia|; y la neta con signo.
 *   - Días promedio de creado a ajustado.
 *   - Por empleado: líneas contadas y su exactitud.
 *
 * Todo puro: recibe las filas y el periodo (YYYY-MM-DD, inclusive) y devuelve números. Sin React, sin base.
 */
import { diferencia, valorDeLaDiferencia, type Conteo, type Linea } from "./conteos";

export interface Periodo { desde: string; hasta: string }

export interface KpiDeConteos {
  tienda: string;
  /** Conteos ajustados en el periodo. */
  hechos: number;
  /** Abiertos ahora (cualquier etapa menos adjusted / cancelled), sin importar el periodo. */
  abiertos: number;
  cancelados: number;
  lineasContadas: number;
  lineasExactas: number;
  /** Null sin líneas comparables. */
  exactitudPct: number | null;
  variacionAbs: number;
  variacionNeta: number;
  /** Promedio de días de created_at a adjusted_at (1 decimal). Null sin hechos. */
  diasPromedio: number | null;
}

export interface KpiDeEmpleado {
  id: string;
  nombre: string;
  lineas: number;
  exactas: number;
  exactitudPct: number | null;
}

type ConteoMin = Pick<Conteo, "id" | "store" | "stage" | "created_at" | "adjusted_at">;
type LineaMin = Pick<Linea, "count_id" | "system_qty" | "counted_total" | "price" | "counted_at" | "counted_by" | "counted_by_name">;

/** ¿Cae el instante dentro del periodo (días inclusive, por la fecha ISO)? */
export function enPeriodo(iso: string | null, p: Periodo): boolean {
  if (!iso) return false;
  const d = iso.slice(0, 10);
  return d >= p.desde && d <= p.hasta;
}

/** Los conteos del periodo: los ajustados dentro de él, más los abiertos (para que la pantalla los enseñe). */
export function conteosDelPeriodo<T extends ConteoMin>(conteos: readonly T[], p: Periodo): T[] {
  return conteos.filter((c) => (c.stage === "adjusted" ? enPeriodo(c.adjusted_at, p) : c.stage !== "cancelled" || enPeriodo(c.created_at, p)));
}

export function diasEntre(desde: string, hasta: string): number {
  return (new Date(hasta).getTime() - new Date(desde).getTime()) / 86_400_000;
}

export function kpiDeConteos(conteos: readonly ConteoMin[], lineas: readonly LineaMin[], p: Periodo, tiendas: readonly string[]): KpiDeConteos[] {
  return tiendas.map((tienda) => {
    const mios = conteos.filter((c) => c.store === tienda);
    const hechos = mios.filter((c) => c.stage === "adjusted" && enPeriodo(c.adjusted_at, p));
    const ids = new Set(hechos.map((c) => c.id));
    let contadas = 0, exactas = 0, comparables = 0, abs = 0, neta = 0;
    for (const l of lineas) {
      if (!ids.has(l.count_id) || l.counted_at == null) continue;
      contadas++;
      const d = diferencia(l);
      if (d == null) continue;
      comparables++;
      if (d === 0) exactas++;
      const v = valorDeLaDiferencia(l);
      if (v != null) { abs += Math.abs(v); neta += v; }
    }
    const dias = hechos.map((c) => diasEntre(c.created_at, c.adjusted_at!)).filter((n) => Number.isFinite(n) && n >= 0);
    return {
      tienda,
      hechos: hechos.length,
      abiertos: mios.filter((c) => c.stage !== "adjusted" && c.stage !== "cancelled").length,
      cancelados: mios.filter((c) => c.stage === "cancelled" && enPeriodo(c.created_at, p)).length,
      lineasContadas: contadas, lineasExactas: exactas,
      exactitudPct: comparables === 0 ? null : Math.round((exactas / comparables) * 100),
      variacionAbs: Math.round(abs * 100) / 100, variacionNeta: Math.round(neta * 100) / 100,
      diasPromedio: dias.length === 0 ? null : Math.round((dias.reduce((a, b) => a + b, 0) / dias.length) * 10) / 10,
    };
  });
}

/** Por empleado: líneas que contó (en los conteos dados) y cuántas cuadraron. Ordenado por líneas, luego nombre. */
export function kpiPorEmpleado(conteos: readonly ConteoMin[], lineas: readonly LineaMin[], p: Periodo, tienda?: string): KpiDeEmpleado[] {
  const ids = new Set(conteos.filter((c) => (!tienda || c.store === tienda) && c.stage === "adjusted" && enPeriodo(c.adjusted_at, p)).map((c) => c.id));
  const por = new Map<string, KpiDeEmpleado & { comparables: number }>();
  for (const l of lineas) {
    if (!ids.has(l.count_id) || l.counted_at == null || !l.counted_by) continue;
    const e = por.get(l.counted_by) ?? { id: l.counted_by, nombre: l.counted_by_name ?? "—", lineas: 0, exactas: 0, exactitudPct: null, comparables: 0 };
    e.lineas++;
    const d = diferencia(l);
    if (d != null) { e.comparables++; if (d === 0) e.exactas++; }
    if (l.counted_by_name && e.nombre === "—") e.nombre = l.counted_by_name;
    por.set(l.counted_by, e);
  }
  return [...por.values()]
    .map(({ comparables, ...e }) => ({ ...e, exactitudPct: comparables === 0 ? null : Math.round((e.exactas / comparables) * 100) }))
    .sort((a, b) => (b.lineas - a.lineas) || a.nombre.localeCompare(b.nombre));
}

/** El tono de la exactitud: ≥ 95 verde, ≥ 85 ámbar, menos rojo; sin dato, gris. */
export function colorDeExactitud(pct: number | null): "verde" | "ambar" | "rojo" | "gris" {
  if (pct === null) return "gris";
  return pct >= 95 ? "verde" : pct >= 85 ? "ambar" : "rojo";
}

/** El periodo de los últimos `dias` días hasta `hoy` (inclusive). */
export function periodoDeDias(hoy: string, dias: number): Periodo {
  const d = new Date(`${hoy}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (dias - 1));
  return { desde: d.toISOString().slice(0, 10), hasta: hoy };
}

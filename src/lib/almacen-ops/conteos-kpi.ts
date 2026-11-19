/**
 * Operaciones de almacén (274, revisada en 333): el KPI de conteos de inventario que ve el gerente EN REPORTES
 * (no en la pantalla de conteo). Roberto (2026-11-19): «if every month we're missing 50 boxes that's a very big red flag».
 *
 *   - Conteos ajustados por tienda en el mes (por `adjusted_at`).
 *   - La diferencia es DESPUÉS de las órdenes pendientes: real = contado − pendiente; diferencia = real − sistema.
 *   - Faltan / sobran: piezas, cajas (piezas ÷ piezas por caja; las líneas sin piezas por caja no suman cajas) y $.
 *   - Exactitud %: líneas con diferencia 0 / líneas comparables (con sistema).
 *   - Días promedio de creado a ajustado.
 *
 * Todo puro: recibe las filas y el periodo (YYYY-MM-DD, inclusive) y devuelve números. Sin React, sin base.
 */
import { cuentasDeLinea, pendienteDeLinea, redondea, type Conteo, type Linea, type OrdenPendiente } from "./conteos";

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
  /** Líneas con sistema (comparables). */
  lineasComparables: number;
  /** Null sin líneas comparables. */
  exactitudPct: number | null;
  /** Faltan (real < sistema), en piezas y en cajas (solo de productos con piezas por caja). */
  faltanPiezas: number;
  faltanCajas: number;
  /** Faltan de productos SIN piezas por caja (no se pueden pasar a cajas). */
  faltanPiezasSinCaja: number;
  /** Sobran (real > sistema). */
  sobranPiezas: number;
  sobranCajas: number;
  sobranPiezasSinCaja: number;
  /** $ faltante (positivo) y sobrante (positivo), y la neta con signo. */
  faltanValor: number;
  sobranValor: number;
  netoValor: number;
  /** Órdenes pendientes registradas en los conteos del periodo (piezas). */
  pendientePiezas: number;
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
type LineaMin = Pick<Linea, "id" | "count_id" | "system_qty" | "counted_total" | "price" | "pieces_per_box" | "counted_at" | "counted_by" | "counted_by_name">;
type PendienteMin = Pick<OrdenPendiente, "line_id" | "qty">;

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

/** El periodo de un mes calendario («2026-11» → del 1 al 30 de noviembre). Mes inválido: null. */
export function periodoDeMes(mes: string): Periodo | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return null;
  const [y, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

/** El mes anterior o siguiente de «YYYY-MM» (sin salir de calendario). */
export function mesVecino(mes: string, delta: number): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function kpiDeConteos(conteos: readonly ConteoMin[], lineas: readonly LineaMin[], pendientes: readonly PendienteMin[], p: Periodo, tiendas: readonly string[]): KpiDeConteos[] {
  return tiendas.map((tienda) => {
    const mios = conteos.filter((c) => c.store === tienda);
    const hechos = mios.filter((c) => c.stage === "adjusted" && enPeriodo(c.adjusted_at, p));
    const ids = new Set(hechos.map((c) => c.id));
    let contadas = 0, exactas = 0, comparables = 0, pend = 0;
    let faltaP = 0, faltaC = 0, faltaSC = 0, sobraP = 0, sobraC = 0, sobraSC = 0, faltaV = 0, sobraV = 0, neto = 0;
    for (const l of lineas) {
      if (!ids.has(l.count_id) || l.counted_at == null) continue;
      contadas++;
      const pl = pendienteDeLinea(pendientes, l.id);
      pend += pl;
      const c = cuentasDeLinea(l, pl);
      if (c.diferencia == null) continue;
      comparables++;
      if (c.diferencia === 0) exactas++;
      const cajas = l.pieces_per_box != null && l.pieces_per_box > 0 ? c.diferencia / l.pieces_per_box : null;
      if (c.diferencia < 0) {
        faltaP += -c.diferencia;
        if (cajas == null) faltaSC += -c.diferencia; else faltaC += -cajas;
        faltaV += -(c.valor ?? 0);
      }
      if (c.diferencia > 0) {
        sobraP += c.diferencia;
        if (cajas == null) sobraSC += c.diferencia; else sobraC += cajas;
        sobraV += c.valor ?? 0;
      }
      neto += c.valor ?? 0;
    }
    const dias = hechos.map((c) => diasEntre(c.created_at, c.adjusted_at!)).filter((n) => Number.isFinite(n) && n >= 0);
    const enPeriodoDeConteos = conteosDelPeriodo(mios, p).map((c) => c.id);
    const pendPeriodo = lineas.filter((l) => enPeriodoDeConteos.includes(l.count_id)).reduce((s, l) => s + pendienteDeLinea(pendientes, l.id), 0);
    return {
      tienda,
      hechos: hechos.length,
      abiertos: mios.filter((c) => c.stage !== "adjusted" && c.stage !== "cancelled").length,
      cancelados: mios.filter((c) => c.stage === "cancelled" && enPeriodo(c.created_at, p)).length,
      lineasContadas: contadas, lineasExactas: exactas, lineasComparables: comparables,
      exactitudPct: comparables === 0 ? null : Math.round((exactas / comparables) * 100),
      faltanPiezas: redondea(faltaP), faltanCajas: redondea(faltaC), faltanPiezasSinCaja: redondea(faltaSC),
      sobranPiezas: redondea(sobraP), sobranCajas: redondea(sobraC), sobranPiezasSinCaja: redondea(sobraSC),
      faltanValor: redondea(faltaV), sobranValor: redondea(sobraV), netoValor: redondea(neto),
      pendientePiezas: redondea(pendPeriodo),
      diasPromedio: dias.length === 0 ? null : Math.round((dias.reduce((a, b) => a + b, 0) / dias.length) * 10) / 10,
    };
  });
}

/** El total de todas las tiendas (suma de los renglones; la exactitud se recalcula con las líneas, no se promedia). */
export function totalDeConteos(filas: readonly KpiDeConteos[]): Pick<KpiDeConteos, "hechos" | "lineasContadas" | "lineasExactas" | "lineasComparables" | "exactitudPct" | "faltanPiezas" | "faltanCajas" | "faltanPiezasSinCaja" | "sobranPiezas" | "sobranCajas" | "sobranPiezasSinCaja" | "faltanValor" | "sobranValor" | "netoValor" | "pendientePiezas"> {
  const suma = (f: (k: KpiDeConteos) => number) => redondea(filas.reduce((s, k) => s + f(k), 0));
  const exactas = filas.reduce((s, k) => s + k.lineasExactas, 0);
  const comparables = filas.reduce((s, k) => s + k.lineasComparables, 0);
  return {
    hechos: filas.reduce((s, k) => s + k.hechos, 0),
    lineasContadas: filas.reduce((s, k) => s + k.lineasContadas, 0),
    lineasExactas: exactas,
    lineasComparables: comparables,
    exactitudPct: comparables === 0 ? null : Math.round((exactas / comparables) * 100),
    faltanPiezas: suma((k) => k.faltanPiezas), faltanCajas: suma((k) => k.faltanCajas), faltanPiezasSinCaja: suma((k) => k.faltanPiezasSinCaja),
    sobranPiezas: suma((k) => k.sobranPiezas), sobranCajas: suma((k) => k.sobranCajas), sobranPiezasSinCaja: suma((k) => k.sobranPiezasSinCaja),
    faltanValor: suma((k) => k.faltanValor), sobranValor: suma((k) => k.sobranValor), netoValor: suma((k) => k.netoValor),
    pendientePiezas: suma((k) => k.pendientePiezas),
  };
}

/** Por empleado: líneas que contó (en los conteos ajustados del periodo) y cuántas cuadraron después de las pendientes. */
export function kpiPorEmpleado(conteos: readonly ConteoMin[], lineas: readonly LineaMin[], pendientes: readonly PendienteMin[], p: Periodo, tienda?: string): KpiDeEmpleado[] {
  const ids = new Set(conteos.filter((c) => (!tienda || c.store === tienda) && c.stage === "adjusted" && enPeriodo(c.adjusted_at, p)).map((c) => c.id));
  const por = new Map<string, KpiDeEmpleado & { comparables: number }>();
  for (const l of lineas) {
    if (!ids.has(l.count_id) || l.counted_at == null || !l.counted_by) continue;
    const e = por.get(l.counted_by) ?? { id: l.counted_by, nombre: l.counted_by_name ?? "—", lineas: 0, exactas: 0, exactitudPct: null, comparables: 0 };
    e.lineas++;
    const c = cuentasDeLinea(l, pendienteDeLinea(pendientes, l.id));
    if (c.diferencia != null) { e.comparables++; if (c.diferencia === 0) e.exactas++; }
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

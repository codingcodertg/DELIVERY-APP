/**
 * Operaciones de almacén (273): el KPI de mantenimiento que ve el gerente en la cabecera de la sección.
 *
 *   - Cumplimiento de la lista diaria esta semana, por tienda: equipos en servicio × días laborales transcurridos
 *     (lunes a sábado, hasta hoy inclusive) contra listas hechas (una por equipo y día; dos personas que revisan el
 *     mismo equipo el mismo día cuentan una).
 *   - Equipos que necesitan reparación (abiertos ahora).
 *
 * Todo puro: recibe las filas y la fecha de hoy (YYYY-MM-DD, la de Texas) y devuelve números. Sin React, sin base.
 */
import type { Equipo, Lista } from "./mantenimiento";

/** Los días que se trabajan en el almacén: lunes (1) a sábado (6). El domingo no cuenta. */
export const DIAS_LABORALES: readonly number[] = [1, 2, 3, 4, 5, 6];

/** El lunes de la semana de `dia` (YYYY-MM-DD → YYYY-MM-DD). */
export function lunesDe(dia: string): string {
  const d = aFecha(dia);
  const dow = d.getUTCDay(); // 0 = domingo
  const atras = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - atras);
  return aTexto(d);
}

/** Los días laborales de la semana de `hoy` que ya pasaron (hoy inclusive), como YYYY-MM-DD. */
export function diasLaboralesTranscurridos(hoy: string, laborales: readonly number[] = DIAS_LABORALES): string[] {
  const lunes = aFecha(lunesDe(hoy));
  const out: string[] = [];
  for (let n = 0; n < 7; n++) {
    const d = new Date(lunes);
    d.setUTCDate(lunes.getUTCDate() + n);
    const txt = aTexto(d);
    if (txt > hoy) break;
    if (laborales.includes(d.getUTCDay())) out.push(txt);
  }
  return out;
}

export interface KpiDeTienda {
  tienda: string;
  /** Equipos activos en servicio (los que deben llevar lista diaria). */
  enServicio: number;
  /** Listas esperadas esta semana: en servicio × días laborales transcurridos. */
  esperadas: number;
  /** Listas hechas esta semana (equipo + día distintos, de equipos activos). */
  hechas: number;
  /** 0–100, o null si no se esperaba ninguna. */
  pct: number | null;
  /** Equipos activos que necesitan reparación. */
  necesitanReparacion: number;
  /** Equipos activos fuera de servicio. */
  fueraDeServicio: number;
  /** Equipos en servicio SIN lista hoy (hoy laboral), para la lista de pendientes. */
  sinListaHoy: string[];
}

/**
 * El KPI por tienda. `equipos` y `listas` son las filas que quien mira puede ver (la RLS ya filtró); se agrupa por
 * `store`. Las tiendas que vienen en `tiendas` salen aunque no tengan equipo (con ceros); las demás, solo si tienen.
 */
export function kpiDeMantenimiento(
  equipos: readonly Pick<Equipo, "id" | "store" | "status" | "active">[],
  listas: readonly Pick<Lista, "equipment_id" | "store" | "shift_date">[],
  hoy: string,
  tiendas: readonly string[] = [],
  laborales: readonly number[] = DIAS_LABORALES,
): KpiDeTienda[] {
  const dias = diasLaboralesTranscurridos(hoy, laborales);
  const desde = lunesDe(hoy);
  const hoyLaboral = dias.includes(hoy);
  const porTienda = new Map<string, KpiDeTienda>();
  const asegura = (t: string) => {
    let k = porTienda.get(t);
    if (!k) { k = { tienda: t, enServicio: 0, esperadas: 0, hechas: 0, pct: null, necesitanReparacion: 0, fueraDeServicio: 0, sinListaHoy: [] }; porTienda.set(t, k); }
    return k;
  };
  for (const t of tiendas) asegura(t);
  const activos = new Map<string, (typeof equipos)[number]>();
  for (const e of equipos) {
    if (!e.active) continue;
    activos.set(e.id, e);
    const k = asegura(e.store);
    if (e.status === "in_service") k.enServicio++;
    else if (e.status === "needs_repair") k.necesitanReparacion++;
    else k.fueraDeServicio++;
  }
  // Listas de la semana: equipo + día distintos, solo de equipos activos y dentro de la semana (hasta hoy).
  const vistas = new Set<string>();
  const conListaHoy = new Set<string>();
  for (const l of listas) {
    if (l.shift_date < desde || l.shift_date > hoy) continue;
    if (!activos.has(l.equipment_id)) continue;
    const clave = `${l.equipment_id}|${l.shift_date}`;
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    asegura(l.store).hechas++;
    if (l.shift_date === hoy) conListaHoy.add(l.equipment_id);
  }
  for (const k of porTienda.values()) {
    k.esperadas = k.enServicio * dias.length;
    k.pct = k.esperadas > 0 ? Math.min(100, Math.round((k.hechas / k.esperadas) * 100)) : null;
    if (hoyLaboral) {
      k.sinListaHoy = [...activos.values()].filter((e) => e.store === k.tienda && e.status === "in_service" && !conListaHoy.has(e.id)).map((e) => e.id);
    }
  }
  return [...porTienda.values()].sort((a, b) => a.tienda.localeCompare(b.tienda));
}

/** El total de todas las tiendas (la cifra grande del KPI). */
export function totalDelKpi(k: readonly KpiDeTienda[]): Pick<KpiDeTienda, "enServicio" | "esperadas" | "hechas" | "pct" | "necesitanReparacion" | "fueraDeServicio"> {
  const t = { enServicio: 0, esperadas: 0, hechas: 0, pct: null as number | null, necesitanReparacion: 0, fueraDeServicio: 0 };
  for (const x of k) { t.enServicio += x.enServicio; t.esperadas += x.esperadas; t.hechas += x.hechas; t.necesitanReparacion += x.necesitanReparacion; t.fueraDeServicio += x.fueraDeServicio; }
  t.pct = t.esperadas > 0 ? Math.min(100, Math.round((t.hechas / t.esperadas) * 100)) : null;
  return t;
}

/** El color del porcentaje: verde ≥ 90, ámbar ≥ 60, rojo abajo; gris sin datos. */
export function colorDelPct(pct: number | null): "verde" | "ambar" | "rojo" | "gris" {
  if (pct === null) return "gris";
  return pct >= 90 ? "verde" : pct >= 60 ? "ambar" : "rojo";
}

function aFecha(dia: string): Date {
  const [y, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}
function aTexto(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

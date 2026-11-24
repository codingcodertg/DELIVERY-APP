/**
 * Operaciones de almacén (23 nov): la FILA de un conteo, la misma para la lista «Seguir» de Conteos y para «Conteos del
 * mes» del informe (dueño: «have both synchronized»: comparten columnas y elección de columnas). Sin React.
 * La aritmética NO cambia: sale de `resumenDelConteo` y de la misma fórmula de cajas que ya usaba el informe
 * (contado − pendiente − sistema, en cajas, solo líneas comparables).
 */
import {
  comparableConElSistema, progresoDelConteo, resumenDelConteo, type Conteo, type Linea, type OrdenPendiente,
} from "./conteos";

export interface FilaDeConteo {
  c: Conteo;
  lineas: Linea[];
  pendientes: OrdenPendiente[];
  /** Neto en $ (faltan − sobran), después de pendientes. */
  neto: number;
  faltanCajas: number;
  sobranCajas: number;
  exactitud: number | null;
  /** Líneas ya contadas. */
  lineasN: number;
  hechas: number;
  total: number;
  /** Órdenes pendientes del conteo. */
  ordenes: number;
}

/** Las filas de los conteos: `lineas` y `pendientes` ya son los de ese conteo. */
export function filaDeConteo(c: Conteo, lineas: Linea[], pendientes: OrdenPendiente[]): FilaDeConteo {
  const r = resumenDelConteo(lineas, pendientes);
  const cajas = (signo: 1 | -1) => lineas.reduce((s, l) => {
    const pz = l.pieces_per_box;
    const pl = pendientes.filter((o) => o.line_id === l.id).reduce((x, o) => x + o.qty, 0);
    if (l.counted_at == null || l.system_qty == null || pz == null || pz <= 0 || !comparableConElSistema(l)) return s;
    const d = (l.counted_total ?? 0) - pl - l.system_qty;
    return s + (Math.sign(d) === signo ? Math.abs(d) / pz : 0);
  }, 0);
  const p = progresoDelConteo(lineas);
  return {
    c, lineas, pendientes, neto: r.valorNeto,
    faltanCajas: Math.round(cajas(-1) * 100) / 100, sobranCajas: Math.round(cajas(1) * 100) / 100,
    exactitud: r.exactitudPct, lineasN: r.contadas, hechas: p.hechas, total: p.total, ordenes: pendientes.length,
  };
}

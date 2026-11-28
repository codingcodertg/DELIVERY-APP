import { descargaPrimero } from "./descarga-primero";
import type { OrdenEntrada, ParadaRef } from "./types";

/**
 * D-1212 · «Si vamos a una tienda, dejamos en la tienda y recogemos» (el dueño, 2026-11-27: «no vas a recoger algo si
 * tienes algo para entregar a esa tienda»). Regla DURA, sin excepción de tiempo ni de millas: si al recoger en la tienda S
 * el camión lleva a bordo una orden que va PARA S (su recogida está antes y su entrega más adelante), esa entrega se adelanta
 * a ese momento, y `descargaPrimero` la deja antes de las cargas de la visita. Adelantar una descarga nunca sube la carga a
 * bordo. Las primeras `fijas` paradas (hechas o en curso) no se tocan; una entrega fija tampoco se mueve.
 * Devuelve una lista NUEVA; no muta la entrada. Es idempotente.
 */
export function dejaAntesDeRecoger(secuencia: readonly ParadaRef[], ordenes: readonly OrdenEntrada[], fijas = 0): ParadaRef[] {
  const porId = new Map<string, OrdenEntrada>();
  for (const o of ordenes) if (!porId.has(o.id)) porId.set(o.id, o);
  let seq: ParadaRef[] = [...secuencia];
  for (let pasada = 0; pasada <= secuencia.length; pasada++) {
    const k = primeraRecogidaConCargaParaAhi(seq, porId, fijas);
    if (!k) break;
    const [d] = seq.splice(k.entrega, 1);
    seq.splice(k.recogida, 0, d);
  }
  return descargaPrimero(seq, ordenes, fijas);
}

/** La primera recogida (desde `fijas`) en una tienda S con algo a bordo para S, y la entrega que hay que adelantar. */
export function primeraRecogidaConCargaParaAhi(seq: readonly ParadaRef[], porId: ReadonlyMap<string, OrdenEntrada>, fijas = 0): { recogida: number; entrega: number; orden: string } | null {
  const aBordo = new Set<string>();
  for (let i = 0; i < seq.length; i++) {
    const p = seq[i];
    if (p.tipo === "D") { aBordo.delete(p.orden); continue; }
    const tienda = porId.get(p.orden)?.origen || null;
    if (tienda && i >= fijas) {
      for (const o of aBordo) {
        if ((porId.get(o)?.destino || null) !== tienda) continue;
        const entrega = seq.findIndex((x, j) => j > i && x.tipo === "D" && x.orden === o);
        if (entrega >= fijas && entrega > i) return { recogida: i, entrega, orden: o };
      }
    }
    aBordo.add(p.orden);
  }
  return null;
}

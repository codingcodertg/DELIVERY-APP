import { aCentesimas } from "./route-engine/evalua";

/**
 * La auto-optimización al asignar (fase 3 del dueño): la DECISIÓN, pura. Sin escrituras, sin red, sin reloj. Quien asigna
 * (el Gestor, el reparto, un arrastre) le pasa lo que cambió; esto dice qué rutas de chofer y día hay que volver a
 * optimizar, si una ruta cambió de verdad (su huella), y dónde puede entrar lo nuevo sin pisar lo que alguien fijó a mano.
 */

export type CambioDeAsignacion = { orden: string; dia: string | null; antes: string | null /* chofer */; despues: string | null };
export type RutaAOptimizar = { chofer: string; dia: string; motivo: "llega" | "sale" | "ambas"; ordenes: string[] };

interface Acumulada { chofer: string; dia: string; llega: boolean; sale: boolean; ordenes: string[] }

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * De un lote de cambios (asignar una, varias, repartir entre choferes, pasar un bucket, mover de un chofer a otro), las rutas
 * que hay que volver a optimizar: UNA por chofer y día, con todas las órdenes del lote que la tocan. La ruta de la que una
 * orden SALE también se optimiza. Un cambio que no cambia nada (mismo chofer antes y después) no cuenta. Sin día o sin
 * chofer en ese lado, ese lado no produce ruta. Orden estable: por día y luego por chofer.
 */
export function rutasAOptimizar(cambios: readonly CambioDeAsignacion[]): RutaAOptimizar[] {
  const porClave = new Map<string, Acumulada>();
  const tocar = (chofer: string, dia: string, orden: string, lado: "llega" | "sale"): void => {
    const clave = `${dia}\u0000${chofer}`;
    let r = porClave.get(clave);
    if (!r) {
      r = { chofer, dia, llega: false, sale: false, ordenes: [] };
      porClave.set(clave, r);
    }
    r[lado === "llega" ? "llega" : "sale"] = true;
    if (!r.ordenes.includes(orden)) r.ordenes.push(orden);
  };

  for (const c of cambios) {
    if (c.dia == null || c.antes === c.despues) continue;
    if (c.despues != null) tocar(c.despues, c.dia, c.orden, "llega");
    if (c.antes != null) tocar(c.antes, c.dia, c.orden, "sale");
  }

  return [...porClave.values()]
    .sort((a, b) => cmp(a.dia, b.dia) || cmp(a.chofer, b.chofer))
    .map((r): RutaAOptimizar => ({
      chofer: r.chofer,
      dia: r.dia,
      motivo: r.llega && r.sale ? "ambas" : r.llega ? "llega" : "sale",
      ordenes: r.ordenes,
    }));
}

/**
 * La huella de una ruta (chofer, día, las paradas en orden, y cada orden con sus pallets, origen y destino, ordenadas por id)
 * para no recalcular si nada cambió. Es el texto canónico, sin resumir: dos rutas con el mismo contenido dan el mismo texto, y
 * cambia si cambia una orden, sus pallets, el orden de las paradas o un sitio. Los pallets van en centésimas enteras.
 */
export function huellaDeLaRuta(r: {
  chofer: string;
  dia: string;
  paradas: readonly { orden: string; tipo: "P" | "D" }[];
  ordenes: readonly { id: string; pallets: number; origen: string | null; destino: string | null }[];
}): string {
  const ordenes = [...r.ordenes]
    .sort((a, b) => cmp(a.id, b.id))
    .map((o) => [o.id, aCentesimas(o.pallets), o.origen ?? null, o.destino ?? null]);
  const paradas = r.paradas.map((p) => [p.tipo, p.orden]);
  return JSON.stringify([r.chofer, r.dia, paradas, ordenes]);
}

/**
 * Dónde entra lo nuevo sin pisar lo que una persona fijó: `fijadasAMano` son las claves de parada ("P:<orden>" / "D:<orden>")
 * que alguien movió a mano después de la última optimización. Devuelve qué paradas puede mover el optimizador (las del lote
 * y las no fijadas) y cuáles debe dejar donde están, en su orden relativo. Las primeras `hechas` paradas van siempre fijas
 * (ya hechas o en curso). Una parada del lote se libera aunque antes estuviera fijada a mano, salvo que ya esté hecha.
 */
export function repartoDeLibertad(
  secuencia: readonly { orden: string; tipo: "P" | "D" }[],
  hechas: number,
  fijadasAMano: ReadonlySet<string>,
  delLote: ReadonlySet<string>,
): { libres: string[]; fijas: string[] } {
  const libres: string[] = [];
  const fijas: string[] = [];
  secuencia.forEach((p, i) => {
    const clave = `${p.tipo}:${p.orden}`;
    if (i < hechas) fijas.push(clave);
    else if (delLote.has(p.orden)) libres.push(clave);
    else if (fijadasAMano.has(clave)) fijas.push(clave);
    else libres.push(clave);
  });
  return { libres, fijas };
}

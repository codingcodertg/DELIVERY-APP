import { palletsDeLaOrden } from "./pallets";
import { claveDeTienda } from "./secuencia-pd";
import type { Reescritura } from "./mover-parada";

/**
 * Reordenar las RECOGIDAS (filas P) de un viaje en la tarjeta del chofer del Gestor de Rutas (D-NEXT).
 *
 * El dueño, el 2026-09-28, con la tarjeta de Maximo Garza delante: «why i can't rearrenge pickup check that». Las filas P
 * no tenían flechas porque D-334 las DERIVA: en una ruta hecha a mano lo único que se guarda es el viaje (`load_no`) y el
 * puesto de ENTREGA (`route_seq`) de cada orden. La P es la recogida de esa misma orden, y el orden de las tiendas de un
 * viaje sale de la entrega: **las tiendas se recorren en el orden de su primera entrega**. No hay ningún campo que diga
 * «esta tienda antes que aquella» independiente de las entregas, y crearlo es una migración (no se hizo).
 *
 * Así que mover una recogida es mover lo que la decide, y se dice: para que Weslaco se recoja antes que Brownsville, la
 * PRIMERA entrega de Weslaco tiene que ir antes que la primera de Brownsville. Se adelanta **la mínima**: solo esa
 * entrega, justo delante de la primera de la tienda que se salta. Lo demás no se mueve. Lo que se guarda (`route_seq`)
 * es lo que luego se lee (`secuenciaPD`) y lo que pinta el mapa: no hay un orden de recogida «de la pantalla» aparte.
 */

/**
 * Las entregas de UN viaje, reordenadas lo mínimo para que sus tiendas se recojan en el orden `tiendas` (claves de
 * `claveDeTienda`). Una tienda del viaje que no esté en la lista va detrás, en el orden en que aparece hoy.
 *
 * Cómo: se recorre el viaje; cuando aparece la primera entrega de una tienda que aún no toca, se adelanta delante de ella
 * la primera entrega de la tienda que sí toca. Solo se mueven esas primeras entregas.
 */
export function ordenaPorRecogidas<T extends { id: string; store?: string | null }>(viaje: readonly T[], tiendas: readonly string[]): T[] {
  const presentes: string[] = [];
  for (const o of viaje) { const k = claveDeTienda(o); if (!presentes.includes(k)) presentes.push(k); }
  const deseado = [...tiendas.filter((k, i) => presentes.includes(k) && tiendas.indexOf(k) === i), ...presentes.filter((k) => !tiendas.includes(k))];
  const cola = [...viaje], hecho: T[] = [], abiertas = new Set<string>();
  let toca = 0;
  while (cola.length) {
    const k = claveDeTienda(cola[0]);
    if (abiertas.has(k) || k === deseado[toca]) {
      if (!abiertas.has(k)) { abiertas.add(k); toca++; }
      hecho.push(cola.shift()!);
      continue;
    }
    const j = cola.findIndex((o) => claveDeTienda(o) === deseado[toca]);
    hecho.push(cola.splice(j, 1)[0]);
    abiertas.add(deseado[toca]);
    toca++;
  }
  return hecho;
}

/** El mismo corte por capacidad que `splitIntoTrips` (dispatch.ts), sobre los pallets de cada orden. */
const partePorCapacidad = <T extends { actual_pallets?: number | null; est_pallets?: number | null }>(lista: readonly T[], capacidad: number): T[][] => {
  const viajes: T[][] = [];
  let actual: T[] = [], carga = 0;
  for (const o of lista) {
    const n = palletsDeLaOrden(o);
    if (actual.length && carga + n > capacidad) { viajes.push(actual); actual = []; carga = 0; }
    actual.push(o);
    carga += n;
  }
  if (actual.length) viajes.push(actual);
  return viajes;
};

type Orden = { id: string; store?: string | null; actual_pallets?: number | null; est_pallets?: number | null };

export interface FlechaDeRecogida extends Reescritura {
  /** La entrega que se adelantó, y delante de cuál quedó: lo que hay que decirle a quien pulsó. */
  adelantada: string;
  delanteDe: string;
  /** Se escribieron los viajes (`load_no`) porque la ruta se parte sola por capacidad y el orden nuevo la partiría distinto. */
  fijaViajes: boolean;
}

/**
 * La flecha ↑ / ↓ de la fila de recogida `k` del viaje `ti`. `grupos`: las órdenes de cada fila P de ESE viaje, en el orden
 * en que se pintan. Devuelve `null` cuando la flecha no haría nada —la primera no sube, la última no baja, una fila cuyas
 * órdenes no son de este viaje (lo ya entregado) no se mueve—; la pantalla la apaga justo entonces.
 *
 * Qué se escribe: la ruta ENTERA, numerada desde `desde` (tras lo ya hecho, D-433). Con viajes a mano, cada orden conserva
 * su viaje (`loadNoById`). Si la ruta se parte sola por capacidad, basta la secuencia, salvo que el orden nuevo la partiera
 * distinto: entonces se fijan los viajes que se ven, como hace soltar en «📅 Horario» (D-417).
 */
export function planDeFlechaDeRecogida<T extends Orden>(
  viajes: readonly (readonly T[])[], ti: number, grupos: readonly (readonly string[])[], k: number, dir: -1 | 1,
  manual: boolean, capacidad: number, desde: number,
): FlechaDeRecogida | null {
  const viaje = viajes[ti];
  if (!viaje) return null;
  const porId = new Map(viaje.map((o) => [o.id, o]));
  const clave = (g: readonly string[]) => { const o = g.map((id) => porId.get(id)).find(Boolean); return o ? claveDeTienda(o) : null; };
  const claves = grupos.map(clave);
  const mia = claves[k];
  if (mia == null) return null;
  const orden: string[] = [];
  for (const c of claves) if (c != null && !orden.includes(c)) orden.push(c);
  const i = orden.indexOf(mia), j = i + dir;
  if (j < 0 || j >= orden.length) return null;
  [orden[i], orden[j]] = [orden[j], orden[i]];
  const nuevo = ordenaPorRecogidas(viaje, orden);
  const cambia = nuevo.findIndex((o, x) => o.id !== viaje[x].id);
  if (cambia < 0) return null;
  const finales = viajes.map((v, x) => (x === ti ? nuevo : [...v]));
  const ids = finales.flat().map((o) => o.id);
  const mismos = (a: readonly (readonly T[])[]) => a.length === finales.length && a.every((v, x) => v.length === finales[x].length && v.every((o, y) => o.id === finales[x][y].id));
  const fijaViajes = !manual && !mismos(partePorCapacidad(finales.flat(), capacidad));
  let loadNoById: Record<string, number | null> | undefined;
  if (manual || fijaViajes) {
    loadNoById = {};
    finales.forEach((v, x) => v.forEach((o) => { loadNoById![o.id] = x > 0 ? x + 1 : null; }));
  }
  return { ids, loadNoById, desde, adelantada: nuevo[cambia].id, delanteDe: viaje[cambia].id, fijaViajes };
}

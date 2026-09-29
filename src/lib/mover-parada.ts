import { aLaDecima, palletsDeLaOrden, sumaPallets } from "./pallets";

/**
 * Mover UNA parada a mano en la tarjeta de un chofer del Gestor de Rutas (D-433): las flechas ↑ ↓ y el selector «Viaje N».
 *
 * El dueño, el 2026-09-28, con la tarjeta de Ernesto delante: «las felchas no funcionan igual para cmabiar truckload no
 * funcionan». Lo que se midió en el demo (clics de persona, con plan publicado simulado):
 *
 * - **«Viaje N» / «＋ Nuevo viaje» dejaba la ruta A MEDIAS.** Escribía el viaje nuevo con `route_seq: null`, y una ruta con
 *   alguna parada sin puesto se lee como D-336: la movida pasa a «—» y **todas las filas de recogida (P) desaparecen** de la
 *   tarjeta, también las del otro viaje. La parada sí cambiaba de viaje, pero la tarjeta se veía rota. Y lo guardado (sin
 *   puesto) no decía dónde estaba la parada que la pantalla pintaba al final del viaje.
 * - **No miraba la capacidad**: pasaba la parada a un viaje lleno sin decir nada.
 * - **Las flechas escribían `route_seq` 0..n-1 contando solo lo pendiente.** Lo recogido o entregado del chofer ese día no
 *   sale en el Gestor, pero conserva su puesto, y «Mi ruta» del chofer ordena TODO por `route_seq`: medido en producción el
 *   2026-09-28, #552 entregada con `route_seq` 1 y #603 pendiente también con 1.
 *
 * Aquí está lo que decide QUÉ se escribe, sin pantalla: la pantalla llama a esto y escribe con `reorderStops`.
 */

/** Las etapas de lo ya hecho: no salen en el Gestor, pero siguen en «Mi ruta» con su puesto. No se mueven nunca. */
export const ETAPAS_HECHAS: ReadonlySet<string> = new Set(["picked_up", "delivered"]);

/**
 * Desde qué `route_seq` se numeran las pendientes: justo DESPUÉS de lo último ya hecho del chofer ese día.
 *
 * Se decidió así, y no «saltar» los números de las hechas intercalándolas, porque lo hecho ya pasó: en el orden del día va
 * delante de todo lo pendiente. Así las pendientes no empatan con ninguna hecha (el caso medido: dos con puesto 1) y «Mi
 * ruta» enseña lo hecho y después lo que falta, en el orden que dejó quien despacha. Las hechas no se reescriben.
 */
export function inicioDeLaSecuencia(hechas: readonly { route_seq?: number | null }[]): number {
  let max = -1;
  for (const h of hechas) if (h.route_seq != null && h.route_seq > max) max = h.route_seq;
  return max + 1;
}

/** Lo ya hecho de un chofer en esas fechas (las de las paradas que se mueven). */
export function hechasDelChofer<T extends { assigned_driver?: string | null; delivery_date?: string | null; stage: string }>(
  todas: readonly T[], chofer: string, fechas: ReadonlySet<string | null>,
): T[] {
  return todas.filter((d) => d.assigned_driver === chofer && ETAPAS_HECHAS.has(d.stage) && fechas.has(d.delivery_date ?? null));
}

/** Lo que se escribe: la secuencia ENTERA en ese orden (a partir de `desde`) y, si se da, el viaje de cada parada. */
export interface Reescritura { ids: string[]; loadNoById?: Record<string, number | null>; desde: number }

/** El `load_no` de un viaje por su posición: el primero va sin número (`null`), como en todo el Gestor. */
const cargaDelViaje = (ti: number): number | null => (ti > 0 ? ti + 1 : null);

type Parada = { id: string; actual_pallets?: number | null; est_pallets?: number | null };

/**
 * Una flecha: la parada `indice` (su puesto en la lista que se pinta, los viajes seguidos) sube o baja uno.
 *
 * Con viajes puestos a mano (`manual`), cada viaje conserva su tamaño y se vuelve a sellar por posición: la parada que pasa
 * del borde entra de verdad en el viaje de al lado. Si el Gestor aún parte por capacidad, basta la secuencia.
 * `viaje`: en qué viaje queda (solo se sabe con viajes a mano; si no, lo decide la capacidad al pintar).
 */
export function planDeFlecha<T extends { id: string }>(
  viajes: readonly (readonly T[])[], indice: number, dir: -1 | 1, manual: boolean, desde: number,
): (Reescritura & { puesto: number; total: number; viaje: number | null }) | null {
  const lista = viajes.flat();
  const j = indice + dir;
  if (indice < 0 || indice >= lista.length || j < 0 || j >= lista.length) return null;
  const [movida] = lista.splice(indice, 1);
  lista.splice(j, 0, movida);
  let loadNoById: Record<string, number | null> | undefined;
  let viaje: number | null = null;
  if (manual) {
    loadNoById = {};
    let at = 0;
    viajes.forEach((v, ti) => {
      for (let k = 0; k < v.length; k++, at++) {
        loadNoById![lista[at].id] = cargaDelViaje(ti);
        if (at === j) viaje = ti + 1;
      }
    });
  }
  return { ids: lista.map((d) => d.id), loadNoById, desde, puesto: j, total: lista.length, viaje };
}

/** ¿Cabe la parada `id` en el viaje `destino` (1 = el primero)? La carga que ya lleva ese viaje SIN ella, a la décima. */
export function cabeEnElViaje<T extends Parada>(viajes: readonly (readonly T[])[], id: string, destino: number, capacidad: number): { cabe: boolean; carga: number; pallets: number } {
  const orden = viajes.flat().find((o) => o.id === id);
  const pallets = orden ? aLaDecima(palletsDeLaOrden(orden)) : 0;
  const carga = sumaPallets((viajes[destino - 1] ?? []).filter((o) => o.id !== id));
  return { cabe: aLaDecima(carga + pallets) <= capacidad, carga, pallets };
}

/**
 * «🔗 Unir viajes» (D-437): todos los viajes vuelven a ser uno, EN EL ORDEN QUE SE VE, numerado desde `desde`. Sin viajes
 * a mano, el Gestor vuelve a partir la ruta por capacidad al pintarla (`splitIntoTrips`).
 *
 * Hasta D-437 se escribía `route_seq: null` en todas, porque después venía «Optimizar» y rehacía el orden. Sin Optimizar,
 * eso tiraba el orden que la persona había puesto con las flechas (la ruta volvía al orden por número de orden).
 */
export function planDeUnirViajes<T extends { id: string }>(viajes: readonly (readonly T[])[], desde: number): Reescritura & { loadNoById: Record<string, number | null> } {
  const ids = viajes.flat().map((o) => o.id);
  const loadNoById: Record<string, number | null> = {};
  for (const id of ids) loadNoById[id] = null;
  return { ids, loadNoById, desde };
}

/**
 * «✂ Dividir en 2» (D-437): la primera mitad (redondeada hacia arriba) al viaje 1 y el resto al 2, en el orden que se ve y
 * numerado desde `desde`. Como «Unir viajes», antes dejaba el puesto en blanco para que Optimizar lo rehiciera.
 * `null` con menos de dos paradas: no hay nada que dividir.
 */
export function planDeDividirEnDos<T extends { id: string }>(viajes: readonly (readonly T[])[], desde: number): (Reescritura & { loadNoById: Record<string, number | null> }) | null {
  const lista = viajes.flat();
  if (lista.length < 2) return null;
  const mitad = Math.ceil(lista.length / 2);
  const loadNoById: Record<string, number | null> = {};
  lista.forEach((o, i) => { loadNoById[o.id] = cargaDelViaje(i < mitad ? 0 : 1); });
  return { ids: lista.map((o) => o.id), loadNoById, desde };
}

export type CambioDeViaje =
  | (Reescritura & { ok: true; viaje: number; nuevo: boolean; excede: boolean })
  | { ok: false; motivo: "no_esta" | "sin_cambio" }
  | { ok: false; motivo: "no_cabe"; viaje: number; carga: number; pallets: number; capacidad: number };

/**
 * El selector «Viaje N» de una parada: la pasa al final del viaje `destino`, o a un viaje NUEVO si `destino` pasa del último.
 *
 * - A un viaje que ya existe, **solo si cabe** (`cabeEnElViaje`); si no, no se escribe nada y se dice cuánto lleva.
 * - Un viaje nuevo siempre se puede. Si la parada sola ya pasa la capacidad, se hace igual (como `splitIntoTrips`, que la
 *   deja sola en su viaje) y `excede` lo dice.
 * - Se escribe la ruta ENTERA —puesto de cada parada desde `desde`, y el viaje de cada una—, no solo la movida: así la
 *   ruta sigue ordenada entera (sus P/D se siguen leyendo, D-334) y lo guardado es exactamente lo que se pinta.
 * - Un viaje que se queda vacío desaparece y los de detrás corren un número: no quedan huecos («Viaje 1, Viaje 3»).
 */
export function planDeCambioDeViaje<T extends Parada>(
  viajes: readonly (readonly T[])[], id: string, destino: number, capacidad: number, desde: number,
): CambioDeViaje {
  const origen = viajes.findIndex((v) => v.some((o) => o.id === id));
  if (origen < 0) return { ok: false, motivo: "no_esta" };
  const orden = viajes[origen].find((o) => o.id === id)!;
  const nuevo = destino > viajes.length;
  if (destino - 1 === origen) return { ok: false, motivo: "sin_cambio" };
  // Ya va sola en el último viaje: un viaje nuevo sería el mismo.
  if (nuevo && viajes[origen].length === 1 && origen === viajes.length - 1) return { ok: false, motivo: "sin_cambio" };
  if (!nuevo) {
    const c = cabeEnElViaje(viajes, id, destino, capacidad);
    if (!c.cabe) return { ok: false, motivo: "no_cabe", viaje: destino, carga: c.carga, pallets: c.pallets, capacidad };
  }
  const nuevos: T[][] = viajes.map((v) => v.filter((o) => o.id !== id));
  if (nuevo) nuevos.push([orden]);
  else nuevos[destino - 1].push(orden);
  const finales = nuevos.filter((v) => v.length > 0);
  const loadNoById: Record<string, number | null> = {};
  finales.forEach((v, ti) => v.forEach((o) => { loadNoById[o.id] = cargaDelViaje(ti); }));
  return {
    ok: true, ids: finales.flat().map((o) => o.id), loadNoById, desde,
    viaje: finales.findIndex((v) => v.includes(orden)) + 1, nuevo, excede: nuevo && palletsDeLaOrden(orden) > capacidad,
  };
}

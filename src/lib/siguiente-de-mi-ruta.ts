import type { FilaDeLaRuta } from "@/lib/route-plan/lectura-de-ruta";
import type { ParadasDeLaRuta } from "@/lib/gestor/paradas-numeradas";
import { ordenDeLaLlegada, type LlegadaDeParada } from "@/lib/acciones-parada";

// ============================================================
// «Siguiente parada» de «Mi ruta» por PARADAS y un solo botón por orden (D-533, 2026-10-12). El dueño, con la captura de
// dos recogidas en la misma tienda (179500 y 179510):
//
//   «it should say one, next stop 1 of 5 and pickup will be one of two because there are two pickups in the same stop.
//    And when you press arrived, it should be arrived for both pickup. And when you press pickup, it should pick up
//    number one and then take you to the next order»
//   «if you press pickup it opens up the order instead of doing the action, if he wants to open the order just make it
//    possible when pressing the invoice number»
//   «make arrived first and then pickup not 2 button just 1 that changes»
//
// Reglas puras, sin React. Las usa `my-route/page.tsx` y `AccionesDeParada`.
// ============================================================

/** Una recogida está hecha con estas etapas (la carga va en el camión o ya se entregó) o no existe (anulada). */
const RECOGIDA_HECHA = new Set(["picked_up", "delivered", "canceled"]);

export interface SiguienteDeMiRuta {
  /** La orden que toca. */
  id: string;
  /** Qué se hace con ella: recogerla (P) o entregarla (D). */
  tipo: "P" | "D";
  /** El número de su parada (el del círculo de la lista) y cuántas paradas tiene la ruta. */
  parada: number;
  totalParadas: number;
  /** «Recogida 1 de 2»: cuál es dentro de su parada y cuántas órdenes tiene la parada. */
  posicion: number;
  deLaParada: number;
}

/**
 * La orden que toca AHORA, siguiendo la ruta FILA POR FILA (las recogidas de la parada 1, luego la entrega de la parada 2…),
 * no orden por orden: con dos recogidas en la misma tienda, recogida la primera toca la SEGUNDA recogida, no la entrega de
 * la primera. Una recogida toca mientras su orden no vaya en el camión; una entrega, mientras la orden va en el camión.
 * Una orden apartada (`marcas`: rechazada por el cliente) no toca nunca. `null`: no queda nada por hacer.
 *
 * Antes (hasta D-532) la siguiente era `siguienteParada(stops)`: la primera orden sin entregar, que tras recoger la primera
 * de la tienda saltaba a SU entrega con la segunda aún en la tienda. El aviso «en camino» del servidor sigue con esa
 * función (`avisos-cliente-envio.ts`): avisa al cliente de la primera orden cargada, que es la primera que se entregará.
 */
export function siguienteDeMiRuta(
  filas: readonly FilaDeLaRuta[],
  numeradas: Pick<ParadasDeLaRuta, "deFila" | "paradas">,
  etapaDe: (id: string) => string | null | undefined,
  marcas: ReadonlyMap<string, unknown>,
): SiguienteDeMiRuta | null {
  for (let i = 0; i < filas.length; i++) {
    const f = filas[i];
    const candidatas = f.tipo === "P" ? f.ordenes : [f.orden];
    for (const id of candidatas) {
      const etapa = etapaDe(id);
      if (etapa == null || marcas.has(id)) continue;
      const toca = f.tipo === "P" ? !RECOGIDA_HECHA.has(etapa) : etapa === "picked_up";
      if (!toca) continue;
      const n = numeradas.deFila[i];
      const p = numeradas.paradas[n - 1];
      const ordenes = p?.ordenes ?? [id];
      return {
        id, tipo: f.tipo, parada: n, totalParadas: numeradas.paradas.length,
        posicion: Math.max(0, ordenes.indexOf(id)) + 1, deLaParada: ordenes.length,
      };
    }
  }
  return null;
}

/** «Recogida 1 de 2» / «Pickup 1 of 2» al lado del número de parada, solo cuando la parada tiene más de una orden. */
export function textoDePosicion(s: Pick<SiguienteDeMiRuta, "tipo" | "posicion" | "deLaParada">, t: (en: string, es: string) => string): string | null {
  if (s.deLaParada <= 1) return null;
  const que = s.tipo === "P" ? t("Pickup", "Recogida") : t("Delivery", "Entrega");
  return `${que} ${s.posicion} ${t("of", "de")} ${s.deLaParada}`;
}

/** La llegada de la parada vale para CADA orden de su tramo: la fila de cada una enseña «📍 Llegué» mientras no se ha
 *  llegado (un toque la marca en todas) y su «Recogido»/«Entregado» después. `null` si la orden no está en ese tramo.
 *  **Nota D-547:** el BOTÓN «Llegué» ya solo va en la primera (`llevaBotonDeLlegada`); esto sigue diciendo de qué llegada
 *  depende cada fila, que es lo que esconde o enseña su «Recogido»/«Entregado». */
export function llegadaDeLaOrden(llegada: LlegadaDeParada | null | undefined, id: string): LlegadaDeParada | null {
  return llegada && llegada.ordenes.includes(id) ? llegada : null;
}

/**
 * ¿Se pinta en la fila de esta orden el botón «📍 Llegué» (o, ya llegado, «✓ Llegaste 10:42 · ↩ Deshacer»)? (D-547)
 *
 * El dueño, 2026-10-14, con la captura de la parada 6 en RDZ Brownsville, varias recogidas y cada una con su «Arrived»:
 * *«see pickup 6 and then all pickups to that hav an arrive but since is the 6th stop with that thats enough»*. Solo la
 * PRIMERA orden de la parada que sigue en su tramo lo lleva (`ordenDeLaLlegada`, como en D-527); las demás no. La llegada
 * se sigue marcando en TODAS las órdenes del tramo (`BotonDeLlegada` recorre `llegada.ordenes`).
 *
 * `llegada` sigue llegando a todas las filas (`llegadaDeLaOrden`): es lo que esconde «Recogido»/«Entregado» mientras no se
 * ha llegado (`botonesConLlegada`, D-533), y al llegar lo deja en CADA fila, porque cada orden se recoge por separado.
 */
export function llevaBotonDeLlegada(llegada: LlegadaDeParada | null | undefined, id: string): boolean {
  return !!llegada && ordenDeLaLlegada(llegada) === id;
}

/**
 * La tarjeta «Siguiente parada · 1/13 · Recogida 1 de 2» de «Mi ruta» (D-533), APAGADA (D-547). El dueño, 2026-10-14,
 * con su captura: *«disable that box for now but have the option to activate it in the future»*. Su código sigue entero en
 * la página; volver a encenderla es poner esto a `true`. Con ella apagada, la etapa de cada orden va en su fila de la lista.
 */
export const MOSTRAR_SIGUIENTE_PARADA: boolean = false;

/** «🚚 Recogido» se hace de un toque, sin abrir la ficha, cuando el almacén ya la tiene lista. Sin lista (`approved`,
 *  `fulfilling`) sigue abriendo la ficha: «Recoger de todos modos» pide una nota (D-527). */
export const seRecogeDeUnToque = (stage: string | null | undefined): boolean => stage === "ready";

/**
 * Un solo botón que cambia (el dueño: «make arrived first and then pickup not 2 button just 1 that changes»): mientras la
 * llegada de la parada está pendiente, «Recogido» y «Entregado» NO se pintan —la fila lleva «📍 Llegué»— y salen al llegar.
 * Lo demás queda: «⛔ Rechazado» siempre en la entrega («rejected will always show so 2 buttons for delivery»), «Dejar en
 * tienda» y «↩ Deshacer recogido». Sin llegada que marcar (`null`) o ya marcada, la lista tal cual.
 */
export function botonesConLlegada<B extends { accion: string }>(acciones: readonly B[], llegada: LlegadaDeParada | null | undefined): B[] {
  if (llegada?.estado !== "pendiente") return [...acciones];
  return acciones.filter((b) => b.accion !== "recoger" && b.accion !== "entregar");
}

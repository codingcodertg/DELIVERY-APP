import { filasConLoHecho, type FilaPintada, type OrdenHecha } from "@/lib/hechas-del-gestor";
import { etiquetaDeLaParada, numeraLaLista, tiendaDeRecogida, type ParadaDeLaLista } from "@/lib/lista-unica";
import type { LecturaDeRuta, OrdenAsignada, ParadaDelPlanMinima } from "@/lib/route-plan/lectura-de-ruta";
import { ordenDeLaParte } from "@/lib/route-plan/publicar";
import { paradasDeLaRuta, type FilaQueSeNumera, type ParadaFisica } from "./paradas-numeradas";

/**
 * El Gestor de Rutas (y «Ruta de hoy», que es la misma página) numera el DÍA ENTERO del chofer, como «Mi ruta» (D-529).
 *
 * El dueño, 2026-10-11, con la captura de una ruta desplegada —«① P1», «② D1», «✓P» sin número, «③ P2», «④ D2», «🚚D» sin
 * número—: *«when a order is delviered dont take the number of the stop away»*.
 *
 * Qué pasaba: D-485 numeró por paradas solo lo PENDIENTE (`lecturaDe`, las etapas de `ROUTE_STAGES`). Lo recogido, en camino
 * o entregado se pintaba aparte (D-459), sin número, y lo que quedaba se volvía a numerar desde 1. «Mi ruta» (D-515) numera
 * el día entero, así que a media jornada la misma parada llevaba un número en cada pantalla — y el mapa del Gestor, que es
 * también el de «Mi ruta» (D-514), le daba al chofer números distintos de los de su propia lista.
 *
 * Ahora la numeración es la de la lista que la tarjeta PINTA —lo pendiente con lo hecho en el sitio en que iba
 * (`filasConLoHecho`, D-459)—, que es la lista del día que lee «Mi ruta», y con la misma función (`paradasDeLaRuta`, D-485). No
 * hay una segunda regla: solo cambia QUÉ filas entran. Lo que se mueve no cambia: las flechas, el arrastre, «Optimizar», la
 * cuenta de pallets y la medida siguen siendo de lo pendiente (`lectura.filas`, con su índice); lo hecho sigue sin índice.
 *
 * Las etiquetas P/D (D-334: `Dk` es la entrega de la orden recogida en `Pk`, numeradas por orden de RECOGIDA) también son del
 * día entero: con plan publicado, las del plan, que ya lo eran —el plan conserva lo entregado— y ahora las lleva también lo
 * hecho; sin plan, numeradas sobre la lista del día (`numeraLaLista`, la misma que usa la lectura). Antes, sin plan, lo
 * pendiente se re-etiquetaba desde P1 al entregar; con plan, no. Ahora las dos igual, y como en «Mi ruta».
 */

type ConLugar = { id: string; store?: string | null; pickup_name?: string | null; delivery_address?: string | null };

export interface NumerosDelDia {
  /** Por fila PINTADA (el índice de `filasConLoHecho`): su número de parada del día. */
  deFila: number[];
  /** Por fila pintada: ¿es la primera de su parada? (la que lleva el número; las demás, la raya de que sigue). */
  primera: boolean[];
  /** Por fila pintada: su etiqueta P/D del día («P2», «D3»). */
  etiqueta: string[];
  /** Las paradas del día, con sus órdenes —hechas y pendientes— y sus etiquetas. */
  paradas: ParadaFisica[];
  /** Por fila PENDIENTE (el índice de `lectura.filas`): su número de parada del día. Para el mapa y el horario. */
  dePendiente: number[];
  /** Por fila pendiente: su etiqueta del día. Para los avisos de mover («P3 #1009 arriba»). */
  etiquetaDePendiente: string[];
  /** Cuántas paradas tienen aún algo PENDIENTE: el «N paradas» de la cabecera, junto a «N órdenes», que es lo pendiente. */
  quedan: number;
}

/**
 * Numera la lista que se pinta. `fuente`: la de la lectura (con plan, las etiquetas son las suyas). `ordenes`: las del día,
 * pendientes y hechas (la tienda y la dirección de cada una, para saber qué filas seguidas son el mismo sitio).
 */
export function numerosDelDia(
  pintadas: readonly FilaPintada[], fuente: LecturaDeRuta["fuente"], ordenes: readonly ConLugar[], paradasDelPlan: readonly ParadaDelPlanMinima[] | null,
): NumerosDelDia {
  const porId = new Map(ordenes.map((o) => [o.id, o]));
  const delPlan = fuente === "plan" ? [...(paradasDelPlan ?? [])].sort((a, b) => a.seq - b.seq) : [];
  const delPlanDe = (tipo: "P" | "D", id: string) => delPlan.filter((p) => p.kind === tipo && ordenDeLaParte(p.order_ref) === id);
  // El sitio de una recogida ya hecha: con plan, el del plan (como lo lee `lecturaDeLaRuta`); si no, donde se recoge su
  // orden (`tiendaDeRecogida`: `pickup_name`, y si falta `store`; D-NEXT).
  const tiendaHecha = (id: string): string | null => (fuente === "plan"
    ? delPlanDe("P", id)[0]?.place ?? null
    : tiendaDeRecogida(porId.get(id) ?? {}));
  const lista: ParadaDeLaLista[] = pintadas.map((fp): ParadaDeLaLista => {
    if (!fp.hecha) return fp.fila.tipo === "P" ? { tipo: "P", ordenes: fp.fila.ordenes, tienda: fp.fila.lugar } : { tipo: "D", orden: fp.fila.orden };
    return fp.tipo === "P" ? { tipo: "P", ordenes: [fp.orden], tienda: tiendaHecha(fp.orden) } : { tipo: "D", orden: fp.orden };
  });
  const numeros = numeraLaLista(lista);
  const etiqueta = pintadas.map((fp, k) => {
    if (fuente !== "plan") return etiquetaDeLaParada(lista[k], numeros);
    if (!fp.hecha) return fp.fila.etiqueta;
    // Lo hecho, con la etiqueta que el plan le dio (las dos de una orden repartida en cargas, juntas: «D3·D5»).
    return delPlanDe(fp.tipo, fp.orden).map((p) => p.label).join("·") || fp.tipo;
  });
  const filas: FilaQueSeNumera[] = lista.map((p, k) => (p.tipo === "P"
    ? { tipo: "P", ordenes: p.ordenes, lugar: p.tienda, etiqueta: etiqueta[k] }
    : { tipo: "D", orden: p.orden, etiqueta: etiqueta[k] }));
  const { deFila, primera, paradas } = paradasDeLaRuta(filas, ordenes);
  const dePendiente: number[] = [];
  const etiquetaDePendiente: string[] = [];
  const conAlgoPendiente = new Set<number>();
  pintadas.forEach((fp, k) => {
    if (fp.hecha) return;
    dePendiente[fp.i] = deFila[k];
    etiquetaDePendiente[fp.i] = etiqueta[k];
    conAlgoPendiente.add(deFila[k]);
  });
  return { deFila, primera, etiqueta, paradas, dePendiente, etiquetaDePendiente, quedan: conAlgoPendiente.size };
}

/**
 * El día entero de una ruta, de una vez: lo que pinta la tarjeta (`filasConLoHecho`: lo pendiente de la lectura, en su orden y
 * con su índice, y lo hecho donde iba) y su numeración. Lo llaman la tabla, el mapa, el horario y los avisos de mover del
 * Gestor, para que los cuatro digan el mismo número.
 */
export function diaDeLaRuta(
  lectura: Pick<LecturaDeRuta, "fuente" | "filas">, pendientes: readonly (OrdenAsignada & ConLugar)[], hechas: readonly (OrdenHecha & ConLugar)[],
  capacidad: number, paradasDelPlan: readonly ParadaDelPlanMinima[] | null,
): NumerosDelDia & { pintadas: FilaPintada[] } {
  const pintadas = filasConLoHecho(lectura, pendientes, hechas, capacidad, paradasDelPlan);
  return { pintadas, ...numerosDelDia(pintadas, lectura.fuente, [...pendientes, ...hechas], paradasDelPlan) };
}

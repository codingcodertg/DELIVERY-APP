import { lecturaDeLaRuta, sigueElPlan, type FilaInformativa, type LecturaDeRuta, type OrdenAsignada, type ParadaDelPlanMinima } from "./lectura-de-ruta";
import { ordenDeLaParte } from "./publicar";

/**
 * La lectura de una ruta en el Gestor, con lo que el chofer ya recogió o entregó (D-433).
 *
 * El hueco: el Gestor solo enseña lo pendiente (`ROUTE_STAGES`), y le pasaba a `lecturaDeLaRuta` solo eso. El plan
 * publicado conserva las órdenes ya entregadas, así que `sigueElPlan` —que exige las MISMAS órdenes— decía «cambió» en
 * cuanto el chofer entregaba una, aunque nadie tocara la ruta. D-335 dice lo contrario: un cambio de ETAPA no es tocar la
 * ruta. La librería lo cumple (su prueba le pasa las órdenes en camino); lo que fallaba era lo que le daba la pantalla.
 * «Mi ruta» no tenía el hueco: le pasa todas las del día.
 *
 * Qué se hace, sin tocar la librería: **la comparación se hace con las pendientes MÁS las hechas** (que conservan su viaje
 * y su puesto: nadie las reescribe). Si con ellas la ruta sigue siendo la publicada, manda el plan. Si no —se movió, se
 * añadió o se quitó una pendiente—, se devuelve la lectura de siempre, con su aviso.
 *
 * Se descartó quitar las hechas del plan: `posicionesDeLaRuta` volvería a numerar los puestos sin ellas y las pendientes,
 * que tienen los puestos que escribió publicar, no casarían nunca.
 *
 * **Las filas que se pintan no cambian:** la tarjeta sigue recorriendo solo las pendientes. Lo que el plan ponía antes de
 * la entrega de una orden ya hecha (sus recogidas, y las de otras que se cargaron en el mismo sitio) se pasa a la
 * siguiente entrega pendiente del plan —donde ya estaba en la secuencia—, o al final si no queda ninguna. Así no se
 * pierde ninguna fila de recogida que antes de la entrega se veía.
 */
export function lecturaConLoHecho(
  viajes: readonly (readonly OrdenAsignada[])[], paradas: readonly ParadaDelPlanMinima[] | null, hechas: readonly OrdenAsignada[],
): LecturaDeRuta {
  const base = lecturaDeLaRuta(viajes, paradas);
  if (!paradas || paradas.length === 0 || hechas.length === 0 || !base.cambioTrasPublicar) return base;
  if (!sigueElPlan(paradas, [...viajes.flat(), ...hechas])) return base;

  const delPlan = lecturaDeLaRuta([...viajes, hechas], paradas);
  const hecha = new Set(hechas.map((o) => o.id));
  // Las órdenes en el orden de su PRIMERA entrega en el plan: es el orden en que están guardadas sus `previas`.
  const vistas = new Set<string>(), entregas: string[] = [];
  for (const p of [...paradas].sort((a, b) => a.seq - b.seq)) {
    const id = ordenDeLaParte(p.order_ref);
    if (p.kind === "D" && !vistas.has(id)) { vistas.add(id); entregas.push(id); }
  }
  const previas = new Map(delPlan.previas);
  let arrastra: FilaInformativa[] = [];
  for (const id of entregas) {
    if (hecha.has(id)) { arrastra = [...arrastra, ...(previas.get(id) ?? [])]; previas.delete(id); continue; }
    if (arrastra.length) { previas.set(id, [...arrastra, ...(previas.get(id) ?? [])]); arrastra = []; }
  }
  return { ...delPlan, previas, alFinal: [...arrastra, ...delPlan.alFinal] };
}

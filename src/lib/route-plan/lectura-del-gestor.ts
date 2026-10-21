import { lecturaDeLaRuta, type LecturaDeRuta, type OrdenAsignada, type ParadaDelPlanMinima } from "./lectura-de-ruta";
import { estaEnElCamion } from "@/lib/mover-parada";

/**
 * La lectura de una ruta en el Gestor, con lo que el chofer ya recogió o entregó (D-433).
 *
 * El hueco que cerró D-433: el Gestor solo enseña lo pendiente (`ROUTE_STAGES`), y le pasaba a la lectura solo eso. El plan
 * publicado conserva las órdenes ya entregadas, así que `sigueElPlan` —que exige las MISMAS órdenes— decía «cambió» en
 * cuanto el chofer entregaba una, aunque nadie tocara la ruta. D-335 dice lo contrario: un cambio de ETAPA no es tocar la
 * ruta. **La comparación se hace con las pendientes MÁS las hechas** (que conservan su puesto: nadie las reescribe), y las
 * filas que se pintan son solo las pendientes.
 *
 * Desde D-443 esto lo hace `lecturaDeLaRuta` con su cuarto argumento; aquí queda el nombre que usa la pantalla.
 */
export function lecturaConLoHecho(
  ordenes: readonly OrdenAsignada[], capacidad: number, paradas: readonly ParadaDelPlanMinima[] | null, hechas: readonly OrdenAsignada[],
): LecturaDeRuta {
  // D-NEXT: las órdenes que ya van en el camión (`picked_up`) siguen en `ordenes` por su entrega; su recogida no es fila pendiente.
  const enElCamion = new Set(ordenes.filter((o) => estaEnElCamion((o as { stage?: string }).stage)).map((o) => o.id));
  return lecturaDeLaRuta(ordenes, capacidad, paradas, hechas, enElCamion);
}

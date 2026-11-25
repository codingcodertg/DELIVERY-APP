import { gruposDeMismoLugar, type ParadaDeLaLista } from "@/lib/lista-unica";

/**
 * El número de PARADA de cada fila de la tabla del plan (D-485, igual que la tabla de paradas del Gestor). Filas SEGUIDAS
 * en el mismo sitio son una parada: la primera lleva el círculo con el número, las demás la raya que las une. Una fila
 * sola es su propia parada.
 *
 * Reutiliza la regla de `gruposDeMismoLugar` (la de la tabla de paradas), así que las dos tablas agrupan igual. Aquí solo
 * se traduce la fila del plan a lo que esa regla pide: una recogida por su tienda, una entrega por su dirección.
 */

/** Una fila del plan, con lo que hace falta para saber en qué sitio está. `tienda` solo en una recogida; `direccion` solo
 *  en una entrega (la de la orden). */
export interface FilaDelPlanParaParada {
  tipo: "P" | "D";
  /** La orden de la fila (`order_ref`, que puede ser una parte «id#b»). */
  orden: string;
  tienda: string | null;
  direccion: string | null;
  /** La tienda a la que va la ENTREGA de la orden, si su destino es una tienda (`misma-visita`); la misma en sus dos filas. */
  tiendaDeDestino?: string | null;
}

export interface NumeroDeLaFila {
  /** El número de la parada de esta fila (1, 2…). Las filas de una misma parada comparten número. */
  numero: number;
  /** Si es la primera de su parada: la que lleva el círculo con el número; las demás, la raya. */
  primera: boolean;
  /** Si la fila es recogida y va en un grupo de recogidas seguidas en la misma tienda (tono más fuerte, como el Gestor). */
  enGrupoDeRecogidas: boolean;
  /** Si es la primera fila de ese grupo (lleva la raya que lo separa del de arriba). */
  inicioDeGrupo: boolean;
}

/** Por fila, en el orden de la lista. */
export function numeracionDeLasParadas(filas: readonly FilaDelPlanParaParada[]): NumeroDeLaFila[] {
  const paradas: ParadaDeLaLista[] = filas.map((f) => (f.tipo === "P" ? { tipo: "P", ordenes: [f.orden], tienda: f.tienda } : { tipo: "D", orden: f.orden }));
  // Una orden sale en dos filas (P y D): la dirección es la misma en las dos, y la búsqueda por id toma cualquiera.
  const ordenes = filas.map((f) => ({ id: f.orden, store: f.tienda, delivery_address: f.direccion }));
  // El destino de tienda de cada orden, por su id (la misma en sus dos filas): la regla de `misma-visita`.
  const destinos = new Map(filas.map((f) => [f.orden, f.tiendaDeDestino ?? null]));
  const grupos = gruposDeMismoLugar(paradas, ordenes, (id) => destinos.get(id) ?? null);
  let n = 0;
  return grupos.map((g, i) => {
    const primera = g == null || i === 0 || grupos[i - 1] !== g;
    if (primera) n++;
    const enGrupoDeRecogidas = g != null && filas[i].tipo === "P";
    return { numero: n, primera, enGrupoDeRecogidas, inicioDeGrupo: enGrupoDeRecogidas && primera };
  });
}

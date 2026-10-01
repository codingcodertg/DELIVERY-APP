import { esFuncionAusente, particionesDelDia } from "@/lib/cargas-partidas";
import { entradaDelDia, type DatosDelDia } from "./entrada";

/**
 * Partir EN LA BASE, antes de planificar, las órdenes que no caben en el camión (D-452, 157).
 *
 * Hasta aquí el motor las partía en cargas virtuales (`id#a`, `id#b`) del mismo chofer, y publicar escribía una sola
 * fila (medido en `cargas-partidas.test.ts`, bloque «HOY»). Ahora «Armar rutas» mira, con la MISMA regla del motor
 * (`parteOrdenesGrandes`, por `particionesDelDia`), qué órdenes no caben y en cuánto, y llama `partir_carga` por cada
 * resto, con la sesión de quien planifica: cada carga nace como una orden hermana (`#Xa`, `#Xb`), y después el motor las
 * reparte como dos órdenes cualesquiera —también con choferes distintos—. Luego hay que VOLVER A LEER el día.
 *
 * Sin la 157 (`esFuncionAusente` en la primera llamada) no se parte nada y se planifica como hoy, con cargas virtuales.
 * Un error a medias (una orden sin factura que el guard rechaza, por ejemplo) no para el día: lo partido queda partido
 * —son órdenes válidas—, se dice qué falló, y el motor parte virtualmente lo que no se pudo.
 */

export interface ClienteDeCargas {
  rpc: (fn: "partir_carga", args: { p_id: string; p_resto: number }) => PromiseLike<{ data: unknown; error: { code?: string | null; message: string } | null }>;
}

export type Partida = { id: string; nuevas: string[] };
export type ResultadoDePartir =
  | { fuente: "base"; partidas: Partida[] }
  | { fuente: "sin_funcion"; partidas: [] }
  | { fuente: "error"; detalle: string; partidas: Partida[] };

export async function parteEnLaBase(cliente: ClienteDeCargas, datos: DatosDelDia): Promise<ResultadoDePartir> {
  const dia = entradaDelDia(datos);
  const particiones = particionesDelDia(dia.entrada.ordenes, dia.entrada.choferes);
  const partidas: Partida[] = [];
  for (const p of particiones) {
    let de = p.id;
    const nuevas: string[] = [];
    for (const resto of p.restos) {
      const { data, error } = await cliente.rpc("partir_carga", { p_id: de, p_resto: resto });
      if (error) {
        if (esFuncionAusente(error) && !partidas.length && !nuevas.length) return { fuente: "sin_funcion", partidas: [] };
        return { fuente: "error", detalle: error.message, partidas: nuevas.length ? [...partidas, { id: p.id, nuevas }] : partidas };
      }
      de = String(data);
      nuevas.push(de);
    }
    partidas.push({ id: p.id, nuevas });
  }
  return { fuente: "base", partidas };
}

/** ¿Hay que volver a leer el día? Solo si algo se partió de verdad. */
export const hayQueReleer = (r: ResultadoDePartir): boolean => r.partidas.length > 0;

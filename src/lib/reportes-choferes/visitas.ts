import { HUECO_MAX_MIN, metros, type LatLng, type Rastro } from "./rastro";

/**
 * Cuándo LLEGÓ y cuándo SE FUE el vehículo de un sitio, deducido del rastro (D-NEXT, «Reportes de choferes»).
 *
 * La regla, con sus números (los enseña la pantalla):
 *   · **Estar en la parada** = un punto del rastro a 150 m o menos de ella (`RADIO_DE_PARADA_M`): una tienda con su patio,
 *     o una casa con el camión en la calle y la dirección puesta a ojo.
 *   · **Una visita** = un rato seguido dentro de ese círculo. LLEGADA: el primer punto dentro. SALIDA: el último punto
 *     dentro antes de irse. Si sale del círculo y vuelve en menos de 3 minutos (`VUELVE_EN_S`: el temblor del GPS en el
 *     borde, o una maniobra), es la misma visita.
 *   · **Permanencia mínima**: 2 minutos (`PERMANENCIA_MIN_S`). Pasar por delante —la tienda está en la avenida— no es
 *     visitarla. Una visita más corta solo vale si el chofer TOCÓ en la app durante ella (eso lo decide quien llama, con
 *     `confirmada`).
 *   · Con el TELÉFONO, dos puntos dentro del círculo separados más de 20 minutos son dos visitas (en medio no se sabe).
 *     Con el CAMIÓN no: el rastreador calla con el motor apagado, así que ese silencio es la parada misma.
 *
 * Nada se interpola: un sitio sin puntos cerca no tiene visita.
 *
 * Puro: sin base, sin red, sin reloj.
 */

export const RADIO_DE_PARADA_M = 150;
export const PERMANENCIA_MIN_S = 120;
export const VUELVE_EN_S = 180;

export interface Visita {
  /** Milisegundos (época). */
  llegada: number; salida: number;
  /** Cuántos puntos del rastro la sostienen. */
  puntos: number;
  /** Empieza con el primer punto del rastro (ya estaba ahí: la llegada no se vio) o acaba con el último (no se vio irse). */
  yaEstaba: boolean; seQuedo: boolean;
}

export interface OpcionesDeVisita { radioM?: number; vuelveEnS?: number }

/** TODOS los ratos dentro del círculo, por cortos que sean, en orden. La permanencia mínima la aplica `vale`. */
export function visitasA(rastro: Rastro, sitio: LatLng, opciones: OpcionesDeVisita = {}): Visita[] {
  const radio = opciones.radioM ?? RADIO_DE_PARADA_M, vuelve = (opciones.vuelveEnS ?? VUELVE_EN_S) * 1000;
  const ps = rastro.puntos;
  const ratos: { a: number; b: number }[] = [];   // índices del primer y último punto dentro
  let abierto: { a: number; b: number } | null = null;
  for (let i = 0; i < ps.length; i++) {
    const dentro = metros(ps[i], sitio) <= radio;
    if (!dentro) { if (abierto) { ratos.push(abierto); abierto = null; } continue; }
    if (abierto && rastro.fuente === "telefono" && ps[i].t - ps[abierto.b].t > HUECO_MAX_MIN * 60_000) { ratos.push(abierto); abierto = null; }
    if (abierto) abierto.b = i; else abierto = { a: i, b: i };
  }
  if (abierto) ratos.push(abierto);
  // Salió y volvió enseguida: la misma visita.
  const juntos: { a: number; b: number }[] = [];
  for (const r of ratos) {
    const prev = juntos[juntos.length - 1];
    if (prev && ps[r.a].t - ps[prev.b].t <= vuelve) prev.b = r.b; else juntos.push({ ...r });
  }
  return juntos.map((r) => {
    let n = 0;
    for (let i = r.a; i <= r.b; i++) if (metros(ps[i], sitio) <= radio) n++;
    return { llegada: ps[r.a].t, salida: ps[r.b].t, puntos: n, yaEstaba: r.a === 0, seQuedo: r.b === ps.length - 1 };
  });
}

/** Segundos que duró la visita. */
export const permanenciaS = (v: Pick<Visita, "llegada" | "salida">): number => Math.round((v.salida - v.llegada) / 1000);

/** Margen alrededor de una visita en el que un toque del chofer la confirma (tocó al bajarse, o al arrancar). */
export const MARGEN_DEL_TOQUE_MS = 5 * 60_000;

/** ¿Cuenta como visita? Si duró lo mínimo, o si el chofer tocó en la app durante ella (`toques`, en ms). */
export function vale(v: Visita, toques: readonly number[] = [], minS = PERMANENCIA_MIN_S): boolean {
  if (permanenciaS(v) >= minS) return true;
  return toques.some((t) => t >= v.llegada - MARGEN_DEL_TOQUE_MS && t <= v.salida + MARGEN_DEL_TOQUE_MS);
}

/** ¿Cae esa hora dentro de la visita (con su margen)? */
export const durante = (v: Pick<Visita, "llegada" | "salida">, t: number, margenMs = MARGEN_DEL_TOQUE_MS): boolean =>
  t >= v.llegada - margenMs && t <= v.salida + margenMs;

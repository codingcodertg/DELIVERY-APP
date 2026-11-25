import type { ParadaDeLaLista } from "./lista-unica";
import { descargaPrimero } from "./route-engine/descarga-primero";
import { unaSolaVisita } from "./route-engine/una-sola-visita";
import { validaLaRuta, type Resultado } from "./route-engine/validador";
import type { OrdenEntrada, ParadaRef } from "./route-engine/types";

/**
 * Las reglas duras del motor (`route-engine`) para la LISTA del Gestor (`ParadaDeLaLista`, «Optimizar»).
 *
 * El motor de día trabaja con una secuencia de `ParadaRef` (una parada por orden). El Gestor guarda la lista con filas:
 * una «P» de recogida puede llevar varias órdenes de la misma tienda. Esta capa solo TRADUCE, sin red, sin base y sin
 * reloj: la lista se vuelve secuencia, se valida o se arregla con las mismas funciones que el motor, y la secuencia se vuelve
 * lista otra vez.
 *
 * De dónde sale cada dato de una orden (`OrdenDeLaLista`, que arma quien llama):
 *   · origen (dónde se carga) = la tienda de su fila «P» (`tiendaDeRecogida`);
 *   · destino (dónde se descarga) = el punto de su fila «D»;
 *   · pallets = los de su entrega.
 *
 * Para que el validador y el reparador (que comparan sitios con `===`) vean la misma tienda en «Dallas» y en «dallas ».
 * (como `claveDeTienda`), los sitios se pasan normalizados. Una orden sin tienda no se junta con ninguna otra.
 */

/** Lo que hace falta saber de cada orden para juzgar una lista: de dónde se carga, dónde se descarga y cuántos pallets. */
export type OrdenDeLaLista = { id: string; codigo?: string | null; origen: string | null; destino: string | null; pallets: number; recogidaHecha?: boolean; recogidaDesde?: number | null };

/** Capacidad «no se sabe»: la lista no se mide contra ningún tope (como en `EntradaDeOptimizar`, 0 o null). */
const SIN_TOPE = 1e9;

const normaliza = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();
const capacidadDeLaLista = (c: number): number => (Number.isFinite(c) && c > 0 ? c : SIN_TOPE);

/** La lista como secuencia de paradas sueltas: una «P» por orden (una fila de recogida de tres órdenes son tres «P» seguidas). */
export function aSecuencia(lista: readonly ParadaDeLaLista[]): ParadaRef[] {
  return lista.flatMap((p): ParadaRef[] => (p.tipo === "P" ? p.ordenes.map((orden) => ({ orden, tipo: "P" as const })) : [{ orden: p.orden, tipo: "D" as const }]));
}

/**
 * Al revés: las «P» SEGUIDAS de órdenes que se cargan en la misma tienda vuelven a ser UNA fila de recogida. La tienda de una
 * orden es su `origen`. Dos «P» separadas por otra parada nunca se juntan, y una orden sin tienda va siempre sola.
 */
export function aLista(secuencia: readonly ParadaRef[], ordenes: readonly OrdenDeLaLista[]): ParadaDeLaLista[] {
  const porId = new Map<string, OrdenDeLaLista>();
  for (const o of ordenes) if (!porId.has(o.id)) porId.set(o.id, o);
  const out: ParadaDeLaLista[] = [];
  // Clave normalizada de la tienda de la última fila «P» (null tras una entrega o si esa fila no tiene tienda).
  let claveUltima: string | null = null;
  for (const p of secuencia) {
    if (p.tipo === "D") {
      out.push({ tipo: "D", orden: p.orden });
      claveUltima = null;
      continue;
    }
    const origen = porId.get(p.orden)?.origen || null;
    const clave = origen && origen.trim() ? normaliza(origen) : null;
    const ultima = out[out.length - 1];
    if (clave !== null && clave === claveUltima && ultima?.tipo === "P") {
      ultima.ordenes.push(p.orden);
    } else {
      out.push({ tipo: "P", ordenes: [p.orden], tienda: origen });
      claveUltima = clave;
    }
  }
  return out;
}

/** La orden como la lee el validador y el reparador del motor: sitios normalizados, sin ventana ni servicio (la lista no los tiene). */
function aOrdenEntrada(o: OrdenDeLaLista): OrdenEntrada {
  return {
    id: o.id,
    codigo: o.codigo ?? null,
    origen: o.origen && o.origen.trim() ? normaliza(o.origen) : null,
    destino: o.destino && o.destino.trim() ? normaliza(o.destino) : null,
    pallets: Number.isFinite(o.pallets) ? o.pallets : 0,
    ventana: null,
    servicioRecogidaMin: 0,
    servicioEntregaMin: 0,
    recogidaHecha: o.recogidaHecha === true,
    recogidaDesde: o.recogidaDesde ?? null,
  };
}

/** Las paradas (en secuencia) de las primeras `filas` filas de la lista. */
const paradasDeLasFilas = (lista: readonly ParadaDeLaLista[], filas: number): number => aSecuencia(lista.slice(0, Math.max(0, filas))).length;

/**
 * Las reglas duras sobre una lista: lo que incumple y lo que hay que señalar. Es `validaLaRuta` con la lista traducida.
 * `hechas` son filas de la lista (las ya hechas o en curso, que deben seguir al principio tal cual). Sin ventanas ni
 * llegadas, la regla 7 no se mira aquí; la 8 tampoco (la lista no trae las órdenes «esperadas»).
 */
export function validaLaLista(lista: readonly ParadaDeLaLista[], ordenes: readonly OrdenDeLaLista[], capacidad: number, hechas = 0): Resultado {
  const secuencia = aSecuencia(lista);
  const hechasRef = secuencia.slice(0, paradasDeLasFilas(lista, hechas));
  return validaLaRuta({
    chofer: { nombre: "", capacidad: capacidadDeLaLista(capacidad) },
    ordenes: ordenes.map(aOrdenEntrada),
    secuencia,
    hechas: hechasRef,
  });
}

/** Copia de la lista (filas nuevas, órdenes de cada fila nuevas) para devolverla sin compartir memoria con la entrada. */
const copiaDeLaLista = (lista: readonly ParadaDeLaLista[]): ParadaDeLaLista[] =>
  lista.map((p): ParadaDeLaLista => (p.tipo === "P" ? { tipo: "P", ordenes: [...p.ordenes], tienda: p.tienda } : { tipo: "D", orden: p.orden }));

/**
 * La lista arreglada: descarga primero en cada visita y una sola visita por tienda cuando cabe (las dos funciones del motor),
 * sin tocar las primeras `hechas` filas. Devuelve la lista nueva y si cambió. Nunca devuelve una lista con MÁS violaciones
 * que la de entrada: si el arreglo no mejora la cuenta, devuelve la de entrada tal cual (`cambio: false`).
 *
 * Nota: cuando la secuencia cambia, la lista nueva se arma con `aLista`, así que las recogidas seguidas en la misma tienda
 * quedan en UNA fila aunque la entrada las tuviera en filas separadas.
 */
export function arreglaLaLista(lista: readonly ParadaDeLaLista[], ordenes: readonly OrdenDeLaLista[], capacidad: number, hechas = 0): { lista: ParadaDeLaLista[]; cambio: boolean } {
  const ref = aSecuencia(lista);
  const fijas = paradasDeLasFilas(lista, hechas);
  const oe = ordenes.map(aOrdenEntrada);
  const cap = capacidadDeLaLista(capacidad);

  const sinCambio = { lista: copiaDeLaLista(lista), cambio: false };
  const arreglada = unaSolaVisita(descargaPrimero(ref, oe, fijas), oe, cap, fijas);
  const igual = arreglada.length === ref.length && arreglada.every((p, i) => p.orden === ref[i].orden && p.tipo === ref[i].tipo);
  if (igual) return sinCambio;

  const nueva = aLista(arreglada, ordenes);
  const violAntes = validaLaLista(lista, ordenes, capacidad, hechas).violaciones.length;
  const violDespues = validaLaLista(nueva, ordenes, capacidad, hechas).violaciones.length;
  if (violDespues >= violAntes) return sinCambio;
  return { lista: nueva, cambio: true };
}

import { ordenSinRecoger, type ParadaDeLaLista } from "./lista-unica";
import { mideLaLista, optimizaLaLista, type EntradaDeOptimizar, type MedidaDeLaLista, type ResultadoDeOptimizar, type VentanaDeEntrega } from "./optimiza-la-ruta";
import PATRONES from "./patrones-de-despacho.json";

/**
 * «🧭 Optimizar» NUNCA deja la ruta peor de como la ve el despachador (D-1029).
 *
 * El dueño, 2026-11-12: «el botón de optimizar no funciona: más bien agrega más millas y aumenta el tiempo estimado» · «haz
 * que el motor […] lo haga igual que nosotros».
 *
 * Lo medido (producción, solo lectura; 90 rutas armadas a mano del 29 sep al 13 nov, `scripts/rutas/vuelca.mjs` y `rutas-a-mano.backtest.test.ts`): el
 * Optimizar de D-461 cambiaba 69 y en 22 dejaba MÁS millas o más jornada de tarjeta que la ruta del despachador (+466 millas
 * entre las 20 que subían de millas). No era una búsqueda atascada —casi todas salían «exactas»—: era que optimizaba OTRA
 * cosa que lo que el despachador mira.
 *
 *   1. **Las ventanas mandaban sobre las millas**, y el equipo no las trata así. De las entregas «0830-1000» hechas en su
 *      día, el 80 % se entregó después de las 10:00 (mediana: 146 min después); de las «0830-1200», el 52 %. El despachador
 *      las pone pronto (69 % en el primer tercio de la ruta, contra 27 % de las demás) pero no da un rodeo por ellas. El
 *      optimizador sí: 11 de las 22.
 *   2. **La capacidad mandaba sobre todo**, y el 14 % de las rutas hechas a mano pasa de 10 pallets a bordo en algún tramo
 *      (4 % de 12). Por 0.2 pallets de más, la ruta del 16 oct pasaba de 138 a 220 millas. 7 de las 22.
 *   3. **Minutos antes que millas, y la tarjeta no cuenta las esperas.** La «jornada» del optimizador incluye esperar a que
 *      abra una ventana o a que llegue un relevo (D-994); la de la tarjeta es manejo + parado. Quitar una espera manejando
 *      más le parecía mejor: 13 millas de más por 13 minutos (10 nov), o 42 millas de más y 39 min más de tarjeta (13 nov).
 *   4. **La banda de «de paso»** (D-464) acepta hasta un 5 % más de jornada y 3 millas más que el MEJOR orden; contra el
 *      orden del despachador eso también podía ser «peor».
 *
 * La regla nueva, sobre el mismo optimizador (`optimizaLaLista`), con dos topes que él ya respeta en su búsqueda:
 *
 *   · **Topes** (`EntradaDeOptimizar.topes`): ningún orden con más millas, ni con más jornada de tarjeta, que el de ahora.
 *   · **Primero, lo que arregla algo sin costar nada**: con las ventanas y la capacidad de verdad, dentro de los topes. Si
 *     la ruta llega tarde a algo o se pasa de carga y hay un orden que lo mejora sin más millas ni más tiempo, ése.
 *   · **Si no, como el despachador**: lo que su ruta ya hace vale. Una entrega que ya llegaba tarde no puede llegar MÁS
 *     tarde (su ventana se estira hasta su hora de ahora); las que llegan a tiempo siguen a tiempo; y el camión puede
 *     llevar lo que su ruta ya llevaba en su tramo más cargado. Dentro de eso, la menor jornada y las menores millas.
 *   · **La guarda** (`noEsPeor`), al final y sobre la ruta medida con las ventanas y la capacidad de verdad: ni más millas,
 *     ni más jornada de tarjeta, ni más jornada con esperas, ni más retraso (en ventana estrecha y en total), ni más
 *     exceso. Lo que no la pasa no se aplica, y se dice: «ya está en buen orden».
 *
 * Esto sustituye, para el botón, el orden de prioridades de D-461 («(1) capacidad, (2) ventanas, (3) jornada, (4) millas»):
 * siguen siendo objetivos, pero ninguno se compra con millas o tiempo. `optimizaLaLista` sin topes no cambia (sus pruebas
 * y sus casos reales siguen igual); la banda de D-464 y la última pasada de D-651 siguen, dentro de los topes.
 */

/** Los minutos de jornada como los cuenta la TARJETA de la ruta: manejo + parado (cargas y descargas), sin esperas. */
export const jornadaDeTarjeta = (m: Pick<MedidaDeLaLista, "minutos" | "esperaMin">): number => m.minutos - m.esperaMin;

const minutosTarde = (m: Pick<MedidaDeLaLista, "tarde">, soloEstrechas = false): number =>
  m.tarde.reduce((s, t) => s + (soloEstrechas && !t.estrecha ? 0 : t.minutos), 0);

/**
 * LA GUARDA: ¿`despues` no es peor que `antes` en NADA de lo que el despachador mira? Millas (sin redondear), jornada de
 * tarjeta, jornada con esperas, retraso en ventanas estrechas, retraso total y exceso de carga. Es la única puerta por la
 * que un orden nuevo llega a guardarse.
 */
export function noEsPeor(antes: MedidaDeLaLista, despues: MedidaDeLaLista): boolean {
  return despues.centiMillas <= antes.centiMillas
    && jornadaDeTarjeta(despues) <= jornadaDeTarjeta(antes)
    && despues.minutos <= antes.minutos
    && minutosTarde(despues, true) <= minutosTarde(antes, true)
    && minutosTarde(despues) <= minutosTarde(antes)
    && despues.exceso <= antes.exceso + 1e-9;
}

/** La entrada con sus paradas en otro orden (las mismas paradas): cada lista paralela se reordena igual. */
export function entradaEnOrden(e: EntradaDeOptimizar, paradas: readonly ParadaDeLaLista[]): EntradaDeOptimizar {
  const puesto = new Map(e.paradas.map((p, i) => [p, i]));
  const idx = paradas.map((p) => puesto.get(p) ?? -1);
  if (idx.some((i) => i < 0) || idx.length !== e.paradas.length) throw new Error("entradaEnOrden: no son las mismas paradas");
  const lleva = <T,>(l: readonly T[] | undefined): T[] | undefined => (l ? idx.map((i) => l[i]) : undefined);
  return {
    ...e, paradas: [...paradas], puntos: lleva(e.puntos)!, cambios: lleva(e.cambios)!,
    ...(e.ventanas ? { ventanas: lleva(e.ventanas) } : {}), ...(e.servicios ? { servicios: lleva(e.servicios) } : {}),
    ...(e.recogidaDesde ? { recogidaDesde: lleva(e.recogidaDesde) } : {}),
  };
}

/** Lo más que lleva a bordo la lista en su orden de ahora, en pallets (la misma cuenta entera del optimizador: centésimas). */
export function picoDeCarga(e: Pick<EntradaDeOptimizar, "paradas" | "cambios">): number {
  const c = (n: number | null | undefined) => Math.round((Number.isFinite(n ?? NaN) ? (n as number) : 0) * 100);
  const recogidas = new Set<string>();
  for (const p of e.paradas) if (p.tipo === "P") for (const id of p.ordenes) recogidas.add(id);
  // Lo que ya va a bordo al salir: las entregas cuya recogida no está en la lista.
  let carga = 0;
  e.paradas.forEach((p, i) => { if (p.tipo === "D" && !recogidas.has(p.orden) && c(e.cambios[i]) < 0) carga -= c(e.cambios[i]); });
  let pico = carga;
  e.paradas.forEach((_, i) => { carga += c(e.cambios[i]); if (carga > pico) pico = carga; });
  return pico / 100;
}

/**
 * La misma lista, vista como la ve el despachador que la armó (`PATRONES.ventanas`, `PATRONES.capacidad`): lo que su orden
 * ya hace, vale. La ventana de una entrega que ya llega tarde se estira hasta la hora a la que llega ahora; y la capacidad,
 * hasta lo más que su ruta ya lleva a bordo. Con esto la ruta de ahora no «debe» nada, y el optimizador solo busca menos
 * jornada y menos millas sin retrasar más a nadie ni cargar más el camión.
 */
export function comoLaVeElDespachador(e: EntradaDeOptimizar, antes: MedidaDeLaLista): EntradaDeOptimizar {
  const tardeDe = new Map(antes.tarde.map((t) => [t.orden, t.minutos]));
  const ventanas = e.ventanas?.map((v, i): VentanaDeEntrega | null => {
    const p = e.paradas[i];
    const tarde = p.tipo === "D" ? tardeDe.get(p.orden) ?? 0 : 0;
    return v && tarde > 0 ? { ...v, cierra: v.cierra + tarde } : v;
  });
  const capacidad = e.capacidad != null && e.capacidad > 0 ? Math.max(e.capacidad, picoDeCarga(e)) : e.capacidad;
  return { ...e, ...(ventanas ? { ventanas } : {}), capacidad };
}

export interface ResultadoSinEmpeorar extends ResultadoDeOptimizar {
  /** Qué pasada dio el orden: «arregla» (menos retraso o exceso, sin costar nada), «ahorra» (menos jornada o millas sin
   *  retrasar más a nadie) o `null` si no se cambió nada. */
  como: "arregla" | "ahorra" | null;
  /** Órdenes que la búsqueda encontró y la guarda NO dejó pasar (para medir; en pantalla no se enseñan). */
  descartados: number;
}

/**
 * «🧭 Optimizar» con la regla de D-1029. Devuelve lo mismo que `optimizaLaLista` —`antes` y `despues` medidos con las
 * ventanas y la capacidad DE VERDAD—, y `cambio: false` si no hay un orden que mejore algo sin empeorar nada.
 */
export function optimizaSinEmpeorar(e: EntradaDeOptimizar): ResultadoSinEmpeorar {
  const antes = mideLaLista(e);
  const nada = (base: ResultadoDeOptimizar, descartados: number): ResultadoSinEmpeorar => ({
    ...base, paradas: [...e.paradas], cambio: false, antes, despues: antes,
    millasAntes: antes.millas, millasDespues: antes.millas, excesoAntes: antes.exceso, excesoDespues: antes.exceso, como: null, descartados,
  });
  // Con menos de tres paradas no hay orden que elegir, y una lista que rompe la precedencia no se toca: lo dice el de siempre.
  if (e.paradas.length < 3 || ordenSinRecoger(e.paradas) != null) return nada(optimizaLaLista(e), 0);

  const topes = { millas: antes.centiMillas / 100, tarjetaMin: jornadaDeTarjeta(antes) };
  let descartados = 0;
  const pasa = (r: ResultadoDeOptimizar, como: "arregla" | "ahorra"): ResultadoSinEmpeorar | null => {
    if (!r.cambio) return null;
    const despues = mideLaLista(entradaEnOrden(e, r.paradas));
    if (!noEsPeor(antes, despues)) { descartados++; return null; }
    return { ...r, antes, despues, millasAntes: antes.millas, millasDespues: despues.millas, excesoAntes: antes.exceso, excesoDespues: despues.exceso, como, descartados };
  };

  // 1 · Si la ruta llega tarde a algo o se pasa de carga: lo que lo arregle sin más millas ni más tiempo.
  let exacta = true;
  if (antes.tarde.length > 0 || antes.exceso > 0) {
    const r0 = optimizaLaLista({ ...e, topes });
    const ok = pasa(r0, "arregla");
    if (ok) return ok;
    exacta = r0.exacta;
  }
  // 2 · Como el despachador: lo que su ruta ya hace vale; dentro de eso, menos jornada y menos millas.
  const r1 = optimizaLaLista({ ...comoLaVeElDespachador(e, antes), topes });
  const ok = pasa(r1, "ahorra");
  if (ok) return ok;
  return nada({ ...r1, exacta: exacta && r1.exacta && descartados === 0 }, descartados);
}

/** Lo medido de las rutas hechas a mano con lo que se justifican estas reglas (`scripts/rutas/patrones.mjs`). */
export const PATRONES_DE_DESPACHO = PATRONES;

// ---------------------------------------------------------------------------------------------------------------------
// La ruta que ya va a MEDIAS: lo pendiente sale de donde está el camión, a la hora que es.

/** Lo que hace falta de una orden ya tocada hoy para saber dónde quedó el camión. */
export interface HechoDelDia {
  /** Entregada: cuándo, y dónde (el pin de la entrega). */
  pod_delivered_at?: string | null;
  delivery_lat?: number | null;
  delivery_lng?: number | null;
  /** Recogida: cuándo, y en qué tienda. */
  pickup_gps_at?: string | null;
  pickup_name?: string | null;
  store?: string | null;
}

/**
 * De dónde y a qué hora sale lo PENDIENTE de una ruta (D-1029). Hasta aquí «🧭 Optimizar» contaba siempre desde la base del
 * chofer a las 08:00, también a media tarde con el camión en otra ciudad: ordenaba lo que quedaba como si el día empezara
 * de nuevo, y la tarjeta —que mide desde lo último hecho (D-906)— enseñaba después más millas y más tiempo.
 *
 * Solo viendo HOY y con algo ya hecho en ESA fecha: el punto de lo último que se hizo (la entrega más reciente, o la tienda
 * de la recogida más reciente) y la hora de ahora (nunca antes de la salida prevista). Si no, `null`: la base y su hora.
 * `fechaDe`: el día del negocio de un instante (`ahoraDelNegocio(…).fecha`), para no contar lo hecho otro día.
 */
export function arranqueDeLoPendiente(args: {
  hechos: readonly HechoDelDia[]; fecha: string; hoy: { fecha: string; minutos: number }; salidaMin: number;
  coordsDeTienda: (nombre: string | null) => { lat: number; lng: number } | null;
  fechaDe: (instante: Date) => string;
}): { punto: { lat: number; lng: number }; salidaMin: number } | null {
  if (args.fecha !== args.hoy.fecha) return null;
  let ultimo = -Infinity, punto: { lat: number; lng: number } | null = null;
  const mira = (cuando: string | null | undefined, donde: { lat: number; lng: number } | null) => {
    const t = cuando ? Date.parse(cuando) : NaN;
    if (!Number.isFinite(t) || !donde || args.fechaDe(new Date(t)) !== args.fecha || t <= ultimo) return;
    ultimo = t; punto = donde;
  };
  for (const h of args.hechos) {
    mira(h.pickup_gps_at, args.coordsDeTienda((h.pickup_name ?? "").trim() || (h.store ?? "").trim() || null));
    mira(h.pod_delivered_at, h.delivery_lat != null && h.delivery_lng != null ? { lat: h.delivery_lat, lng: h.delivery_lng } : null);
  }
  return punto ? { punto, salidaMin: Math.max(args.salidaMin, args.hoy.minutos) } : null;
}

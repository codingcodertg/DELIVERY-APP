import { BUSINESS_TZ } from "@/lib/utils";
import { formateadorDeFecha } from "@/lib/formateador";
/* ---- A qué hora «sale» la medida de una ruta (D-602, 2026-10-19) ----
 * Ernesto (chofer): «Why does ETA say 8 to orders that havent been done yet?». A las 12:40, con 11 paradas hechas, la
 * parada 12 (pendiente) decía 8:23: la medida de la ruta siempre arrancaba de la base a las 08:00 (`DAY_START_MIN`),
 * aunque fueran las doce y el camión llevara horas fuera. Las paradas HECHAS ya no están en la lista que se mide (solo
 * se miden las pendientes), así que la primera pendiente «salía» a las 08:00 más el trayecto desde la base.
 *
 * Regla: la medida de HOY no puede salir antes de la hora que es. Si ya pasó la hora de salida, sale AHORA; si aún no,
 * a la hora de salida. Otro día (mañana, o uno pasado que se revisa) no tiene «ahora»: la hora de salida.
 *
 * D-NEXT (2026-11-06): «ahora» y «hoy» son los del NEGOCIO (Texas, `BUSINESS_TZ`), no los del reloj de quien mira. Hasta
 * aquí se leían con `getHours()` del navegador mientras las horas reales de las paradas se leían en Texas: quien abría
 * el Gestor desde otro huso (Guatemala va una hora por detrás de Texas todo el verano) veía —y APUNTABA en
 * `delivery_eta_plans`— las llegadas de lo pendiente corridas una hora. */

/** La hora a la que se supone que sale el camión si nadie ha hecho nada todavía y su chofer no tiene turno en Ajustes →
 *  Rutas: las 08:00 (`DAY_START_MIN` del Gestor y `SALIDA_POR_DEFECTO_MIN` de optimizar). Con turno, manda su entrada
 *  (`salidaPrevistaMin`, D-NEXT). Medido en 30 días: el primer toque de un chofer es a las 08:34 en el cuartil temprano y
 *  el primer punto de GPS del día a las 08:19 de mediana (11 chofer-días); con 08:20 en vez de 08:00 el error de la
 *  prevista de la mañana baja de 77 a 67 minutos de mediana. No se cambió aquí: es el turno de cada chofer, y se pone en
 *  Ajustes, de donde también lo lee «Armar rutas». */
export const SALIDA_MIN = 8 * 60;

/** El día (yyyy-mm-dd) y los minutos desde la medianoche de un instante, en el huso del negocio. */
export function ahoraDelNegocio(ahora: Date = new Date()): { fecha: string; minutos: number } {
  const partes = Object.fromEntries(formateadorDeFecha("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(ahora).map((p) => [p.type, p.value]));
  return { fecha: `${partes.year}-${partes.month}-${partes.day}`, minutos: Number(partes.hour) * 60 + Number(partes.minute) };
}

/** `fecha` es la del día que se mide (yyyy-mm-dd); `ahora`, el instante en que se mide. Minutos desde la medianoche. */
export function salidaDeLaMedida(fecha: string, ahora: Date = new Date(), salidaMin: number = SALIDA_MIN): number {
  const hoy = ahoraDelNegocio(ahora);
  if (fecha !== hoy.fecha) return salidaMin;
  return Math.max(salidaMin, hoy.minutos);
}

/* ---- La hora de cada parada cuando parte de la ruta YA está hecha (D-691, 2026-10-26) ----
 * Roberto (admin), ruta de Julio Jijon: «Something is still off with the ETAs». ✓P3 recogida en RDZ Pharr a las 09:37, y aun
 * así «Base: salida 10:31» y P1/P2 (pendientes, en la MISMA tienda) a las 10:31. Se hizo que lo hecho anclara el reloj.
 *
 * ---- D-NEXT (2026-11-06): el reloj sigue al camión, no a la lista ----
 * Roberto otra vez, con la ruta de Ernesto a las 09:25: «Something is off with the times». «Base: salida 01:43», y las
 * paradas pendientes a las 02:04, 02:51 … 07:18 —de madrugada—, mientras lo ya hecho decía «prevista 14:52, real 08:55,
 * −357 min». Ernesto había empezado por el FINAL de su lista (las transferencias de Pharr) y el reloj de D-691 recorría
 * la lista en SU orden: tomaba la primera parada hecha (08:14, la novena de la lista) y le restaba los tramos y los
 * servicios de las ocho pendientes que tenía delante, como si ya se hubieran hecho antes. De ahí la salida a la 01:43 y
 * las ocho pendientes «llegando» de madrugada. La regla de «no llegar en el pasado» solo miraba lo que iba DETRÁS de la
 * primera hecha.
 *
 * Medido además con el GPS de los teléfonos (4 y 5 de noviembre, 3 choferes, 78 paradas): solo la mitad de los toques
 * («Recogido», «Entregado») se dan estando en la parada; 30 se dieron después de irse (hasta 5 h después) y 9 antes de
 * llegar. Y en 30 días, 46 de 65 chofer-días con dos o más paradas hechas tienen toques claramente fuera del orden de
 * la lista. Por eso el reloj ya no supone que la lista se cumple en orden:
 *
 *  1. Dónde está el camión: en la parada del ÚLTIMO toque real (la hora real más tarde), esté donde esté en la lista.
 *     «Recogido» y «Entregado» marcados a la vez se marcan en casa del cliente: ahí está.
 *  2. Lo pendiente —todo, vaya delante o detrás de lo hecho en la lista— se proyecta desde ahí, en el orden de la
 *     lista: sale cuando acaba lo último hecho (una entrega, su hora real más su descarga; una recogida, su toque) y hoy
 *     nunca antes de ahora, y suma tramo y servicio parada a parada. Así las horas de lo pendiente SIEMPRE suben en el
 *     orden de la lista y hoy nunca caen en el pasado.
 *  3. La salida de la base es la del PRIMER hecho real menos su tramo desde la base; ya no arrastra lo pendiente.
 *  4. Un tramo que no se sabe (el router no lo dio, o dio 0 entre dos sitios que están lejos) no vale 0: esa parada y
 *     las siguientes se quedan SIN hora (la celda lo dice) en vez de enseñar una hora falsa.
 *  5. La medida se pide en el orden en que la ruta se está haciendo de verdad (`enOrdenDeEjecucion`): lo hecho por su
 *     hora real y luego lo pendiente. Así el tramo «última hecha → primera pendiente» es el del router, no un invento.
 *     Si el chofer sigue la lista, ese orden ES el de la lista y nada cambia (D-584: hacer una parada no vuelve a medir).
 *  6. Con la posición del camión (TrackSolid) reciente, el primer tramo se acorta en lo que ya lleva recorrido.
 *  7. Una recogida A MEDIAS (de tres órdenes de la misma visita a la tienda, una marcada recogida y dos sin marcar): la
 *     tienda ya se visitó. A lo que falta NO se le pone hora y NO se manda al camión de vuelta. No se sabe si las otras
 *     dos van a bordo sin marcar o se quedaron en la tienda, y lo primero es lo corriente: en 30 días, 149 de 324 órdenes
 *     tienen el toque de «Recogido» a menos de 2 minutos del de «Entregado» —se marcan las dos cosas en casa del
 *     cliente—. Es lo que pasó en la captura de Julio del 26 de octubre: FU571 salía «pendiente de recoger» en Pharr a
 *     las 10:31 y se marcó recogida a las 11:09:00 y entregada a las 11:09:31, en Weslaco. La celda dice «sin marcar»
 *     (`sinHora`), y la ruta sigue desde donde está el camión. (Hasta aquí esas recogidas decían la hora de «ahora».)
 * Las paradas enteramente hechas no llevan llegada estimada: la suya es la del plan (D-671) y su hora real. */

/** Minutos del día de una hora real (ISO) en la zona del negocio, solo si cae en `fecha` (yyyy-mm-dd). */
export function minutosReales(iso: string | null | undefined, fecha: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const en = ahoraDelNegocio(d);
  return en.fecha === fecha ? en.minutos : null;
}

/** Un punto medido: su clave en `etas`, su servicio, sus órdenes y si es entrega o recogida. Con `lat`/`lng`, el reloj
 *  puede comprobar un tramo y estimar un salto entre dos puntos que la medida no trae seguidos. */
export interface PuntoDelReloj { id: string; servicio: number; tipo: "P" | "D"; ordenes: readonly string[]; lat?: number; lng?: number }
export interface OrdenDelReloj { id: string; stage?: string | null; pickup_gps_at?: string | null; pod_delivered_at?: string | null }
export type CoordenadasDelReloj = { lat: number; lng: number };
/** La última posición conocida de un camión y cuándo se tomó. */
export type CamionDelReloj = { lat: number; lng: number; en: Date | string };

/** Cuándo se llegó a un punto, si ya se hizo (la primera hora real de sus órdenes hechas), y si está hecho entero. */
export function horaHecha(p: Pick<PuntoDelReloj, "tipo" | "ordenes">, porId: ReadonlyMap<string, OrdenDelReloj>, fecha: string): { real: number | null; entero: boolean } {
  const { real, entero } = estadoDelPunto(p, porId, fecha);
  return { real, entero };
}

/** Lo hecho de un punto: su primera y su última hora real, si está hecho entero, y si está A MEDIAS (alguna de sus órdenes
 *  hecha y alguna no: en una recogida, la tienda ya se visitó y queda algo sin marcar). */
function estadoDelPunto(p: Pick<PuntoDelReloj, "tipo" | "ordenes">, porId: ReadonlyMap<string, OrdenDelReloj>, fecha: string): { real: number | null; ultimo: number | null; entero: boolean; aMedias: boolean } {
  const horas: number[] = [];
  let hechas = 0;
  for (const id of p.ordenes) {
    const o = porId.get(id);
    const hecha = !!o && (p.tipo === "D" ? o.stage === "delivered" : o.stage === "picked_up" || o.stage === "delivered");
    if (!hecha) continue;
    hechas++;
    const m = minutosReales(p.tipo === "D" ? o!.pod_delivered_at : o!.pickup_gps_at, fecha);
    if (m != null) horas.push(m);
  }
  const entero = p.ordenes.length > 0 && hechas === p.ordenes.length;
  return { real: horas.length ? Math.min(...horas) : null, ultimo: horas.length ? Math.max(...horas) : null, entero, aMedias: hechas > 0 && !entero };
}

/** Dos toques a menos de esto se toman como dados a la vez: la oficina marca tres recogidas en un minuto, y el orden
 *  de esos toques no es el orden en que el camión pasó por las tiendas. Entre ellos manda el orden de la lista. */
export const TOQUES_A_LA_VEZ_MIN = 3;

/** Una parada de la lista, lo justo para ordenarla: una recogida con sus órdenes o una entrega con la suya. */
type ParadaOrdenable = { tipo: "P"; ordenes: readonly string[] } | { tipo: "D"; orden: string };

/**
 * La lista en el orden en que la ruta se está HACIENDO: primero lo hecho entero sin hora real (ya pasó, no se sabe
 * cuándo), luego lo hecho —entero, o una recogida a medias: la tienda ya se visitó— por su hora real, y al final lo
 * pendiente en el orden de la lista. Entre toques dados a la vez (`TOQUES_A_LA_VEZ_MIN`) no se reordena. Con la lista cumplida en orden,
 * devuelve la misma lista. Lo usa la medida: se pide el camino en ESTE orden (`useMedidaDeRutas`).
 */
export function enOrdenDeEjecucion<P extends ParadaOrdenable>(lista: readonly P[], ordenes: readonly OrdenDelReloj[], fecha: string): P[] {
  const porId = new Map(ordenes.map((o) => [o.id, o]));
  const sinHora: P[] = [], conHora: { p: P; real: number }[] = [], pendientes: P[] = [];
  for (const p of lista) {
    const h = estadoDelPunto({ tipo: p.tipo, ordenes: p.tipo === "P" ? p.ordenes : [p.orden] }, porId, fecha);
    // Una recogida a medias ya se VISITÓ (regla 7): va con lo hecho, por su hora si la tiene; no se vuelve a ella.
    if (!h.entero && !h.aMedias) pendientes.push(p);
    else if (h.real == null) sinHora.push(p);
    else conHora.push({ p, real: h.real });
  }
  // Inserción: una hecha solo adelanta a otra si su hora real es claramente anterior. Estable y determinista.
  for (let i = 1; i < conHora.length; i++) {
    for (let j = i; j > 0 && conHora[j - 1].real > conHora[j].real + TOQUES_A_LA_VEZ_MIN; j--) [conHora[j - 1], conHora[j]] = [conHora[j], conHora[j - 1]];
  }
  return [...sinHora, ...conHora.map((x) => x.p), ...pendientes];
}

const RADIO_TIERRA_MI = 3958.8;
/** Millas en línea recta. */
export function millasEntre(a: CoordenadasDelReloj, b: CoordenadasDelReloj): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_MI * Math.asin(Math.sqrt(h));
}
/** El mismo cálculo grueso del último escalón de `route-times` (línea recta × 1,3 a 30 mph): solo para un SALTO entre
 *  dos puntos que la medida no trae seguidos (un instante, hasta que llega la medida en el orden nuevo). */
const minutosEstimados = (a: CoordenadasDelReloj, b: CoordenadasDelReloj): number => Math.round(((millasEntre(a, b) * 1.3) / 30) * 60);
/** Menos de esto es «el mismo sitio»: un tramo de 0 entre dos puntos más separados no es un tramo, es un hueco. */
const MISMO_SITIO_MI = 0.3;
/** La posición del camión vale si es de hace menos de esto; más vieja, no se usa. */
export const POSICION_RECIENTE_MIN = 10;
const conPunto = (p: { lat?: number; lng?: number } | null | undefined): p is CoordenadasDelReloj => !!p && typeof p.lat === "number" && typeof p.lng === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lng);

/** Por qué un punto pendiente se queda sin hora: falta el tiempo de un tramo, o es una recogida a medias de la que el
 *  camión ya se fue (no se sabe si lo que falta va a bordo sin marcar). */
export type MotivoSinHora = "sin_tramo" | "sin_marcar";

export interface RelojDeLaRuta {
  /** La llegada estimada de cada punto pendiente con hora calculable, «HH:MM». */
  etas: Record<string, string>;
  /** Los puntos pendientes cuya hora NO se puede dar, y por qué: la celda lo dice en vez de inventar una. */
  sinHora: Record<string, MotivoSinHora>;
  /** La salida de la base, en minutos; `null` si no se sabe (hay cosas hechas y ninguna hora real, o falta su tramo). */
  salida: number | null;
  /** La hora al acabar (de vuelta en la base si `vuelve`); `null` si no se pudo calcular. */
  clock: number | null;
  servicio: number;
}

/** Las horas de la ruta medida: la llegada de cada punto pendiente, la salida de la base y la vuelta. `legs` como los da
 *  el router: con base, el tramo j entra en el punto j y el último es la vuelta; sin base, el tramo j-1 entra en el j. */
export function relojDeLaRuta(e: {
  puntos: readonly PuntoDelReloj[]; legs: readonly number[]; conBase: boolean; vuelve: boolean;
  ordenes: readonly OrdenDelReloj[]; fecha: string; ahora?: Date;
  /** La hora de salida si nadie ha hecho nada (minutos). Por defecto `SALIDA_MIN`. */
  salidaPrevistaMin?: number;
  /** Las coordenadas de la base y del fin, si se saben: para comprobar su tramo y estimar un salto desde o hacia ellos. */
  base?: CoordenadasDelReloj | null; fin?: CoordenadasDelReloj | null;
  /** La última posición del camión (TrackSolid). Solo acorta el primer tramo, y solo si es reciente. */
  camion?: CamionDelReloj | null;
}): RelojDeLaRuta {
  const { puntos } = e;
  const n = puntos.length;
  const porId = new Map(e.ordenes.map((o) => [o.id, o]));
  const hechas = puntos.map((p) => estadoDelPunto(p, porId, e.fecha));
  const ahora = e.ahora ?? new Date();
  const hoy = ahoraDelNegocio(ahora);
  const ahoraMin = hoy.fecha === e.fecha ? hoy.minutos : null; // null: no es hoy, no hay «ahora»
  const salidaPrevista = e.salidaPrevistaMin ?? SALIDA_MIN;
  const lugar = (j: number) => (j < 0 ? e.base : j >= n ? (e.fin ?? e.base) : puntos[j]);

  /** El tramo que ENTRA en el punto j desde el anterior de la medida (j = n: la vuelta). `null` si no se sabe. */
  const tramoDeLaMedida = (j: number): number | null => {
    if (!e.conBase && j === 0) return 0;
    const s = e.legs[e.conBase ? j : j - 1];
    if (typeof s !== "number" || !Number.isFinite(s) || s < 0) return null;
    // Un 0 solo vale entre dos puntos que están en el mismo sitio (dos recogidas en la tienda, la base que es la tienda).
    if (s === 0) { const de = lugar(j - 1), a = lugar(j); if (conPunto(de) && conPunto(a) && millasEntre(de, a) > MISMO_SITIO_MI) return null; }
    return s / 60;
  };
  /** De un punto de la medida a otro (-1 = la base; n = el fin): su tramo si van seguidos; si no, una estimación con sus
   *  coordenadas; sin ellas, no se sabe. */
  const viaje = (de: number, a: number): number | null => {
    if (a === de) return 0;
    if (a === de + 1) return tramoDeLaMedida(a);
    const p = lugar(de), q = lugar(a);
    return conPunto(p) && conPunto(q) ? minutosEstimados(p, q) : null;
  };

  // Dónde está el camión: en el punto del ÚLTIMO toque real (en una recogida de varias órdenes, el último de ellas: si
  // volvió a la tienda a por más, está ahí). Entre toques dados a la vez, el de más abajo en la medida: «Recogido» y
  // «Entregado» marcados juntos se marcan en casa del cliente, no en la tienda.
  const conHora = hechas.map((h, j) => ({ j, real: h.real, ultimo: h.ultimo })).filter((x): x is { j: number; real: number; ultimo: number } => x.real != null && x.ultimo != null);
  const ultimaHora = conHora.length ? Math.max(...conHora.map((x) => x.ultimo)) : null;
  // Sin ninguna hora real pero con algo hecho (entero o a medias): está en lo último hecho de la medida, no se sabe desde cuándo.
  const visitados = hechas.map((h, j) => (h.entero || h.aMedias ? j : -1)).filter((j) => j >= 0);
  const donde = ultimaHora != null
    ? Math.max(...conHora.filter((x) => x.ultimo >= ultimaHora - TOQUES_A_LA_VEZ_MIN).map((x) => x.j))
    : visitados.length ? visitados[visitados.length - 1] : -1;

  // La salida de la base: sin nada hecho, la prevista (hoy, no antes de ahora); con algo hecho, la del primer hecho real
  // menos su tramo desde la base. Con cosas hechas y ninguna hora real, no se sabe.
  let salida: number | null;
  if (ultimaHora == null) salida = visitados.length ? null : ahoraMin != null ? Math.max(salidaPrevista, ahoraMin) : salidaPrevista;
  else {
    const primeraHora = Math.min(...conHora.map((x) => x.real));
    const primera = Math.min(...conHora.filter((x) => x.real <= primeraHora + TOQUES_A_LA_VEZ_MIN).map((x) => x.j));
    const desdeLaBase = e.conBase ? viaje(-1, primera) : 0;
    salida = desdeLaBase == null ? null : Math.max(0, hechas[primera].real! - desdeLaBase);
  }

  // Lo pendiente, en el orden de la medida, desde donde está el camión. Una recogida a medias (regla 7) ya se visitó: lo que
  // le falta por marcar no lleva hora, y el camión no vuelve a ella.
  const pendientes: number[] = [];
  const etas: Record<string, string> = {};
  const sinHora: Record<string, MotivoSinHora> = {};
  hechas.forEach((h, j) => { if (h.aMedias) sinHora[puntos[j].id] = "sin_marcar"; else if (!h.entero) pendientes.push(j); });
  let clock: number | null;
  if (donde < 0) clock = salida;
  else {
    // Sale de la parada hecha cuando acaba: una entrega, su hora real más su servicio; una recogida, su último toque
    // («Recogido» se marca con el camión ya cargado).
    clock = ultimaHora == null ? null : ultimaHora + (puntos[donde].tipo === "D" ? puntos[donde].servicio : 0);
    if (ahoraMin != null && pendientes.length) clock = Math.max(clock ?? ahoraMin, ahoraMin);
  }
  let desde = donde;
  let primero = true;
  for (const j of pendientes) {
    let tramo = clock == null ? null : viaje(desde, j);
    // El camión ya va de camino (regla 6): sale AHORA y le queda la parte del tramo que le falta por recorrer.
    if (primero && tramo != null && j !== desde && ahoraMin != null && donde >= 0) {
      const queda = loQueLeQuedaAlCamion(lugar(desde), puntos[j], e.camion, ahora);
      if (queda != null) { clock = ahoraMin; tramo *= queda; }
    }
    primero = false;
    clock = clock == null || tramo == null ? null : clock + tramo;
    if (clock == null) sinHora[puntos[j].id] = "sin_tramo";
    else { etas[puntos[j].id] = fmtReloj(clock); clock += puntos[j].servicio; }
    desde = j;
  }
  if (e.vuelve && clock != null) {
    const vuelta = viaje(desde, n);
    clock = vuelta == null ? null : clock + vuelta;
  }
  return { etas, sinHora, salida, clock, servicio: puntos.reduce((s, p) => s + p.servicio, 0) };
}

/**
 * Qué parte del tramo le queda al camión (0…1), si ya va de camino (D-NEXT): la distancia que le falta entre la del tramo
 * entero, en línea recta. `null` —el tramo entero, saliendo cuando toque— si no hay posición, no es reciente
 * (`POSICION_RECIENTE_MIN`), faltan coordenadas, los dos puntos son el mismo sitio o el camión aún no salió de la parada
 * anterior. Nunca alarga el tramo.
 */
export function loQueLeQuedaAlCamion(
  de: { lat?: number; lng?: number } | null | undefined, a: { lat?: number; lng?: number } | null | undefined,
  camion: CamionDelReloj | null | undefined, ahora: Date,
): number | null {
  if (!camion || !conPunto(camion) || !conPunto(de) || !conPunto(a)) return null;
  const hace = (ahora.getTime() - new Date(camion.en).getTime()) / 60_000;
  if (!Number.isFinite(hace) || hace < -1 || hace > POSICION_RECIENTE_MIN) return null;
  const entero = millasEntre(de, a);
  if (entero <= MISMO_SITIO_MI || millasEntre(camion, de) <= MISMO_SITIO_MI) return null;
  return Math.min(1, millasEntre(camion, a) / entero);
}

/** «HH:MM» de unos minutos desde la medianoche. */
export function fmtReloj(min: number): string {
  const total = Math.round(min);
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

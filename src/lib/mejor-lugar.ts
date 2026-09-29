import { FACTOR_DE_RODEO, MILLAS_POR_HORA_ESTIMADAS, millasEnLineaRecta } from "@/lib/route-times/proveedores";
import { RELOAD_MIN } from "@/lib/trip-timing";

/**
 * «📍 Mejor lugar» del Gestor de Rutas (D-411): meter UNA orden en la ruta de un chofer, en el hueco más barato, sin
 * reoptimizar nada más. Es el «best fit» de OptimoRoute (docs/research-route-optimization.md §1.3 y §4 «Copiar») y la
 * «inserción más barata del par» de docs/route-algorithm-design.md §2.6.
 *
 * **El par recogida → entrega.** En el Gestor cada viaje es un lazo: sale de la recogida (la base de la ruta, donde carga
 * el camión), reparte y vuelve. Así lo calcula «Optimizar» (`computeRoute`) y así lo lee la etiqueta P/D (`secuenciaPD`:
 * las recogidas del viaje van delante de sus entregas). Meter la orden en el viaje `v` es meter su recogida al principio de
 * ese viaje y su entrega en el puesto elegido: la recogida va antes que la entrega por construcción. Por eso el hueco es
 * (viaje, puesto de la entrega), y no dos puestos sueltos.
 *
 * **Capacidad.** Solo se mira un viaje al que le quepan los pallets. Si no cabe en ninguno, va en un viaje nuevo al final
 * (con su recarga). Nunca se abre un viaje nuevo si cabe en uno que ya existe: así la ruta que se escribe es la misma que
 * volverá a partir `splitIntoTrips` (en una ruta que parte la capacidad sola, meter en un viaje con sitio no mueve ningún
 * corte: los pallets de ese viaje siguen sin pasar de la capacidad, y la parada siguiente sigue sin caber).
 *
 * **Coste, sin llamar a nadie.** Millas en línea recta × `FACTOR_DE_RODEO` y minutos a `MILLAS_POR_HORA_ESTIMADAS`: el
 * escalón «estimado» de los tiempos (D-318), el que no llama a Google ni a OSRM. Para ELEGIR entre huecos basta: ordena
 * los huecos igual que lo haría la carretera en casi todos los casos, y cuesta cero. Llamar a Google por cada hueco serían
 * decenas de peticiones de pago por clic. Las millas y la hora que enseña el aviso son esta estimación, y se dice.
 *
 * **Ventanas, si se puede.** Primero el hueco que añade MENOS minutos tarde a la ruta (sumando todas sus paradas: meter una
 * parada puede retrasar las de detrás); a igualdad, el que añade menos millas; a igualdad, el primero. Llegar antes de que
 * abra la ventana espera a que abra, como en OptimoRoute (`twFrom`).
 *
 * **Sin viajes (D-443).** El Gestor ya no parte la ruta en viajes: le pasa la lista entera como UN viaje y, en `admite`,
 * si en cada puesto cabe la orden nueva recogida justo delante de su entrega (la carga a bordo en ese punto + sus pallets,
 * contra la capacidad; `cargaAntesDeLaEntrega` de lib/lista-unica). Con `admite` no se mira la suma del «viaje» ni se abre
 * uno nuevo: si no cabe en ningún puesto, se elige igual el mejor —la cuenta de la tabla avisa en la parada que se pase—.
 */

export interface LatLng { lat: number; lng: number }

export interface ParadaDeRuta {
  id: string;
  lat: number | null | undefined;
  lng: number | null | undefined;
  pallets: number;
  /** Minutos desde medianoche `[abre, cierra]`, o `null`. */
  ventana: [number, number] | null;
  /** Minutos de descarga. */
  servicioMin: number;
}

export interface EntradaDeMejorLugar {
  /** Los viajes de la ruta, tal como los pinta la pantalla (`buildTrips`). */
  viajes: readonly (readonly ParadaDeRuta[])[];
  nueva: ParadaDeRuta;
  /** La recogida / base de la ruta. Sin ella, la ruta es abierta (como en `computeRoute`). */
  base: LatLng | null;
  capacidad: number;
  /** A qué hora sale el primer viaje, en minutos desde medianoche. */
  inicioMin: number;
  /** D-443: ¿cabe en el puesto `puesto` del viaje `viaje`? Si se da, sustituye a la suma por viaje y nunca se abre uno nuevo. */
  admite?: (viaje: number, puesto: number) => boolean;
}

/**
 * El filtro de chofer válido (D-418, requisitos del camión): de las órdenes marcadas, cuáles puede llevar el chofer de
 * la ruta elegida y cuáles no, con lo que le falta. Va ANTES de buscar hueco y antes de «asignar al final» (sin pin o de
 * otro día): una orden que pide liftgate no entra en un camión sin liftgate por ningún camino. El cálculo del hueco
 * (`mejorLugar`) no cambia. `faltanA` es `faltanAlChofer` de `lib/requisitos` con esa ruta.
 */
export function separaPorRequisitos<T>(marcadas: readonly T[], faltanA: (orden: T) => readonly string[]): { pueden: T[]; no: { orden: T; faltan: string[] }[] } {
  const pueden: T[] = [];
  const no: { orden: T; faltan: string[] }[] = [];
  for (const d of marcadas) {
    const falta = faltanA(d);
    if (falta.length) no.push({ orden: d, faltan: [...falta] });
    else pueden.push(d);
  }
  return { pueden, no };
}

export interface Hueco {
  /** Índice del viaje (0 = el primero). `viaje === viajes.length` es un viaje nuevo. */
  viaje: number;
  /** Puesto de la entrega DENTRO del viaje (0 = la primera). */
  puesto: number;
  nuevoViaje: boolean;
  millasExtra: number;
  tardeExtraMin: number;
  /** Hora estimada de llegada a la nueva, en minutos desde medianoche. */
  llegadaMin: number;
}

export type ResultadoDeMejorLugar =
  /** `masCorto`: el hueco de menos millas cuando NO es el elegido (porque retrasaba alguna ventana). Es el porqué. */
  | { ok: true; hueco: Hueco; huecosMirados: number; siguiente: Hueco | null; masCorto: Hueco | null }
  | { ok: false; motivo: "sin_punto" };

const tienePunto = (p: ParadaDeRuta): p is ParadaDeRuta & { lat: number; lng: number } =>
  typeof p.lat === "number" && typeof p.lng === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lng);

/** Millas de carretera estimadas entre dos puntos. */
export const millasEstimadas = (a: LatLng, b: LatLng): number => millasEnLineaRecta(a, b) * FACTOR_DE_RODEO;
const minutosDe = (millas: number): number => (millas / MILLAS_POR_HORA_ESTIMADAS) * 60;

/**
 * Lo que cuesta la ruta entera: millas y minutos tarde, con reloj continuo entre viajes (recarga de `RELOAD_MIN` entre
 * uno y otro, como `computeRoute`). Las paradas sin punto no suman distancia pero sí su descarga.
 */
export function costeDeLaRuta(
  viajes: readonly (readonly ParadaDeRuta[])[],
  base: LatLng | null,
  inicioMin: number,
): { millas: number; tardeMin: number; llegadas: Map<string, number> } {
  let millas = 0;
  let tardeMin = 0;
  let reloj = inicioMin;
  const llegadas = new Map<string, number>();
  let primero = true;
  for (const viaje of viajes) {
    if (!viaje.length) continue;
    if (!primero && base) reloj += RELOAD_MIN;
    primero = false;
    let donde: LatLng | null = base;
    for (const p of viaje) {
      if (tienePunto(p)) {
        if (donde) {
          const m = millasEstimadas(donde, p);
          millas += m;
          reloj += minutosDe(m);
        }
        donde = p;
      }
      if (p.ventana && reloj < p.ventana[0]) reloj = p.ventana[0];
      llegadas.set(p.id, reloj);
      if (p.ventana && reloj > p.ventana[1]) tardeMin += reloj - p.ventana[1];
      reloj += p.servicioMin;
    }
    if (base && donde && donde !== base) {
      const m = millasEstimadas(donde, base);
      millas += m;
      reloj += minutosDe(m);
    }
  }
  return { millas, tardeMin, llegadas };
}

const palletsDe = (viaje: readonly ParadaDeRuta[]) => viaje.reduce((n, p) => n + (p.pallets || 0), 0);

/** El hueco más barato para `nueva` en la ruta. No escribe nada. */
export function mejorLugar(e: EntradaDeMejorLugar): ResultadoDeMejorLugar {
  if (!tienePunto(e.nueva)) return { ok: false, motivo: "sin_punto" };
  const antes = costeDeLaRuta(e.viajes, e.base, e.inicioMin);
  const huecos: Hueco[] = [];
  const prueba = (viaje: number, puesto: number, viajes: ParadaDeRuta[][], nuevoViaje: boolean) => {
    const despues = costeDeLaRuta(viajes, e.base, e.inicioMin);
    huecos.push({
      viaje, puesto, nuevoViaje,
      millasExtra: despues.millas - antes.millas,
      tardeExtraMin: Math.max(0, Math.round(despues.tardeMin - antes.tardeMin)),
      llegadaMin: despues.llegadas.get(e.nueva.id) ?? e.inicioMin,
    });
  };
  const mira = (filtra: boolean) => e.viajes.forEach((viaje, v) => {
    if (!e.admite && palletsDe(viaje) + (e.nueva.pallets || 0) > e.capacidad) return;
    for (let k = 0; k <= viaje.length; k++) {
      if (filtra && e.admite && !e.admite(v, k)) continue;
      const viajes = e.viajes.map((x) => [...x]);
      viajes[v].splice(k, 0, e.nueva);
      prueba(v, k, viajes, false);
    }
  });
  mira(true);
  // Con `admite` (lista única): si no cabe en ningún puesto, el mejor de todos igual. Sin él: un viaje nuevo SOLO si no cabe
  // en ninguno (así lo que se escribe es lo que la pantalla vuelve a partir).
  if (!huecos.length && e.admite) mira(false);
  if (!huecos.length) prueba(e.viajes.length, 0, [...e.viajes.map((x) => [...x]), [e.nueva]], true);
  const ordenados = [...huecos].sort((a, b) =>
    a.tardeExtraMin - b.tardeExtraMin || a.millasExtra - b.millasExtra || a.viaje - b.viaje || a.puesto - b.puesto);
  const porMillas = [...huecos].sort((a, b) => a.millasExtra - b.millasExtra || a.viaje - b.viaje || a.puesto - b.puesto)[0];
  return { ok: true, hueco: ordenados[0], huecosMirados: huecos.length, siguiente: ordenados[1] ?? null, masCorto: porMillas === ordenados[0] ? null : porMillas };
}

/**
 * Lo que hay que escribir para dejar la orden en su hueco: la secuencia entera de la ruta (`route_seq` 0..n-1, como las
 * flechas) y, si la ruta lleva viajes puestos a mano, el viaje de cada parada (`load_no`: `null` el primero). En una ruta
 * que parte la capacidad sola no se escribe `load_no`: el hueco ya respeta sus cortes.
 */
export function escrituraDelHueco(
  viajes: readonly (readonly { id: string }[])[],
  nuevaId: string,
  hueco: Pick<Hueco, "viaje" | "puesto">,
  viajesPuestosAMano: boolean,
): { ids: string[]; loadNoById?: Record<string, number | null>; loadNoDeLaNueva: number | null } {
  const conLaNueva = viajes.map((v) => v.map((p) => p.id));
  if (hueco.viaje >= conLaNueva.length) conLaNueva.push([nuevaId]);
  else conLaNueva[hueco.viaje].splice(hueco.puesto, 0, nuevaId);
  const loadNoDeLaNueva = viajesPuestosAMano && hueco.viaje > 0 ? hueco.viaje + 1 : null;
  if (!viajesPuestosAMano) return { ids: conLaNueva.flat(), loadNoDeLaNueva };
  const loadNoById: Record<string, number | null> = {};
  conLaNueva.forEach((ids, v) => ids.forEach((id) => { loadNoById[id] = v > 0 ? v + 1 : null; }));
  return { ids: conLaNueva.flat(), loadNoById, loadNoDeLaNueva };
}

/** «10:05» para el aviso. */
export const horaDe = (min: number): string => {
  const m = Math.max(0, Math.round(min));
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** El aviso de una orden colocada: dónde entró, entre quién, y por qué ese hueco. En los dos idiomas. */
export function avisoDelHueco(args: {
  orden: string;
  ruta: string;
  hueco: Hueco;
  totalDelViaje: number;
  anterior: string | null;
  siguienteParada: string | null;
  huecosMirados: number;
  alternativa: Hueco | null;
  masCorto?: Hueco | null;
}): { en: string; es: string } {
  const { orden, ruta, hueco, totalDelViaje, anterior, siguienteParada, huecosMirados, alternativa, masCorto } = args;
  const mi = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
  const pos = hueco.puesto + 1;
  const entreEn = anterior && siguienteParada ? `between #${anterior} and #${siguienteParada}`
    : anterior ? `after #${anterior}` : siguienteParada ? `before #${siguienteParada}` : "alone";
  const entreEs = anterior && siguienteParada ? `entre #${anterior} y #${siguienteParada}`
    : anterior ? `después de #${anterior}` : siguienteParada ? `antes de #${siguienteParada}` : "sola";
  // Sin viajes (D-443) el aviso dice solo la parada. Un viaje nuevo solo lo abre quien no pasa `admite`.
  const viajeEn = hueco.nuevoViaje ? `new truckload ${hueco.viaje + 1} (it didn't fit in any), ` : "";
  const viajeEs = hueco.nuevoViaje ? `viaje nuevo ${hueco.viaje + 1} (no cabía en ninguno), ` : "";
  const tardeEn = hueco.tardeExtraMin > 0 ? `+${hueco.tardeExtraMin} min late` : "no new lateness";
  const tardeEs = hueco.tardeExtraMin > 0 ? `+${hueco.tardeExtraMin} min tarde` : "sin retrasos nuevos";
  const altEn = alternativa ? ` Next best: stop ${alternativa.puesto + 1}, +${mi(alternativa.millasExtra)} mi${alternativa.tardeExtraMin > 0 ? `, +${alternativa.tardeExtraMin} min late` : ""}.` : "";
  const altEs = alternativa ? ` El siguiente mejor: parada ${alternativa.puesto + 1}, +${mi(alternativa.millasExtra)} mi${alternativa.tardeExtraMin > 0 ? `, +${alternativa.tardeExtraMin} min tarde` : ""}.` : "";
  const cortoEn = masCorto ? ` The shortest (stop ${masCorto.puesto + 1}, +${mi(masCorto.millasExtra)} mi) added ${masCorto.tardeExtraMin} min of lateness to the windows.` : "";
  const cortoEs = masCorto ? ` El más corto (parada ${masCorto.puesto + 1}, +${mi(masCorto.millasExtra)} mi) sumaba ${masCorto.tardeExtraMin} min de retraso en las ventanas.` : "";
  return {
    en: `#${orden} → ${ruta}, ${viajeEn}stop ${pos} of ${totalDelViaje} (${entreEn}): +${mi(hueco.millasExtra)} mi, ~${horaDe(hueco.llegadaMin)}, ${tardeEn}. Best of ${huecosMirados} slot(s), straight-line estimate.${cortoEn}${altEn}`,
    es: `#${orden} → ${ruta}, ${viajeEs}parada ${pos} de ${totalDelViaje} (${entreEs}): +${mi(hueco.millasExtra)} mi, ~${horaDe(hueco.llegadaMin)}, ${tardeEs}. El mejor de ${huecosMirados} hueco(s), estimación en línea recta.${cortoEs}${altEs}`,
  };
}

/**
 * A qué hora LLEGÓ de verdad el chofer a cada parada del plan publicado, deducido de las posiciones GPS que ya
 * se guardan (`driver_locations`, 043) — y cuánto se equivocó la hora estimada.
 *
 * Es una **reconstrucción honesta, con sus huecos declarados** (D-009/D-034/D-036): el GPS solo existe durante
 * el turno, con la pantalla que sea y la cobertura que haya. Así que:
 *   · **Nada se interpola.** Una parada sin una posición cerca no tiene hora real; tiene un motivo.
 *   · El reporte dice PRIMERO de cuántas paradas hay dato y de cuántas no, y solo después el error — y solo
 *     sobre las que tienen dato. Nunca una media que esconda los huecos.
 *   · No cambia nada de lo que ve o pulsa el chofer (D-021): solo se lee lo que su teléfono ya mandaba.
 *
 * Aquí no hay base, ni red, ni reloj.
 */

export interface ParadaDelPlan {
  id: string; driver_id: string | null; delivery_id: string | null; seq: number; kind: "P" | "D"; lat: number | null; lng: number | null;
  /** Minutos desde la medianoche LOCAL del día de la ruta. */
  eta: number; etd: number;
}
export interface Posicion { driver_id: string; lat: number; lng: number; accuracy_m: number | null; recorded_at: string }

/** `la_marco_otra_persona`: hay hora del toque, pero no la pulsó el chofer de la parada (o no se sabe quién): es
 *  cuándo alguien en un escritorio cerró la orden, no cuándo estuvo el camión allí. No mide nada, y no entra. */
export type MotivoSinLlegada = "sin_chofer" | "sin_punto" | "sin_posiciones_ese_dia" | "sin_posiciones_cerca" | "la_marco_otra_persona";

export interface LlegadaDeParada {
  paradaId: string;
  /** ISO. `null` si no se pudo deducir; entonces `motivo` dice por qué. */
  llegada: string | null; salida: string | null;
  motivo: MotivoSinLlegada | null;
  /** Cuántas posiciones sostienen el dato. Con una sola, llegada y salida son el mismo instante. */
  posiciones: number;
}

export interface OpcionesDeLlegada {
  /** A cuántos metros de la parada cuenta como «estar ahí». */
  radioM: number;
  /** Una posición que dice ser peor que esto no prueba nada: se ignora. */
  precisionMaxM: number;
  /** Si entre dos posiciones dentro del radio pasa más que esto, son dos visitas distintas. */
  huecoMaxMin: number;
}
/** 150 m: una tienda con su patio, o una casa con el camión en la calle. 100 m de precisión: lo que un teléfono
 *  da en ciudad con el GPS encendido. Son un punto de partida SIN medir contra datos reales; son parámetros. */
export const OPCIONES_POR_DEFECTO: OpcionesDeLlegada = { radioM: 150, precisionMaxM: 100, huecoMaxMin: 20 };

const RADIO_TIERRA_M = 6371000;
export function metrosEntre(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (g: number) => (g * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Por chofer, en el ORDEN de su ruta: la visita a cada parada es el primer rato dentro del radio que empieza
 * DESPUÉS de haber salido de la parada anterior hallada. Eso es lo que distingue dos paradas en el mismo
 * sitio (dos recogidas en la tienda, o volver a cargar): la segunda no puede ser el mismo rato que la primera
 * salvo que sean la misma visita física — y entonces comparten hora, que es lo que pasó.
 */
export function llegadasDeGPS(paradas: readonly ParadaDelPlan[], posiciones: readonly Posicion[], opciones: OpcionesDeLlegada = OPCIONES_POR_DEFECTO): LlegadaDeParada[] {
  const buenas = posiciones
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && (p.accuracy_m == null || p.accuracy_m <= opciones.precisionMaxM) && Number.isFinite(Date.parse(p.recorded_at)))
    .map((p) => ({ ...p, t: Date.parse(p.recorded_at) }))
    .sort((a, b) => a.t - b.t || (a.recorded_at < b.recorded_at ? -1 : 1));
  const porChofer = new Map<string, typeof buenas>();
  for (const p of buenas) porChofer.set(p.driver_id, [...(porChofer.get(p.driver_id) ?? []), p]);

  const r = new Map<string, LlegadaDeParada>();
  const sin = (p: ParadaDelPlan, motivo: MotivoSinLlegada) => r.set(p.id, { paradaId: p.id, llegada: null, salida: null, motivo, posiciones: 0 });
  const choferes = [...new Set(paradas.map((p) => p.driver_id))];
  for (const chofer of choferes) {
    const suyas = paradas.filter((p) => p.driver_id === chofer).sort((a, b) => a.seq - b.seq);
    if (!chofer) { suyas.forEach((p) => sin(p, "sin_chofer")); continue; }
    const rastro = porChofer.get(chofer) ?? [];
    let desde = -Infinity;                              // la salida de la última parada hallada
    let anterior: { lat: number; lng: number; llegada: number; salida: number; n: number } | null = null;
    for (const p of suyas) {
      if (p.lat == null || p.lng == null) { sin(p, "sin_punto"); continue; }
      if (!rastro.length) { sin(p, "sin_posiciones_ese_dia"); continue; }
      const aqui = { lat: p.lat, lng: p.lng };
      // La misma visita física que la parada anterior (mismo sitio, seguidas): comparten la hora.
      if (anterior && metrosEntre(anterior, aqui) <= opciones.radioM) {
        r.set(p.id, { paradaId: p.id, llegada: new Date(anterior.llegada).toISOString(), salida: new Date(anterior.salida).toISOString(), motivo: null, posiciones: anterior.n });
        continue;
      }
      const cerca = rastro.filter((x) => x.t > desde && metrosEntre(x, aqui) <= opciones.radioM);
      if (!cerca.length) { sin(p, "sin_posiciones_cerca"); anterior = null; continue; }
      let fin = 0;
      while (fin + 1 < cerca.length && cerca[fin + 1].t - cerca[fin].t <= opciones.huecoMaxMin * 60000) fin++;
      const visita = { lat: p.lat, lng: p.lng, llegada: cerca[0].t, salida: cerca[fin].t, n: fin + 1 };
      r.set(p.id, { paradaId: p.id, llegada: new Date(visita.llegada).toISOString(), salida: new Date(visita.salida).toISOString(), motivo: null, posiciones: visita.n });
      desde = visita.salida; anterior = visita;
    }
  }
  return paradas.map((p) => r.get(p.id)!);
}

// ---------------------------------------------------------------------------------------------------------------
// La mejor hora real DISPONIBLE por parada, y de dónde sale
// ---------------------------------------------------------------------------------------------------------------

/** Los sellos que el chofer ya deja al trabajar, sin que esto le pida nada nuevo (D-021). Son la hora del TOQUE:
 *  cuando cerró la parada — cargó, o entregó —, no cuando llegó. */
export interface SellosDeOrden {
  id: string; pickup_gps_at: string | null; pod_delivered_at: string | null;
  /** Quién registró el paso a «recogida» y a «entregada» (`order_events.created_by`). Medido el 2026-09-18: las
   *  entregas de tres de los cuatro choferes las mueve otra gente desde un escritorio. */
  picked_up_by: string | null; delivered_by: string | null;
}

export type FuenteReal = "gps" | "toque";

export interface RealDeParada {
  paradaId: string;
  fuente: FuenteReal | null;
  /** Solo el GPS sabe cuándo LLEGÓ. Con `toque`, la llegada es `null`: no se inventa restándole el servicio. */
  llegada: string | null;
  /** Con GPS: la última posición dentro del radio. Con `toque`: la hora del toque. */
  salida: string | null;
  motivo: MotivoSinLlegada | null;
}

/**
 * GPS si lo hay; si no, el toque del chofer; si no, el motivo por el que el GPS no lo dio.
 * Lo que se guarda en `route_plan_stops` sigue la misma regla, y por eso la fuente se puede leer de vuelta sin
 * una columna más: `actual_arrival_at` SOLO lo escribe el GPS — llegada con valor = GPS; solo salida = toque.
 */
export function realesDelDia(paradas: readonly ParadaDelPlan[], posiciones: readonly Posicion[], sellos: readonly SellosDeOrden[], opciones: OpcionesDeLlegada = OPCIONES_POR_DEFECTO): RealDeParada[] {
  const sello = new Map(sellos.map((s) => [s.id, s]));
  return llegadasDeGPS(paradas, posiciones, opciones).map((g, k): RealDeParada => {
    const p = paradas[k];
    if (g.llegada) return { paradaId: p.id, fuente: "gps", llegada: g.llegada, salida: g.salida, motivo: null };
    const s = p.delivery_id ? sello.get(p.delivery_id) : undefined;
    const toque = p.kind === "P" ? s?.pickup_gps_at : s?.pod_delivered_at;
    if (toque && Number.isFinite(Date.parse(toque))) {
      const quien = p.kind === "P" ? s?.picked_up_by : s?.delivered_by;
      if (!quien || quien !== p.driver_id) return { paradaId: p.id, fuente: null, llegada: null, salida: null, motivo: "la_marco_otra_persona" };
      return { paradaId: p.id, fuente: "toque", llegada: null, salida: toque, motivo: null };
    }
    return { paradaId: p.id, fuente: null, llegada: null, salida: null, motivo: g.motivo };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// El reporte: primero cuánto dato hay, y de quién; después, el error — por fuente, nunca mezclado
// ---------------------------------------------------------------------------------------------------------------

export interface ErrorDeHora { n: number; medianaMin: number; p90AbsMin: number; sesgoMin: number; dentroDe15: number }
export const MINIMO_PARA_PERCENTILES = 8;

export interface ReporteDePrecision {
  paradas: number;
  /** Cuántas paradas tienen hora real, por fuente; y por qué no las demás. Las tres cifras suman `paradas`. */
  conGPS: number; conToque: number;
  sinDato: Record<MotivoSinLlegada, number>;
  /** LLEGADA real (GPS) − ETA. Minutos; positivo = llegó más tarde de lo estimado. `null` con menos de
   *  `MINIMO_PARA_PERCENTILES`: con tan pocas, un percentil es una anécdota. */
  llegadaPorGPS: ErrorDeHora | null;
  /** CIERRE real (el toque del chofer) − hora de salida estimada. Es OTRA medida: incluye lo que tardó el
   *  servicio y lo que tardó en tocar. No se suma ni se promedia con la de arriba. */
  cierrePorToque: ErrorDeHora | null;
  /** Por qué falta dato, del lado de la captura: de los choferes con ruta ese día, cuántos abrieron turno y
   *  cuántos mandaron alguna posición. El GPS solo existe con turno abierto Y desde la app instalada. */
  captura: { choferesConRuta: number; hanIniciadoSesion: number; conTurno: number; conPosiciones: number };
}

const percentil = (ordenados: readonly number[], q: number) => ordenados[Math.min(ordenados.length - 1, Math.max(0, Math.ceil(q * ordenados.length) - 1))];
function errorDe(errores: readonly number[]): ErrorDeHora | null {
  if (errores.length < MINIMO_PARA_PERCENTILES) return null;
  const ordenados = [...errores].sort((a, b) => a - b), absolutos = errores.map(Math.abs).sort((a, b) => a - b);
  return {
    n: errores.length, medianaMin: percentil(ordenados, 0.5), p90AbsMin: percentil(absolutos, 0.9),
    sesgoMin: Math.round((errores.reduce((s, x) => s + x, 0) / errores.length) * 10) / 10, dentroDe15: absolutos.filter((x) => x <= 15).length,
  };
}

/** `minutoLocal(iso)`: a qué minuto del día LOCAL de la ruta corresponde un instante. Lo da quien llama, que sabe la zona. */
export function reporteDePrecision(
  paradas: readonly ParadaDelPlan[], reales: readonly RealDeParada[], minutoLocal: (iso: string) => number,
  choferesConTurno: readonly string[], choferesConPosiciones: readonly string[], choferesConSesion: readonly string[],
): ReporteDePrecision {
  const de = new Map(reales.map((x) => [x.paradaId, x]));
  const sinDato: Record<MotivoSinLlegada, number> = { sin_chofer: 0, sin_punto: 0, sin_posiciones_ese_dia: 0, sin_posiciones_cerca: 0, la_marco_otra_persona: 0 };
  const porGPS: number[] = [], porToque: number[] = [];
  for (const p of paradas) {
    const x = de.get(p.id);
    if (x?.fuente === "gps" && x.llegada) porGPS.push(minutoLocal(x.llegada) - p.eta);
    else if (x?.fuente === "toque" && x.salida) porToque.push(minutoLocal(x.salida) - p.etd);
    else sinDato[x?.motivo ?? "sin_posiciones_ese_dia"]++;
  }
  const conRuta = new Set(paradas.map((p) => p.driver_id).filter((c): c is string => !!c));
  return {
    paradas: paradas.length, conGPS: porGPS.length, conToque: porToque.length, sinDato, llegadaPorGPS: errorDe(porGPS), cierrePorToque: errorDe(porToque),
    captura: { choferesConRuta: conRuta.size, hanIniciadoSesion: choferesConSesion.filter((c) => conRuta.has(c)).length, conTurno: choferesConTurno.filter((c) => conRuta.has(c)).length, conPosiciones: choferesConPosiciones.filter((c) => conRuta.has(c)).length },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Instantes a la hora LOCAL de la ruta. Sin librerías: `Intl` sabe de zonas y de horario de verano.
// ---------------------------------------------------------------------------------------------------------------

function partesEnZona(iso: string, zona: string): Record<string, string> {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return Object.fromEntries(f.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
}
/** A qué minuto del día local corresponde un instante: 08:30 → 510. */
export const minutoEnZona = (iso: string, zona: string): number => { const p = partesEnZona(iso, zona); return Number(p.hour) * 60 + Number(p.minute); };
/** A qué FECHA local corresponde un instante: las 23:30 de Texas ya son «mañana» en UTC, y no lo son para la ruta. */
export const fechaEnZona = (iso: string, zona: string): string => { const p = partesEnZona(iso, zona); return `${p.year}-${p.month}-${p.day}`; };

// ---------------------------------------------------------------------------------------------------------------
// De las filas de la base a lo de arriba
// ---------------------------------------------------------------------------------------------------------------

/** Los sellos de cada orden con QUIÉN los dejó: el autor del ÚLTIMO evento `picked_up` / `delivered` de la orden. */
export function sellosDeOrdenes(
  ordenes: readonly { id: string; pickup_gps_at: string | null; pod_delivered_at: string | null }[],
  eventos: readonly { delivery_id: string; kind: string; created_by: string | null; created_at: string }[],
): SellosDeOrden[] {
  const ultimo = new Map<string, { created_by: string | null; t: number }>();
  for (const e of eventos) {
    const k = `${e.delivery_id}|${e.kind}`, t = Date.parse(e.created_at);
    const ya = ultimo.get(k);
    if (!ya || t > ya.t) ultimo.set(k, { created_by: e.created_by, t });
  }
  return ordenes.map((o) => ({
    id: o.id, pickup_gps_at: o.pickup_gps_at, pod_delivered_at: o.pod_delivered_at,
    picked_up_by: ultimo.get(`${o.id}|picked_up`)?.created_by ?? null, delivered_by: ultimo.get(`${o.id}|delivered`)?.created_by ?? null,
  }));
}

/** Qué se escribe en `route_plan_stops`: SOLO las dos columnas `actual_*`, y solo donde hay dato. La llegada, solo de GPS. */
export function actualesParaGuardar(reales: readonly RealDeParada[]): { id: string; actual_arrival_at: string | null; actual_departure_at: string | null }[] {
  return reales.filter((r) => r.fuente !== null).map((r) => ({ id: r.paradaId, actual_arrival_at: r.fuente === "gps" ? r.llegada : null, actual_departure_at: r.salida }));
}

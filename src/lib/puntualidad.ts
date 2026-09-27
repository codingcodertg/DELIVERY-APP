import { parseWindow } from "./dispatch";
import { fechaEnZona, metrosEntre, minutoEnZona, sellosDeOrdenes, type Posicion } from "./route-plan/llegadas";
import { redondeaMillas } from "./totales";

/**
 * Informe de puntualidad por chofer, por rango de fechas (D-414). Es el «On-time performance» de OptimoRoute, hecho con
 * lo que la app YA guarda — sin migración, sin pedirle nada nuevo al chofer (D-021).
 *
 * Lo que decide, y conviene saber (mismas reglas de honestidad que `route-plan/llegadas.ts`, D-328):
 *   · **La hora real de una entrega** es, por este orden: la LLEGADA por GPS que guardó «¿Se cumplió el plan?» en el plan
 *     publicado de ese día (`route_plan_stops.actual_arrival_at`, solo la escribe el GPS); si no, el TOQUE «entregado» del
 *     chofer (`pod_delivered_at`), **solo si lo pulsó ese chofer** (`order_events.created_by`). Marcada por otra persona
 *     desde un escritorio no mide dónde estuvo el camión: es «sin dato», con su motivo. Nada se interpola.
 *   · **A tiempo** = la hora real no pasa del FIN de la ventana de la orden (`delivery_windows`, la primera, como en todo el
 *     Gestor), en la zona del negocio y el día de la entrega. Llegar antes de que abra cuenta como a tiempo y se cuenta
 *     aparte («antes de abrir»). Sin ventana, la entrega cuenta como entrega pero no entra en el porcentaje.
 *   · El toque es la hora de CERRAR (incluye la descarga), así que con toque una entrega puede salir tarde habiendo llegado
 *     a tiempo: es la medida conservadora. Por eso cada fila dice cuántas salen de GPS y cuántas del toque.
 *   · **Millas del plan**: la suma de `leg_miles` de las paradas del chofer en los planes PUBLICADOS del rango. Sin plan
 *     publicado, no hay: `null`, no cero. **Millas por GPS**: el rastro de `driver_locations` (solo con turno y desde el APK,
 *     D-328), con los huecos sin contar — nunca una recta entre dos puntos separados más de 20 min.
 *
 * Puro: sin base, sin red, sin reloj.
 */

export interface EntregaParaPuntualidad {
  id: string; stage: string; delivery_date: string | null; delivery_windows: string | null;
  assigned_driver: string | null; pod_delivered_at: string | null; is_training?: boolean | null;
}
export interface ParadaPublicada {
  plan_date: string; driver_id: string | null; delivery_id: string | null; kind: "P" | "D";
  actual_arrival_at: string | null; leg_miles: number | null;
}
export interface EventoDeEntrega { delivery_id: string; kind: string; created_by: string | null; created_at: string }

export type MotivoSinHora = "la_marco_otra_persona" | "sin_hora";

export interface FilaDePuntualidad {
  chofer: string;
  choferId: string | null;
  /** Entregadas en el rango. Las cifras de abajo salen de éstas. */
  entregas: number;
  /** Con hora real, por fuente; y sin ella, por qué. `conGPS + conToque + sinDato.*` = `entregas`. */
  conGPS: number; conToque: number;
  sinDato: Record<MotivoSinHora, number>;
  /** De las que tienen hora real: cuántas no tienen ventana (no entran en el porcentaje). */
  sinVentana: number;
  /** Las que se pueden juzgar: hora real Y ventana. `aTiempo + tarde` = `medidas`. */
  medidas: number; aTiempo: number; tarde: number;
  /** Dentro de `aTiempo`: las que llegaron (o cerraron) antes de que abriera la ventana. */
  antesDeAbrir: number;
  /** `aTiempo / medidas`, en %, sin decimales. `null` sin ninguna medida. */
  pctATiempo: number | null;
  /** Minutos de retraso, solo sobre las que llegaron tarde: la media y la peor. `null` si ninguna llegó tarde. */
  retrasoMedioMin: number | null; retrasoMaxMin: number | null;
  /** Suma de tramos de sus paradas en los planes publicados; `null` si no tuvo ninguno. */
  millasPlan: number | null; diasConPlan: number;
  /** Del rastro GPS; `null` si no hay rastro (o no se pidió). */
  millasGPS: number | null; diasConRastro: number;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Minutos que una hora real pasa del fin de la ventana, contando el día: entregar al día siguiente son 1440 más. */
export function minutosSobreElFin(realISO: string, fechaDeEntrega: string, finMin: number, zona: string): number {
  const dia = fechaEnZona(realISO, zona);
  const dias = Math.round((Date.parse(`${dia}T00:00:00Z`) - Date.parse(`${fechaDeEntrega}T00:00:00Z`)) / 86_400_000);
  return dias * 1440 + minutoEnZona(realISO, zona) - finMin;
}

/**
 * Millas del rastro GPS, por chofer, y en cuántos días locales hubo rastro. Posiciones peor que 100 m se ignoran. Un
 * salto de más de 20 min entre dos posiciones es un hueco: no se cuenta la recta. Y para que el temblor del GPS con el
 * camión parado no sume millas, solo se avanza cuando el punto se aleja 50 m o más del último punto contado.
 */
export const PRECISION_MAX_M = 100, HUECO_MAX_MIN = 20, PASO_MIN_M = 50;
export function millasDelRastro(posiciones: readonly Posicion[], zona: string): Map<string, { millas: number; dias: number }> {
  const porChofer = new Map<string, (Posicion & { t: number })[]>();
  for (const p of posiciones) {
    const t = Date.parse(p.recorded_at);
    if (!Number.isFinite(t) || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    if (p.accuracy_m != null && p.accuracy_m > PRECISION_MAX_M) continue;
    const l = porChofer.get(p.driver_id) ?? [];
    l.push({ ...p, t });
    porChofer.set(p.driver_id, l);
  }
  const r = new Map<string, { millas: number; dias: number }>();
  for (const [chofer, lista] of porChofer) {
    lista.sort((a, b) => a.t - b.t);
    let metros = 0;
    let ancla = lista[0], anterior = lista[0];
    const dias = new Set<string>();
    for (const p of lista) {
      dias.add(fechaEnZona(p.recorded_at, zona));
      if (p === lista[0]) continue;
      if (p.t - anterior.t > HUECO_MAX_MIN * 60_000) { ancla = p; anterior = p; continue; }
      const d = metrosEntre(ancla, p);
      if (d >= PASO_MIN_M) { metros += d; ancla = p; }
      anterior = p;
    }
    r.set(chofer, { millas: redondeaMillas(metros / 1609.344), dias: dias.size });
  }
  return r;
}

export interface EntradaDePuntualidad {
  entregas: readonly EntregaParaPuntualidad[];
  /** Los choferes (perfiles), para pasar de nombre a id: `assigned_driver` es el nombre. */
  choferes: readonly { id: string; full_name: string }[];
  /** Eventos `delivered` de esas órdenes: de ahí sale QUIÉN pulsó «entregado». */
  eventos: readonly EventoDeEntrega[];
  /** Paradas de los planes publicados del rango (vacío si no hay, o en el demo). */
  paradas: readonly ParadaPublicada[];
  /** Posiciones GPS del rango, o `null` si no se leyeron: entonces «Millas por GPS» sale `null`, no cero. */
  posiciones: readonly Posicion[] | null;
  zona: string;
}

/** Una fila por chofer con alguna entrega en el rango, ordenadas por nombre. */
export function puntualidadPorChofer(e: EntradaDePuntualidad): FilaDePuntualidad[] {
  const idDe = new Map(e.choferes.map((c) => [norm(c.full_name), c.id]));
  const nombreDeId = new Map(e.choferes.map((c) => [c.id, c.full_name]));
  const entregadas = e.entregas.filter((d) => d.stage === "delivered" && !d.is_training && norm(d.assigned_driver) && d.delivery_date);
  const quien = new Map(sellosDeOrdenes(entregadas.map((d) => ({ id: d.id, pickup_gps_at: null, pod_delivered_at: d.pod_delivered_at })), e.eventos).map((s) => [s.id, s.delivered_by]));

  // La llegada por GPS de cada orden, de la parada D de su plan publicado — y de SU chofer: si la orden cambió de manos
  // después de publicar, la llegada del otro camión no es la suya.
  const llegadaGPS = new Map<string, { t: number; iso: string; chofer: string | null }>();
  for (const p of e.paradas) {
    if (p.kind !== "D" || !p.delivery_id || !p.actual_arrival_at) continue;
    const t = Date.parse(p.actual_arrival_at);
    if (!Number.isFinite(t)) continue;
    const ya = llegadaGPS.get(p.delivery_id);
    if (!ya || t < ya.t) llegadaGPS.set(p.delivery_id, { t, iso: p.actual_arrival_at, chofer: p.driver_id });
  }

  type Acc = FilaDePuntualidad & { retrasos: number[] };
  const filas = new Map<string, Acc>();
  const filaDe = (nombre: string): Acc => {
    const k = norm(nombre);
    let f = filas.get(k);
    if (!f) {
      f = { chofer: nombre.trim(), choferId: idDe.get(k) ?? null, entregas: 0, conGPS: 0, conToque: 0, sinDato: { la_marco_otra_persona: 0, sin_hora: 0 },
        sinVentana: 0, medidas: 0, aTiempo: 0, tarde: 0, antesDeAbrir: 0, pctATiempo: null, retrasoMedioMin: null, retrasoMaxMin: null,
        millasPlan: null, diasConPlan: 0, millasGPS: null, diasConRastro: 0, retrasos: [] };
      filas.set(k, f);
    }
    return f;
  };

  for (const d of entregadas) {
    const f = filaDe(d.assigned_driver!);
    f.entregas++;
    let real: string | null = null;
    const gps = llegadaGPS.get(d.id);
    if (gps && (!gps.chofer || !f.choferId || gps.chofer === f.choferId)) { real = gps.iso; f.conGPS++; }
    else if (d.pod_delivered_at && Number.isFinite(Date.parse(d.pod_delivered_at))) {
      const marco = quien.get(d.id) ?? null;
      if (marco && f.choferId && marco === f.choferId) { real = d.pod_delivered_at; f.conToque++; }
      else f.sinDato.la_marco_otra_persona++;
    } else f.sinDato.sin_hora++;
    if (!real) continue;
    const ventana = parseWindow(d.delivery_windows);
    if (!ventana) { f.sinVentana++; continue; }
    f.medidas++;
    const sobre = minutosSobreElFin(real, d.delivery_date!, ventana[1], e.zona);
    if (sobre <= 0) {
      f.aTiempo++;
      if (minutosSobreElFin(real, d.delivery_date!, ventana[0], e.zona) < 0) f.antesDeAbrir++;
    } else { f.tarde++; f.retrasos.push(sobre); }
  }

  // Millas del plan: por chofer (id → nombre) y cuántos días distintos tuvo plan publicado.
  const plan = new Map<string, { millas: number; dias: Set<string> }>();
  for (const p of e.paradas) {
    if (!p.driver_id) continue;
    const a = plan.get(p.driver_id) ?? { millas: 0, dias: new Set<string>() };
    a.millas += Number(p.leg_miles ?? 0) || 0;
    a.dias.add(p.plan_date);
    plan.set(p.driver_id, a);
  }
  const rastro = e.posiciones ? millasDelRastro(e.posiciones, e.zona) : null;

  return [...filas.values()].map(({ retrasos, ...f }) => {
    const suyo = f.choferId ? plan.get(f.choferId) : undefined;
    const gps = f.choferId && rastro ? rastro.get(f.choferId) : undefined;
    return {
      ...f,
      pctATiempo: f.medidas ? Math.round((f.aTiempo / f.medidas) * 100) : null,
      retrasoMedioMin: retrasos.length ? Math.round(retrasos.reduce((s, x) => s + x, 0) / retrasos.length) : null,
      retrasoMaxMin: retrasos.length ? Math.max(...retrasos) : null,
      millasPlan: suyo ? redondeaMillas(suyo.millas) : null, diasConPlan: suyo?.dias.size ?? 0,
      millasGPS: rastro ? (gps?.millas ?? 0) : null, diasConRastro: gps?.dias ?? 0,
      chofer: f.chofer || (f.choferId ? nombreDeId.get(f.choferId) ?? "" : ""),
    };
  }).sort((a, b) => a.chofer.localeCompare(b.chofer));
}

/** El rango que se acepta: fechas `YYYY-MM-DD`, `desde <= hasta`, y como mucho 62 días (dos meses). */
export const DIAS_MAX_DEL_RANGO = 62;
export function rangoValido(desde: string, hasta: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return false;
  const a = Date.parse(`${desde}T00:00:00Z`), b = Date.parse(`${hasta}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) && a <= b && (b - a) / 86_400_000 < DIAS_MAX_DEL_RANGO;
}

/** Lee TODAS las filas de una consulta, de 1000 en 1000 (el tope por petición de PostgREST), hasta `tope` filas. */
export async function todasLasFilas<T>(pagina: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, tope = 50_000, tam = 1000): Promise<{ filas: T[]; error: string | null; cortado: boolean }> {
  const filas: T[] = [];
  for (let desde = 0; desde < tope; desde += tam) {
    const { data, error } = await pagina(desde, desde + tam - 1);
    if (error) return { filas, error: error.message, cortado: false };
    filas.push(...(data ?? []));
    if ((data ?? []).length < tam) return { filas, error: null, cortado: false };
  }
  return { filas, error: null, cortado: true };
}

/**
 * El RASTRO de un chofer en un día (D-907, «Reportes de choferes»): por dónde anduvo, con su hora.
 *
 * Dos fuentes, y se usa UNA por chofer y día — la mejor que haya, y la pantalla dice cuál:
 *   · `camion`: el historial del rastreador del camión que llevó ese día (TrackSolid, `jimi.device.track.list`). Un punto
 *     cada ~10 s mientras el camión se mueve, y silencio mientras está apagado: un hueco largo con el camión en el mismo
 *     sitio ES una parada, no un fallo.
 *   · `telefono`: las posiciones que manda el teléfono del chofer con el turno abierto (`driver_locations`). Un punto cada
 *     ~30 s; un hueco largo aquí es «no se sabe», no una parada.
 *
 * Puro: sin base, sin red, sin reloj y sin React (lo importan rutas del servidor).
 */

export type FuenteDeRastro = "camion" | "telefono";
/** `t` en milisegundos (época). `mph`, si la fuente la da. */
export interface PuntoDeRastro { t: number; lat: number; lng: number; mph?: number | null }
export interface Rastro { fuente: FuenteDeRastro; puntos: PuntoDeRastro[] }
export interface LatLng { lat: number; lng: number }

const RADIO_TIERRA_M = 6_371_000;
export const METROS_POR_MILLA = 1609.344;

export function metros(a: LatLng, b: LatLng): number {
  const r = (g: number) => (g * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Un salto que pide más que esto es una posición falsa (una antena, o la vieja de otro turno). */
export const MPH_IMPOSIBLE = 110;
/** Con menos puntos que esto, o menos rato, no hay rastro del que sacar nada. */
export const PUNTOS_MINIMOS = 20, MINUTOS_MINIMOS = 30;
/** Entre dos puntos del TELÉFONO separados más que esto no se sabe qué pasó. */
export const HUECO_MAX_MIN = 20;
/** El temblor del GPS con el vehículo parado no suma millas: solo se avanza al alejarse esto del último punto contado. */
export const PASO_MIN_M = 30;

/** Ordena por hora, quita repetidos, lo que no es un número y los saltos imposibles. */
export function limpiaRastro(puntos: readonly PuntoDeRastro[]): PuntoDeRastro[] {
  const buenos = puntos
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0))
    .slice().sort((a, b) => a.t - b.t);
  const out: PuntoDeRastro[] = [];
  for (const p of buenos) {
    const prev = out[out.length - 1];
    if (prev) {
      if (p.t === prev.t) continue;
      const d = metros(prev, p), h = (p.t - prev.t) / 3_600_000;
      if (d > 300 && d / METROS_POR_MILLA / h > MPH_IMPOSIBLE) continue;
    }
    out.push(p);
  }
  return out;
}

/** ¿Hay rastro del que sacar algo? */
export function rastroUtil(puntos: readonly PuntoDeRastro[]): boolean {
  return puntos.length >= PUNTOS_MINIMOS && puntos[puntos.length - 1].t - puntos[0].t >= MINUTOS_MINIMOS * 60_000;
}

/**
 * El rastro que se usa ese día: el del camión si lo hay y sirve; si no, el del teléfono; si no, ninguno.
 * El camión va primero porque no depende de que el chofer abra el turno ni de la batería del teléfono.
 */
export function eligeRastro(camion: readonly PuntoDeRastro[] | null | undefined, telefono: readonly PuntoDeRastro[] | null | undefined): Rastro | null {
  const c = limpiaRastro(camion ?? []);
  if (rastroUtil(c)) return { fuente: "camion", puntos: c };
  const f = limpiaRastro(telefono ?? []);
  if (rastroUtil(f)) return { fuente: "telefono", puntos: f };
  return null;
}

const enVentana = (puntos: readonly PuntoDeRastro[], desde?: number | null, hasta?: number | null) =>
  puntos.filter((p) => (desde == null || p.t >= desde) && (hasta == null || p.t <= hasta));

/** ¿Se cuenta el tramo entre dos puntos seguidos? No, si es un hueco del teléfono; el camión solo calla parado. */
function tramoConocido(r: Rastro, a: PuntoDeRastro, b: PuntoDeRastro): boolean {
  if (b.t - a.t <= HUECO_MAX_MIN * 60_000) return true;
  // Un hueco largo: con el camión vale si no se movió (estaba apagado); si apareció lejos, tampoco se sabe por dónde.
  return r.fuente === "camion" && metros(a, b) <= 500;
}

/** Millas manejadas según el rastro, entre dos instantes (o todo). Los tramos desconocidos no se cuentan como rectas. */
export function millasDelRastro(r: Rastro, desde?: number | null, hasta?: number | null): number {
  const ps = enVentana(r.puntos, desde, hasta);
  if (ps.length < 2) return 0;
  let m = 0, ancla = ps[0], anterior = ps[0];
  for (let i = 1; i < ps.length; i++) {
    const p = ps[i];
    if (!tramoConocido(r, anterior, p)) { ancla = p; anterior = p; continue; }
    const d = metros(ancla, p);
    if (d >= PASO_MIN_M) { m += d; ancla = p; }
    anterior = p;
  }
  return Math.round((m / METROS_POR_MILLA) * 10) / 10;
}

/** Minutos en MOVIMIENTO entre dos instantes: tramos de menos de 5 min en los que se avanzó a más de ~2 mph. */
export function minutosEnMovimiento(r: Rastro, desde?: number | null, hasta?: number | null): number {
  const ps = enVentana(r.puntos, desde, hasta);
  let ms = 0;
  for (let i = 1; i < ps.length; i++) {
    const dt = ps[i].t - ps[i - 1].t;
    if (dt <= 0 || dt > 5 * 60_000) continue;
    if (metros(ps[i - 1], ps[i]) / (dt / 1000) >= 1) ms += dt;
  }
  return Math.round(ms / 60_000);
}

/** Cuántos tramos del rastro son desconocidos (huecos): la medida de cuánto se puede fiar uno de las millas. */
export function huecosDelRastro(r: Rastro): number {
  let n = 0;
  for (let i = 1; i < r.puntos.length; i++) if (!tramoConocido(r, r.puntos[i - 1], r.puntos[i])) n++;
  return n;
}

/** Milisegundos del rastro que caen en tramos desconocidos. */
export function tiempoEnHuecos(r: Rastro): number {
  let ms = 0;
  for (let i = 1; i < r.puntos.length; i++) if (!tramoConocido(r, r.puntos[i - 1], r.puntos[i])) ms += r.puntos[i].t - r.puntos[i - 1].t;
  return ms;
}

/**
 * Dónde estaba a una hora, o `null` si el rastro no lo sabe. Entre dos puntos que no se movieron (100 m), estaba ahí
 * —aunque pasen horas: el camión apagado—. Si no, vale el punto más cercano en el tiempo a menos de 2 minutos.
 */
export function posicionEn(r: Rastro, t: number): LatLng | null {
  const ps = r.puntos;
  if (!ps.length) return null;
  let lo = 0, hi = ps.length - 1;
  if (t < ps[0].t) return ps[0].t - t <= 120_000 ? ps[0] : null;
  if (t > ps[hi].t) return t - ps[hi].t <= 120_000 ? ps[hi] : null;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ps[mid].t <= t) lo = mid; else hi = mid; }
  const a = ps[lo], b = ps[hi];
  if (a === b || metros(a, b) <= 100) return a;
  const cerca = t - a.t <= b.t - t ? a : b;
  return Math.abs(cerca.t - t) <= 120_000 ? cerca : null;
}

export interface Estancia { desde: number; hasta: number; lat: number; lng: number }
/** Quieto es no salir de este círculo… */
export const QUIETO_M = 60;
/** …durante al menos este rato. */
export const ESTANCIA_MIN_MIN = 5;

/** Los ratos en que el vehículo estuvo quieto (sin salir de 60 m durante 5 min o más). Un hueco del teléfono corta. */
export function estancias(r: Rastro, minMin = ESTANCIA_MIN_MIN): Estancia[] {
  const out: Estancia[] = [];
  const ps = r.puntos;
  let i = 0;
  while (i < ps.length) {
    let j = i;
    while (j + 1 < ps.length && metros(ps[i], ps[j + 1]) <= QUIETO_M && (r.fuente === "camion" || ps[j + 1].t - ps[j].t <= HUECO_MAX_MIN * 60_000)) j++;
    if (ps[j].t - ps[i].t >= minMin * 60_000) out.push({ desde: ps[i].t, hasta: ps[j].t, lat: ps[i].lat, lng: ps[i].lng });
    i = j > i ? j : i + 1;
  }
  return out;
}

/**
 * El rastro para el mapa: como mucho `max` puntos, en trozos. Un trozo se corta donde el tramo es desconocido, para que
 * el mapa no pinte una recta por donde nadie sabe si pasó el camión.
 */
export function trazosParaElMapa(r: Rastro, max = 1500): [number, number][][] {
  const paso = Math.max(1, Math.ceil(r.puntos.length / max));
  const trozos: [number, number][][] = [];
  let actual: [number, number][] = [];
  for (let i = 0; i < r.puntos.length; i++) {
    const p = r.puntos[i], prev = r.puntos[i - 1];
    const corta = !!prev && !tramoConocido(r, prev, p);
    if (corta) { if (actual.length > 1) trozos.push(actual); actual = []; }
    if (corta || i % paso === 0 || i === r.puntos.length - 1) actual.push([Math.round(p.lat * 1e5) / 1e5, Math.round(p.lng * 1e5) / 1e5]);
  }
  if (actual.length > 1) trozos.push(actual);
  return trozos;
}

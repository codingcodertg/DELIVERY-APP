import type { Fix } from "@/lib/track-history";
import { limpiaRastro, metros, METROS_POR_MILLA, rastroUtil, type PuntoDeRastro } from "@/lib/reportes-choferes/rastro";

// ============================================================
// La LÍNEA del día de un chofer en el mapa en vivo, sacada del rastreador de su camión (D-NEXT).
//
// El dueño, 2026-11-06, con la captura del Recorrido: «pero mira cómo salen». La línea de Julio se quedaba en su
// primera entrega y el camión estaba en otra ciudad, sin línea hasta él. Dos causas, medidas ese día:
//   · la línea salía solo del TELÉFONO (`driver_locations`), que calla cuando el chofer cierra la app, se queda sin
//     datos o termina sus órdenes — el de Julio mandó 475 posiciones y calló a las 9:35; su camión siguió hasta la tarde;
//   · y la lectura del día venía cortada a las primeras 1.000 filas (el tope por petición de PostgREST), entre todos
//     los choferes: a Ernesto y a Máximo se les acababa la línea a las 10:07. Eso se arregla en `recorrido-del-telefono`.
//
// La regla: el chofer que ese día lleva un camión con rastreador (el del día; si no, el habitual — `camionesDelDia`, la
// misma regla de la marca fundida, D-903) se dibuja con el rastro DEL CAMIÓN, entero. Sin rastreador, o si el rastro
// no se pudo leer o no sirve, se dibuja el del teléfono, como siempre. Nunca los dos encima.
//
// Puro: sin React, sin red, sin base y sin reloj (lo importan la ruta del servidor y las pantallas).
// ============================================================

/** Metros que puede apartarse la línea dibujada del rastro real (Douglas-Peucker). */
export const TOLERANCIA_M = 12;
/**
 * Aunque el camino sea una recta, se conserva un punto al menos cada tantos segundos (si el rastreador los mandó):
 * así quien lee la línea sigue distinguiendo «venía por aquí» de «no se sabe» (el hueco punteado de D-835 es más de
 * 2 minutos Y un cuarto de milla sin nada), y las paradas y los minutos manejados salen igual que con todos los puntos.
 */
export const SILENCIO_MAX_S = 90;

/** `[segundos de época, lat, lng]`: lo que viaja al navegador. */
export type PuntoEnLaRed = [number, number, number];

/** Un rastro de camión tal como lo manda `/api/tracksolid/trails`. */
export type RastroDeCamionEnLaRed = {
  driverId: string;
  imei: string;
  /** El nombre del camión (texto de TrackSolid: se pinta siempre como texto, nunca como HTML). */
  truck: string;
  /** Cuántos puntos GPS mandó el rastreador ese día (todos, no los de la línea simplificada). */
  points: number;
  /** Millas del día según TODOS los puntos. */
  miles: number;
  line: PuntoEnLaRed[];
};

/** Distancia (m) de `p` al segmento `a`–`b`, en un plano local: de sobra para tramos de pocas millas. */
function metrosAlSegmento(p: PuntoDeRastro, a: PuntoDeRastro, b: PuntoDeRastro): number {
  const kx = 111_320 * Math.cos((a.lat * Math.PI) / 180), ky = 110_540;
  const bx = (b.lng - a.lng) * kx, by = (b.lat - a.lat) * ky, px = (p.lng - a.lng) * kx, py = (p.lat - a.lat) * ky;
  const largo2 = bx * bx + by * by;
  const u = largo2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / largo2));
  return Math.hypot(px - u * bx, py - u * by);
}

/**
 * Menos puntos para la misma línea. Douglas-Peucker con `toleranciaM` (se quedan las curvas y se van los puntos de una
 * recta y el temblor del GPS con el camión parado), y después se devuelve un punto donde haría falta para que no
 * pasen más de `silencioMaxS` sin ninguno. El primero y el último se quedan siempre: la línea empieza donde arrancó
 * el camión y acaba donde está.
 */
export function simplificaRastro(puntos: readonly PuntoDeRastro[], opciones: { toleranciaM?: number; silencioMaxS?: number } = {}): PuntoDeRastro[] {
  const n = puntos.length;
  if (n <= 2) return [...puntos];
  const tolerancia = opciones.toleranciaM ?? TOLERANCIA_M, silencio = (opciones.silencioMaxS ?? SILENCIO_MAX_S) * 1000;
  const queda = new Uint8Array(n);
  queda[0] = 1; queda[n - 1] = 1;
  const pila: [number, number][] = [[0, n - 1]];   // sin recursión: un día son miles de puntos
  while (pila.length) {
    const [a, b] = pila.pop()!;
    let lejos = -1, max = tolerancia;
    for (let i = a + 1; i < b; i++) {
      const d = metrosAlSegmento(puntos[i], puntos[a], puntos[b]);
      if (d > max) { max = d; lejos = i; }
    }
    if (lejos < 0) continue;
    queda[lejos] = 1;
    pila.push([a, lejos], [lejos, b]);
  }
  let ultimo = puntos[0].t;
  for (let i = 1; i < n - 1; i++) {
    if (!queda[i] && puntos[i + 1].t - ultimo > silencio) queda[i] = 1;
    if (queda[i]) ultimo = puntos[i].t;
  }
  return puntos.filter((_, i) => queda[i] === 1);
}

/** Millas del rastro, sumando solo cuando el camión se apartó 30 m del último punto contado (el temblor no suma). */
export function millasDeLosPuntos(puntos: readonly PuntoDeRastro[]): number {
  let m = 0, ancla = puntos[0];
  for (const p of puntos) {
    const d = metros(ancla, p);
    if (d >= 30) { m += d; ancla = p; }
  }
  return Math.round((m / METROS_POR_MILLA) * 10) / 10;
}

const redondea5 = (n: number) => Math.round(n * 1e5) / 1e5;

/**
 * El rastro de un camión, listo para mandarlo: limpio (sin saltos imposibles), medido con todos sus puntos y con la
 * línea simplificada. `null` si no sirve para dibujar el día (menos de 20 puntos o de media hora — la misma vara que
 * los Reportes de choferes, `rastroUtil`): entonces la pantalla se queda con el teléfono.
 */
export function rastroParaElMapa(crudos: readonly PuntoDeRastro[]): { points: number; miles: number; line: PuntoEnLaRed[] } | null {
  const limpios = limpiaRastro(crudos);
  if (!rastroUtil(limpios)) return null;
  return {
    points: limpios.length,
    miles: millasDeLosPuntos(limpios),
    line: simplificaRastro(limpios).map((p) => [Math.round(p.t / 1000), redondea5(p.lat), redondea5(p.lng)]),
  };
}

/** Lo que llegó por la red, validado y en la forma que ya usan las pantallas (`Fix`). Lo que no sea un punto, fuera. */
export function fixesDeLaLinea(linea: unknown): Fix[] {
  if (!Array.isArray(linea)) return [];
  const out: Fix[] = [];
  for (const p of linea) {
    if (!Array.isArray(p) || p.length < 3) continue;
    const [t, lat, lng] = p as unknown[];
    if (typeof t !== "number" || typeof lat !== "number" || typeof lng !== "number") continue;
    if (!Number.isFinite(t) || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    out.push({ lat, lng, at: new Date(t * 1000).toISOString(), accuracy_m: null });
  }
  return out;
}

/** Un rastro ya leído de la respuesta de `/api/tracksolid/trails`. */
export type RastroLeido = { driverId: string; imei: string; camion: string; puntos: number; millas: number; fixes: Fix[] };

/** Lo que contestó la ruta, validado: lo que no tenga chofer, camión y al menos dos puntos, fuera. */
export function rastrosDeLaRespuesta(cuerpo: unknown): RastroLeido[] {
  const trails = (cuerpo as { trails?: unknown } | null)?.trails;
  if (!Array.isArray(trails)) return [];
  return (trails as (Partial<RastroDeCamionEnLaRed> | null)[]).flatMap((r) => {
    if (!r || typeof r.driverId !== "string" || typeof r.imei !== "string") return [];
    const fixes = fixesDeLaLinea(r.line);
    if (fixes.length < 2) return [];
    return [{
      driverId: r.driverId, imei: r.imei, camion: typeof r.truck === "string" && r.truck ? r.truck : r.imei,
      puntos: typeof r.points === "number" && Number.isFinite(r.points) ? r.points : fixes.length,
      millas: typeof r.miles === "number" && Number.isFinite(r.miles) ? r.miles : 0, fixes,
    }];
  });
}

export type FuenteDelRecorrido = "camion" | "telefono";
export type RecorridoElegido = { fuente: FuenteDelRecorrido; fixes: Fix[] };

/**
 * De dónde sale la línea de un chofer: del camión si hay rastro suyo (el servidor solo manda los que sirven); si no,
 * del teléfono. UNA de las dos, nunca las dos encima.
 */
export function eligeRecorrido(telefono: readonly Fix[] | null | undefined, camion: readonly Fix[] | null | undefined): RecorridoElegido {
  if (camion && camion.length >= 2) return { fuente: "camion", fixes: camion as Fix[] };
  return { fuente: "telefono", fixes: (telefono ?? []) as Fix[] };
}

const ms = (iso: string) => new Date(iso).getTime();

/** Dónde está el camión ahora (lo que ya trae la marca en vivo, D-903). */
export type CamionEnVivo = { lat: number | null; lng: number | null; posicionEn: string | null };

/** Cuántos puntos en vivo se guardan como mucho entre dos lecturas del rastro. */
export const COLA_MAX = 120;

/**
 * La COLA: entre una lectura del rastro y la siguiente (unos minutos), la posición en vivo del camión se va colgando
 * al final para que la línea llegue siempre hasta la marca. Devuelve la cola nueva: sin lo que el rastro ya alcanzó,
 * y con la posición en vivo si es más nueva que todo lo que hay. Si no cambia nada, devuelve la MISMA lista.
 */
export function colaConLoVivo(cola: readonly Fix[], rastro: readonly Fix[], vivo: CamionEnVivo | null | undefined): Fix[] {
  const finDelRastro = rastro.length ? ms(rastro[rastro.length - 1].at) : -Infinity;
  let out = cola.some((f) => ms(f.at) <= finDelRastro) ? cola.filter((f) => ms(f.at) > finDelRastro) : (cola as Fix[]);
  if (vivo && vivo.lat != null && vivo.lng != null && vivo.posicionEn && Number.isFinite(ms(vivo.posicionEn))) {
    const ultimo = out.length ? ms(out[out.length - 1].at) : finDelRastro;
    if (ms(vivo.posicionEn) > ultimo) out = [...out, { lat: vivo.lat, lng: vivo.lng, at: new Date(ms(vivo.posicionEn)).toISOString(), accuracy_m: null }].slice(-COLA_MAX);
  }
  return out;
}

/** «959 puntos del camión · 1054 posiciones del teléfono»: la cabecera dice qué cuenta. Lo que sea cero no sale. */
export function textoDelConteo(camion: number, telefono: number, t: (en: string, es: string) => string): string {
  const partes: string[] = [];
  if (camion > 0) partes.push(`${camion} ${t("truck GPS points", "puntos del GPS del camión")}`);
  if (telefono > 0 || camion === 0) partes.push(`${telefono} ${t("phone fixes", "posiciones del teléfono")}`);
  return partes.join(" · ");
}

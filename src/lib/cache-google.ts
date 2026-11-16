import { createHash } from "node:crypto";

// ============================================================
// Caché de las llamadas de pago a Google Maps Platform — las partes PURAS: cómo se
// normaliza una dirección, cómo se construye la clave de cada caché y cuándo un
// resultado sigue vigente. Sin red ni base de datos: la lectura/escritura vive en
// `cache-google-servidor.ts`.
//
// Regla general: una caché que falla (la tabla aún no existe, la base no responde)
// se comporta como si no existiera. Nunca rompe la respuesta de la ruta.
// ============================================================

const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;

/** Caché de lugares del mercado: 7 días, compartida por todos. */
export const TTL_PLACES_MS = 7 * DIA_MS;
/** Caché de rutas optimizadas: 60 minutos (el tráfico cambia). */
export const TTL_RUTA_OPT_MS = HORA_MS;
/** Caché de distancia entre dos direcciones: 30 días. */
export const TTL_DISTANCIA_MS = 30 * DIA_MS;

/** Clave de dirección: minúsculas, sin espacios sobrantes y con los espacios internos colapsados. */
export function claveDeDireccion(direccion: string): string {
  return direccion.trim().replace(/\s+/g, " ").toLowerCase();
}

/** SHA-256 en hexadecimal de un texto. Sirve para claves de longitud fija. */
export function hashClave(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

/** Clave de un par origen→destino (ordenado: A→B no es necesariamente igual que B→A). */
export function clavePorPar(origen: string, destino: string): string {
  return hashClave(`${claveDeDireccion(origen)}\n${claveDeDireccion(destino)}`);
}

/** Clave de la búsqueda de lugares de una categoría. Incluye las consultas y los centros: si cambian, la clave cambia. */
export function clavePlaces(
  categoria: string,
  consultas: readonly string[],
  centros: readonly (readonly [number, number])[],
): string {
  return hashClave(JSON.stringify([categoria, consultas, centros]));
}

/** Parada tal como entra en la optimización: id y coordenadas redondeadas a 5 decimales. */
export interface ParadaParaClave {
  id: string;
  lat: number;
  lng: number;
}

/** Hora (en horas desde 1970) en la que se mide el tráfico: la clave de ruta cambia cada hora. */
export function cubetaDeHora(ahora: number = Date.now()): number {
  return Math.floor(ahora / HORA_MS);
}

/** Clave de una optimización de ruta: paradas en orden, opciones, fecha y cubeta de hora. */
export function claveDeRuta(p: {
  paradas: readonly ParadaParaClave[];
  roundtrip: boolean;
  dateISO: string | null;
  trafficOptimal: boolean;
  optimize: boolean;
  cubeta: number;
}): string {
  const paradas = p.paradas.map((s) => [s.id, s.lat.toFixed(5), s.lng.toFixed(5)]);
  return hashClave(JSON.stringify([paradas, p.roundtrip, p.dateISO, p.trafficOptimal, p.optimize, p.cubeta]));
}

/**
 * ¿Sigue vigente una fila según su `created_at` (texto ISO de la base)? Una fecha que no se lee cuenta como caducada:
 * mejor pagar una llamada que servir un dato sin saber su edad.
 */
export function estaVigente(createdAtISO: string | null | undefined, ttlMs: number, ahora: number = Date.now()): boolean {
  if (!createdAtISO) return false;
  const t = Date.parse(createdAtISO);
  if (!Number.isFinite(t)) return false;
  return ahora - t < ttlMs;
}

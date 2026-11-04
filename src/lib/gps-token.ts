import { createHmac, timingSafeEqual } from "node:crypto";

// ============================================================
// D-838: la subida DIRECTA de posiciones desde la app Android (APK 7).
//
// Con el teléfono bloqueado Android congela la página de la app y las posiciones llegaban al servidor con 20+ minutos de
// retraso (medido el 2026-11-04: mediana 23 min). Ahora la parte nativa las sube sola a /api/gps/ingest. La página no
// está viva para renovar la sesión de Supabase, así que la subida va con una LLAVE DEL TURNO: firmada con un secreto del
// servidor, dice qué chofer es y hasta cuándo vale. Solo sirve para escribir posiciones de ese chofer.
// ============================================================

const secreto = (): string => process.env.GPS_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const firma = (payload: string, clave: string) => createHmac("sha256", clave).update(payload).digest("base64url");

/** Horas que vale una llave: un turno largo y algo más. La app pide otra cada vez que vuelve al frente. */
export const HORAS_DE_LA_LLAVE = 18;

export function firmaLlaveDeGps(driverId: string, ahoraMs = Date.now(), clave = secreto()): { token: string; expira: number } {
  if (!clave) throw new Error("Sin secreto para firmar la llave de GPS.");
  const expira = ahoraMs + HORAS_DE_LA_LLAVE * 3_600_000;
  const payload = b64(JSON.stringify({ d: driverId, e: expira }));
  return { token: `${payload}.${firma(payload, clave)}`, expira };
}

/** El chofer de una llave válida y vigente; null si está mal firmada, caducada o rota. */
export function verificaLlaveDeGps(token: string | null | undefined, ahoraMs = Date.now(), clave = secreto()): string | null {
  if (!token || !clave) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const esperada = Buffer.from(firma(payload, clave)), dada = Buffer.from(sig);
  if (esperada.length !== dada.length || !timingSafeEqual(esperada, dada)) return null;
  try {
    const { d, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { d?: unknown; e?: unknown };
    if (typeof d !== "string" || !d || typeof e !== "number" || e < ahoraMs) return null;
    return d;
  } catch { return null; }
}

export interface FilaDePosicion {
  driver_id: string; lat: number; lng: number; accuracy_m: number | null; speed_mps: number | null;
  heading: number | null; battery_pct: number | null; recorded_at: string;
}

/** Como mucho, posiciones por envío; la app manda lotes de 200. */
export const MAX_POR_ENVIO = 500;
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/**
 * Lo que la app manda → filas para `driver_locations`. Se queda solo con lo que tiene sentido: coordenadas válidas, una
 * precisión de GPS (≤ 65 m, como el filtro de la web, D-835), y una hora de captura ni del futuro ni de hace más de 3
 * días (una cola vieja que alguien encontró en un cajón no pinta un recorrido de la semana pasada).
 */
export function filasDeIngesta(driverId: string, body: unknown, ahoraMs = Date.now()): FilaDePosicion[] {
  const fixes = (body as { fixes?: unknown })?.fixes;
  if (!Array.isArray(fixes)) return [];
  const out: FilaDePosicion[] = [];
  for (const f of fixes.slice(0, MAX_POR_ENVIO)) {
    const o = f as Record<string, unknown>;
    const lat = num(o.lat), lng = num(o.lng);
    if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) continue;
    const acc = num(o.accuracy_m);
    if (acc != null && acc > 65) continue;
    const t = Date.parse(String(o.recorded_at ?? ""));
    if (!Number.isFinite(t) || t > ahoraMs + 5 * 60_000 || t < ahoraMs - 3 * 86_400_000) continue;
    const bat = num(o.battery_pct);
    out.push({
      driver_id: driverId, lat, lng, accuracy_m: acc, speed_mps: num(o.speed_mps), heading: num(o.heading),
      battery_pct: bat == null ? null : Math.max(0, Math.min(100, Math.round(bat))), recorded_at: new Date(t).toISOString(),
    });
  }
  return out;
}

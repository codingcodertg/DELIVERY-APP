import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Cliente de servicio CRUDO, SIN el wrapper de modo enseñanza (a diferencia de `createAdminClient`). El limitador NO
 * puede depender de la cookie de demo que el cliente controla: si pasara por ese wrapper, cualquiera podría poner la
 * cookie y apagar el limitador (p. ej. para martillar «olvidé mi contraseña»). Su contabilidad siempre llega a la base.
 */
function clienteDelLimitador() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (server env var).");
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * Limitador de peticiones por IP, respaldado en Postgres (RPC `check_rate_limit`, migración 282). Para las rutas `/api`
 * que gastan dinero (SMS, llamadas, geocodificación, mapas…) o son sensibles (olvidé mi contraseña, invitar, borrar).
 *
 * FAIL-OPEN a propósito: si la base falla, la migración 282 no está aplicada, o el modo enseñanza corta la escritura,
 * DEJA PASAR. Un corte del limitador no puede tumbar el app ni el login a las 7am; se registra en el log del servidor.
 *
 * El login en sí (`supabase.auth.signInWithPassword`) va del navegador DIRECTO a Supabase Auth, que ya lo limita de su
 * lado; no se puede interceptar aquí, así que no se cubre desde la app.
 */

/** La IP del cliente, del primer salto de `x-forwarded-for` (lo que pone Vercel), con respaldo `x-real-ip`. */
export function ipDe(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const primero = xff.split(",")[0]?.trim();
    if (primero) return primero;
  }
  return req.headers.get("x-real-ip")?.trim() || "ip-desconocida";
}

export interface OpcionesLimite {
  /** Etiqueta de la ruta (p. ej. "notify"); se combina con la IP para el cubo. */
  clave: string;
  /** Máximo de peticiones permitidas por ventana. */
  max: number;
  /** Tamaño de la ventana, en segundos. */
  ventanaSeg: number;
}

/**
 * ¿Esta petición pasa el límite? `{ ok: true }` si cabe (o si el limitador no pudo medir: fail-open); `{ ok: false,
 * reset }` cuando se pasó, con el epoch (segundos) en que se reinicia la ventana.
 */
export async function limita(req: Request, opts: OpcionesLimite): Promise<{ ok: true } | { ok: false; reset: number }> {
  const bucket = `${opts.clave}:${ipDe(req)}`;
  try {
    const admin = clienteDelLimitador();
    const { data, error } = await admin.rpc("check_rate_limit", {
      p_bucket: bucket,
      p_max: opts.max,
      p_window_seconds: opts.ventanaSeg,
    });
    if (error) {
      console.error("[rate-limit] no se pudo medir, se deja pasar:", error.code ?? error.message);
      return { ok: true };
    }
    const r = data as { allowed?: boolean; reset?: number } | null;
    if (r && r.allowed === false) {
      const reset = Number(r.reset);
      return { ok: false, reset: Number.isFinite(reset) ? reset : Math.floor(Date.now() / 1000) + opts.ventanaSeg };
    }
    return { ok: true };
  } catch (e) {
    console.error("[rate-limit] excepción, se deja pasar:", (e as Error).message);
    return { ok: true };
  }
}

/** Respuesta 429 estándar, con `Retry-After` en segundos. `reset` es el epoch (segundos) en que se libera. */
export function respuesta429(reset: number): Response {
  const segundos = Math.max(1, Math.ceil(reset - Date.now() / 1000));
  return new Response(JSON.stringify({ error: "Too many requests", retryAfter: segundos }), {
    status: 429,
    headers: { "content-type": "application/json", "Retry-After": String(segundos) },
  });
}

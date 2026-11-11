/**
 * CSRF — chequeo de Origen para las rutas `/api` que cambian algo y van con la cookie de sesión (D-969, revisión de
 * seguridad #16). La app usa auth por cookie de Supabase; hasta ahora la única defensa era `SameSite=Lax`. Esto añade,
 * como defensa en profundidad, que una petición mutante (POST/PUT/PATCH/DELETE) hecha CON la cookie de sesión venga del
 * MISMO origen que el sitio.
 *
 * Por qué mirar la cookie: un ataque CSRF funciona montándose en la cookie de la víctima, así que la petición forjada
 * SIEMPRE trae la cookie → se revisa y, si viene de otro origen, se rechaza. En cambio lo que NO trae esa cookie
 * —los cron/servidor (bearer `CRON_SECRET`), los endpoints públicos por token (avisos al cliente, tracking), las
 * descargas— no se toca: no hay nada que forjar sin sesión. Así no hace falta una lista de rutas exentas que se quede
 * vieja. Las GET nunca se tocan.
 *
 * Puro y sin red: se puede probar con un `Request` normal.
 */

const METODOS_MUTANTES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** ¿Es una ruta `/api` (en cualquier nivel: /api, /timetracker/api, /timetracker/clock-in/api) con método que cambia algo? */
export function esApiMutante(metodo: string | null | undefined, pathname: string): boolean {
  return METODOS_MUTANTES.has((metodo || "GET").toUpperCase()) && /(^|\/)api\//.test(pathname);
}

/** ¿La petición trae la cookie de sesión de Supabase (`sb-<ref>-auth-token`, que puede venir troceada)? */
export function traeCookieDeSesion(cookies: readonly { name: string }[]): boolean {
  return cookies.some((c) => /^sb-.*auth-token/i.test(c.name));
}

/** El origen propio del despliegue, a partir de las cabeceras que pone Vercel. `null` si no se puede saber. */
export function origenPropio(req: Request): string | null {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return null;
  const proto = (req.headers.get("x-forwarded-proto") ?? "https").split(",")[0].trim();
  return `${proto}://${host}`;
}

function origenDe(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).origin; } catch { return null; }
}

/**
 * ¿El origen de la petición es ACEPTABLE? Regla CSRF segura estándar:
 *  - `Origin` presente (o, en su defecto, el origen del `Referer`) que NO coincide con el del sitio → NO (ataque): se bloquea.
 *  - presente y coincide → sí.
 *  - AMBOS ausentes → SÍ (se permite). Un navegador SIEMPRE manda `Origin` en un POST cross-site, así que un CSRF real
 *    siempre trae un `Origin` (que no cuadra) y se bloquea igual; en cambio los llamadores nativos/propios que omiten
 *    `Origin` (el plugin de GPS en segundo plano de Capacitor, algún caso de Electron, servidor-a-servidor) NO se rompen.
 */
export function mismoOrigen(req: Request): boolean {
  const origen = req.headers.get("origin") ?? origenDe(req.headers.get("referer"));
  if (!origen) return true; // ni Origin ni Referer: no es un CSRF de navegador; se permite (no rompe el GPS nativo)
  const propio = origenPropio(req);
  if (!propio) return true; // no podemos saber nuestro propio origen: no bloqueamos a ciegas
  return origen === propio;
}

/** La respuesta 403 cuando el origen no cuadra. */
export function respuestaCsrf(): Response {
  return new Response(JSON.stringify({ error: "bad origin" }), { status: 403, headers: { "content-type": "application/json" } });
}

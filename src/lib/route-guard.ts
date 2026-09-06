import { safeNext } from "@/lib/auth-redirect";

// ============================================================
// El guard de rutas del middleware, como función pura (G-29, D-208).
//
// `updateSession` (lib/supabase/middleware.ts) estaba escrito desde D-119 y nadie lo llamaba:
// `src/middleware.ts` solo refrescaba la sesión. Al conectarlo, la parte que decide —qué se sirve,
// qué rebota a /login y con qué `next`, y a dónde va quien ya entró y pisa el login— se saca
// aquí, sin Supabase ni `NextRequest`, para que se pueda probar como una tabla: ruta × sesión →
// resultado. Lo que queda en el middleware es solo leer la cookie y aplicar la decisión.
// ============================================================

export type Decision =
  | { kind: "next" }
  | { kind: "redirect"; to: string };

/**
 * Rutas que se autentican solas, por secreto o bearer, o que no llevan sesión: `/api/*`,
 * `/timetracker/api/*`, `/timetracker/clock-in/api/*`. Se busca el segmento en cualquier
 * posición porque van anidadas. Medido contra `find src/app -name route.ts`: las 31 rutas de
 * datos caen aquí o bajo `/auth` (callback y signout, que son públicas por su prefijo).
 */
export function isApiPath(path: string): boolean {
  return path.includes("/api/");
}

/**
 * Un fichero servido tal cual desde `public/` (o cualquier ruta cuyo último segmento lleva
 * extensión). La regla es la extensión y no una lista, porque la lista se queda vieja: hoy
 * `isPublicPath` cubría el manifest y el favicon pero no `clockin-sw.js`, y un service worker
 * que rebota a /login es un service worker que nunca se instala. Ninguna página de la app
 * tiene un punto en su último segmento (los ids son números o uuids sin punto).
 */
export function isStaticFile(path: string): boolean {
  const last = path.slice(path.lastIndexOf("/") + 1);
  // Hasta 12 letras de extensión: `.webmanifest` tiene 11.
  return /\.[a-z0-9]{1,12}$/i.test(last);
}

/**
 * Lo que se sirve sin sesión (D-156, ampliado): el login, el intercambio de OAuth y la salida
 * (`/auth/*`), el restablecimiento de contraseña (se llega desde un correo, sin sesión),
 * `/no-access` (donde aterriza quien SÍ entró pero no tiene módulo: mandarlo al login sería un
 * bucle), `/track/:id` (el enlace que se manda al cliente por SMS: no tiene cuenta), los
 * internos de Next, el túnel de Sentry, los ficheros estáticos y las rutas de datos.
 */
export function isPublicPath(path: string): boolean {
  return path === "/login" || path.startsWith("/login/")
    || path === "/auth" || path.startsWith("/auth/")
    || path === "/reset-password" || path.startsWith("/reset-password/")
    || path === "/no-access"
    || path === "/track" || path.startsWith("/track/")
    || path.startsWith("/_next")
    || path === "/monitoring" || path.startsWith("/monitoring/")
    || isStaticFile(path)
    || isApiPath(path);
}

/**
 * Rutas por las que el middleware NO debe ni preguntar por la sesión: no renderizan listas,
 * algunas se autentican con un secreto (los crons de Vercel y el de GitHub), y cobrarles una
 * llamada al servidor de auth por petición sería latencia por nada. La cookie que leerían es la
 * que acaba de refrescar la petición de página que las precede. (Era el salto de `/api/` de
 * `refreshSession`, ampliado a los ficheros estáticos.)
 */
export function skipsSession(path: string): boolean {
  return isApiPath(path) || isStaticFile(path) || path.startsWith("/_next") || path === "/monitoring" || path.startsWith("/monitoring/");
}

/**
 * La decisión, dada la ruta (con su query), el `?next=` y si hay sesión.
 *
 * Orden, y por qué: primero "ya dentro y pisando el login", porque `/login` ESTÁ en la lista de
 * públicas (tiene que estarlo) y con el orden al revés quien ya entró se quedaría mirando un
 * formulario que no necesita. Después lo público, tal cual. Después, sin sesión, al login
 * recordando a dónde iba —ruta Y query, para que `/erp/review?issue=X` vuelva a `?issue=X`— en
 * `next`; importa sobre todo en el escritorio de Time Tracker (D-076), que no tiene barra de
 * direcciones. El `next` de vuelta pasa por `safeNext` (D-193): solo una ruta interna, nada de
 * `//evil.com`, `/\evil.com`, caracteres de control ni un salto al propio login.
 */
export function decide(pathWithSearch: string, next: string | null, hasUser: boolean): Decision {
  const q = pathWithSearch.indexOf("?");
  const path = q === -1 ? pathWithSearch : pathWithSearch.slice(0, q);

  if (hasUser && (path === "/login" || path.startsWith("/login/"))) {
    return { kind: "redirect", to: safeNext(next, "/home") };
  }
  if (isPublicPath(path)) return { kind: "next" };
  if (!hasUser) {
    return { kind: "redirect", to: "/login?next=" + encodeURIComponent(pathWithSearch) };
  }
  return { kind: "next" };
}

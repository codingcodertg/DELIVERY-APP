import { esSlugDeTarjeta } from "@/lib/tarjetas/slug";

/**
 * El dominio público de las tarjetas (NFC). Es el ÚNICO sitio donde vive el nombre; el middleware, la
 * página, el panel y los enlaces lo leen de aquí.
 */
export const HOST_DE_TARJETAS = "businesscard.rdztilegroup.com";
export const ORIGEN_DE_TARJETAS = `https://${HOST_DE_TARJETAS}`;

/** Página que se sirve (con 404) para todo lo que el dominio de tarjetas no debe enseñar. */
export const RUTA_404_DE_TARJETAS = "/tarjeta/no-encontrada";

/** ¿Es la petición del dominio de tarjetas? Sin puerto, en minúsculas, sin el punto final del FQDN. */
export function esHostDeTarjetas(host: string | null | undefined): boolean {
  if (!host) return false;
  const limpio = host.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  return limpio === HOST_DE_TARJETAS;
}

export type RutaEnHostDeTarjetas =
  | { kind: "pasa" }
  | { kind: "reescribe"; to: string }
  | { kind: "no-encontrada" };

/**
 * Qué hace el middleware con una ruta del dominio de tarjetas. Solo tres cosas se sirven:
 *   - `/<slug>` → la tarjeta de esa persona (reescrita a `/tarjeta/<slug>`);
 *   - `/editar` → el editor de la foto (reescrito a `/tarjeta/editar`, con su `?token=`);
 *   - los ficheros de la página (`/_next/`, `/tarjetas/`) y las rutas de API de tarjetas (`/api/tarjetas/`).
 * Todo lo demás —`/`, el login, el hub, la API del hub, cualquier otra cosa— va a la 404 de tarjetas.
 */
export function rutaEnHostDeTarjetas(pathname: string): RutaEnHostDeTarjetas {
  if (pathname.startsWith("/_next/") || pathname.startsWith("/tarjetas/")) return { kind: "pasa" };
  if (pathname.startsWith("/api/tarjetas/")) return { kind: "pasa" };
  if (pathname === "/editar") return { kind: "reescribe", to: "/tarjeta/editar" };
  const m = /^\/([^/]+)$/.exec(pathname);
  if (m && esSlugDeTarjeta(m[1])) return { kind: "reescribe", to: `/tarjeta/${m[1]}` };
  return { kind: "no-encontrada" };
}

/**
 * El guion que corre antes de pintar (lo pone el layout raíz en el `<head>`, como el del tema): marca el
 * `<html>` para que el CSS esconda las burbujas y avisos del hub. Se genera del nombre del host, no se escribe a mano.
 */
export const GUION_DE_HOST_DE_TARJETAS =
  `(function(){try{if(location.hostname.toLowerCase()===${JSON.stringify(HOST_DE_TARJETAS)})document.documentElement.setAttribute("data-tarjetas","")}catch(e){}})();`;

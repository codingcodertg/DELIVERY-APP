/**
 * A dónde volver después de entrar (D-193).
 *
 * El `?next=` lo escribe el middleware al mandar al login a quien no tiene sesión, y también
 * viaja en el enlace de restablecer contraseña (`/auth/callback?next=/reset-password`). Como
 * llega por URL, cualquiera puede escribir lo que quiera ahí: se acepta SOLO una ruta interna.
 * `//evil.com` cuenta como externa para el navegador aunque empiece por barra; `/login` sería
 * un bucle. Todo lo demás cae a `fallback`.
 *
 * Caracteres de control: el analizador de URL (WHATWG, el de `new URL()` en Node y en el
 * navegador) ELIMINA tabuladores y saltos de línea de cualquier posición antes de resolver, así
 * que `/\t/evil.com` pasaría las comprobaciones de arriba y acabaría en `//evil.com`, o sea,
 * fuera del sitio. El auditor lo reprodujo con `?next=/%09/evil.com` (D-193). Ningún carácter
 * de control tiene uso legítimo en un `next`: cualquiera lo tumba, no solo los tres conocidos.
 */
export function safeNext(next: string | null | undefined, fallback = "/home"): string {
  if (!next) return fallback;
  const n = next.trim();
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(n)) return fallback;
  if (!n.startsWith("/") || n.startsWith("//") || n.startsWith("/\\")) return fallback;
  if (n === "/login" || n.startsWith("/login/") || n.startsWith("/login?")) return fallback;
  return n;
}

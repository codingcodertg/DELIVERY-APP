/**
 * A dónde volver después de entrar (D-NEXT).
 *
 * El `?next=` lo escribe el middleware al mandar al login a quien no tiene sesión, y también
 * viaja en el enlace de restablecer contraseña (`/auth/callback?next=/reset-password`). Como
 * llega por URL, cualquiera puede escribir lo que quiera ahí: se acepta SOLO una ruta interna.
 * `//evil.com` cuenta como externa para el navegador aunque empiece por barra; `/login` sería
 * un bucle. Todo lo demás cae a `fallback`.
 */
export function safeNext(next: string | null | undefined, fallback = "/home"): string {
  if (!next) return fallback;
  const n = next.trim();
  if (!n.startsWith("/") || n.startsWith("//") || n.startsWith("/\\")) return fallback;
  if (n === "/login" || n.startsWith("/login/") || n.startsWith("/login?")) return fallback;
  if (/[\r\n]/.test(n)) return fallback;
  return n;
}

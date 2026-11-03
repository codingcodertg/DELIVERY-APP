import { COOKIE_DISPOSITIVO, DIAS_DE_COOKIE, idDeDispositivoValido } from "./reglas";

/**
 * El id del dispositivo en el navegador (D-811): nace una vez (`crypto.randomUUID()`), vive en `localStorage` y se
 * copia a una cookie para que el middleware lo lea en cada navegación. La app de escritorio y el Chrome de la misma
 * máquina tienen almacenes distintos: son dos dispositivos, y eso es lo que el dueño quiere («solo usen el desktop
 * app»).
 *
 * Lo que NO es: una prueba criptográfica. Quien copie la cookie de una máquina aprobada a otra se hace pasar por ella.
 * El modelo de amenaza del dueño es «que no entren desde su casa», no un atacante con acceso a la máquina de la tienda;
 * y la lista de Security dice quién entró desde dónde, que es lo que delata una copia.
 */
export function idDelDispositivo(w: { localStorage?: Storage; document?: { cookie: string }; crypto?: { randomUUID?: () => string } } | null | undefined): string | null {
  if (!w) return null;
  let id: string | null = null;
  try { id = w.localStorage?.getItem(COOKIE_DISPOSITIVO) ?? null; } catch { /* sin almacén: se sigue con la cookie */ }
  if (!idDeDispositivoValido(id)) id = leeCookie(w.document?.cookie ?? "");
  if (!idDeDispositivoValido(id)) {
    const nuevo = w.crypto?.randomUUID?.();
    if (!nuevo) return null;
    id = nuevo;
  }
  try { w.localStorage?.setItem(COOKIE_DISPOSITIVO, id); } catch { /* idem */ }
  if (w.document) w.document.cookie = `${COOKIE_DISPOSITIVO}=${id}; Max-Age=${DIAS_DE_COOKIE * 86400}; Path=/; SameSite=Lax`;
  return id;
}

export function leeCookie(cookie: string): string | null {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE_DISPOSITIVO}=([^;]+)`).exec(cookie);
  return m ? decodeURIComponent(m[1]) : null;
}

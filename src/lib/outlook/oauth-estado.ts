/**
 * La cookie de ida y vuelta de la conexión: `state`, verificador PKCE, quién la empezó y cuándo caduca. Va CIFRADA con la
 * llave de Outlook (AES-GCM con su propio `aad`), así un cliente no puede ni leerla ni cambiarla. PURO.
 */
import { descifrar } from "./cifrado";

export const COOKIE_OAUTH = "outlook_oauth";
export const AAD_OAUTH = "outlook:oauth-state";
const VIDA_MS = 10 * 60 * 1000;

export interface EstadoOauth {
  state: string;
  verifier: string;
  userId: string;
  exp: number;
}

export function payloadOauth(p: { state: string; verifier: string; userId: string; ahora: Date }): EstadoOauth {
  return { state: p.state, verifier: p.verifier, userId: p.userId, exp: p.ahora.getTime() + VIDA_MS };
}

export function opcionesCookieOauth(maxAgeSeg: number) {
  return { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/api/outlook", maxAge: maxAgeSeg };
}

/** Lee la cookie; null si no descifra, está caducada o no tiene la forma esperada. Nunca lanza. */
export function leerEstadoOauth(valor: string | undefined, clave: Buffer, ahora: Date): EstadoOauth | null {
  if (!valor) return null;
  try {
    const e = JSON.parse(descifrar(valor, clave, AAD_OAUTH)) as Partial<EstadoOauth>;
    if (typeof e.state !== "string" || typeof e.verifier !== "string" || typeof e.userId !== "string" || typeof e.exp !== "number") return null;
    if (e.exp < ahora.getTime()) return null;
    return e as EstadoOauth;
  } catch {
    return null;
  }
}

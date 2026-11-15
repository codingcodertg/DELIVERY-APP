/**
 * OAuth 2.0 con Microsoft (código de autorización + PKCE, permisos delegados). SOLO SERVIDOR: usa el secreto del cliente.
 *
 * Nada de este fichero escribe tokens en un log ni en un error: los errores llevan el código de Microsoft (AADSTS…),
 * nunca el cuerpo de la respuesta, porque ahí puede venir un token.
 */
import { createHash, randomBytes } from "node:crypto";
import { SCOPES_OUTLOOK } from "./config";
import type { ClaveErrorOutlook } from "./mensajes";

export const GRAPH = "https://graph.microsoft.com/v1.0";

export function urlDeAutorizacion(p: {
  tenant: string;
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const u = new URL(`https://login.microsoftonline.com/${encodeURIComponent(p.tenant)}/oauth2/v2.0/authorize`);
  u.search = new URLSearchParams({
    client_id: p.clientId,
    response_type: "code",
    redirect_uri: p.redirectUri,
    response_mode: "query",
    scope: SCOPES_OUTLOOK,
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return u.toString();
}

/** Un par verificador/desafío PKCE (RFC 7636): el verificador tiene 43 caracteres, el desafío es su SHA-256 en base64url. */
export function generarPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function generarState(): string {
  return randomBytes(16).toString("base64url");
}

/** Error de Microsoft ya sin tokens: `codigo` es lo que vino (AADSTS65001, invalid_grant…), nada más. */
export class ErrorMicrosoft extends Error {
  constructor(
    public readonly paso: "token" | "refresh" | "me" | "correo",
    public readonly codigo: string,
  ) {
    super(`Microsoft (${paso}): ${codigo}`);
    this.name = "ErrorMicrosoft";
  }
}

type FetchFn = typeof fetch;

/** Lee `error` y el primer código AADSTS de la respuesta de error, sin devolver nada más. */
async function codigoDeError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string; error_description?: string };
    const aad = /AADSTS\d+/.exec(j.error_description ?? "");
    return aad ? aad[0] : (j.error ?? `HTTP ${res.status}`);
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function intercambiarCodigo(
  p: { tenant: string; clientId: string; clientSecret: string; code: string; verifier: string; redirectUri: string },
  fetchFn: FetchFn = fetch,
): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await fetchFn(`https://login.microsoftonline.com/${encodeURIComponent(p.tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: p.clientId,
      client_secret: p.clientSecret,
      grant_type: "authorization_code",
      code: p.code,
      code_verifier: p.verifier,
      redirect_uri: p.redirectUri,
      scope: SCOPES_OUTLOOK,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new ErrorMicrosoft("token", await codigoDeError(res));
  const j = (await res.json()) as { access_token?: string; refresh_token?: string };
  if (!j.access_token || !j.refresh_token) throw new ErrorMicrosoft("token", "sin_refresh_token");
  return { accessToken: j.access_token, refreshToken: j.refresh_token };
}

/** Pide un access token nuevo. Microsoft puede rotar el refresh token: si trae uno nuevo, hay que guardarlo cifrado. */
export async function refrescarAcceso(
  p: { tenant: string; clientId: string; clientSecret: string; refreshToken: string },
  fetchFn: FetchFn = fetch,
): Promise<{ accessToken: string; refreshToken: string | null }> {
  const res = await fetchFn(`https://login.microsoftonline.com/${encodeURIComponent(p.tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: p.clientId,
      client_secret: p.clientSecret,
      grant_type: "refresh_token",
      refresh_token: p.refreshToken,
      scope: SCOPES_OUTLOOK,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new ErrorMicrosoft("refresh", await codigoDeError(res));
  const j = (await res.json()) as { access_token?: string; refresh_token?: string };
  if (!j.access_token) throw new ErrorMicrosoft("refresh", "sin_access_token");
  return { accessToken: j.access_token, refreshToken: j.refresh_token ?? null };
}

/** La dirección del buzón conectado (`mail`, o el UPN si no hay correo). */
export async function buzonConectado(accessToken: string, fetchFn: FetchFn = fetch): Promise<string> {
  const res = await fetchFn(`${GRAPH}/me?$select=mail,userPrincipalName`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) throw new ErrorMicrosoft("me", `HTTP ${res.status}`);
  const j = (await res.json()) as { mail?: string | null; userPrincipalName?: string | null };
  const correo = (j.mail ?? j.userPrincipalName ?? "").trim();
  if (!correo) throw new ErrorMicrosoft("me", "sin_correo");
  return correo.toLowerCase();
}

/** Traduce el error de Microsoft (`error=` o el código AADSTS) a una clave de `MENSAJES_OUTLOOK`. */
export function claveDeErrorMicrosoft(error: string | null | undefined, descripcion?: string | null): ClaveErrorOutlook {
  const texto = `${error ?? ""} ${descripcion ?? ""}`;
  // 65001: el consentimiento no está concedido (la organización lo bloquea). 90094: lo exige un admin.
  if (/AADSTS65001|AADSTS90094|admin_consent|admin approval|requires admin/i.test(texto)) return "consentimiento-bloqueado";
  // 65004: la persona lo rechazó en la pantalla de permisos. access_denied sin más: también cancelación.
  if (/AADSTS65004|access_denied/i.test(texto)) return "cancelado";
  return "microsoft";
}

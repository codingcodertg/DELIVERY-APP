import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { origenPublico } from "@/lib/avisos-cliente-envio";
import { createAdminClient } from "@/lib/supabase/admin";
import { cifrar, claveDelEntorno } from "@/lib/outlook/cifrado";
import { VENTANA_INICIAL_MS } from "@/lib/outlook/config";
import { COOKIE_OAUTH, leerEstadoOauth, opcionesCookieOauth } from "@/lib/outlook/oauth-estado";
import { buzonConectado, claveDeErrorMicrosoft, ErrorMicrosoft, intercambiarCodigo } from "@/lib/outlook/microsoft";
import { requireAdminOutlook } from "@/lib/outlook/acceso";

export const dynamic = "force-dynamic";

/**
 * Vuelta de Microsoft. Verifica el `state` contra la cookie, canjea el código con el verificador PKCE, lee el buzón y
 * guarda el refresh token CIFRADO. Nunca devuelve tokens: solo redirige a Ajustes con `?outlook=ok` o `?outlook_error=…`.
 */
export async function GET(req: Request) {
  const origen = origenPublico(req.url);
  const url = new URL(req.url);
  const volver = (codigo: string) => {
    const res = NextResponse.redirect(`${origen}/recruiting/settings?outlook_error=${codigo}`, 302);
    res.cookies.set(COOKIE_OAUTH, "", opcionesCookieOauth(0));
    return res;
  };

  const errorMs = url.searchParams.get("error");
  if (errorMs) return volver(claveDeErrorMicrosoft(errorMs, url.searchParams.get("error_description")));

  const acceso = await requireAdminOutlook();
  if (!acceso.ok) return volver(acceso.codigo === "no-admin" ? "no-admin" : "sin-sesion");

  let clave: Buffer;
  try {
    clave = claveDelEntorno(process.env);
  } catch {
    return volver("faltan-variables");
  }
  const estado = leerEstadoOauth((await cookies()).get(COOKIE_OAUTH)?.value, clave, new Date());
  if (!estado || estado.userId !== acceso.userId || estado.state !== url.searchParams.get("state")) {
    return volver("estado-invalido");
  }
  const code = url.searchParams.get("code");
  if (!code) return volver("microsoft");

  const credenciales = {
    tenant: process.env.MS_TENANT_ID as string,
    clientId: process.env.MS_CLIENT_ID as string,
    clientSecret: process.env.MS_CLIENT_SECRET as string,
  };
  let tokens: { accessToken: string; refreshToken: string };
  try {
    tokens = await intercambiarCodigo({ ...credenciales, code, verifier: estado.verifier, redirectUri: `${origen}/api/outlook/callback` });
  } catch (e) {
    console.error(`[outlook] canje de código rechazado: ${e instanceof ErrorMicrosoft ? e.codigo : "desconocido"}`);
    return volver(e instanceof ErrorMicrosoft && /AADSTS65001|AADSTS90094/.test(e.codigo) ? "consentimiento-bloqueado" : "microsoft");
  }

  let buzon: string;
  try {
    buzon = await buzonConectado(tokens.accessToken);
  } catch {
    return volver("correo");
  }

  const ahora = new Date();
  const { error } = await createAdminClient()
    .schema("recruiting")
    .from("outlook_connection")
    .upsert(
      {
        id: 1,
        mailbox: buzon,
        refresh_token_enc: cifrar(tokens.refreshToken, clave),
        connected_by: acceso.userId,
        connected_at: ahora.toISOString(),
        last_check_at: null,
        last_error: null,
        // Primera revisión: 24 horas hacia atrás. No se importa historial antiguo.
        last_message_received_at: new Date(ahora.getTime() - VENTANA_INICIAL_MS).toISOString(),
      },
      { onConflict: "id" },
    );
  if (error) {
    console.error(`[outlook] no se guardó la conexión: ${error.message}`);
    return volver("guardar");
  }

  const res = NextResponse.redirect(`${origen}/recruiting/settings?outlook=ok`, 302);
  res.cookies.set(COOKIE_OAUTH, "", opcionesCookieOauth(0));
  return res;
}

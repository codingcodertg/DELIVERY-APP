import { NextResponse } from "next/server";
import { origenPublico } from "@/lib/avisos-cliente-envio";
import { AAD_OAUTH, COOKIE_OAUTH, opcionesCookieOauth, payloadOauth } from "@/lib/outlook/oauth-estado";
import { cifrar, claveDelEntorno } from "@/lib/outlook/cifrado";
import { variablesQueFaltan } from "@/lib/outlook/config";
import { generarPkce, generarState, urlDeAutorizacion } from "@/lib/outlook/microsoft";
import { requireAdminOutlook } from "@/lib/outlook/acceso";

export const dynamic = "force-dynamic";

/** Inicia la conexión: manda al login de Microsoft con PKCE y un `state`, guardados en una cookie cifrada de 10 minutos. */
export async function GET(req: Request) {
  const origen = origenPublico(req.url);
  const volver = (codigo: string) => NextResponse.redirect(`${origen}/recruiting/settings?outlook_error=${codigo}`, 302);

  const acceso = await requireAdminOutlook();
  if (!acceso.ok) return volver(acceso.codigo === "no-admin" ? "no-admin" : "sin-sesion");
  const faltan = variablesQueFaltan(process.env);
  if (faltan.length) return volver("faltan-variables");

  const state = generarState();
  const { verifier, challenge } = generarPkce();
  const clave = claveDelEntorno(process.env);
  const cookie = cifrar(JSON.stringify(payloadOauth({ state, verifier, userId: acceso.userId, ahora: new Date() })), clave, AAD_OAUTH);

  const res = NextResponse.redirect(
    urlDeAutorizacion({
      tenant: process.env.MS_TENANT_ID as string,
      clientId: process.env.MS_CLIENT_ID as string,
      redirectUri: `${origen}/api/outlook/callback`,
      state,
      challenge,
    }),
    302,
  );
  res.cookies.set(COOKIE_OAUTH, cookie, opcionesCookieOauth(600));
  return res;
}

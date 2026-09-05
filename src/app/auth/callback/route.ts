import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth-redirect";

/**
 * Intercambio del código de Supabase Auth por una sesión (D-NEXT).
 *
 * Existía la promesa y no la ruta: "Forgot password?" mandaba el correo con
 * `redirectTo: /auth/callback?next=/reset-password` y `isPublicPath` ya dejaba pasar
 * `/auth/*`, pero `/auth/callback` no estaba implementada. Quien tocaba el enlace del correo
 * caía en un 404. Esto es lo que ese enlace promete: se canjea el `code` con el cliente de
 * servidor (que escribe la cookie de sesión) y se manda a `?next=` saneado a ruta interna.
 * Si falla —código caducado, ya usado, o ausente— se vuelve a `/login?error=…` para que la
 * pantalla lo diga en vez de dejar una página en blanco.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(reason)}`, request.url), { status: 303 });

  // Supabase puede volver ya con un error (enlace caducado, denegado).
  const providerError = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (providerError) return fail(providerError);
  if (!code) return fail("missing_code");

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return fail(error.message);

  return NextResponse.redirect(new URL(next, request.url), { status: 303 });
}

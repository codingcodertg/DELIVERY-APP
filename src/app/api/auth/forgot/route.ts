import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { pideRecuperacion } from "@/lib/password-recovery";

/**
 * Pide el correo de «olvidé mi contraseña» desde el servidor (D-NEXT).
 *
 * Con un cliente de flujo **implícito**, no el PKCE del navegador: así el enlace del correo no depende
 * de ningún verificador guardado en el navegador que lo pidió, y se puede abrir en cualquier equipo.
 * Medido en `auth-js` 2.112.4: con `flowType: "implicit"`, `resetPasswordForEmail` no manda
 * `code_challenge`, así que Supabase genera el enlace de toda la vida, que vuelve con la sesión en el
 * fragmento.
 *
 * El correo lo sigue mandando Supabase, con su plantilla y su propio límite de envíos. Esta ruta no
 * manda nada por su cuenta, y por eso no necesita limitador propio.
 *
 * Contesta lo mismo exista o no la cuenta: la lógica y el porqué están en `pideRecuperacion`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { email?: unknown } = {};
  try { body = await req.json(); } catch { /* un cuerpo roto se trata como correo ausente */ }

  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        // Implícito A PROPÓSITO: es lo que hace que el enlace funcione en otro equipo.
        flowType: "implicit",
        // Un cliente de un solo uso en el servidor: ni guarda sesión, ni refresca, ni lee URLs.
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );

  const { status, body: respuesta } = await pideRecuperacion(
    body.email,
    new URL(req.url).origin,
    (correo, redirectTo) => supabase.auth.resetPasswordForEmail(correo, { redirectTo }),
  );
  return NextResponse.json(respuesta, { status });
}

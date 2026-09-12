import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_RETORNO, desempaquetar } from "@/lib/impersonation-cookie";
import { createClient } from "@/lib/supabase/server";

/**
 * ¿Estoy dentro de la sesión de otra persona? (D-243)
 *
 * La pregunta del banner, y solo eso. Devuelve el nombre de la persona en la que se entró y
 * cuándo empezó; nada de ids, ni del admin, ni de la cookie.
 *
 * **No está detrás de la bandera**, por lo mismo que la ruta de volver: si `IMPERSONATION_ENABLED`
 * se apaga con una sesión impersonada viva, el banner tiene que seguir apareciendo. Un aviso que
 * se apaga y deja a alguien dentro de otra identidad sin decírselo es peor que no tenerlo.
 *
 * Y cuando no hay impersonación devuelve un objeto vacío, que es el caso de casi todas las
 * cargas: el banner no pinta nada y la respuesta no dice nada de nadie.
 */
export async function GET() {
  const galletas = await cookies();
  const guardado = desempaquetar(galletas.get(COOKIE_RETORNO)?.value ?? null);
  if (!guardado) return NextResponse.json({});

  // El nombre se lee de la sesión ACTUAL, que es la de la persona impersonada: es exactamente
  // el nombre que hay que enseñar, y así el banner no depende de que el que entró lo guardara
  // bien en la cookie.
  const ssr = await createClient();
  const { data: { user } } = await ssr.auth.getUser();
  if (!user) return NextResponse.json({});

  const { data: perfil } = await ssr
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  return NextResponse.json({
    como: perfil?.full_name ?? user.email ?? "otro usuario",
    inicio: guardado.inicio,
  });
}

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_RETORNO, desempaquetar } from "@/lib/impersonation-cookie";
import { createClient } from "@/lib/supabase/server";
import { impersonacionActiva } from "@/lib/impersonation-flag";
import { esAdmin } from "@/lib/impersonation";

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

  const ssr = await createClient();
  const { data: { user } } = await ssr.auth.getUser();
  if (!user) return NextResponse.json({});

  const { data: perfil } = await ssr
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .maybeSingle();

  // `habilitado` sirve para una sola cosa: que el botón «Switch usuario» no exista si la
  // función está apagada (D-NEXT). Un botón que abre una lista para luego chocar contra el 404
  // de `/api/impersonate` es peor que no estar.
  //
  // Solo se le dice a un admin, y con el rol leído de la base. A cualquier otro se le contesta
  // que no, aunque la bandera esté encendida: quien no puede usar la función tampoco necesita
  // saber que existe.
  const habilitado = impersonacionActiva() && esAdmin(perfil?.role);

  if (!guardado) return NextResponse.json({ habilitado });

  // El nombre se lee de la sesión ACTUAL, que es la de la persona impersonada: es exactamente
  // el nombre que hay que enseñar, y así el banner no depende de que el que entró lo guardara
  // bien en la cookie.
  return NextResponse.json({
    como: perfil?.full_name ?? user.email ?? "otro usuario",
    inicio: guardado.inicio,
    // Dentro de una impersonación el botón no se enseña: ahí está el banner con «volver». Y el
    // rol que se lee aquí es el del impersonado, así que esto ya sale `false` solo — se deja
    // explícito para que no dependa de esa coincidencia.
    habilitado: false,
  });
}

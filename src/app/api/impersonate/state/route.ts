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
 *
 * ---
 *
 * **`?ask=switch` (D-NEXT), y el parámetro existe para no cobrarle a quien no pregunta.**
 *
 * El botón «Switch usuario» necesita saber si la función está encendida, y eso exige leer el rol
 * de la base. Pero esta ruta la llama **el banner en cada carga de página de las cinco apps**,
 * para todo el mundo: meter esa consulta en el camino común le habría cobrado a cada persona una
 * ida al servidor de auth y una a `profiles` en cada carga, para calcular algo que hoy —con la
 * bandera apagada— es siempre `false`.
 *
 * Así que sin el parámetro esta ruta cuesta **exactamente lo que costaba**: sin cookie, cero idas
 * a la base. Lo pide solo el botón, que además ya sabe por su lado que quien mira es admin.
 */
export async function GET(request: Request) {
  const preguntanPorElBoton = new URL(request.url).searchParams.get("ask") === "switch";
  const galletas = await cookies();
  const guardado = desempaquetar(galletas.get(COOKIE_RETORNO)?.value ?? null);

  // Sin cookie y sin que nadie pregunte por el botón, no hay nada que decir. `impersonacionActiva`
  // es una lectura de entorno: gratis, y por eso puede ir antes de tocar nada.
  const activa = impersonacionActiva();
  if (!guardado && !(preguntanPorElBoton && activa)) return NextResponse.json({});

  const ssr = await createClient();
  const { data: { user } } = await ssr.auth.getUser();
  if (!user) return NextResponse.json({});

  const { data: perfil } = await ssr
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!guardado) {
    // Solo se le dice a un admin, y con el rol leído de la base. A cualquier otro se le contesta
    // que no aunque la bandera esté encendida: quien no puede usar la función tampoco necesita
    // saber que existe.
    return NextResponse.json({ habilitado: activa && esAdmin(perfil?.role) });
  }

  // El nombre se lee de la sesión ACTUAL, que es la de la persona impersonada: es exactamente
  // el nombre que hay que enseñar, y así el banner no depende de que el que entró lo guardara
  // bien en la cookie.
  return NextResponse.json({
    como: perfil?.full_name ?? user.email ?? "otro usuario",
    inicio: guardado.inicio,
    // Dentro de una impersonación el botón no se enseña: ahí está el banner con «volver». El rol
    // que se lee aquí es el del impersonado, así que saldría `false` solo — se deja explícito
    // para que no dependa de esa coincidencia.
    habilitado: false,
  });
}

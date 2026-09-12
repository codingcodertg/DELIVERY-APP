import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { COOKIE_RETORNO } from "@/lib/impersonation-cookie";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // Y la cookie de retorno de «entrar como», si la hay (D-NEXT). Un admin que entra como
  // Patricia y luego pulsa «Cerrar sesión» —en vez de «Volver»— dejaría **su propio refresh
  // token** vivo hasta una hora en un equipo compartido: el siguiente en entrar vería el banner
  // y un botón que le da la sesión del admin. Es `httpOnly`, así que borrarla es cosa del
  // servidor y de nadie más.
  (await cookies()).delete(COOKIE_RETORNO);
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
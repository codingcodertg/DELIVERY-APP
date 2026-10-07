import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { COOKIE_RETORNO } from "@/lib/impersonation-cookie";
import { COOKIE_CAPACITACION, RUTA_DE_LA_COOKIE } from "@/lib/timetracker/capacitacion";

export async function POST(request: Request) {
  const supabase = await createClient();
  // `local`, no el `global` que es el valor por defecto de `signOut()` en auth-js: «Cerrar
  // sesión» cierra ESTE equipo. El global revocaba todas las sesiones de la cuenta, y cerrar en
  // la web sacaba a la misma persona de la app de escritorio y del teléfono. Salir de todos los
  // dispositivos es otro botón, el del Time Tracker, y ese sí es global a propósito.
  await supabase.auth.signOut({ scope: "local" });
  // Y la cookie de retorno de «entrar como», si la hay (D-243). Un admin que entra como
  // Patricia y luego pulsa «Cerrar sesión» —en vez de «Volver»— dejaría **su propio refresh
  // token** vivo hasta una hora en un equipo compartido: el siguiente en entrar vería el banner
  // y un botón que le da la sesión del admin. Es `httpOnly`, así que borrarla es cosa del
  // servidor y de nadie más.
  (await cookies()).delete(COOKIE_RETORNO);
  // El modo capacitación de Time Tracker (D-490) no sobrevive a cerrar sesión: en un equipo
  // compartido, quien entre después tiene que fichar de verdad. La cookie vive en `/timetracker`, y
  // por eso se borra con esa ruta: borrarla solo por nombre no tocaría la del navegador.
  (await cookies()).delete({ name: COOKIE_CAPACITACION, path: RUTA_DE_LA_COOKIE });
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
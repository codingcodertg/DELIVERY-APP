import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exentoDelCierre } from "@/lib/session-cutoff";

/**
 * ¿A quien pregunta le toca el cierre de las 18:30? (D-NEXT)
 *
 * Existe por una razón estrecha: **el aviso previo**. La barrera es el middleware y no cambia;
 * lo que la pantalla necesita saber es si tiene que avisar, y avisar a un admin de un cierre
 * que no le va a pasar sería peor que no avisar.
 *
 * Devuelve un booleano y nada más. No dice el rol, ni la hora de la sesión, ni el nombre de
 * ninguna tabla: quien pregunta solo necesita eso, y todo lo demás sería regalar información
 * a cambio de nada.
 *
 * **Y `null` cuando no se sabe, que no es lo mismo que `true`.** Esta ruta la escribí para el
 * aviso, donde «si falla, digo que está exento y no molesto» era la dirección segura. Ahora la
 * usan dos consumidores con direcciones **opuestas** —el aviso calla sin respuesta, el
 * cronómetro para—, así que la ruta no puede resolver la duda por ellos: fabricar un `true`
 * aquí libraba del paro a un vendedor por un fallo de un instante a las 18:20, y a las 18:31 el
 * middleware le cerraba la sesión igual, con el reloj corriendo. Es la huérfana de D-241 que
 * esta rama existe para no fabricar, entrando por la puerta de atrás.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ exento: false, sesion: false });

  const { data, error } = await supabase.rpc("session_gate").single<{
    deliveries_role: string | null; clockin_role: string | null;
  }>();

  // Si la puerta no contesta, se dice que no se sabe. Cada quien lo resuelve en su dirección.
  if (error || !data) return NextResponse.json({ exento: null, sesion: true });

  return NextResponse.json({
    exento: exentoDelCierre({ entregas: data.deliveries_role, fichaje: data.clockin_role }),
    sesion: true,
  });
}

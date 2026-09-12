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
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ exento: false, sesion: false });

  const { data, error } = await supabase.rpc("session_gate").single<{
    deliveries_role: string | null; clockin_role: string | null;
  }>();

  // Igual que en el middleware: si la puerta no contesta, se responde que NO hay nada que
  // avisar. El aviso es cortesía, y un aviso equivocado asusta a alguien sin motivo.
  if (error || !data) return NextResponse.json({ exento: true, sesion: true });

  return NextResponse.json({
    exento: exentoDelCierre({ entregas: data.deliveries_role, fichaje: data.clockin_role }),
    sesion: true,
  });
}

import { redirect } from "next/navigation";
import { SeccionesDeRegistrarTiempo } from "@/components/timetracker/SeccionesDeRegistrarTiempo";
import { createClient } from "@/lib/supabase/server";
import { entradaDeTimeTracker, RUTA_DE_PAYROLL } from "@/lib/timetracker/pantalla-de-entrada";
import { ADMIN_DEMO } from "@/lib/timetracker/demo-data";
import { ProfileReadError } from "@/components/ProfileReadError";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";

const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

// «Registrar tiempo». Esta página NO monta el cronómetro, y es a propósito (D-470).
//
// El cronómetro vivía aquí, y con él el tick, el latido de diez segundos, el contador de
// actividad y el receptor de capturas de la app de escritorio. Next desmonta la página al
// cambiar de pestaña, así que abrir «Capturas» o «Semana» con el reloj corriendo lo mataba todo
// en silencio (incidente del 2026-10-04: 3 h 12 min sin un latido).
//
// Ahora lo monta `CronometroAnfitrion` desde el layout del módulo, que sobrevive a la
// navegación, y lo enseña cuando la ruta es esta. **No importes `Cronometro` aquí**: habría dos
// cronómetros a la vez escribiendo sobre la misma fila. Lo vigila `vigia.test.ts`.
//
// Debajo del reloj van dos secciones plegadas (owner, 2026-11-24): «Schedule» (solo admins) y
// «My week». El cronómetro va en el layout, así que esto no le afecta.
// 2026-11-25 (pedido del dueño): el admin de Time Tracker que entra aquí sin `?ver=track` cae en Nómina. La marca la
// pone el enlace de la pestaña «Registrar tiempo» para el admin (`hrefDeTrackTime`). Quien no es admin no se redirige.
// La decisión está en `entradaDeTimeTracker`. En la demo, el admin es la persona de la demo (`ADMIN_DEMO`, layout).
export default async function TrackTimePage({ searchParams }: { searchParams: Promise<{ ver?: string | string[] }> }) {
  const p = await searchParams;
  if (LOCAL_MODE) {
    if (entradaDeTimeTracker({ esAdmin: ADMIN_DEMO.role === "admin", ver: p.ver }) === "payroll") redirect(RUTA_DE_PAYROLL);
    return <SeccionesDeRegistrarTiempo />;
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: me, error: errorPerfil } = await supabase.from("profiles").select("timetracker_role").eq("id", user.id).maybeSingle();
    // Una consulta que FALLA no manda a nadie a otro sitio (como en Nómina): se enseña el error.
    if (estadoDeLectura({ data: me, error: errorPerfil }) === "fallo") {
      return <ProfileReadError error={errorPerfil!} verDetalle={puedeVerDetalle(user)} />;
    }
    if (entradaDeTimeTracker({ esAdmin: me?.timetracker_role === "admin", ver: p.ver }) === "payroll") redirect(RUTA_DE_PAYROLL);
  }
  return <SeccionesDeRegistrarTiempo />;
}

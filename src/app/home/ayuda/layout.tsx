import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * «Mis solicitudes» es de todo el mundo: la puerta solo pregunta si hay sesión, igual que los
 * tutoriales (D-268) y «Mi perfil» (D-265).
 *
 * **No usa `canReachHub`, y es a propósito.** El chofer no entra al lobby (D-173), pero pide ayuda
 * desde el botón de Entregas, y la respuesta le llega aquí: si esta página le cerrara la puerta, la
 * campana le llevaría a un sitio al que no puede entrar. Qué solicitudes ve cada uno lo decide la RLS
 * de la 120 y la 126, no esta puerta.
 */
export default async function AyudaLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/home/ayuda");

  return <div className="wrap">{children}</div>;
}

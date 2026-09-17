import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Los tutoriales son de todo el mundo, así que la puerta solo pregunta si hay sesión (D-NEXT), igual
 * que el directorio (D-256) y «Mi perfil» (D-265).
 *
 * **No usa `canReachHub`, y es a propósito.** El chofer no entra al lobby (D-173), pero veía los
 * tutoriales en la «Cuenta» de Entregas, que sí tiene. Esa sección se va y queda un enlace hasta aquí:
 * si esta página le cerrara la puerta, se quedaría sin videos.
 */
export default async function TutorialsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/home/tutorials");

  return <div className="wrap">{children}</div>;
}

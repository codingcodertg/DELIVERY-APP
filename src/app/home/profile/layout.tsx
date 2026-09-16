import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * «Mi perfil» es de cualquiera que tenga cuenta, así que la puerta solo pregunta si hay sesión
 * (D-265), igual que el directorio (D-256).
 *
 * **No usa `canReachHub`, y es a propósito.** El chofer no entra al lobby (D-173), pero hasta ahora
 * cambiaba su contraseña en la «Cuenta» de Entregas, que sí tiene. Ese formulario se va y queda un
 * enlace hasta aquí: si esta página le cerrara la puerta, el chofer se quedaría sin forma de
 * cambiar su propia contraseña.
 */
export default async function ProfileLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/home/profile");

  return <div className="wrap">{children}</div>;
}

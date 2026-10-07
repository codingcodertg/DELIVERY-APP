import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RUTA_PERSONALIZAR } from "@/lib/personalizar";

/**
 * «Personalizar» es de cualquiera que tenga cuenta (D-NEXT), así que la puerta solo pregunta si hay
 * sesión, igual que «Mi perfil» (D-265).
 *
 * **No usa `canReachHub`, a propósito y por lo mismo que «Mi perfil»:** el chofer no entra al lobby
 * (D-173), pero el idioma y el tema también son suyos. Entra desde el menú de su nombre en Entregas;
 * si esta página le cerrara la puerta, se quedaría sin forma de cambiar de idioma.
 */
export default async function PersonalizarLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${RUTA_PERSONALIZAR}`);

  return <div className="wrap">{children}</div>;
}

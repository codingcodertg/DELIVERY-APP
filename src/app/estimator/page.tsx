import { createClient } from "@/lib/supabase/server";
import { Estimador } from "./Estimador";

export const dynamic = "force-dynamic";
const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

/**
 * El Estimador (T-0408): el «Quote Builder» del documento del dueño.
 *
 * El servidor solo dice quién es: el nombre va en «Prepared by» y el id decide si el estimado es
 * suyo. Todo lo demás —buscar, guardar, aprobar— lo hace el cliente contra la base con la sesión de
 * quien mira, para que la RLS de la 148 sea la que decide y no una copia de ella aquí.
 *
 * En demo no hay sesión: quién eres lo dice «Ver como» (`localStorage`), y eso solo lo lee el cliente.
 */
export default async function EstimatorPage() {
  if (SIN_BASE) return <Estimador me={null} demo />;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: perfil } = user
    ? await supabase.from("profiles").select("id, full_name, role").eq("id", user.id).maybeSingle()
    : { data: null };

  const me = perfil
    ? { id: perfil.id as string, name: (perfil.full_name as string | null) ?? "", admin: perfil.role === "admin" }
    : null;
  return <Estimador me={me} demo={false} />;
}

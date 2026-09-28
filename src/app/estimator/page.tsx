import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
 *
 * **La extensión de quien prepara** (D-NEXT, «should be automatic») también la dice el servidor: es la de su expediente
 * de RR. HH., `recruiting.employee_files.ringcentral_ext`, enlazado a la cuenta por `profile_id` (106) — la misma que
 * enseña el directorio. Esa tabla solo la leen admin y gerente de RR. HH. (094), así que un vendedor no la puede leer
 * con su sesión; se lee aquí con la llave de servicio, **filtrando por el id de la sesión y pidiendo solo esa
 * columna**. No abre nada: la extensión de cada persona activa ya la ve cualquiera en el directorio (`phone_book()`).
 * Se descartó buscarla en `phone_book()` por nombre: el directorio no devuelve el id, y dos personas con el mismo
 * nombre darían la extensión de otra.
 */
async function extensionDelExpediente(userId: string): Promise<string | null> {
  try {
    const { data, error } = await createAdminClient()
      .schema("recruiting").from("employee_files")
      .select("ringcentral_ext")
      .eq("profile_id", userId)
      .is("date_left", null)
      .maybeSingle();
    if (error) return null;
    const ext = typeof data?.ringcentral_ext === "string" ? data.ringcentral_ext.trim() : "";
    return ext || null;
  } catch {
    // Sin la llave de servicio (o sin red) se escribe a mano, como antes: no es motivo para no abrir la pantalla.
    return null;
  }
}
export default async function EstimatorPage() {
  if (SIN_BASE) return <Estimador me={null} demo extension={null} />;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: perfil } = user
    ? await supabase.from("profiles").select("id, full_name, role").eq("id", user.id).maybeSingle()
    : { data: null };

  const me = perfil
    ? { id: perfil.id as string, name: (perfil.full_name as string | null) ?? "", admin: perfil.role === "admin" }
    : null;
  const extension = me ? await extensionDelExpediente(me.id) : null;
  return <Estimador me={me} demo={false} extension={extension} />;
}

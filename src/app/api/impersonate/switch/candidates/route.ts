import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient as createSSRClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { adminKey } from "@/lib/erp/supabase/admin";
import { COOKIE_RETORNO, desempaquetar } from "@/lib/impersonation-cookie";
import { impersonacionActiva } from "@/lib/impersonation-flag";
import { candidatosParaSaltar } from "@/lib/impersonation";

/**
 * A quién se puede saltar desde dentro de una impersonación (D-NEXT).
 *
 * El aviso naranja vive en el layout raíz, sin `DataProvider`, así que el panel no puede leer la
 * plantilla de ahí. Y con la sesión del suplantado tampoco debería listarla para esto: lo que se
 * enseña es lo que **el admin de la cookie** podría hacer, no lo que ve el vendedor. Por eso se lee
 * con la llave de servicio, pero solo si hay cookie de retorno (o sea, si hay alguien a quien volver)
 * y solo lo que el panel pinta: id, nombre, rol y tienda. Nada más.
 *
 * Ya viene **filtrado con la misma regla que la ruta de saltar** (`puedeEntrarComo`): sin admins y sin
 * el propio admin. La lista no enseña a nadie a quien la ruta vaya a decir que no.
 */
export async function GET() {
  if (!impersonacionActiva()) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const guardado = desempaquetar((await cookies()).get(COOKIE_RETORNO)?.value ?? null);
  if (!guardado) return NextResponse.json({ error: "sin_impersonacion" }, { status: 409 });

  // Que la sesión que pregunta sea la que la cookie dice que está suplantada: una cookie de retorno
  // pegada a otra sesión no lista a nadie.
  const ssr = await createSSRClient();
  const { data: { user } } = await ssr.auth.getUser();
  if (!user || user.id !== guardado.comoId) return NextResponse.json({ error: "sin_sesion" }, { status: 401 });

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, adminKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const [{ data: perfiles, error }, { data: ajustes }] = await Promise.all([
    admin.from("profiles").select("id, full_name, role, store").order("full_name"),
    admin.from("settings").select("stores").eq("id", 1).maybeSingle(),
  ]);
  if (error) return NextResponse.json({ error: "perfiles" }, { status: 500 });

  const yo = perfiles?.find((p) => p.id === guardado.adminId);
  // Si quien firmó la cookie ya no es admin, no hay candidatos que enseñar: la ruta de saltar lo va a
  // rechazar igual, y la lista no puede prometer lo contrario.
  const users = candidatosParaSaltar({ id: guardado.adminId, rol: yo?.role }, perfiles ?? []);
  return NextResponse.json({ users, stores: (ajustes?.stores ?? []) as { name: string }[] });
}

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { landingRoute } from "@/lib/constants";
import { ProfileReadError } from "@/components/ProfileReadError";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";

/**
 * El historial de solicitudes de ayuda es del admin (D-NEXT), y se decide en el servidor con el rol de
 * la sesión, igual que Usuarios (D-056) y la vista móvil (D-278).
 *
 * No es la única puerta: la 120 pone RLS sobre la tabla, así que quien llegue por la API sin ser admin
 * solo ve las suyas. Esta puerta es para que nadie se plante delante de una pantalla vacía.
 */
export default async function SolicitudesLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/home/solicitudes-de-ayuda");

  const { data: perfil, error: errorPerfil } = await supabase
    .from("profiles").select("role, module_access").eq("id", user.id).maybeSingle();
  // Tres desenlaces (D-234): con la consulta fallida no se redirige, que el login volvería aquí.
  if (estadoDeLectura({ data: perfil, error: errorPerfil }) === "fallo") {
    return <ProfileReadError error={errorPerfil!} verDetalle={puedeVerDetalle(user)} />;
  }
  if (!perfil) redirect("/login?next=/home/solicitudes-de-ayuda");
  if (perfil.role !== "admin") redirect(landingRoute(perfil));

  return <div className="wrap">{children}</div>;
}

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { landingRoute } from "@/lib/constants";
import { ProfileReadError } from "@/components/ProfileReadError";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";

/**
 * La vista móvil es del admin (D-NEXT), y se decide en el servidor con el rol de la sesión, igual que
 * Usuarios (D-056). «Ver como» es solo del cliente y no cambia la sesión, así que un admin
 * previsualizando otro rol sigue entrando; alguien suplantado por un admin (D-243) tiene la sesión de
 * esa persona, y no entra.
 *
 * Sin `DataProvider`: esta página no lee órdenes. La app que se prueba corre dentro del marco, con los
 * suyos.
 */
export default async function VistaMovilLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/home/vista-movil");

  const { data: perfil, error: errorPerfil } = await supabase.from("profiles").select("role, module_access").eq("id", user.id).maybeSingle();
  // Tres desenlaces (D-234): si la consulta falla no se redirige, que el login volvería aquí.
  if (estadoDeLectura({ data: perfil, error: errorPerfil }) === "fallo") {
    return <ProfileReadError error={errorPerfil!} verDetalle={puedeVerDetalle(user)} />;
  }
  if (!perfil) redirect("/login?next=/home/vista-movil");
  if (perfil.role !== "admin") redirect(landingRoute(perfil));

  return <div className="wrap">{children}</div>;
}

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { COOKIE_RETORNO, desempaquetar } from "@/lib/impersonation-cookie";
import { debeCambiarContrasena, destinoTrasCambio, RUTA_CAMBIO_OBLIGATORIO } from "@/lib/cambio-obligatorio";
import { CambioObligatorioForm } from "@/components/CambioObligatorioForm";
import { estadoDeLectura } from "@/lib/profile-read";

export const dynamic = "force-dynamic";

/**
 * «Cambia tu contraseña» (D-NEXT): adonde el middleware manda a quien entró con una contraseña
 * temporal (`user_metadata.must_change_password`), venga de la app que venga.
 *
 * La pantalla vuelve a mirar la marca por su cuenta: quien llega sin ella —ya la cambió, o pegó la
 * URL— sigue a su destino; aquí no hay nada que hacer, y cambiar la contraseña por gusto es cosa de
 * «Mi perfil», que pide la actual.
 */
export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const sp = await searchParams;
  const destino = destinoTrasCambio(typeof sp.next === "string" ? sp.next : null);

  // Demo: sin servidor de auth no hay marca que leer. Se enseña el formulario (para verlo), y
  // guardar dice que en el demo no se puede.
  if (process.env.NEXT_PUBLIC_LOCAL_MODE === "true") {
    return <CambioObligatorioForm nombre={null} destino={destino} demo />;
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(RUTA_CAMBIO_OBLIGATORIO)}`);

  const suplantando = desempaquetar((await cookies()).get(COOKIE_RETORNO)?.value ?? null) !== null;
  if (suplantando || !debeCambiarContrasena(user)) redirect(destino);

  // Solo para saludar. Si la lectura falla (D-234) no se rebota a nadie: se saluda sin nombre, que
  // cambiar la contraseña no depende de él.
  const { data: perfil, error: errorPerfil } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const nombre = estadoDeLectura({ data: perfil, error: errorPerfil }) === "fallo"
    ? null
    : (perfil as { full_name?: string | null } | null)?.full_name ?? null;

  return <CambioObligatorioForm nombre={nombre} destino={destino} />;
}

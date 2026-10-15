import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { COOKIE_RETORNO, desempaquetar } from "@/lib/impersonation-cookie";
import { canReachHub, landingRoute } from "@/lib/constants";
import type { Profile } from "@/lib/types";
import { ProfileReadError } from "@/components/ProfileReadError";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";
import { MapaDeLaEmpresa } from "@/components/MapaDeLaEmpresa";

// «🗺️ Mapa de la empresa» (D-556). Las mismas puertas que el inicio del hub (home/page.tsx): sesión, perfil leído en
// tres desenlaces (D-234), `canReachHub` (D-173) y la cookie de suplantación (D-306). Quien no puede estar en el hub no
// llega al mapa.
export default async function MapaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/home/mapa");

  const { data: profile, error: errorPerfil } = await supabase
    .from("profiles")
    .select("id, full_name, role, module_access, erp_role")
    .eq("id", user.id)
    .maybeSingle();
  if (estadoDeLectura({ data: profile, error: errorPerfil }) === "fallo") {
    return <ProfileReadError error={errorPerfil!} verDetalle={puedeVerDetalle(user)} />;
  }
  if (!profile) redirect("/login");
  const me: Profile = profile;
  if (!canReachHub(me)) redirect(landingRoute(me));

  const suplantando = desempaquetar((await cookies()).get(COOKIE_RETORNO)?.value ?? null) !== null;
  return <MapaDeLaEmpresa me={me} suplantando={suplantando} />;
}

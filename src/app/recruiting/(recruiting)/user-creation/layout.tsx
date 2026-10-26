import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DataProvider } from "@/lib/data-provider";
import { ConfirmProvider } from "@/lib/confirm";
import { landingRoute } from "@/lib/constants";
import type { Profile } from "@/lib/types";
import { ProfileReadError } from "@/components/ProfileReadError";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";

// D-704: «Crear usuarios» dentro de RR. HH. El dueño: «crear usuario tiene que ir directamente a la app de HR». Encima
// del layout de RR. HH. (barra, tema, sesión, recruiting_role), la misma puerta que src/app/home/users/layout.tsx: solo
// el admin del hub (role = admin), porque /api/invite y guard_recruiting_access_change lo exigen igual (D-050/D-056).
// La pantalla es UsersManager, que lee el DataProvider DEL HUB (usuarios, addUser y las ~20 escrituras de UserDialog):
// se monta solo aquí, no en todo /recruiting. D-693/D-695 lo intentaron y Vercel murió por memoria, pero con Sentry
// instalado (quitado en D-700); si vuelve a morir, la causa es esto y no Sentry.
export default async function RrhhUserCreationLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/recruiting/user-creation");

  const { data: profile, error: errorPerfil } = await supabase
    .from("profiles")
    .select("id, full_name, username, role, store, permissions, avatar_url, recruiting_role, module_access")
    .eq("id", user.id)
    .maybeSingle();
  if (estadoDeLectura({ data: profile, error: errorPerfil }) === "fallo") {
    return <ProfileReadError error={errorPerfil!} verDetalle={puedeVerDetalle(user)} />;
  }
  if (!profile) redirect("/login?next=/recruiting/user-creation");
  const me: Profile = profile;
  if (me.role !== "admin") redirect(landingRoute(me));

  return (
    <ConfirmProvider>
      <DataProvider me={me}>{children}</DataProvider>
    </ConfirmProvider>
  );
}

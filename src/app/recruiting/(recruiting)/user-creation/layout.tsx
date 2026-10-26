import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DataProvider } from "@/lib/data-provider";
import { ConfirmProvider } from "@/lib/confirm";
import type { Profile } from "@/lib/types";
import { ProfileReadError } from "@/components/ProfileReadError";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";

// «User creation» dentro de RR. HH. (D-NEXT). La misma barrera que home/users/layout.tsx: solo un
// admin del hub (`role = admin`), porque /api/invite y los guards de la base (D-050) lo exigen
// igual desde cualquier URL. El layout de (recruiting) ya pidió recruiting_role; esto añade lo otro.
// Monta el DataProvider del HUB (usuarios, ajustes, addUser) además del de RR. HH. que ya envuelve:
// son contextos distintos, y es lo que deja usar UsersManager/UserDialog sin copiarlos.
export default async function UserCreationLayout({ children }: { children: React.ReactNode }) {
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
  if (me.role !== "admin") redirect("/recruiting/employees");

  return (
    <ConfirmProvider>
      <DataProvider me={me}>{children}</DataProvider>
    </ConfirmProvider>
  );
}

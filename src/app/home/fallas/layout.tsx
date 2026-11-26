import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { landingRoute } from "@/lib/constants";
import type { UserRole } from "@/lib/types";
import { ProfileReadError } from "@/components/ProfileReadError";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";

/**
 * La puerta de «Fallas de la app» (2026-11-25): solo el admin REAL, como Security. La base lo dice lo mismo: la tabla
 * `app_errors` (352) solo la lee `public.is_admin()`. Aquí se comprueba para que una URL escrita a mano no llegue a la
 * pantalla. El demo (`NEXT_PUBLIC_LOCAL_MODE`) no tiene sesión: entra la persona inventada del demo, que es admin.
 */
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export default async function FallasLayout({ children }: { children: React.ReactNode }) {
  if (LOCAL_MODE) return <div className="wrap">{children}</div>;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/home/fallas");

  const { data: profile, error: errorPerfil } = await supabase
    .from("profiles").select("role, module_access").eq("id", user.id).maybeSingle();
  if (estadoDeLectura({ data: profile, error: errorPerfil }) === "fallo") {
    return <ProfileReadError error={errorPerfil!} verDetalle={puedeVerDetalle(user)} />;
  }
  if (!profile) redirect("/login?next=/home/fallas");
  const role = (profile.role ?? "sales") as UserRole;
  if (role !== "admin") redirect(landingRoute({ role, module_access: profile.module_access }));

  return <div className="wrap">{children}</div>;
}

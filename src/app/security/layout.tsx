import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { landingRoute } from "@/lib/constants";
import { BarraSencilla } from "@/components/BarraDeApp";
import type { UserRole } from "@/lib/types";
import { ProfileReadError } from "@/components/ProfileReadError";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";

export const metadata: Metadata = { title: "Security" };

const NOMBRE = ["Security", "Seguridad"] as const;

/**
 * La puerta de Security (D-811): solo el admin. No va por `module_access` a propósito —es una herramienta del hub, como
 * «Usuarios · permisos»—, y la base dice lo mismo: las tres tablas de la 229 solo las lee y edita `security.is_admin()`.
 * Misma forma que la de Promos: una URL escrita a mano se comprueba aquí en vez de confiarse.
 */
/** El demo (`NEXT_PUBLIC_LOCAL_MODE`, D-NEXT): sin base ni sesión, como Leads y Promos. La persona es el admin inventado. */
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export default async function SecurityLayout({ children }: { children: React.ReactNode }) {
  if (LOCAL_MODE) return <><BarraSencilla nombre={NOMBRE} deliveriesRole="admin" moduleAccess={null} persona="Demo" />{children}</>;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/security");

  const { data: profile, error: errorPerfil } = await supabase
    .from("profiles").select("role, module_access, full_name").eq("id", user.id).maybeSingle();
  if (estadoDeLectura({ data: profile, error: errorPerfil }) === "fallo") {
    return <ProfileReadError error={errorPerfil!} verDetalle={puedeVerDetalle(user)} />;
  }
  const role = (profile?.role ?? "sales") as UserRole;
  if (role !== "admin") redirect(landingRoute({ role, module_access: profile?.module_access }));

  return (
    <>
      <BarraSencilla nombre={NOMBRE} deliveriesRole={role} moduleAccess={profile?.module_access}
        persona={profile?.full_name?.trim() || user.email || ""} />
      {children}
    </>
  );
}

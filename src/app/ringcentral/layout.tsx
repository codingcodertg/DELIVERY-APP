import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { landingRoute } from "@/lib/constants";
import { BarraSencilla } from "@/components/BarraDeApp";
import type { UserRole } from "@/lib/types";
import { ProfileReadError } from "@/components/ProfileReadError";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";
import "./ringcentral.css";

export const metadata: Metadata = { title: "RingCentral" };

const NOMBRE = ["RingCentral", "RingCentral"] as const;

/**
 * La puerta de RingCentral de los choferes: solo el admin, igual que Security (herramienta del hub, sin `module_access`).
 * Una URL escrita a mano se comprueba aquí; la base lo repite con la RLS de las migraciones 329 (solo admin).
 * El demo (`NEXT_PUBLIC_LOCAL_MODE`) no tiene base ni sesión: la persona es el admin inventado.
 */
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export default async function RingCentralLayout({ children }: { children: React.ReactNode }) {
  if (LOCAL_MODE) return <><BarraSencilla nombre={NOMBRE} deliveriesRole="admin" moduleAccess={null} persona="Demo" />{children}</>;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/ringcentral");

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

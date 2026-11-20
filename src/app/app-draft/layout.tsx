import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { landingRoute } from "@/lib/constants";
import { BarraSencilla } from "@/components/BarraDeApp";
import type { UserRole } from "@/lib/types";
import { ProfileReadError } from "@/components/ProfileReadError";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";
import "./app-draft.css";

export const metadata: Metadata = { title: "App Draft" };

const NOMBRE = ["App Draft", "App Draft"] as const;

/**
 * La puerta de App Draft: el admin siempre; los demás solo con `app_draft` en `module_access` (al gerente se le concede
 * con la casilla en Usuarios). Los prototipos no leen ni escriben la base: todo son datos de ejemplo en el navegador.
 * Calcada de la de QR Codes (`surveys/layout.tsx`), con sus tres desenlaces (D-234).
 */
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export default async function AppDraftLayout({ children }: { children: React.ReactNode }) {
  if (LOCAL_MODE) return <><BarraSencilla nombre={NOMBRE} deliveriesRole="admin" moduleAccess={null} persona="Demo" />{children}</>;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/app-draft");

  const { data: profile, error: errorPerfil } = await supabase
    .from("profiles").select("role, module_access, full_name").eq("id", user.id).maybeSingle();
  if (estadoDeLectura({ data: profile, error: errorPerfil }) === "fallo") {
    return <ProfileReadError error={errorPerfil!} verDetalle={puedeVerDetalle(user)} />;
  }
  const role = (profile?.role ?? "sales") as UserRole;
  const entra = role === "admin" || !!profile?.module_access?.includes("app_draft");
  if (!entra) redirect(landingRoute({ role, module_access: profile?.module_access }));

  return (
    <>
      <BarraSencilla nombre={NOMBRE} deliveriesRole={role} moduleAccess={profile?.module_access}
        persona={profile?.full_name?.trim() || user.email || ""} />
      {children}
    </>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { landingRoute } from "@/lib/constants";
import { ProfileReadError } from "@/components/ProfileReadError";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";
import "./leads.css";

export const metadata: Metadata = {
  title: "RTG LEADS",
};

/**
 * La puerta de «Leads» (migración 162). Calcada de la de Encuestas (`surveys/layout.tsx`).
 *
 * Llegar a este layout no demuestra nada: una URL escrita a mano se comprueba aquí. Sin esto la base seguiría
 * negando cada fila —la política de la 162 mira `has_leads_access()`— pero quien no tiene el módulo vería
 * «0 leads», y eso se lee como «el banco está vacío», que es mentira.
 *
 * El admin siempre entra, igual que dice `public.has_leads_access()`.
 *
 * **Tres desenlaces, no dos** (D-234): si la CONSULTA del perfil falla no se redirige, porque el login vuelve
 * aquí y el fallo se convierte en un bucle. Solo la fila ausente —con error nulo— manda al login.
 */
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export default async function LeadsLayout({ children }: { children: React.ReactNode }) {
  // Modo demo: sin base ni sesión. Los leads son los inventados de `lib/leads/demo`.
  if (LOCAL_MODE) return <>{children}</>;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/leads");

  const { data: profile, error: errorPerfil } = await supabase
    .from("profiles")
    .select("role, module_access")
    .eq("id", user.id)
    .maybeSingle();
  if (estadoDeLectura({ data: profile, error: errorPerfil }) === "fallo") {
    return <ProfileReadError error={errorPerfil!} verDetalle={puedeVerDetalle(user)} />;
  }

  const role = profile?.role ?? "sales";
  const tieneLeads = role === "admin" || !!profile?.module_access?.includes("leads");
  if (!tieneLeads) {
    redirect(landingRoute({ role, module_access: profile?.module_access }));
  }

  return <>{children}</>;
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { landingRoute } from "@/lib/constants";
import { ProfileReadError } from "@/components/ProfileReadError";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";
import "./surveys.css";

export const metadata: Metadata = {
  title: "RTG SURVEYS",
};

/**
 * La puerta de «Encuestas» (migración 155). Calcada de la del Estimador (`estimator/layout.tsx`).
 *
 * Llegar a este layout no demuestra nada: una URL escrita a mano se comprueba aquí. Sin esto la base seguiría
 * negando cada fila —la política de la 155 mira `has_surveys_access()`— pero quien no tiene el módulo vería
 * «0 respuestas», y eso se lee como «nadie ha contestado», que es mentira.
 *
 * El admin siempre entra, igual que dice `public.has_surveys_access()`.
 *
 * **Tres desenlaces, no dos** (D-234): si la CONSULTA del perfil falla no se redirige, porque el login vuelve
 * aquí y el fallo se convierte en un bucle. Solo la fila ausente —con error nulo— manda al login.
 */
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export default async function SurveysLayout({ children }: { children: React.ReactNode }) {
  // Modo demo: sin base ni sesión. Las respuestas son las inventadas de `lib/encuestas/demo`.
  if (LOCAL_MODE) return <>{children}</>;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/surveys");

  const { data: profile, error: errorPerfil } = await supabase
    .from("profiles")
    .select("role, module_access")
    .eq("id", user.id)
    .maybeSingle();
  if (estadoDeLectura({ data: profile, error: errorPerfil }) === "fallo") {
    return <ProfileReadError error={errorPerfil!} verDetalle={puedeVerDetalle(user)} />;
  }

  const role = profile?.role ?? "sales";
  const tieneEncuestas = role === "admin" || !!profile?.module_access?.includes("surveys");
  if (!tieneEncuestas) {
    redirect(landingRoute({ role, module_access: profile?.module_access }));
  }

  return <>{children}</>;
}

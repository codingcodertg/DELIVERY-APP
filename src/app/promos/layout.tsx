import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { landingRoute } from "@/lib/constants";
import { ProfileReadError } from "@/components/ProfileReadError";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";

export const metadata: Metadata = {
  title: "RTG PROMOS",
};

/**
 * La puerta del módulo de promociones (migración 140).
 *
 * Misma forma que la del ERP y la de RR. HH. (D-051), y por la misma razón: llegar a este layout no
 * demuestra nada por sí solo, así que una URL escrita a mano se comprueba aquí en vez de confiarse.
 * Sin esto la base seguiría negando cada fila —`has_promos_access()` está en todas las políticas de
 * la 140— pero un vendedor sin el módulo vería una pantalla vacía en lugar de que se le diga que no,
 * y una pantalla vacía se lee como una avería.
 *
 * El admin siempre entra, igual que dice `public.has_promos_access()`: quien reparte el módulo no
 * puede quedarse fuera del módulo que administra.
 *
 * **Tres desenlaces, no dos** (D-234): si la CONSULTA del perfil falla no se redirige, porque el
 * login vuelve aquí y el fallo se convierte en un bucle. Solo la fila ausente —con error nulo— es la
 * sesión degradada que manda al login.
 */
export default async function PromosLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/promos");

  const { data: profile, error: errorPerfil } = await supabase
    .from("profiles")
    .select("role, module_access")
    .eq("id", user.id)
    .maybeSingle();
  if (estadoDeLectura({ data: profile, error: errorPerfil }) === "fallo") {
    return <ProfileReadError error={errorPerfil!} verDetalle={puedeVerDetalle(user)} />;
  }

  const role = profile?.role ?? "sales";
  const tienePromos = role === "admin" || !!profile?.module_access?.includes("promos");
  if (!tienePromos) {
    redirect(landingRoute({ role, module_access: profile?.module_access }));
  }

  return <>{children}</>;
}

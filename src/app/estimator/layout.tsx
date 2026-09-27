import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { landingRoute } from "@/lib/constants";
import { ProfileReadError } from "@/components/ProfileReadError";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";
import "./estimator.css";

export const metadata: Metadata = {
  title: "RTG ESTIMATOR",
};

/**
 * La puerta del Estimador (T-0408, migración 148). Calcada de la de promociones (`promos/layout.tsx`).
 *
 * Misma forma que la del ERP y la de RR. HH. (D-051), y por la misma razón: llegar a este layout no
 * demuestra nada por sí solo, así que una URL escrita a mano se comprueba aquí en vez de confiarse.
 * Sin esto la base seguiría negando cada fila —`has_estimator_access()` está en todas las políticas de
 * la 148— pero un vendedor sin el módulo vería una pantalla vacía en lugar de que se le diga que no,
 * y una pantalla vacía se lee como una avería.
 *
 * El admin siempre entra, igual que dice `public.has_estimator_access()`: quien reparte el módulo no
 * puede quedarse fuera del módulo que administra.
 *
 * **Tres desenlaces, no dos** (D-234): si la CONSULTA del perfil falla no se redirige, porque el
 * login vuelve aquí y el fallo se convierte en un bucle. Solo la fila ausente —con error nulo— es la
 * sesión degradada que manda al login.
 */
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export default async function EstimatorLayout({ children }: { children: React.ReactNode }) {
  // Modo demo: no hay base ni sesión, así que la puerta no tiene nada que comprobar y mandaría al
  // login a quien solo viene a mirar. Mismo atajo que `(app)/layout.tsx`. Las pantallas de dentro
  // usan datos inventados (`lib/estimator/demo`), que es lo que permite mirar esto en un navegador.
  if (LOCAL_MODE) return <>{children}</>;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/estimator");

  const { data: profile, error: errorPerfil } = await supabase
    .from("profiles")
    .select("role, module_access")
    .eq("id", user.id)
    .maybeSingle();
  if (estadoDeLectura({ data: profile, error: errorPerfil }) === "fallo") {
    return <ProfileReadError error={errorPerfil!} verDetalle={puedeVerDetalle(user)} />;
  }

  const role = profile?.role ?? "sales";
  const tieneEstimador = role === "admin" || !!profile?.module_access?.includes("estimator");
  if (!tieneEstimador) {
    redirect(landingRoute({ role, module_access: profile?.module_access }));
  }

  return <>{children}</>;
}

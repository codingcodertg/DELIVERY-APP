import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { landingRoute } from "@/lib/constants";
import "./erp.css";
import { ProfileReadError } from "@/components/ProfileReadError";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";

export const metadata: Metadata = {
  title: "RTG Inventory",
};

/**
 * The Inventory section's shell (D-090; «RTG ERP» hasta D-NEXT, que lo renombró y lo vistió como Entregas).
 *
 * `data-app="erp"` is load-bearing, not decoration: erp.css deliberately does NOT import Tailwind's
 * preflight, because that is a global reset and every other screen in this app was built without
 * it. The stand-in reset is scoped to this attribute, so it applies here and stops here.
 *
 * The access check is the same shape recruiting's layout uses (D-051): reaching this layout is not,
 * by itself, proof of anything, so a direct URL is checked here rather than trusted. Without it the
 * database still refused every row — the restrictive module gate in migration 066 sees to that —
 * but a driver who typed /erp/catalog would have got an empty catalog instead of being told no,
 * which reads as a broken page rather than a closed door.
 *
 * Admins are always in, matching public.has_erp_access(): the person who grants module access
 * should not be able to lock themselves out of the module they administer.
 */
export default async function ErpLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient(); // deliveries' client — public schema, shared identity
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/erp/catalog");

  const { data: profile, error: errorPerfil } = await supabase
    .from("profiles")
    .select("role, module_access")
    .eq("id", user.id)
    .maybeSingle();
  // Tres desenlaces, no dos (D-234): si la CONSULTA fallo no se redirige, porque el
  // login vuelve aqui y el fallo se convierte en un bucle. Solo la fila ausente
  // —error nulo— sigue siendo la sesion degradada de D-081 que manda al login.
  if (estadoDeLectura({ data: profile, error: errorPerfil }) === "fallo") {
    return <ProfileReadError error={errorPerfil!} verDetalle={puedeVerDetalle(user)} />;
  }


  const role = profile?.role ?? "sales";
  const hasErp = role === "admin" || !!profile?.module_access?.includes("erp");
  if (!hasErp) {
    redirect(landingRoute({ role, module_access: profile?.module_access }));
  }

  // D-NEXT (2026-10-21): la barra es la superior de Entregas (side-nav.tsx) y va en el flujo del documento, así que
  // ya no hay barra lateral fija ni hueco a la izquierda que reservar (el `ErpNavProvider` de D-090 se fue con ella).
  return <div data-app="erp">{children}</div>;
}

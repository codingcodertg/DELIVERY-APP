import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { puedeEntrarAClientes } from "@/lib/customers/reglas";
import { createClient } from "@/lib/supabase/server";
import { landingRoute } from "@/lib/constants";
import { ProfileReadError } from "@/components/ProfileReadError";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";
import "@/app/erp/erp.css";

export const metadata: Metadata = {
  title: "RTG CUSTOMERS",
};

/**
 * La puerta de «Clientes» (migración 180). Calcada de la de Leads (`leads/layout.tsx`), con el cascarón del ERP.
 *
 * Llegar a este layout no demuestra nada: una URL escrita a mano se comprueba aquí. Sin esto la base seguiría
 * negando cada fila —la puerta restrictiva de la 180 mira `has_customers_access()`— pero quien no tiene el módulo
 * vería «0 clientes», y eso se lee como «la lista está vacía», que es mentira.
 *
 * El admin siempre entra, igual que dice `public.has_customers_access()`.
 *
 * **Tres desenlaces, no dos** (D-234): si la CONSULTA del perfil falla no se redirige, porque el login vuelve aquí y
 * el fallo se convierte en un bucle. Solo la fila ausente —con error nulo— manda al login.
 *
 * **El tema es el de Inventario** (el dueño: «con el schema de el ERP así con ese theme»): se importa `erp.css` —que
 * trae el preflight de Tailwind y, desde D-622, la paleta del hub— y se envuelve en `data-app="erp"`, que es el
 * ancla de sus variables de color. La barra es la superior de Entregas (D-622), sin hueco lateral.
 */
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export default async function CustomersLayout({ children }: { children: React.ReactNode }) {
  // D-622 (2026-10-21): la barra es la superior de Entregas, en el flujo; sin `ErpNavProvider` ni hueco lateral.
  const cascaron = <div data-app="erp">{children}</div>;
  // Modo demo: sin base ni sesión. Los clientes son los inventados de `lib/customers/demo`.
  if (LOCAL_MODE) return cascaron;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/customers");

  const { data: profile, error: errorPerfil } = await supabase
    .from("profiles")
    .select("role, module_access")
    .eq("id", user.id)
    .maybeSingle();
  if (estadoDeLectura({ data: profile, error: errorPerfil }) === "fallo") {
    return <ProfileReadError error={errorPerfil!} verDetalle={puedeVerDetalle(user)} />;
  }

  const role = profile?.role ?? "sales";
  // Solo admins por ahora (D-570): la regla vive en `reglas.ts`, no aquí.
  const tieneClientes = puedeEntrarAClientes({ role, module_access: profile?.module_access });
  if (!tieneClientes) {
    redirect(landingRoute({ role, module_access: profile?.module_access }));
  }

  return cascaron;
}

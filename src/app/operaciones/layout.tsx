import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { landingRoute } from "@/lib/constants";
import { BarraSencilla } from "@/components/BarraDeApp";
import type { UserRole } from "@/lib/types";
import { ProfileReadError } from "@/components/ProfileReadError";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";
import { puedeVerReporte, tieneElModulo } from "@/lib/almacen-ops/visibilidad";
import "./operaciones.css";

export const metadata: Metadata = {
  title: "Warehouse Ops",
};

/**
 * La puerta de «Operaciones de almacén» (D-883, migración 247). Calcada de la de Encuestas: quien no tiene el módulo
 * vuelve a su pantalla de inicio. La base niega igual (RLS de la 247); esto evita una pantalla vacía que mienta.
 * Excepción: RR. HH. (admin o gerente) entra sin el módulo, porque ve los reportes de RR. HH. de todas las tiendas.
 */
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
const NOMBRE = ["Warehouse Ops", "Operaciones de almacén"] as const;

export default async function OperacionesLayout({ children }: { children: React.ReactNode }) {
  if (LOCAL_MODE) return <><BarraSencilla nombre={NOMBRE} deliveriesRole="admin" moduleAccess={null} persona="Demo" />{children}</>;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/operaciones");

  const { data: profile, error: errorPerfil } = await supabase
    .from("profiles")
    .select("role, module_access, full_name, recruiting_role")
    .eq("id", user.id)
    .maybeSingle();
  if (estadoDeLectura({ data: profile, error: errorPerfil }) === "fallo") {
    return <ProfileReadError error={errorPerfil!} verDetalle={puedeVerDetalle(user)} />;
  }

  const role = profile?.role ?? "sales";
  const quien = { id: user.id, role, module_access: profile?.module_access, recruiting_role: profile?.recruiting_role };
  const entra = tieneElModulo(quien) || puedeVerReporte(quien, { kind: "insubordination", store: "", author_id: "" });
  if (!entra) redirect(landingRoute({ role, module_access: profile?.module_access }));

  return (
    <>
      <BarraSencilla nombre={NOMBRE} deliveriesRole={role as UserRole} moduleAccess={profile?.module_access}
        persona={profile?.full_name?.trim() || user.email || ""} />
      {children}
    </>
  );
}

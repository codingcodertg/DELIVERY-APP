import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";
import { ProfileReadError } from "@/components/ProfileReadError";
import { puedeEditar } from "@/lib/customers/reglas";
import type { UserRole } from "@/lib/types";
import { BarraDeClientes } from "@/components/customers/barra";
import { DecidirJuntar } from "./DecidirJuntar";

export const dynamic = "force-dynamic";
const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

/**
 * «Decidir si se juntan / Decide to merge» (migración 189): la cola de pares de clientes que PARECEN la misma compañía
 * sin serlo obviamente. El dueño (2026-10-21): «tiene que irse a un site que dice Decide to Merge. Entonces, él te va a
 * poner y el usuario lo va a revisar y él va a decir, ok, Merge».
 *
 * Cuelga de `customers/layout.tsx`: la misma puerta que la lista (D-570, solo admins por ahora). El servidor solo dice
 * quién mira; los pares los lee la pantalla con la sesión de quien mira (RLS de la 189), y juntar o rechazar es una
 * llamada a la base que vuelve a comprobar quién puede (`erp.customers_can_write()`).
 */
export default async function JuntarPage() {
  if (SIN_BASE) {
    return (
      <>
        <BarraDeClientes role="admin" fullName="Demo" email="demo@example.com" moduleAccess={null} />
        <DecidirJuntar demo puedeEditar />
      </>
    );
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let role: UserRole = "sales";
  let fullName: string | null = null;
  let moduleAccess: string[] | null = null;
  if (user) {
    const { data: perfil, error: errorPerfil } = await supabase.from("profiles").select("full_name, role, module_access").eq("id", user.id).maybeSingle();
    // El fallo de lectura no manda a nadie a otro sitio (D-753, misma guarda que el layout): se enseña y se reintenta.
    if (estadoDeLectura({ data: perfil, error: errorPerfil }) === "fallo") return <ProfileReadError error={errorPerfil!} verDetalle={puedeVerDetalle(user)} />;
    role = (perfil?.role as UserRole | undefined) ?? "sales";
    fullName = perfil?.full_name?.trim() || null;
    moduleAccess = (perfil?.module_access as string[] | null) ?? null;
  }
  // D-748: juntar empresas es cosa del admin; a los demás, la lista.
  if (role !== "admin") redirect("/customers");
  return (
    <>
      <BarraDeClientes role={role} fullName={fullName} email={user?.email ?? ""} moduleAccess={moduleAccess} />
      <DecidirJuntar demo={false} puedeEditar={puedeEditar(role)} />
    </>
  );
}

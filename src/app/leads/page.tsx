import { createClient } from "@/lib/supabase/server";
import type { Persona } from "@/lib/leads/reglas";
import { tieneEstimador } from "@/lib/leads/cotizar";
import { Leads } from "./Leads";

export const dynamic = "force-dynamic";
const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

/**
 * «Leads» (migración 162): el banco de leads de permisos de obra por tienda, y el pool personal de cada vendedor.
 *
 * El servidor solo dice QUIÉN mira (id, nombre, su tienda y si es admin): con eso la pantalla entra en el pool de su
 * tienda y sabe qué es suyo. Los leads los lee la pantalla con la sesión de quien mira, para que la RLS de la 162 sea
 * la que decide; y que sea admin aquí solo enseña botones: las funciones de la base lo vuelven a comprobar.
 * La puerta (quién entra) está en `layout.tsx`.
 */
export default async function LeadsPage() {
  if (SIN_BASE) return <Leads demo yo={null} cotiza />;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let yo: Persona | null = null;
  let cotiza = false;
  if (user) {
    const { data } = await supabase.from("profiles").select("full_name, store, role, module_access").eq("id", user.id).maybeSingle();
    yo = { id: user.id, name: data?.full_name?.trim() || user.email || "—", store: data?.store ?? null, admin: data?.role === "admin" };
    // ¿Tiene el Quote Builder? (D-NEXT) Solo decide si se ofrece «Crear cotización» y se cuentan las cotizaciones de
    // cada lead; la puerta del Quote Builder y la RLS de la 148 lo vuelven a exigir.
    cotiza = tieneEstimador(data);
  }
  return <Leads demo={false} yo={yo} cotiza={cotiza} />;
}

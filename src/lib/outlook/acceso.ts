/**
 * Quién puede tocar la conexión de Outlook: solo un admin con sesión. SOLO SERVIDOR.
 */
import { createClient } from "@/lib/supabase/server";

export type AccesoOutlook = { ok: true; userId: string } | { ok: false; codigo: "sin-sesion" | "no-admin" | "base" };

export async function requireAdminOutlook(): Promise<AccesoOutlook> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, codigo: "sin-sesion" };
  const { data: yo, error } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (error) return { ok: false, codigo: "base" };
  if (yo?.role !== "admin") return { ok: false, codigo: "no-admin" };
  return { ok: true, userId: user.id };
}

"use server";

import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";

/** Let the signed-in user set their own account language (English / Español). */
export async function setLanguage(lang: "en" | "es"): Promise<{ ok: boolean; message?: string }> {
  if (lang !== "en" && lang !== "es") return { ok: false, message: "Invalid language." };
  if (!isSupabaseConfigured) return { ok: false, message: "Not configured." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  const { error } = await supabase.from("profiles").update({ language: lang }).eq("id", user.id);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/**
 * El idioma de avisos de quien pregunta.
 *
 * Hacía falta al traer ese campo a Mi cuenta de Time Tracker (fusión de vistas #1): esa
 * pantalla lee de su proveedor, y el proveedor no conoce esta columna — vive en
 * clockin.employee_settings, no en el perfil compartido. Antes que ensanchar el proveedor
 * con un campo que usa una sola casilla, la casilla se lo pregunta al servidor.
 *
 * Devuelve 'en' si no hay nada: es el mismo respaldo que usa la vista clockin.profiles, y
 * dos respaldos distintos para el mismo dato acabarían discrepando.
 */
export async function getMyLanguage(): Promise<"en" | "es"> {
  if (!isSupabaseConfigured) return "en";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "en";
  const { data } = await supabase.from("profiles").select("language").eq("id", user.id).maybeSingle();
  return data?.language === "es" ? "es" : "en";
}

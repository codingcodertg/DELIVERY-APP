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

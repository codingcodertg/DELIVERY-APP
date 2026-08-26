"use server";

import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";

export async function addNote(text: string): Promise<{ ok: boolean; message?: string }> {
  if (!isSupabaseConfigured) return { ok: false, message: "Not configured." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const note = text.trim();
  if (!note) return { ok: false, message: "Write something first." };

  const { data: me } = await supabase.from("profiles").select("company_id").eq("id", user.id).single();
  if (!me) return { ok: false, message: "No profile." };

  const { error } = await supabase
    .from("notes_log")
    .insert({ company_id: me.company_id, employee_id: user.id, note });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

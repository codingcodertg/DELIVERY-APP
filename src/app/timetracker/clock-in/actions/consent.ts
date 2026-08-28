"use server";

import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";

/** Record the employee's location-use consent (timestamp on their profile). */
export async function acceptConsent(): Promise<{ ok: boolean; message?: string }> {
  if (!isSupabaseConfigured) return { ok: false, message: "Not configured." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const { error } = await supabase
    .from("profiles")
    .update({ location_consent_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

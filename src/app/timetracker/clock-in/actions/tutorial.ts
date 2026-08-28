"use server";

import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";

/** Record that the signed-in user has seen the first-login tutorial (per account). */
export async function markTutorialSeen(): Promise<{ ok: boolean }> {
  if (!isSupabaseConfigured) return { ok: false };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const { error } = await supabase
    .from("profiles")
    .update({ tutorial_seen_at: new Date().toISOString() })
    .eq("id", user.id);
  return { ok: !error };
}

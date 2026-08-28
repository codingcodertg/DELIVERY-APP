"use server";

import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";

/** Mark all of the current user's notifications as read. */
export async function markAllRead(): Promise<{ ok: boolean }> {
  if (!isSupabaseConfigured) return { ok: false };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("employee_id", user.id)
    .eq("read", false);
  return { ok: !error };
}

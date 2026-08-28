"use server";

import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { sendPush } from "@/lib/clockin/push";

type Sub = { endpoint: string; p256dh: string; auth: string };

async function getUser() {
  if (!isSupabaseConfigured) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase, user } : null;
}

/** Save (or refresh) a browser push subscription for the signed-in employee. */
export async function saveSubscription(sub: Sub): Promise<{ ok: boolean; message?: string }> {
  const ctx = await getUser();
  if (!ctx) return { ok: false, message: "Not signed in." };
  const { supabase, user } = ctx;
  const { data: me } = await supabase.from("profiles").select("company_id").eq("id", user.id).single();
  if (!me) return { ok: false, message: "No profile." };

  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      {
        company_id: me.company_id,
        employee_id: user.id,
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
      },
      { onConflict: "endpoint" },
    );
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function deleteSubscription(endpoint: string): Promise<{ ok: boolean }> {
  const ctx = await getUser();
  if (!ctx) return { ok: false };
  await ctx.supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  return { ok: true };
}

/** Send a test push to all of the signed-in user's devices. */
export async function sendTestPush(): Promise<{ ok: boolean; sent: number }> {
  const ctx = await getUser();
  if (!ctx) return { ok: false, sent: 0 };
  const { supabase, user } = ctx;
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("employee_id", user.id);
  let sent = 0;
  for (const s of subs ?? []) {
    const res = await sendPush(s as Sub, {
      title: "RTG Clock-In ✅",
      body: "Notifications are working — you'll get shift reminders here.",
      url: "/timetracker/clock-in/clock",
    });
    if (res.ok) sent++;
    if (res.gone) await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
  }
  return { ok: true, sent };
}

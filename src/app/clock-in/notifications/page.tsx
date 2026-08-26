import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { dateTime } from "@/lib/clockin/time";
import { t, type Lang } from "@/lib/clockin/i18n";
import AppHeader from "@/components/clockin/AppHeader";
import MarkReadOnView from "./MarkReadOnView";

export const dynamic = "force-dynamic";

type Notif = { id: string; type: string; message: string; read: boolean; created_at: string };

// Icon by message family (notification `type` is a dedup key like "shift_reminder:<id>").
const ICON: Record<string, string> = {
  shift_reminder: "⏰",
  shift_now: "⏰",
  not_clocked_in: "⚠️",
  shift_ending: "🔔",
  forgot_clockout: "🔴",
  approaching_ot: "📈",
  overtime: "📈",
  away_overdue: "📍",
  great_week: "🎉",
  timeoff_approved: "✅",
  timeoff_denied: "🚫",
  mgr_late: "⚠️",
  mgr_forgot_clockout: "🔴",
  mgr_away_overdue: "📍",
  mgr_offsite: "📍",
  mgr_offsite_out: "📍",
  mgr_unscheduled: "❓",
  mgr_timeoff_request: "🗓️",
  payroll_verify: "🧾",
  mgr_payroll_approve: "🧾",
  store_ready: "✅",
  admin_clocked_in: "🟢",
  admin_clocked_out: "🔴",
};

export default async function NotificationsPage() {
  if (!isSupabaseConfigured) redirect("/clock-in/clock");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("language, location_consent_at")
    .eq("id", user.id)
    .single();
  if (profile && !profile.location_consent_at) redirect("/clock-in/welcome");
  const lang = (profile?.language === "es" ? "es" : "en") as Lang;
  const tr = t(lang);

  const { data: rows } = await supabase
    .from("notifications")
    .select("id, type, message, read, created_at")
    .eq("employee_id", user.id)
    .order("created_at", { ascending: false })
    .limit(60);
  const items: Notif[] = rows ?? [];
  const hasUnread = items.some((n) => !n.read);

  return (
    <main className="flex-1 w-full max-w-md mx-auto p-5 flex flex-col gap-5">
      <MarkReadOnView hasUnread={hasUnread} />
      <AppHeader title={tr.notifications} />

      {items.length === 0 ? (
        <p className="text-sm text-zinc-400 text-center mt-8">{tr.noNotifications}</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((n) => {
            const base = n.type.split(":")[0];
            return (
              <li
                key={n.id}
                className={`flex gap-3 py-3 border-t border-zinc-100 dark:border-zinc-900 first:border-0 ${
                  n.read ? "" : "bg-emerald-50/40 dark:bg-emerald-950/10 -mx-2 px-2 rounded-lg"
                }`}
              >
                <span className="text-xl leading-none mt-0.5">{ICON[base] ?? "🔔"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-800 dark:text-zinc-200">{n.message}</p>
                  <p className="text-xs text-zinc-400 mt-0.5">{dateTime(n.created_at)}</p>
                </div>
                {!n.read && <span className="mt-1 h-2 w-2 rounded-full bg-emerald-500 shrink-0" />}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

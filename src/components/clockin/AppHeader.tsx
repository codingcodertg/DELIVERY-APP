import Link from "next/link";
import type { ReactNode } from "react";
import { createClient } from "@/lib/clockin/supabase/server";
import { t, type Lang } from "@/lib/clockin/i18n";
import NavMenu from "@/app/timetracker/clock-in/clock/NavMenu";
import HubLink from "./HubLink";

/**
 * Shared header for every employee-facing sub-page: a Home button (back to the
 * clock screen) on the left and the full hamburger menu on the right, so the
 * user never has to rely on the browser's swipe-back gesture to get around.
 * Fetches its own language / role / unread count so pages stay one-liners.
 */
export default async function AppHeader({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("language, role").eq("id", user.id).single()
    : { data: null };
  const lang = (profile?.language === "es" ? "es" : "en") as Lang;
  const tr = t(lang);
  const isManager = profile?.role === "manager" || profile?.role === "owner";
  const isOwner = profile?.role === "owner";

  let unread = 0;
  if (user) {
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", user.id)
      .eq("read", false);
    unread = count ?? 0;
  }

  return (
    <header className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <HubLink lang={lang} />
        <Link
          href="/timetracker/clock-in/clock"
          aria-label={tr.home}
          className="flex items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 h-10 px-3 text-sm font-semibold hover:border-brand-400 transition-colors shrink-0"
        >
          <span aria-hidden>🏠</span>
          {tr.home}
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl font-bold truncate">{title}</h1>
          {subtitle && <p className="text-sm text-zinc-500 truncate">{subtitle}</p>}
        </div>
      </div>
      <NavMenu lang={lang} isManager={isManager} isOwner={isOwner} unread={unread} />
    </header>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { t, type Lang } from "@/lib/clockin/i18n";
import AddSiteForm from "./AddSiteForm";
import SiteRow from "./SiteRow";

export const dynamic = "force-dynamic";

export default async function SitesPage() {
  if (!isSupabaseConfigured) redirect("/clock-in/clock");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role, company_id, language")
    .eq("id", user.id)
    .single();
  // Job sites (geofences) are owner-only.
  if (!me || me.role !== "owner") redirect("/clock-in/clock");
  const lang = (me.language === "es" ? "es" : "en") as Lang;
  const base = t(lang);
  const tr = base.mgr;

  const { data: sites } = await supabase
    .from("job_sites")
    .select("id, name, latitude, longitude, radius_meters, active, boundary, padding_meters")
    .eq("company_id", me.company_id)
    .order("active", { ascending: false })
    .order("name");

  const list = sites ?? [];

  return (
    <main className="flex-1 w-full max-w-2xl mx-auto p-5 flex flex-col gap-6">
      <header className="flex items-center gap-2.5">
        <Link
          href="/clock-in/clock"
          aria-label={base.home}
          className="flex items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 h-11 px-3 text-sm font-semibold hover:border-emerald-400 transition-colors shrink-0"
        >
          <span aria-hidden>🏠</span>
          {base.home}
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl font-bold truncate">{tr.jobSites}</h1>
          <p className="text-sm text-zinc-500 truncate">{tr.sitesSubtitle}</p>
        </div>
      </header>

      <AddSiteForm lang={lang} />

      <details className="rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <summary className="cursor-pointer list-none flex items-center justify-between gap-2 px-5 py-4 bg-zinc-50 dark:bg-zinc-900/50 hover:bg-zinc-100 dark:hover:bg-zinc-900">
          <span className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            📍 {tr.sites} ({list.length})
          </span>
          <span className="text-zinc-400">▾</span>
        </summary>
        <div className="p-5 pt-2">
          {list.length === 0 ? (
            <p className="text-sm text-zinc-400">{tr.noSites}</p>
          ) : (
            <ul className="flex flex-col">
              {list.map((s) => (
                <SiteRow key={s.id} site={s} lang={lang} />
              ))}
            </ul>
          )}
        </div>
      </details>
    </main>
  );
}

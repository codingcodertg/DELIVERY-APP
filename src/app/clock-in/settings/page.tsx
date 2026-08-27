import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { t, type Lang } from "@/lib/clockin/i18n";
import HubLink from "@/components/clockin/HubLink";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (!isSupabaseConfigured) redirect("/clock-in/clock");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("profiles").select("role, language").eq("id", user.id).single();
  if (!me || (me.role !== "manager" && me.role !== "owner")) redirect("/clock-in/clock");
  const lang = (me.language === "es" ? "es" : "en") as Lang;
  const tr = t(lang);
  const m = tr.mgr;
  const isOwner = me.role === "owner";

  const cards: { href: string; icon: string; label: string; desc: string }[] = [
    // People moved to Users on the hub (D-095); what is left here is the fleet.
    { href: "/clock-in/team", icon: "🚚", label: m.vehicles, desc: m.settingsVehiclesDesc },
    // Job sites (geofences) are owner-only.
    ...(isOwner ? [{ href: "/clock-in/sites", icon: "📍", label: m.jobSites, desc: m.settingsSitesDesc }] : []),
    { href: "/clock-in/account", icon: "⚙️", label: tr.account, desc: m.settingsAccountDesc },
  ];

  return (
    <main className="flex-1 w-full max-w-2xl mx-auto p-5 flex flex-col gap-5">
      <header className="flex items-center gap-2.5">
        <HubLink lang={lang} />
        <Link
          href="/clock-in/clock"
          aria-label={tr.home}
          className="flex items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 h-11 px-3 text-sm font-semibold hover:border-emerald-400 transition-colors shrink-0"
        >
          <span aria-hidden>🏠</span>
          {tr.home}
        </Link>
        <h1 className="text-xl font-bold truncate">{m.settings}</h1>
      </header>
      <div className="grid grid-cols-1 gap-3">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="flex items-center gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 hover:border-emerald-400 transition-colors"
          >
            <span className="text-2xl" aria-hidden>{c.icon}</span>
            <span className="min-w-0">
              <span className="block font-semibold">{c.label}</span>
              <span className="block text-sm text-zinc-500 truncate">{c.desc}</span>
            </span>
            <span className="ml-auto text-emerald-600">→</span>
          </Link>
        ))}
      </div>
    </main>
  );
}

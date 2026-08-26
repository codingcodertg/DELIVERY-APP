import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { t, type Lang } from "@/lib/clockin/i18n";
import { storeScope } from "@/lib/clockin/scope";
import AddEmployeeForm from "./AddEmployeeForm";
import TeamList from "./TeamList";
import VehiclesManager from "./VehiclesManager";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  if (!isSupabaseConfigured) redirect("/clock-in/clock");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role, company_id, language, store_id")
    .eq("id", user.id)
    .single();
  if (!me || (me.role !== "manager" && me.role !== "owner")) redirect("/clock-in/clock");
  const lang = (me.language === "es" ? "es" : "en") as Lang;
  const base = t(lang);
  const tr = base.mgr;
  const isOwner = me.role === "owner";

  // Store-scoping: a manager with a home store manages only their store's crew.
  const { scopeStore } = await storeScope(supabase, me.company_id, me.role, me.store_id);

  let peopleQ = supabase
    .from("profiles")
    .select("id, full_name, role, position, language, active, store_id, default_schedule, custom_schedule, is_runner, vehicle_id")
    .eq("company_id", me.company_id);
  if (scopeStore) peopleQ = peopleQ.eq("store_id", scopeStore);
  // The owner is invisible to managers — only the owner sees owners.
  if (me.role !== "owner") peopleQ = peopleQ.neq("role", "owner");

  const [{ data: people }, { data: sites }, { data: vehicles }] = await Promise.all([
    peopleQ.order("active", { ascending: false }).order("full_name"),
    supabase.from("job_sites").select("id, name").eq("company_id", me.company_id).eq("active", true).order("name"),
    supabase.from("vehicles").select("id, name, plate, active").eq("company_id", me.company_id).order("name"),
  ]);

  const list = people ?? [];
  const siteList = sites ?? [];
  const vehicleList = vehicles ?? [];

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
          <h1 className="text-xl font-bold truncate">{tr.team}</h1>
          <p className="text-sm text-zinc-500 truncate">{list.filter((p) => p.active).length} {tr.activeWord}</p>
        </div>
      </header>

      <AddEmployeeForm lang={lang} sites={siteList} />

      <VehiclesManager vehicles={vehicleList} lang={lang} />

      <TeamList people={list} sites={siteList} vehicles={vehicleList} lang={lang} isOwner={isOwner} userId={user.id} />
    </main>
  );
}

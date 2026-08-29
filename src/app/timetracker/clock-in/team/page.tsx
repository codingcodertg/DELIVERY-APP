import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { t, type Lang } from "@/lib/clockin/i18n";
import VehiclesManager from "./VehiclesManager";
import HubLink from "@/components/clockin/HubLink";

export const dynamic = "force-dynamic";

/**
 * Vehicles (D-095).
 *
 * This was the Team screen: add an employee, then a row per person with their position, schedule,
 * job site, runner vehicle, activate/deactivate and a password reset. All of that was configuration
 * of a PERSON, and this app already has one place for that — Users on the hub, where the same
 * person's deliveries role, recruiting access and ERP access are set. Two lists of the same staff,
 * each showing a different half of them, is how someone ends up deactivated in one and active in
 * the other.
 *
 * So the crew half moved into the Users dialog and this route kept the fleet, which is the one
 * thing here that is not about a person at all. The path is /timetracker/clock-in/team since 3b, with a redirect from the old one, so nobody's bookmark
 * breaks.
 */
export default async function VehiclesPage() {
  if (!isSupabaseConfigured) redirect("/timetracker/clock-in/clock");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role, company_id, language")
    .eq("id", user.id)
    .maybeSingle();
  if (!me || (me.role !== "manager" && me.role !== "owner")) redirect("/timetracker/clock-in/clock");
  const lang = (me.language === "es" ? "es" : "en") as Lang;
  const base = t(lang);
  const tr = base.mgr;

  const { data: vehicles } = await supabase
    .from("vehicles")
    .select("id, name, plate, active")
    .eq("company_id", me.company_id)
    .order("name");

  return (
    <main className="flex-1 w-full max-w-2xl mx-auto p-5 flex flex-col gap-6">
      <header className="flex items-center gap-2.5">
        <HubLink lang={lang} />
        <Link
          href="/timetracker/clock-in/clock"
          aria-label={base.home}
          className="flex items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 h-10 px-3 text-sm font-semibold hover:border-emerald-400 transition-colors shrink-0"
        >
          <span aria-hidden>🏠</span>
          {base.home}
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl font-bold truncate">{tr.vehicles}</h1>
          <p className="text-sm text-zinc-500 truncate">{(vehicles ?? []).filter((v) => v.active).length} {tr.activeWord}</p>
        </div>
      </header>

      <VehiclesManager vehicles={vehicles ?? []} lang={lang} />

      {/* Said here rather than left as a screen people keep looking for. */}
      <p className="text-sm text-zinc-500 border-t border-zinc-200 dark:border-zinc-800 pt-4">
        {lang === "es"
          ? "Las personas —puesto, horario, sitio, repartidor y si cuentan tiempo— se configuran en Usuarios, en el hub."
          : "People — position, schedule, site, runner and whether they count time — are configured in Users, on the hub."}{" "}
        <Link href="/home/users" className="text-emerald-600 font-medium hover:underline">
          {lang === "es" ? "Ir a Usuarios →" : "Go to Users →"}
        </Link>
      </p>
    </main>
  );
}

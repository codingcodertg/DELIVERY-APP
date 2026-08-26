import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { t, type Lang } from "@/lib/clockin/i18n";
import AppHeader from "@/components/clockin/AppHeader";
import { centralDateStr, fmtDate } from "@/lib/clockin/schedule";
import { storeScope, NO_MATCH } from "@/lib/clockin/scope";
import TimeOffForm from "./TimeOffForm";
import ReviewButtons from "./ReviewButtons";

export const dynamic = "force-dynamic";

type Req = {
  id: string;
  employee_id?: string;
  type: string;
  start_date: string;
  end_date: string;
  note: string | null;
  status: string;
  manager_comment: string | null;
};

function StatusBadge({ status, lang }: { status: string; lang: Lang }) {
  const tr = t(lang);
  const cls =
    status === "approved"
      ? "bg-emerald-100 text-emerald-700"
      : status === "denied"
        ? "bg-red-100 text-red-700"
        : "bg-amber-100 text-amber-700";
  return (
    <span className={`text-xs rounded-full px-2 py-0.5 ${cls}`}>
      {tr.status[status as keyof typeof tr.status] ?? status}
    </span>
  );
}

export default async function TimeOffPage() {
  if (!isSupabaseConfigured) redirect("/clock-in/clock");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, company_id, language, store_id")
    .eq("id", user.id)
    .single();
  const lang = (profile?.language === "es" ? "es" : "en") as Lang;
  const tr = t(lang);
  const isManager = profile?.role === "manager" || profile?.role === "owner";

  const { data: mineRows } = await supabase
    .from("time_off_requests")
    .select("id, type, start_date, end_date, note, status, manager_comment")
    .eq("employee_id", user.id)
    .order("created_at", { ascending: false });
  const mine: Req[] = mineRows ?? [];

  let pending: Req[] = [];
  const nameOf = new Map<string, string>();
  if (isManager) {
    // Store-scoping: a manager with a home store reviews only their store's requests.
    const { scopeStore, ids } = await storeScope(supabase, profile!.company_id, profile!.role, profile!.store_id);
    const inEmp = ids ? (ids.length ? ids : NO_MATCH) : null;

    let pendingQ = supabase
      .from("time_off_requests")
      .select("id, employee_id, type, start_date, end_date, note, status, manager_comment")
      .eq("status", "pending");
    if (inEmp) pendingQ = pendingQ.in("employee_id", inEmp);

    let peopleQ = supabase.from("profiles").select("id, full_name").eq("company_id", profile!.company_id);
    if (scopeStore) peopleQ = peopleQ.eq("store_id", scopeStore);
    if (profile!.role !== "owner") peopleQ = peopleQ.neq("role", "owner"); // owner invisible to managers

    const [{ data: pendingRows }, { data: people }] = await Promise.all([pendingQ.order("created_at"), peopleQ]);
    pending = pendingRows ?? [];
    for (const p of people ?? []) nameOf.set(p.id, p.full_name);
  }

  return (
    <main className="flex-1 w-full max-w-2xl mx-auto p-5 flex flex-col gap-6">
      <AppHeader title={tr.timeOff} />

      <TimeOffForm lang={lang} defaultDate={centralDateStr()} />

      {/* Manager: pending approvals */}
      {isManager && (
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            {tr.pendingApprovals} ({pending.length})
          </h2>
          {pending.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-400">{tr.noPending}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {pending.map((r) => (
                <li key={r.id} className="rounded-xl border border-zinc-100 dark:border-zinc-900 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{nameOf.get(r.employee_id ?? "") ?? "Unknown"}</span>
                    <span className="text-zinc-500">
                      {tr.timeOffTypes[r.type as keyof typeof tr.timeOffTypes] ?? r.type}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {fmtDate(r.start_date)} → {fmtDate(r.end_date)}
                    {r.note ? ` · “${r.note}”` : ""}
                  </p>
                  <ReviewButtons id={r.id} lang={lang} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* My requests */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{tr.myRequests}</h2>
        {mine.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">{tr.noRequests}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {mine.map((r) => (
              <li key={r.id} className="flex items-start justify-between text-sm border-t border-zinc-100 dark:border-zinc-900 pt-2 first:border-0 first:pt-0">
                <div>
                  <span className="font-medium">
                    {tr.timeOffTypes[r.type as keyof typeof tr.timeOffTypes] ?? r.type}
                  </span>
                  <p className="text-xs text-zinc-500">
                    {fmtDate(r.start_date)} → {fmtDate(r.end_date)}
                  </p>
                  {r.manager_comment && (
                    <p className="text-xs text-zinc-400 italic mt-0.5">“{r.manager_comment}”</p>
                  )}
                </div>
                <StatusBadge status={r.status} lang={lang} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

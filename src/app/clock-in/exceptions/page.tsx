import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { timeOnly, dateTime } from "@/lib/clockin/time";
import { t, type Lang } from "@/lib/clockin/i18n";
import { storeScope, NO_MATCH } from "@/lib/clockin/scope";
import ManagerHeader from "@/components/clockin/ManagerHeader";
import ResolveButton from "./ResolveButton";

export const dynamic = "force-dynamic";

type Exc = {
  id: string;
  employee_id: string;
  type: string;
  reason: string | null;
  note: string | null;
  photo_path: string | null;
  left_at: string | null;
  expected_return_at: string | null;
  returned_at: string | null;
  resolved: boolean;
  created_at: string;
};

export default async function ExceptionsPage() {
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
  const tr = t(lang).mgr;
  const TYPE_LABEL: Record<string, string> = {
    out_of_radius: tr.typeOffSite,
    leaving_while_clocked_in: tr.typeLeft,
    missed_punch: tr.typeMissed,
    other: tr.typeOther,
  };

  // Store-scoping: a manager with a home store reviews only their store's exceptions.
  const { scopeStore, ids } = await storeScope(supabase, me.company_id, me.role, me.store_id);
  const inEmp = ids ? (ids.length ? ids : NO_MATCH) : null;

  let excQ = supabase
    .from("exceptions")
    .select(
      "id, employee_id, type, reason, note, photo_path, left_at, expected_return_at, returned_at, resolved, created_at",
    );
  if (inEmp) excQ = excQ.in("employee_id", inEmp);

  let peopleQ = supabase.from("profiles").select("id, full_name").eq("company_id", me.company_id);
  if (scopeStore) peopleQ = peopleQ.eq("store_id", scopeStore);

  const [{ data: rows }, { data: people }] = await Promise.all([
    excQ.order("created_at", { ascending: false }).limit(60),
    peopleQ,
  ]);

  const exceptions: Exc[] = rows ?? [];
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name]));

  // Signed URLs for photos (private bucket; manager can read same-company objects).
  const photoUrl = new Map<string, string>();
  for (const ex of exceptions) {
    if (ex.photo_path) {
      const { data } = await supabase.storage
        .from("exception-photos")
        .createSignedUrl(ex.photo_path, 3600);
      if (data?.signedUrl) photoUrl.set(ex.id, data.signedUrl);
    }
  }

  const unresolved = exceptions.filter((e) => !e.resolved);
  const resolved = exceptions.filter((e) => e.resolved);

  function Row({ e }: { e: Exc }) {
    return (
      <li className="flex gap-3 py-3 border-t border-zinc-100 dark:border-zinc-900 first:border-0">
        {photoUrl.has(e.id) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl.get(e.id)}
            alt="verification"
            className="h-16 w-16 rounded-lg object-cover border border-zinc-200 dark:border-zinc-800"
          />
        ) : (
          <div className="h-16 w-16 rounded-lg bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-zinc-300 text-xs">
            {tr.noPhoto}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm">
            <span className="font-medium">{nameOf.get(e.employee_id) ?? "Unknown"}</span>
            <span className="text-zinc-500"> · {TYPE_LABEL[e.type] ?? e.type}</span>
          </p>
          <p className="text-xs text-zinc-500">
            {e.reason ? e.reason.replace(/_/g, " ") : "—"}
            {e.note ? ` · “${e.note}”` : ""}
          </p>
          <p className="text-xs text-zinc-400">
            {dateTime(e.created_at)}
            {e.left_at && e.returned_at ? ` · ${tr.backAt} ${timeOnly(e.returned_at)}` : ""}
            {e.left_at && !e.returned_at ? ` · ${tr.stillOut}` : ""}
          </p>
        </div>
        {!e.resolved && <ResolveButton id={e.id} lang={lang} />}
      </li>
    );
  }

  return (
    <main className="flex-1 w-full max-w-2xl mx-auto p-5 flex flex-col gap-6">
      <ManagerHeader lang={lang} active="exceptions" title={tr.exceptions} subtitle={tr.exceptionsSubtitle} isOwner={me.role === "owner"} />

      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          {tr.needsReview} ({unresolved.length})
        </h2>
        {unresolved.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">{tr.allClear}</p>
        ) : (
          <ul className="mt-2 flex flex-col">
            {unresolved.map((e) => (
              <Row key={e.id} e={e} />
            ))}
          </ul>
        )}
      </section>

      {resolved.length > 0 && (
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 opacity-80">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{tr.reviewed}</h2>
          <ul className="mt-2 flex flex-col">
            {resolved.map((e) => (
              <Row key={e.id} e={e} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

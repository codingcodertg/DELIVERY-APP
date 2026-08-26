import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { t, type Lang } from "@/lib/clockin/i18n";
import AppHeader from "@/components/clockin/AppHeader";
import AddNoteForm from "./AddNoteForm";

export const dynamic = "force-dynamic";

function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
}

export default async function NotesPage() {
  if (!isSupabaseConfigured) redirect("/clock-in/clock");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("language")
    .eq("id", user.id)
    .single();
  const lang = (profile?.language === "es" ? "es" : "en") as Lang;
  const tr = t(lang);

  const { data: notes } = await supabase
    .from("notes_log")
    .select("id, note, created_at")
    .eq("employee_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const list = notes ?? [];

  return (
    <main className="flex-1 w-full max-w-2xl mx-auto p-5 flex flex-col gap-6">
      <AppHeader title={tr.dailyNotes} />

      <AddNoteForm lang={lang} />

      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
        {list.length === 0 ? (
          <p className="text-sm text-zinc-400">{tr.noNotesYet}</p>
        ) : (
          <ul className="flex flex-col">
            {list.map((n) => (
              <li
                key={n.id}
                className="py-3 border-t border-zinc-100 dark:border-zinc-900 first:border-0"
              >
                <p className="text-sm">{n.note}</p>
                <p className="text-xs text-zinc-400 mt-0.5">{when(n.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

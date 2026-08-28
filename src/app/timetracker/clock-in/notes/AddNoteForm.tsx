"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addNote } from "@/app/timetracker/clock-in/actions/notes";
import { t, type Lang } from "@/lib/clockin/i18n";
import { btn, field } from "@/lib/clockin/ui";

export default function AddNoteForm({ lang }: { lang: Lang }) {
  const tr = t(lang);
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    const res = await addNote(text);
    setBusy(false);
    if (!res.ok) {
      setError(res.message ?? "Couldn't save.");
      return;
    }
    setText("");
    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{tr.addNote}</h2>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={tr.notePlaceholder}
        rows={3}
        className={`${field} resize-none`}
      />
      <button onClick={save} disabled={busy || !text.trim()} className={btn("primary", "md")}>
        {busy ? "…" : tr.saveNote}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

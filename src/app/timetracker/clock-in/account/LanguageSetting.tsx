"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setLanguage } from "@/app/timetracker/clock-in/actions/account";
import { t, type Lang } from "@/lib/clockin/i18n";

export default function LanguageSetting({ lang }: { lang: Lang }) {
  const tr = t(lang);
  const router = useRouter();
  const [current, setCurrent] = useState<Lang>(lang);
  const [busy, setBusy] = useState<Lang | null>(null);
  const [saved, setSaved] = useState(false);

  async function choose(next: Lang) {
    if (next === current || busy) return;
    setBusy(next);
    setSaved(false);
    const res = await setLanguage(next);
    setBusy(null);
    if (res.ok) {
      setCurrent(next);
      setSaved(true);
      router.refresh(); // re-render the whole app in the new language
    }
  }

  const opts: { key: Lang; label: string }[] = [
    { key: "en", label: tr.english },
    { key: "es", label: tr.spanish },
  ];

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{tr.languageLabel}</h2>
      <div className="grid grid-cols-2 gap-2">
        {opts.map((o) => {
          const active = current === o.key;
          return (
            <button
              key={o.key}
              onClick={() => choose(o.key)}
              disabled={busy !== null}
              aria-pressed={active}
              className={`min-h-[48px] rounded-xl border px-4 py-3 text-base font-semibold transition-colors disabled:opacity-60 ${
                active
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                  : "border-zinc-300 dark:border-zinc-700 hover:border-emerald-400"
              }`}
            >
              {busy === o.key ? "…" : `${active ? "✓ " : ""}${o.label}`}
            </button>
          );
        })}
      </div>
      {saved && <p className="text-sm text-emerald-600">{tr.languageSaved}</p>}
    </div>
  );
}
